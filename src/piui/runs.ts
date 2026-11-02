import { sanitizeUntrusted } from "../diagnostics.js";

/**
 * A run is one user request: agent_start through agent_settled.
 * Pi turns are model calls and are accumulated, not shown as separate rules.
 */
export interface RunState {
  active: boolean;
  index: number;
  startedAt: number | null;
  tools: number;
  failed: number;
  interrupted: boolean;
  /** Paths observed on edit/write tool calls. Not a git claim. */
  toolPaths: string[];
  toolNames: string[];
}

export interface RunClose {
  index: number;
  seconds: number | null;
  tools: number;
  failed: number;
  interrupted: boolean;
  toolPaths: string[];
  toolNames: string[];
}

export function initialRun(): RunState {
  return {
    active: false,
    index: 0,
    startedAt: null,
    tools: 0,
    failed: 0,
    interrupted: false,
    toolPaths: [],
    toolNames: [],
  };
}

export function runStart(s: RunState, at: number): RunState {
  return {
    active: true,
    index: s.index + 1,
    startedAt: at,
    tools: 0,
    failed: 0,
    interrupted: false,
    toolPaths: [],
    toolNames: [],
  };
}

export function runTools(
  s: RunState,
  tools: number,
  failed: number,
  interrupted: boolean,
): RunState {
  if (!s.active) return s;
  return {
    ...s,
    tools: s.tools + tools,
    failed: s.failed + failed,
    interrupted: s.interrupted || interrupted,
  };
}

export function runToolName(s: RunState, name: string): RunState {
  if (!s.active || s.toolNames.length >= 32) return s;
  // Tool names are agent-controlled. Sanitize at capture so every later
  // renderer (ledger, timeline payload, review) inherits the clean value.
  const clean = sanitizeUntrusted(name, 40);
  if (!clean) return s;
  return { ...s, toolNames: [...s.toolNames, clean] };
}

export function runPath(s: RunState, path: string | null): RunState {
  if (!s.active || !path) return s;
  // Paths are agent-controlled: a crafted filename can carry escape or
  // zero-width sequences that rewrite the rendered line.
  const clean = sanitizeUntrusted(path, 180);
  if (!clean || s.toolPaths.includes(clean) || s.toolPaths.length >= 20)
    return s;
  return { ...s, toolPaths: [...s.toolPaths, clean] };
}

export function runClose(
  s: RunState,
  at: number,
): { state: RunState; summary: RunClose | null } {
  if (!s.active) return { state: s, summary: null };
  const seconds =
    s.startedAt === null ? null : Math.max(0, (at - s.startedAt) / 1000);
  const summary: RunClose = {
    index: s.index,
    seconds,
    tools: s.tools,
    failed: s.failed,
    interrupted: s.interrupted,
    toolPaths: s.toolPaths,
    toolNames: s.toolNames,
  };
  return {
    state: { ...s, active: false, startedAt: null },
    summary,
  };
}

/** edit/write path argument. Other tools are not file claims. */
export function toolWritePath(name: string, args: unknown): string | null {
  if (name !== "edit" && name !== "write") return null;
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  const path = record.path ?? record.file_path ?? record.filePath;
  return typeof path === "string" && path.length > 0 ? path : null;
}

/**
 * Bounded closed-run history for the session timeline panel (plan T-02).
 * The extension owns run lifecycles and ships this list to the controller
 * over the existing status payload, mirroring the telemetry-line precedent:
 * controller-side rendering stays available even while Pi is busy.
 */
export interface TimelineEntry {
  /** Monotonic run index, as shown by the in-pane run ledger. */
  index: number;
  /** Wall seconds the run took; null when never closed cleanly. */
  seconds: number | null;
  tools: number;
  failed: number;
  interrupted: boolean;
  /** Newest last, as recorded. */
  toolNames: string[];
}

export const TIMELINE_LIMIT = 12;

/** Append a closed-run summary, oldest dropped beyond the bound. */
export function pushTimelineEntry(
  history: TimelineEntry[],
  entry: TimelineEntry,
): TimelineEntry[] {
  const next = [...history, entry];
  return next.length > TIMELINE_LIMIT ? next.slice(-TIMELINE_LIMIT) : next;
}

/**
 * Session-cumulative token budget (plan T-03). Accumulated from turn usage
 * so the deck can show spend alongside the context sparkline. Bounded to
 * stay finite across very long sessions; tokens are monotonic per session,
 * so the bound only guards against runaway accumulation.
 */
export interface TokenBudget {
  /** Sum of assistant `usage.totalTokens` across settled turns. */
  totalTokens: number;
  /** Sum of assistant `usage.cost.total` across settled turns. */
  costTotal: number;
  /** Settled turns contributing to the totals. */
  turns: number;
}

export function initialBudget(): TokenBudget {
  return { totalTokens: 0, costTotal: 0, turns: 0 };
}

/**
 * Add one settled turn's usage. Malformed or negative usage is ignored
 * entirely — never partially — so one bad event cannot poison the totals.
 */
export function addTurnUsage(
  b: TokenBudget,
  usage:
    | { totalTokens?: unknown; cost?: { total?: unknown } | null }
    | null
    | undefined,
): TokenBudget {
  if (!usage) return b;
  const tokens = usage.totalTokens;
  const cost = usage.cost?.total;
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0)
    return b;
  if (
    cost !== undefined &&
    (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)
  )
    return b;
  return {
    totalTokens: Math.min(1e12, b.totalTokens + Math.round(tokens)),
    costTotal:
      typeof cost === "number"
        ? Math.min(1e6, b.costTotal + cost)
        : b.costTotal,
    turns: b.turns + 1,
  };
}

/** Compact chip text for the deck: `5.2k tok` (+ `$0.031` when nonzero). */
export function budgetChipText(b: TokenBudget): string | null {
  if (b.turns === 0) return null;
  const tokens =
    b.totalTokens >= 10000
      ? `${(b.totalTokens / 1000).toFixed(1)}k`
      : String(b.totalTokens);
  const cost = b.costTotal > 0 ? ` · $${b.costTotal.toFixed(3)}` : "";
  return `${tokens} tok${cost}`;
}
