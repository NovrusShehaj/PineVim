/**
 * Session cost ceiling (Tier 2 #6).
 *
 * Pure decision logic over the existing TokenBudget accumulator — the same
 * object the deck's cost chip renders, so the warning, the chip, and the
 * stop decision cannot disagree. Enforcement (when to abort) lives with the
 * extension's event handlers; this module answers "what should happen now".
 */
import type { TokenBudget } from "./runs.js";

export interface BudgetConfig {
  warnAt: number | null;
  stopAt: number | null;
}

export const BUDGET_DISABLED: BudgetConfig = { warnAt: null, stopAt: null };

/** True when this config can never warn or stop. */
export function budgetDisabled(c: BudgetConfig): boolean {
  return c.warnAt === null && c.stopAt === null;
}

/**
 * Validate a parsed `ui.budget` object. Repo convention: malformed values
 * are PineError("CONFIG", ...); absent/empty objects mean disabled.
 */
export function validateBudgetInput(
  value: unknown,
  fail: (message: string) => never,
): { warnAt?: number; stopAt?: number } {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    fail("ui.budget must be an object.");
  const out: { warnAt?: number; stopAt?: number } = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== "warnAt" && key !== "stopAt")
      fail("Unknown field in ui.budget; allowed: warnAt, stopAt.");
    if (typeof item !== "number" || !Number.isFinite(item) || item <= 0)
      fail(`ui.budget.${key} must be a positive number of dollars.`);
    out[key] = item;
  }
  if (
    out.warnAt !== undefined &&
    out.stopAt !== undefined &&
    out.warnAt > out.stopAt
  )
    fail("ui.budget.warnAt must not exceed ui.budget.stopAt.");
  return out;
}

export type BudgetAction =
  { kind: "none" } | { kind: "warn" } | { kind: "stop" };

/** Latched guard state for one session. */
export class BudgetGuard {
  private warned = false;
  private stopped = false;

  constructor(private readonly config: BudgetConfig) {}

  get warnAt(): number | null {
    return this.config.warnAt;
  }

  get stopAt(): number | null {
    return this.config.stopAt;
  }

  get hasWarned(): boolean {
    return this.warned;
  }

  get hasStopped(): boolean {
    return this.stopped;
  }

  /**
   * Evaluate the guard against current spend. Emits `warn` at most once per
   * session and `stop` repeatedly once the ceiling is crossed (the stop
   * decision must remain true on every later check; the *notification* is
   * deduplicated by the caller via `hasStopped`).
   */
  evaluate(budget: TokenBudget): BudgetAction {
    const { costTotal } = budget;
    if (this.config.stopAt !== null && costTotal >= this.config.stopAt) {
      this.stopped = true;
      return { kind: "stop" };
    }
    if (
      this.config.warnAt !== null &&
      !this.warned &&
      !this.stopped &&
      costTotal >= this.config.warnAt
    ) {
      this.warned = true;
      return { kind: "warn" };
    }
    return { kind: "none" };
  }

  /** True when a new model run must not start at the current spend. */
  shouldBlockStart(budget: TokenBudget): boolean {
    return (
      this.config.stopAt !== null && budget.costTotal >= this.config.stopAt
    );
  }
}

/** Compact USD text used by warning/stop copy: `$1.234`. */
export function usd(value: number): string {
  return `$${value.toFixed(value < 10 ? 3 : 2)}`;
}

/** One-line reason shown to the user when a run is blocked. */
export function stopMessage(guard: BudgetGuard, budget: TokenBudget): string {
  const limit = guard.stopAt;
  return (
    `Session cost ceiling reached: ${usd(budget.costTotal)} of ${limit === null ? "?" : usd(limit)} limit. ` +
    "Model work is blocked for this session. Raise ui.budget.stopAt in PineVim config or start a new session."
  );
}

/** One-line warning shown once when warnAt is crossed. */
export function warnMessage(guard: BudgetGuard, budget: TokenBudget): string {
  const limit = guard.stopAt;
  return (
    `Session cost warning: ${usd(budget.costTotal)} of ${limit === null ? "?" : usd(limit)} ceiling` +
    (limit === null ? "." : " (model work will stop at the ceiling).")
  );
}
