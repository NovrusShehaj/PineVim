/**
 * PineVIM tmux panels (plan §24-26): help popup, status popup, context menu.
 *
 * All content is PineVIM-authored constants plus controller-owned State fields
 * escaped via plain()/escapeTmuxFormat - no user-controlled strings reach tmux
 * formats. Popups require tmux >= 3.2 (display-popup); the runtime floor is
 * 3.5, so popups are always available, with a notify() fallback kept for
 * popup-failure resilience.
 */
import { plain, recoveryCopy } from "../../diagnostics.js";
import { fit } from "../../piui/glyphs.js";
import { helperCommand } from "./config.js";
import type { State } from "../../core/state.js";
import type { AgentTelemetry } from "./statusline.js";

export const PANEL_ACTIONS = ["help", "status", "menu"] as const;
export type PanelAction = (typeof PANEL_ACTIONS)[number];

export function isPanelAction(action: string): action is PanelAction {
  return (PANEL_ACTIONS as readonly string[]).includes(action);
}

/** Prefix label for headings ("F12" vs "C-a" etc.). */
function prefixLabel(prefix: string): string {
  return plain(prefix, 8);
}

export interface HelpRow {
  key: string;
  action: string;
}

export function helpRows(prefix: string): HelpRow[] {
  const p = prefixLabel(prefix);
  return [
    { key: `${p} i`, action: "IDE view" },
    { key: `${p} c`, action: "chat view" },
    { key: `${p} a`, action: "hide/show agent" },
    { key: `${p} Tab`, action: "switch focus" },
    { key: `${p} Left`, action: "agent width -5" },
    { key: `${p} Right`, action: "agent width +5" },
    { key: `${p} r`, action: "retry Pi (if dead)" },
    { key: `${p} q`, action: "safe quit" },
    { key: `${p} s`, action: "workspace status" },
    { key: `${p} m`, action: "command menu" },
    { key: `${p} ?`, action: "this help" },
    { key: `${p} ${p}`, action: "literal prefix" },
  ];
}

const POPUP_WIDTH = 44;

/** Render help popup lines (one row per binding, plus slash commands). */
export function helpPanelLines(prefix: string): string[] {
  const header = " pinevim keys ";
  const rule = "-".repeat(POPUP_WIDTH - 2);
  const rows = helpRows(prefix).map((r) => {
    const key = fit(r.key, 14).padEnd(14, " ");
    return `${key}${r.action}`;
  });
  const slash = [
    "/ide            open the editor",
    "/pinevim help   this list",
    "/pinevim quit   safe quit",
  ];
  const footer = " press a key ";
  return [header, rule, ...rows, rule, ...slash, rule, footer];
}

export interface StatusFacts {
  workspace: string;
  session: string | null;
  /** Kept for callers that want to assert overall bridge state. */
  bridge: boolean;
  slash: { ide: boolean; pinevim: boolean };
  versions: { pi: string; tmux: string; node: string };
  editorNote: string | null;
  prefix: string;
  telemetry?: AgentTelemetry | null;
  themes?: "copied" | "not copied";
}

function lifecycleFact(s: State, facts: StatusFacts): string {
  const life = facts.telemetry?.lifecycle;
  if (life === "waiting")
    return facts.telemetry?.waitingKind
      ? `needs you (${facts.telemetry.waitingKind})`
      : "needs you";
  if (life) return life;
  return s.busy ? "running" : "idle";
}

/** Render status popup lines from controller-owned state. */
export function statusPanelLines(s: State, facts: StatusFacts): string[] {
  const header = " pinevim workspace ";
  const rule = "-".repeat(POPUP_WIDTH - 2);
  const row = (label: string, value: string): string => {
    const l = fit(plain(label, 12), 12).padEnd(12, " ");
    return `${l}${fit(plain(value, 30), 30)}`;
  };
  const mode: Record<State["mode"], string> = {
    CHAT_ONLY: "CHAT",
    IDE_WITH_AGENT: "IDE",
    IDE_FOCUS: "FOCUS",
  };
  const lines = [
    header,
    rule,
    row(
      "workspace",
      fit(facts.workspace.replace(process.env.HOME ?? "", "~"), 30),
    ),
    row("mode", mode[s.mode] + (s.mode === "CHAT_ONLY" ? "" : `, ${s.focus}`)),
    row(
      "pi pane",
      s.agent === null
        ? "not started"
        : !s.agent.alive
          ? `dead (exit ${s.agent.exitCode ?? s.agent.signal ?? "?"}). ${recoveryCopy("AGENT")}`
          : "alive",
    ),
    row(
      "bridge",
      s.bridge
        ? "connected"
        : s.agent?.alive
          ? recoveryCopy("DISCONNECTED")
          : "n/a",
    ),
    row(
      "editor",
      !s.editor?.alive
        ? (s.editor ? "exited" : "not started") +
            (facts.editorNote ? `, ${facts.editorNote}` : "")
        : s.mode === "CHAT_ONLY"
          ? "running, hidden"
          : "alive",
    ),
    row("lifecycle", lifecycleFact(s, facts)),
    row("session", s.sessionId ? s.sessionId.slice(0, 12) : "none yet"),
    row("versions", `pi ${facts.versions.pi}, tmux ${facts.versions.tmux}`),
    row("slash", facts.slash.pinevim ? "/pinevim ok" : "/pinevim collision"),
    ...(facts.themes
      ? [
          row(
            "themes",
            facts.themes === "not copied"
              ? `not copied. ${recoveryCopy("THEME")}`
              : facts.themes,
          ),
        ]
      : []),
  ];
  const footer = ` ${prefixLabel(facts.prefix)} ? keys `;
  return [...lines, rule, footer];
}

/** display-menu argv: each item runs the helper with an existing intent. */
export function menuDisplayArgv(
  node: string,
  helper: string,
  runtime: string,
  prefix: string,
): string[] {
  const argv = ["display-menu", "-T", "pinevim"];
  for (const e of menuEntries(prefix).slice(0, 8)) {
    argv.push(
      e.label,
      "",
      `run-shell -b ${helperCommand(node, helper, runtime, e.intent)}`,
    );
  }
  return argv;
}

/** Menu entries: label + the controller intent each triggers. */
export function menuEntries(
  prefix: string,
): { label: string; intent: string }[] {
  const p = prefixLabel(prefix);
  return [
    { label: `IDE view (${p} i)`, intent: "ide.open" },
    { label: `Chat view (${p} c)`, intent: "chat" },
    { label: `Hide/show agent (${p} a)`, intent: "agent.toggle" },
    { label: `Retry Pi (${p} r)`, intent: "retry" },
    { label: `Status (${p} s)`, intent: "status" },
    { label: `Help (${p} ?)`, intent: "help" },
    { label: `Quit (${p} q)`, intent: "quit" },
  ];
}

/**
 * The helper action names that route to panels. These travel through the
 * existing control protocol; the controller renders panel content itself so
 * the helper stays a thin one-shot client (no content formatting there).
 */
export function panelHelperActions(): Record<PanelAction, string> {
  return { help: "help", status: "status", menu: "menu" };
}

/** Runtime directory passthrough for helper commands (kept test-friendly). */
export function panelHelperCommand(
  node: string,
  helper: string,
  runtime: string,
  action: PanelAction,
): string {
  const quote = (v: string): string => `'${v.replace(/'/g, "'\\''")}'`;
  return [node, helper, runtime, action].map(quote).join(" ");
}
