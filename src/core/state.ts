import { compact, type Geometry } from "./layout.js";
import { PineError } from "../diagnostics.js";
export type Mode = "CHAT_ONLY" | "IDE_WITH_AGENT" | "IDE_FOCUS";
export type Focus = "agent" | "editor";
export const intents = [
  "ide.open",
  "chat",
  "agent.hide",
  "agent.show",
  "agent.toggle",
  "focus.other",
  "width.less",
  "width.more",
  "quit",
  "retry",
  "help",
  "status",
  "timeline",
  "reconcile",
] as const;
export type Intent = (typeof intents)[number];
export interface Child {
  pane: string;
  pid: number;
  alive: boolean;
  ready: boolean;
  exitCode: number | null;
  signal: string | null;
}
export interface State {
  mode: Mode;
  focus: Focus;
  agent: Child | null;
  editor: Child | null;
  geometry: Geometry;
  ratio: number | null;
  compact: boolean;
  generation: number;
  epoch: string;
  bridge: boolean;
  busy: boolean;
  pending: number | null;
  lifecycle: "running" | "stopping" | "detached" | "stopped";
  sessionId: string | null;
  sessionFile: string | null;
  previousMode: Mode;
}
export function initialState(
  geometry: Geometry,
  epoch: string,
  ratio: number | null,
): State {
  return {
    mode: "CHAT_ONLY",
    focus: "agent",
    agent: null,
    editor: null,
    geometry,
    ratio,
    compact: compact(geometry),
    generation: 0,
    epoch,
    bridge: false,
    busy: false,
    pending: null,
    lifecycle: "running",
    sessionId: null,
    sessionFile: null,
    previousMode: "CHAT_ONLY",
  };
}
export function transition(s: State, intent: Intent): State {
  const n = { ...s };
  switch (intent) {
    case "ide.open":
      if (!s.editor?.alive)
        throw new PineError(
          "EDITOR",
          "Editor must be started and reconciled before opening its view.",
        );
      n.mode = s.agent?.alive ? "IDE_WITH_AGENT" : "IDE_FOCUS";
      n.focus = "editor";
      break;
    case "chat":
      if (!s.agent?.alive)
        throw new PineError(
          "AGENT",
          "Agent unavailable. Use the prefix then r to retry.",
        );
      n.mode = "CHAT_ONLY";
      n.focus = "agent";
      break;
    case "agent.toggle":
      return transition(
        s,
        s.mode === "IDE_FOCUS" ? "agent.show" : "agent.hide",
      );
    case "agent.hide":
      if (!s.editor?.alive || s.mode === "CHAT_ONLY")
        throw new PineError("EDITOR", "Open IDE first.");
      n.mode = "IDE_FOCUS";
      n.focus = "editor";
      break;
    case "agent.show":
      if (!s.agent?.alive)
        throw new PineError(
          "AGENT",
          "Agent unavailable. Use the prefix then r to retry.",
        );
      if (s.mode !== "CHAT_ONLY") n.mode = "IDE_WITH_AGENT";
      n.focus = "agent";
      break;
    case "focus.other":
      if (!s.editor?.alive || !s.agent?.alive) break;
      n.mode = "IDE_WITH_AGENT";
      n.focus = s.focus === "agent" ? "editor" : "agent";
      break;
  }
  n.compact = compact(n.geometry);
  return n;
}
export function reconcileChildren(s: State): State {
  const n = { ...s };
  if (!n.editor?.alive && n.agent?.alive) {
    n.mode = "CHAT_ONLY";
    n.focus = "agent";
  }
  if (!n.agent?.alive && n.editor?.alive) {
    if (s.mode !== "IDE_FOCUS") n.previousMode = s.mode;
    n.mode = "IDE_FOCUS";
    n.focus = "editor";
  }
  if (!n.agent?.alive) {
    n.bridge = false;
    n.busy = false;
  }
  n.compact = compact(n.geometry);
  return n;
}
