/**
 * Integration glue between the Pi extension and the Tier 2 subsystems
 * (items #4/#5/#6): durable run indexing, cross-session search, insights,
 * and the cost-ceiling guard.
 *
 * Responsibilities kept out of PiUi so the frame stays presentational:
 * - opens (and migrates) the workspace runs database from PINEVIM_STATE_DIR;
 * - translates Pi lifecycle events into RunIndex writes (best-effort: a
 *   failed index write never breaks an agent run);
 * - evaluates the BudgetGuard at the two enforcement points Pi offers
 *   (before a run starts, and after every settled turn, where abort also
 *   gates every intra-run continuation).
 */
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  RUNS_DB_FILE,
  openRunsDatabase,
  sqliteFactory,
} from "../store/schema.js";
import {
  RunIndex,
  type InsightsSnapshot,
  type RunRecord,
} from "./run-index.js";
import {
  BudgetGuard,
  BUDGET_DISABLED,
  budgetDisabled,
  stopMessage,
  usd,
  warnMessage,
  type BudgetConfig,
} from "./budget.js";
import type { PiUi } from "./index.js";

function envNumber(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Budget config from the controller's environment (unset => disabled). */
export function budgetFromEnv(): BudgetConfig {
  const warnAt = envNumber("PINEVIM_BUDGET_WARN");
  const stopAt = envNumber("PINEVIM_BUDGET_STOP");
  if (warnAt === null && stopAt === null) return BUDGET_DISABLED;
  return { warnAt, stopAt };
}

/** The subsystems one live Pi session uses. */
export interface SessionServices {
  index: RunIndex;
  guard: BudgetGuard;
  /** Opens the current run row; null while unavailable. */
  runRow: number | null;
  /** Set once when stopAt first blocks, so the notice shows exactly once. */
  stopNotified: boolean;
}

export interface Tier2Services {
  index: RunIndex;
  available: boolean;
  /** Greets the user with a notice when the index could not be opened. */
  open(): void;
  newSessionServices(): SessionServices;
  dispose(): void;
}

/** Create per-session services from the environment; never throws. */
export function createTier2Services(): Tier2Services {
  let index: RunIndex | null = null;
  let openError: string | null = null;
  const open = (): void => {
    if (index || openError) return;
    const dir = process.env.PINEVIM_STATE_DIR;
    if (!dir) return; // headless / non-PineVim launch: silently unindexed
    const factory = sqliteFactory();
    if (!factory) {
      openError = "sqlite";
      return;
    }
    try {
      const { db, applied } = openRunsDatabase(
        join(dir, RUNS_DB_FILE),
        factory,
      );
      if (applied.length > 0)
        try {
          // Surface migrations once, verbatim from the registry.
          import("node:process").then(({ default: proc }) =>
            proc.emit("pinevim:migrated", applied),
          );
        } catch {
          /* notice path is best-effort */
        }
      index = new RunIndex(db);
    } catch (error) {
      openError = error instanceof Error ? error.message : String(error);
    }
  };
  return {
    get index() {
      return index ?? new RunIndex(null);
    },
    get available() {
      return index !== null;
    },
    open,
    newSessionServices(): SessionServices {
      const guard = new BudgetGuard(budgetFromEnv());
      return {
        index: index ?? new RunIndex(null),
        guard,
        runRow: null,
        stopNotified: false,
      };
    },
    dispose(): void {
      index = null;
      openError = null;
    },
  };
}

/**
 * Wire run indexing + budget enforcement into the live extension. Called on
 * every session_start, after installUi. Handlers registered here run after
 * PiUi's own wiring so the stop decision sees the usage the frame just
 * accumulated.
 */
export function wireTier2(
  pi: ExtensionAPI,
  ui: PiUi | null,
  context: ExtensionContext,
): void {
  const services = createTier2Services();
  services.open();
  // No proactive notice when the index is unavailable: a missing state dir is
  // normal (headless, embedded hosts), and search/insights explain their own
  // unavailability when the user invokes them.
  let session: SessionServices | null = null;
  const ensureSession = (): SessionServices => {
    if (!session) session = services.newSessionServices();
    return session;
  };

  // #4: the frame reports run lifecycle; this module owns durable rows.
  // PiUi calls open() on agent_start and close() on agent_settled.
  if (ui) {
    ui.runIndexWriter = {
      open: (startedAt) => {
        const s = ensureSession();
        s.runRow = s.index.openRun(null, startedAt);
        return s.runRow;
      },
      close: (id, endedAt, seconds, interrupted) => {
        const s = ensureSession();
        s.index.closeRun(id, endedAt, seconds, interrupted);
        if (s.runRow === id) s.runRow = null;
      },
      tool: (id, name, failed) => {
        const s = ensureSession();
        if (name) s.index.addToolName(id, name);
        if (failed) s.index.addToolCounts(id, 0, 1);
      },
      path: (id, path) => {
        const s = ensureSession();
        s.index.addToolPath(id, path);
      },
      usage: (id, usage) => {
        const s = ensureSession();
        s.index.addUsage(id, usage as RunUsageLike);
      },
    };
  }

  // #6 enforcement point 1: refuse a new run at/over the ceiling before any
  // provider request. abort() inside the awaited handler aborts the run's
  // abort controller before Pi streams; a throw here would be swallowed by
  // Pi's extension error isolation, so abort is the mechanism, not throw.
  pi.on("agent_start", (_event: unknown, ctx: ExtensionContext) => {
    const s = ensureSession();
    const budget = ui?.budgetSnapshot ?? {
      totalTokens: 0,
      costTotal: 0,
      turns: 0,
    };
    if (s.guard.shouldBlockStart(budget)) {
      if (!s.stopNotified) {
        s.stopNotified = true;
        context.ui.notify(stopMessage(s.guard, budget), "warning");
      }
      try {
        ctx.abort();
      } catch {
        /* no active run to abort; the turn_end guard covers the next one */
      }
    }
  });

  // #6 enforcement point 2 + #4 usage capture, after each settled turn.
  pi.on("turn_end", (event: unknown, ctx: ExtensionContext) => {
    const s = ensureSession();
    const message = (event as { message?: { usage?: RunUsageLike } }).message;
    if (s.runRow !== null) s.index.addUsage(s.runRow, message?.usage ?? null);
    const budget = ui?.budgetSnapshot;
    if (!budget) return;
    const action = s.guard.evaluate(budget);
    if (action.kind === "warn") {
      context.ui.notify(warnMessage(s.guard, budget), "warning");
    } else if (action.kind === "stop") {
      if (!s.stopNotified) {
        s.stopNotified = true;
        context.ui.notify(stopMessage(s.guard, budget), "warning");
      }
      // Aborting on turn_end sets Pi's _agentRunAbortRequested, which gates
      // every subsequent agent.continue() in the run loop — the real
      // boundary that prevents the next billable request.
      try {
        ctx.abort();
      } catch {
        /* already settling; the start guard covers the next run */
      }
    }
  });

  pi.on("session_shutdown", () => {
    services.dispose();
    session = null;
  });
}

interface RunUsageLike {
  totalTokens?: unknown;
  cost?: { total?: unknown } | null;
}

// Re-exported types for local command consumers.
export type { InsightsSnapshot, RunRecord };
export { usd, budgetDisabled };
