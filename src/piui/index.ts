/**
 * PineVIM in-pane UI coordinator (plan §6, §14, §17).
 *
 * Installs the PineVIM frame through Pi's public extension hooks:
 *   setHeader(banner), setFooter(deck), setWidget(chip band above editor),
 *   setWorkingIndicator(frames), registerEntryRenderer(turn summaries).
 *
 * Pi 0.87.1 factory semantics (verified in interactive-mode.js): setHeader/
 * setFooter/setWidget factories are invoked synchronously at registration and
 * receive the live TUI as their first argument — ctx.ui itself does NOT expose
 * a tui instance. Components are therefore created inside the factories (which
 * also lets update() drive redraws through tui.requestRender()).
 *
 * Safety gates (plan §21, §29):
 * - capability check: any missing hook => PineVIM UI disabled with a notice;
 * - conflict check: a custom editor already installed by another extension
 *   => stand down (last-writer-wins would silently destroy the user's
 *   customization);
 * - opt-outs from PineVIM config (ui.enabled, ui.motion, ui.glyphs).
 */
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { glyphs, WORK_FRAMES_ASCII, WORK_FRAMES_UNICODE } from "./glyphs.js";
import {
  contextPercent,
  initialLifecycle,
  lifecycle,
  type LifecycleState,
} from "./lifecycle.js";
import { telemetryLine as telemetryLineOf } from "./lifecycle.js";
import { formatChangeSummary, worktreeNumstat } from "./changes.js";
import {
  initialRun,
  pushTimelineEntry,
  runClose,
  runPath,
  runStart,
  runToolName,
  runTools,
  toolWritePath,
  type RunState,
  type TimelineEntry,
} from "./runs.js";
import { titleBrand } from "./logo.js";
import { headerFactory } from "./components/header.js";
import { deckFactory, type DeckInfo } from "./components/deck.js";
import { bandFactory, type BandInfo } from "./components/band.js";
import {
  TURN_SUMMARY_TYPE,
  turnSummaryRenderer,
  type TurnSummaryData,
} from "./renderers/turnSummary.js";
import type { UiConfig } from "../config.js";
import {
  RUN_SUMMARY_TYPE,
  runSummaryRenderer,
  WELCOME_TYPE,
  welcomeRenderer,
  type RunSummaryData,
  type WelcomeData,
} from "./renderers/runLedger.js";
export * from "./renderers/cards.js";

/** Hook probe result used by the compatibility gate. */
export interface PiUiHooks {
  hasSetHeader: boolean;
  hasSetFooter: boolean;
  hasSetWidget: boolean;
  hasWorkingIndicator: boolean;
  hasEntryRenderer: boolean;
  hasAppendEntry: boolean;
}

/** Compile-time-ish runtime gate for the pinned Pi version. */
export function probeHooks(pi: ExtensionAPI, ctx: ExtensionContext): PiUiHooks {
  return {
    hasSetHeader: typeof ctx.ui.setHeader === "function",
    hasSetFooter: typeof ctx.ui.setFooter === "function",
    hasSetWidget: typeof ctx.ui.setWidget === "function",
    hasWorkingIndicator: typeof ctx.ui.setWorkingIndicator === "function",
    hasEntryRenderer: typeof pi.registerEntryRenderer === "function",
    hasAppendEntry: typeof pi.appendEntry === "function",
  };
}

export function hooksSatisfied(h: PiUiHooks): boolean {
  return (
    h.hasSetHeader &&
    h.hasSetFooter &&
    h.hasSetWidget &&
    h.hasWorkingIndicator &&
    h.hasEntryRenderer &&
    h.hasAppendEntry
  );
}

const BAND_KEY = "pinevim";

export class PiUi {
  private g = glyphs("unicode");
  private state: LifecycleState = initialLifecycle();
  private header: ReturnType<typeof headerFactory> | null = null;
  private deck: ReturnType<typeof deckFactory> | null = null;
  private band: ReturnType<typeof bandFactory> | null = null;
  private mode: "CHAT" | "IDE" =
    process.env.PINEVIM_IDE === "1" ? "IDE" : "CHAT";
  private focus: "agent" | "editor" =
    process.env.PINEVIM_IDE === "1" ? "editor" : "agent";
  private unsubs: (() => void)[] = [];
  private lastCtxPercent: number | null = null;
  private disposed = false;
  /** Cached live TUI from the first factory invocation. */
  private tui: Parameters<typeof headerFactory>[0] | null = null;
  /** Abort listener for the current turn's signal, if any. */
  private abortSignal: AbortSignal | null = null;
  private run: RunState = initialRun();
  lastSummary: RunSummaryData | null = null;
  /** Bounded closed-run history for the controller's timeline panel. */
  private timeline: TimelineEntry[] = [];
  /** Fired when lifecycle text changes. The extension coalesces bridge reports. */
  onTelemetry: (() => void) | null = null;

  constructor(
    private pi: ExtensionAPI,
    private ctx: ExtensionContext,
    /** Active theme; components re-capture it from their factory args. */
    theme: Theme,
    private ui: UiConfig,
  ) {
    void theme;
  }

  /** True once any factory has handed us the live TUI (test/gate hook). */
  get tuiAttached(): boolean {
    return this.tui !== null;
  }

  install(): void {
    const ctx = this.ctx;
    const ui = ctx.ui;
    // Non-TUI modes (rpc/print/json) have TUI-bound factories on the type but
    // no interactive session driving them; the mode guard is the supported check.
    if (ctx.mode !== "tui") return;
    this.g = glyphs(this.ui.glyphs);

    // Event wiring is synchronous so lifecycle telemetry starts immediately;
    // components may not exist yet (frame installs deferred below) and
    // refresh() no-ops on missing components.
    this.wireEvents();
    // Persisted turn-summary renderer (plan §20) — API-level, not chrome, so
    // it registers synchronously.
    this.pi.registerEntryRenderer<TurnSummaryData>(
      TURN_SUMMARY_TYPE,
      turnSummaryRenderer(this.g) as never,
    );
    this.pi.registerEntryRenderer<RunSummaryData>(
      RUN_SUMMARY_TYPE,
      runSummaryRenderer(this.g) as never,
    );
    this.pi.registerEntryRenderer<WelcomeData>(
      WELCOME_TYPE,
      welcomeRenderer(this.g) as never,
    );
    if (process.env.PINEVIM_WELCOME === "1") {
      const prefix = process.env.PINEVIM_UI_PREFIX || "F12";
      const separator = this.ui.glyphs === "ascii" ? "-" : "·";
      const welcome: WelcomeData = {
        lines: [
          `${this.g.success} PineVim workspace ready`,
          `type to work ${separator} ${prefix} ? keys ${separator} /pinevim help`,
          `review the last run with /pinevim review ${separator} learned skills with /pinevim skills`,
        ],
      };
      this.pi.appendEntry<WelcomeData>(WELCOME_TYPE, welcome);
    }

    // Frame registration is deferred past Pi's startup sequence: verified via
    // a minimal-extension probe that setHeader/setFooter registered
    // synchronously inside session_start are clobbered by the remainder of
    // InteractiveMode.init(), while a setImmediate registration sticks. The
    // widget band survives either way (map-backed), but everything installs
    // together so chrome appears atomically.
    setImmediate(() => {
      if (this.disposed) return;

      // Motion: static frame when reduced motion is configured.
      if (this.ui.motion === "off") {
        ui.setWorkingIndicator({ frames: [this.g.running], intervalMs: 1000 });
      } else {
        const frames =
          this.ui.glyphs === "ascii"
            ? [...WORK_FRAMES_ASCII]
            : [...WORK_FRAMES_UNICODE];
        ui.setWorkingIndicator({ frames, intervalMs: 120 });
      }

      // Header: lazy factory — Pi calls it synchronously with the live TUI.
      ui.setHeader((tui, theme) => {
        this.tui = tui;
        if (!this.header) {
          this.header = headerFactory(tui, theme, this.g, {
            workspace: workspaceDisplay(ctx.cwd),
            sessionName: this.pi.getSessionName?.() ?? null,
            mode: this.mode,
            focus: this.focus,
            lifecycle: this.state,
          });
        }
        return this.header;
      });

      // Status deck: same lazy pattern; the footer data provider arrives here.
      ui.setFooter((tui, theme, footerData) => {
        this.tui = tui;
        if (!this.deck) {
          this.deck = deckFactory(
            tui,
            theme,
            footerData,
            this.g,
            this.deckInfo(),
          );
        }
        return this.deck;
      });

      // Chip band above the composer (PineComposer frame, plan §17).
      ui.setWidget(
        BAND_KEY,
        (tui, theme) => {
          this.tui = tui;
          if (!this.band) {
            this.band = bandFactory(tui, theme, this.g, this.bandInfo());
          }
          return this.band;
        },
        { placement: "aboveEditor" },
      );

      // (Argument completion is NOT installed here: it uses Pi's native
      // getArgumentCompletions on registerCommand — see completions.ts —
      // because a provider wrapper corrupts bare-command input.)

      // Brand the terminal title (replaces Pi's "π - …" prefix). Best-effort:
      // non-TUI contexts and embedding hosts may not implement setTitle.
      try {
        ui.setTitle?.(titleBrand());
      } catch {
        /* title branding is cosmetic; never fail the install for it */
      }
    });
  }

  private deckInfo(): DeckInfo {
    return {
      lifecycle: this.state,
      ctxPercent: this.lastCtxPercent,
      model: this.ctx.model?.name ?? null,
      thinking: this.ctx.thinkingLevel ?? null,
      prefix: process.env.PINEVIM_UI_PREFIX || "F12",
      ascii: this.ui.glyphs === "ascii",
    };
  }

  private bandInfo(): BandInfo {
    return {
      mode: this.mode,
      focus: this.focus,
      lifecycle: this.state,
      run: this.run,
      queued: this.ctx.hasPendingMessages(),
      ascii: this.ui.glyphs === "ascii",
      ctxPercent: this.lastCtxPercent,
      model: this.ctx.model?.name ?? null,
      thinking: this.ctx.thinkingLevel ?? null,
      prefix: process.env.PINEVIM_UI_PREFIX || "F12",
    };
  }

  private refresh(): void {
    if (this.disposed) return;
    this.lastCtxPercent = contextPercent(this.ctx);
    this.updateWorkingMessage();
    this.header?.update({
      workspace: workspaceDisplay(this.ctx.cwd),
      sessionName: this.pi.getSessionName?.() ?? null,
      mode: this.mode,
      focus: this.focus,
      lifecycle: this.state,
    });
    this.deck?.update(this.deckInfo());
    this.band?.update(this.bandInfo());
    this.onTelemetry?.();
  }

  /** Keep Pi's native loader informative without taking over its spinner. */
  private updateWorkingMessage(): void {
    const ui = this.ctx.ui as typeof this.ctx.ui & {
      setWorkingMessage?: (message?: string) => void;
    };
    if (typeof ui.setWorkingMessage !== "function") return;
    const message = (() => {
      switch (this.state.lifecycle) {
        case "thinking":
          return "Thinking through it...";
        case "streaming":
          return "Responding...";
        case "tooling":
          return this.state.lastTool
            ? `Working with ${this.state.lastTool}...`
            : "Running tools...";
        case "waiting":
          return "Waiting for you...";
        case "compacting":
          return "Compacting context...";
        case "settling":
          return "Finishing up...";
        case "error":
          return "Run failed - see the run summary";
        case "interrupted":
          return "Run stopped";
        default:
          return undefined;
      }
    })();
    try {
      ui.setWorkingMessage(message);
    } catch {
      /* loader copy is cosmetic; never fail lifecycle rendering for it */
    }
  }

  private wireEvents(): void {
    const pi = this.pi;
    this.unsubs.push(
      pi.on("turn_start", (e, ctx) => {
        this.state = lifecycle.turnStart(
          this.state,
          typeof (e as { turnIndex?: number }).turnIndex === "number"
            ? (e as { turnIndex: number }).turnIndex
            : (this.state.turnIndex ?? 0) + 1,
        );
        this.ctx = ctx;
        this.watchAbort(ctx);
        this.refresh();
      }),
    );
    this.unsubs.push(
      pi.on("message_update", (e, ctx) => {
        this.ctx = ctx;
        this.state = lifecycle.messageUpdate(this.state, e);
        this.refresh();
      }),
    );
    this.unsubs.push(
      pi.on("agent_start", () => {
        this.run = runStart(this.run, Date.now());
        this.refresh();
      }),
    );
    this.unsubs.push(
      pi.on("tool_execution_start", (e, _ctx) => {
        this.state = lifecycle.toolStart(this.state, e);
        const args = (e as { args?: unknown }).args;
        const name = String(e.toolName ?? "");
        this.run = runToolName(this.run, name);
        this.run = runPath(this.run, toolWritePath(name, args));
        this.refresh();
      }),
    );
    this.unsubs.push(
      pi.on("tool_execution_end", (e, _ctx) => {
        this.state = lifecycle.toolEnd(this.state, e);
        this.refresh();
      }),
    );
    this.unsubs.push(
      pi.on("ui_prompt_start", (e, _ctx) => {
        this.state = lifecycle.waiting(this.state, e);
        this.refresh();
      }),
    );
    this.unsubs.push(
      pi.on("ui_prompt_end", (e, _ctx) => {
        this.state = lifecycle.promptEnd(this.state, e);
        this.refresh();
      }),
    );
    this.unsubs.push(
      pi.on("session_before_compact", (e, _ctx) => {
        this.state = lifecycle.compacting(this.state, e);
        this.refresh();
      }),
    );
    this.unsubs.push(
      pi.on("session_compact", () => {
        this.state = lifecycle.compactDone(this.state);
        this.refresh();
      }),
    );
    this.unsubs.push(
      (pi.on as unknown as (event: string, handler: () => void) => () => void)(
        "session_compact_failed",
        () => {
          this.state = lifecycle.compactDone(this.state);
          this.refresh();
        },
      ),
    );
    this.unsubs.push(
      pi.on("turn_end", (e, ctx) => {
        this.state = lifecycle.turnEnd(this.state, e);
        const message = e.message as { stopReason?: string } | undefined;
        const interrupted =
          message?.stopReason === "aborted" || this.state.aborted;
        this.run = runTools(
          this.run,
          this.state.toolsRun,
          this.state.toolsFailed,
          interrupted,
        );
        this.ctx = ctx;
        this.refresh();
      }),
    );
    this.unsubs.push(
      pi.on("agent_settled", (_e, ctx) => {
        this.state = lifecycle.settled(this.state);
        this.ctx = ctx;
        const closed = runClose(this.run, Date.now());
        this.run = closed.state;
        const summary = closed.summary;
        if (summary) {
          this.timeline = pushTimelineEntry(this.timeline, {
            index: summary.index,
            seconds: summary.seconds,
            tools: summary.tools,
            failed: summary.failed,
            interrupted: summary.interrupted,
            toolNames: summary.toolNames,
          });
          void worktreeNumstat(ctx.cwd).then((worktree) => {
            const data: RunSummaryData = {
              index: summary.index,
              seconds: summary.seconds,
              tools: summary.tools,
              failed: summary.failed,
              interrupted: summary.interrupted,
              ctxPercent: contextPercent(ctx),
              changes: formatChangeSummary(summary.toolPaths.length, worktree),
              toolNames: summary.toolNames,
              toolPaths: summary.toolPaths,
            };
            this.lastSummary = data;
            pi.appendEntry<RunSummaryData>(RUN_SUMMARY_TYPE, data);
            this.refresh();
          });
        }
        this.refresh();
      }),
    );
    this.unsubs.push(
      pi.on("session_info_changed", (_e, ctx) => {
        this.ctx = ctx;
        this.refresh();
      }),
    );
    this.unsubs.push(
      pi.on("model_select", (_e, ctx) => {
        this.ctx = ctx;
        this.refresh();
      }),
    );
    this.unsubs.push(
      pi.on("thinking_level_select", (_e, ctx) => {
        this.ctx = ctx;
        this.refresh();
      }),
    );
  }

  /**
   * Attach the abort listener to the current turn's signal. ctx.signal is
   * per-turn (undefined between turns), so it is re-watched on every
   * turn_start rather than cached at install time.
   */
  private watchAbort(ctx: ExtensionContext): void {
    if (this.abortSignal) {
      this.abortSignal.removeEventListener("abort", this.onAbort);
      this.abortSignal = null;
    }
    const signal = ctx.signal;
    if (!signal) return;
    this.abortSignal = signal;
    signal.addEventListener("abort", this.onAbort, { once: true });
  }

  private onAbort = (): void => {
    if (this.disposed) return;
    this.state = lifecycle.aborted(this.state);
    this.refresh();
  };

  /** View transition feedback from successful controller intents. */
  setMode(mode: "CHAT" | "IDE", focus?: "agent" | "editor"): void {
    this.mode = mode;
    this.focus = focus ?? (mode === "IDE" ? "editor" : "agent");
    this.refresh();
  }

  /** Controller-visible telemetry line for the bridge status report. */
  telemetryLine(): string {
    return telemetryLineOf(this.state, this.lastCtxPercent);
  }

  /**
   * Controller-visible session timeline for the F12 t panel: one
   * `index|seconds|tools|failed|stop|names` record per closed run,
   * `;`-joined, newest last. Values are bounded integers/names per the
   * protocol validator; empty string when nothing has closed yet.
   */
  timelineLine(): string {
    return this.timeline
      .map((r) => {
        const names = r.toolNames
          .slice(0, 6)
          .join(" ")
          .toLowerCase()
          .replace(/[^a-z0-9 -]/g, "")
          .slice(0, 60);
        return [
          r.index,
          r.seconds === null ? "" : Math.round(r.seconds),
          r.tools,
          r.failed,
          r.interrupted ? 1 : 0,
          names,
        ].join("|");
      })
      .join(";");
  }

  dispose(): void {
    this.disposed = true;
    if (this.abortSignal) {
      this.abortSignal.removeEventListener("abort", this.onAbort);
      this.abortSignal = null;
    }
    for (const unsub of this.unsubs.splice(0)) {
      try {
        unsub();
      } catch {
        /* teardown is best-effort; Pi's own unbind path also removes handlers */
      }
    }
  }
}

function workspaceDisplay(cwd: string): string {
  const home = process.env.HOME;
  if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
  return cwd;
}
