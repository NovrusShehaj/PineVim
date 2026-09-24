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
  if (!s.active || !name || s.toolNames.length >= 32) return s;
  return { ...s, toolNames: [...s.toolNames, name.slice(0, 40)] };
}

export function runPath(s: RunState, path: string | null): RunState {
  if (!s.active || !path) return s;
  if (s.toolPaths.includes(path) || s.toolPaths.length >= 20) return s;
  return { ...s, toolPaths: [...s.toolPaths, path.slice(0, 180)] };
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
