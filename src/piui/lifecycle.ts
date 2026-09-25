/**
 * PineVIM agent lifecycle: one authoritative reducer derived from Pi's public
 * extension events (plan §8.1). Deterministic and unit-testable; the deck,
 * chip band, working indicator, and controller telemetry all render from this
 * state, never from independent guesses.
 *
 * Precedence (tested): waiting > error > compacting > tooling > streaming >
 * thinking > settling > interrupted > idle. A new turn clears error/interrupted.
 */
import type {
  ExtensionContext,
  MessageUpdateEvent,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  TurnEndEvent,
  UIPromptEndEvent,
  UIPromptStartEvent,
} from "@earendil-works/pi-coding-agent";
import type { SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { fit } from "./glyphs.js";

export type Lifecycle =
  | "idle"
  | "thinking"
  | "streaming"
  | "tooling"
  | "waiting"
  | "compacting"
  | "settling"
  | "error"
  | "interrupted";

export const LIFECYCLES: readonly Lifecycle[] = [
  "idle",
  "thinking",
  "streaming",
  "tooling",
  "waiting",
  "compacting",
  "settling",
  "error",
  "interrupted",
];

export interface UiPromptState {
  kind: string;
}

export interface LifecycleState {
  lifecycle: Lifecycle;
  /** Name of the most recent tool execution this turn ("bash", "read", ...). */
  lastTool: string | null;
  /** Tools started this turn. */
  toolsRun: number;
  /** Tools finished with isError=true this turn. */
  toolsFailed: number;
  /** Pi turn index from turn_start/turn_end; null before the first turn. */
  turnIndex: number | null;
  /** Active ui_prompt metadata while waiting. */
  prompt: UiPromptState | null;
  /** True after a settled turn ended with an error assistant message. */
  turnError: boolean;
  /** True when the active turn was aborted by the user. */
  aborted: boolean;
  /** Lifecycle to restore after waiting or compacting. */
  resume: Lifecycle | null;
}

export function initialLifecycle(): LifecycleState {
  return {
    lifecycle: "idle",
    lastTool: null,
    toolsRun: 0,
    toolsFailed: 0,
    turnIndex: null,
    prompt: null,
    turnError: false,
    aborted: false,
    resume: null,
  };
}

/**
 * Helpers for extension event handlers. Every handler returns a fresh state;
 * reducers are pure so tests can replay recorded event sequences.
 */
export const lifecycle = {
  turnStart(s: LifecycleState, turnIndex: number): LifecycleState {
    return {
      ...s,
      lifecycle: "streaming",
      lastTool: null,
      toolsRun: 0,
      toolsFailed: 0,
      turnIndex,
      turnError: false,
      aborted: false,
      resume: null,
    };
  },
  messageUpdate(s: LifecycleState, event: MessageUpdateEvent): LifecycleState {
    if (s.lifecycle === "waiting" || s.lifecycle === "compacting") return s;
    const message = event.message as { role?: string; stopReason?: string };
    if (message.role !== "assistant") return s;
    const ev = event.assistantMessageEvent as { type?: string } | undefined;
    const evType = ev?.type ?? "";
    if (evType.startsWith("text")) return { ...s, lifecycle: "streaming" };
    if (evType.startsWith("thinking")) return { ...s, lifecycle: "thinking" };
    const content = (message as { content?: unknown }).content;
    const blocks = Array.isArray(content) ? content : [];
    const hasText = blocks.some(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: string }).type === "text",
    );
    const thinking =
      !hasText &&
      blocks.some(
        (block) =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: string }).type === "thinking",
      );
    const lifecycle: Lifecycle = thinking ? "thinking" : "streaming";
    return { ...s, lifecycle };
  },
  toolStart(s: LifecycleState, event: ToolExecutionStartEvent): LifecycleState {
    if (s.lifecycle === "waiting" || s.lifecycle === "compacting") return s;
    return {
      ...s,
      lifecycle: "tooling",
      lastTool: typeof event.toolName === "string" ? event.toolName : null,
      toolsRun: s.toolsRun + 1,
    };
  },
  toolEnd(s: LifecycleState, event: ToolExecutionEndEvent): LifecycleState {
    const failed = event.isError === true;
    return {
      ...s,
      toolsFailed: failed ? s.toolsFailed + 1 : s.toolsFailed,
      lifecycle:
        s.lifecycle === "waiting" || s.lifecycle === "compacting"
          ? s.lifecycle
          : "tooling",
    };
  },
  waiting(s: LifecycleState, event: UIPromptStartEvent): LifecycleState {
    return {
      ...s,
      lifecycle: "waiting",
      resume: s.lifecycle === "waiting" ? s.resume : s.lifecycle,
      prompt: { kind: typeof event.kind === "string" ? event.kind : "custom" },
    };
  },
  promptEnd(s: LifecycleState, _event: UIPromptEndEvent): LifecycleState {
    const resume = s.resume;
    const next: Lifecycle =
      resume && resume !== "waiting" && resume !== "compacting"
        ? resume
        : "idle";
    return { ...s, lifecycle: next, prompt: null, resume: null };
  },
  compacting(
    s: LifecycleState,
    _event: SessionBeforeCompactEvent,
  ): LifecycleState {
    return {
      ...s,
      lifecycle: "compacting",
      resume: s.lifecycle === "compacting" ? s.resume : s.lifecycle,
      prompt: null,
    };
  },
  compactDone(s: LifecycleState): LifecycleState {
    if (s.lifecycle !== "compacting") return s;
    const resume = s.resume;
    const next: Lifecycle =
      resume && resume !== "compacting" && resume !== "waiting"
        ? resume
        : "idle";
    return { ...s, lifecycle: next, resume: null };
  },
  turnEnd(s: LifecycleState, event: TurnEndEvent): LifecycleState {
    const message = event.message as { stopReason?: string };
    return {
      ...s,
      turnIndex: event.turnIndex ?? s.turnIndex,
      lifecycle: "settling",
      turnError: message.stopReason === "error",
    };
  },
  settled(s: LifecycleState): LifecycleState {
    const errored = s.turnError;
    const state: LifecycleState = {
      ...s,
      prompt: null,
      turnError: false,
    };
    return {
      ...state,
      lifecycle: errored ? "error" : "idle",
      aborted: false,
    };
  },
  aborted(s: LifecycleState): LifecycleState {
    // Keep counts for the turn summary; the summary notes the interruption.
    return { ...s, lifecycle: "interrupted", prompt: null, aborted: true };
  },
  /** Bridge/degraded fallback: reset to a quiet state. */
  reset(s: LifecycleState): LifecycleState {
    return { ...initialLifecycle(), turnIndex: s.turnIndex };
  },
};

/** One-line presentation used by the chip band and the status deck. */
export function lifecycleLabel(
  s: LifecycleState,
  g: {
    running: string;
    waiting: string;
    stopped: string;
    error: string;
    thinking: string;
    compacting: string;
  },
): string {
  const separator =
    "rule" in g && typeof g.rule === "string" && g.rule === "-" ? "-" : "·";
  const ellipsis = separator === "-" ? "..." : "…";
  switch (s.lifecycle) {
    case "idle":
      return `${g.running} idle`;
    case "thinking":
      return `${g.thinking} thinking`;
    case "streaming":
      return `${g.running} streaming`;
    case "tooling":
      return `${g.running} tools ${s.toolsRun}${s.lastTool ? ` ${separator} ${fit(s.lastTool, 16, ellipsis)}` : ""}`;
    case "waiting":
      return `${g.waiting} needs you${s.prompt ? ` (${s.prompt.kind})` : ""}`;
    case "compacting":
      return `${g.compacting} compacting`;
    case "settling":
      return `${g.running} settling`;
    case "error":
      return `${g.error} error`;
    case "interrupted":
      return `${g.stopped} stopped`;
  }
}

/** Controller telemetry projection (§11): bounded scalars only. */
export interface LifecycleTelemetry {
  lifecycle: Lifecycle;
  toolsRun: number;
  toolsFailed: number;
  turnIndex: number | null;
  waitingKind: string | null;
}

export function telemetry(s: LifecycleState): LifecycleTelemetry {
  const waitingKind =
    s.lifecycle === "waiting" ? (s.prompt?.kind ?? null) : null;
  return {
    lifecycle: s.lifecycle,
    toolsRun: s.toolsRun,
    toolsFailed: s.toolsFailed,
    turnIndex: s.turnIndex,
    waitingKind:
      waitingKind === null
        ? null
        : (() => {
            const normalized = waitingKind
              .toLowerCase()
              .replace(/[^a-z0-9-]+/g, "-")
              .slice(0, 16);
            return /[a-z0-9]/.test(normalized) ? normalized : "custom";
          })(),
  };
}

/** Compact telemetry string for the control protocol (bounded, validated there). */
export function telemetryLine(
  s: LifecycleState,
  ctxPercent: number | null,
): string {
  const t = telemetry(s);
  const ctx = ctxPercent === null ? "-" : String(Math.round(ctxPercent));
  const turn = t.turnIndex === null ? "-" : String(t.turnIndex);
  const wait = t.waitingKind === null ? "-" : t.waitingKind;
  return `${t.lifecycle}|${t.toolsRun}|${t.toolsFailed}|${turn}|${wait}|${ctx}`;
}

export function parseTelemetryLine(
  line: string,
): (LifecycleTelemetry & { ctxPercent: number | null }) | null {
  const parts = line.split("|");
  if (parts.length !== 6) return null;
  const [name, run, fail, turn, wait, ctx] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (!LIFECYCLES.includes(name as Lifecycle)) return null;
  const num = (v: string): number | null => {
    if (!/^\d+$/.test(v)) return null;
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  };
  const toolsRun = num(run);
  const toolsFailed = num(fail);
  if (toolsRun === null || toolsFailed === null) return null;
  const turnIndex = turn === "-" ? null : num(turn);
  const ctxPercent = ctx === "-" ? null : num(ctx);
  return {
    lifecycle: name as Lifecycle,
    toolsRun,
    toolsFailed,
    turnIndex,
    waitingKind: wait === "-" ? null : wait,
    ctxPercent,
  };
}

/** Context-usage helper: Pi returns null tokens right after compaction. */
export function contextPercent(ctx: ExtensionContext): number | null {
  const usage = ctx.getContextUsage();
  if (!usage || usage.percent === null || !Number.isFinite(usage.percent))
    return null;
  return Math.max(0, Math.min(100, usage.percent));
}
