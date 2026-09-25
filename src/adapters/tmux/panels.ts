/**
 * PineVIM tmux panels.
 *
 * Panels are controller-owned, so they remain useful when Pi is busy or
 * unavailable. Dynamic values are reduced to printable text before styling;
 * the only colors in this file are PineVIM-authored SGR roles.
 */
import { plain, recoveryCopy } from "../../diagnostics.js";
import { fit } from "../../piui/glyphs.js";
import { sgr, type SgrRole } from "./styled.js";
import { helperCommand, tmuxQuote } from "./config.js";
import type { State } from "../../core/state.js";
import type { AgentTelemetry } from "./statusline.js";

export const PANEL_ACTIONS = ["help", "status", "menu"] as const;
export type PanelAction = (typeof PANEL_ACTIONS)[number];

export function isPanelAction(action: string): action is PanelAction {
  return (PANEL_ACTIONS as readonly string[]).includes(action);
}

function prefixLabel(prefix: string): string {
  return plain(prefix, 8);
}

interface PanelGlyphs {
  rule: string;
  bullet: string;
  arrow: string;
  ellipsis: string;
}

function panelGlyphs(ascii: boolean): PanelGlyphs {
  return ascii
    ? { rule: "-", bullet: "-", arrow: ">", ellipsis: "..." }
    : { rule: "─", bullet: "·", arrow: "›", ellipsis: "…" };
}

const PANEL_WIDTH = 48;
const CONTENT_WIDTH = PANEL_WIDTH - 2;

function paint(role: SgrRole, text: string): string {
  return sgr(role, text);
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

function panelRule(g: PanelGlyphs): string {
  return paint("border", g.rule.repeat(CONTENT_WIDTH));
}

function panelHeading(text: string, g: PanelGlyphs): string {
  return (
    paint("muted", ` ${text.toUpperCase()}`) +
    paint(
      "border",
      ` ${g.rule.repeat(Math.max(2, CONTENT_WIDTH - text.length - 2))}`,
    )
  );
}

function panelRow(key: string, action: string, g: PanelGlyphs): string {
  const keyText = fit(key, 14, g.ellipsis).padEnd(14, " ");
  return `${paint("accent", keyText)} ${g.bullet} ${fit(action, CONTENT_WIDTH - 19, g.ellipsis)}`;
}

/** Render help popup lines (one row per binding, plus slash commands). */
export function helpPanelLines(prefix: string, ascii = false): string[] {
  const g = panelGlyphs(ascii);
  const title = `${paint("accent", " PINEVIM ")}${paint("muted", " workspace controls")}`;
  const rows = helpRows(prefix).map((r) => panelRow(r.key, r.action, g));
  const commands = [
    "/ide              open the editor",
    "/pinevim status   workspace status",
    "/pinevim help     this key list",
    "/pinevim review   files from the last run",
    "/pinevim skills   learned skills",
  ];
  return [
    title,
    panelRule(g),
    panelHeading("navigate", g),
    ...rows,
    panelHeading("commands", g),
    ...commands.map((line) =>
      paint("text", fit(line, CONTENT_WIDTH, g.ellipsis)),
    ),
    panelRule(g),
    paint(
      "dim",
      ` ${g.arrow} press any key to close  ${g.bullet}  ${prefixLabel(prefix)} m for menu`,
    ),
  ];
}

export interface StatusFacts {
  workspace: string;
  session: string | null;
  bridge: boolean;
  slash: { ide: boolean; pinevim: boolean };
  versions: { pi: string; tmux: string; node: string };
  editorNote: string | null;
  prefix: string;
  telemetry?: AgentTelemetry | null;
  themes?: "copied" | "not copied";
}

const LIFECYCLE_LABEL: Record<string, string> = {
  idle: "idle",
  thinking: "thinking",
  streaming: "responding",
  tooling: "working",
  waiting: "needs you",
  compacting: "compacting",
  settling: "finishing",
  error: "failed",
  interrupted: "stopped",
};

function lifecycleFact(s: State, facts: StatusFacts): string {
  const life = facts.telemetry?.lifecycle;
  if (life === "waiting")
    return facts.telemetry?.waitingKind
      ? `needs you (${facts.telemetry.waitingKind})`
      : "needs you";
  if (life) return LIFECYCLE_LABEL[life] ?? life;
  return s.busy ? "working" : "idle";
}

function nextAction(s: State, facts: StatusFacts, separator: string): string {
  const prefix = prefixLabel(facts.prefix);
  if (s.agent === null || !s.agent.alive) return `${prefix} r  retry Pi`;
  if (!s.bridge) return `pinevim --resume  ${separator}  ${prefix} ? keys`;
  if (!s.editor?.alive)
    return `/ide  open editor  ${separator}  ${prefix} ? keys`;
  return `${prefix} ? keys  ${separator}  ${prefix} m menu`;
}

/** Render status popup lines from controller-owned state. */
export function statusPanelLines(
  s: State,
  facts: StatusFacts,
  ascii = false,
): string[] {
  const g = panelGlyphs(ascii);
  const title = `${paint("accent", " PINEVIM ")}${paint("muted", " workspace status")}`;
  const mode: Record<State["mode"], string> = {
    CHAT_ONLY: "CHAT",
    IDE_WITH_AGENT: "IDE",
    IDE_FOCUS: "FOCUS",
  };
  const row = (
    label: string,
    value: string,
    role: SgrRole = "text",
    sanitize = true,
  ): string => {
    const l = fit(plain(label, 12), 12, g.ellipsis).padEnd(12, " ");
    const safeValue = sanitize ? plain(value, CONTENT_WIDTH - 13) : value;
    const safe = fit(safeValue, CONTENT_WIDTH - 13, g.ellipsis);
    return `${paint("muted", l)}${paint(role, safe)}`;
  };
  const home = process.env.HOME;
  const workspace =
    home && facts.workspace.startsWith(home)
      ? `~${facts.workspace.slice(home.length)}`
      : facts.workspace;
  const editor = !s.editor?.alive
    ? (s.editor ? "exited" : "not started") +
      (facts.editorNote ? `, ${facts.editorNote}` : "")
    : s.mode === "CHAT_ONLY"
      ? "running, hidden"
      : "alive";
  const agent =
    s.agent === null
      ? "not started"
      : !s.agent.alive
        ? `dead (exit ${s.agent.exitCode ?? s.agent.signal ?? "?"})`
        : s.bridge
          ? "connected"
          : "bridge disconnected";
  const lines = [
    title,
    panelRule(g),
    panelHeading("overview", g),
    row("workspace", workspace),
    row("view", `${mode[s.mode]} ${g.bullet} ${s.focus}`, "text", false),
    row(
      "agent",
      agent,
      !s.agent?.alive ? "error" : s.bridge ? "text" : "warning",
    ),
    row("editor", editor, s.editor?.alive ? "text" : "muted"),
    row(
      "lifecycle",
      lifecycleFact(s, facts),
      facts.telemetry?.lifecycle === "error" ? "error" : "text",
    ),
    row("session", s.sessionId ? s.sessionId.slice(0, 18) : "none yet"),
    panelHeading("next", g),
    row("action", nextAction(s, facts, g.bullet), "accent", false),
    panelHeading("details", g),
    row(
      "slash",
      facts.slash.pinevim ? "/pinevim ready" : "/pinevim collision",
      facts.slash.pinevim ? "text" : "warning",
      false,
    ),
    row(
      "versions",
      `Pi ${plain(facts.versions.pi, 24)} ${g.bullet} tmux ${plain(facts.versions.tmux, 24)}`,
      "text",
      false,
    ),
    row("node", `Node ${plain(facts.versions.node, 24)}`, "text", false),
    ...(facts.themes
      ? [
          row(
            "themes",
            facts.themes === "not copied"
              ? `not copied. ${recoveryCopy("THEME")}`
              : facts.themes,
            facts.themes === "not copied" ? "warning" : "text",
            false,
          ),
        ]
      : []),
    panelRule(g),
    paint("dim", ` ${g.arrow} press any key to close`),
  ];
  return lines;
}

/** display-menu argv: each item runs the helper with an existing intent. */
export function menuDisplayArgv(
  node: string,
  helper: string,
  runtime: string,
  prefix: string,
  ascii = false,
): string[] {
  const argv = ["display-menu", "-T", "pinevim"];
  for (const entry of menuEntries(prefix, ascii).slice(0, 8)) {
    argv.push(
      entry.label,
      entry.key,
      `run-shell -b ${tmuxQuote(helperCommand(node, helper, runtime, entry.intent))}`,
    );
  }
  return argv;
}

/** Menu entries: label + the controller intent each triggers. */
export function menuEntries(
  prefix: string,
  ascii = false,
): { label: string; key: string; intent: string }[] {
  const p = prefixLabel(prefix);
  const arrow = ascii ? ">" : "›";
  return [
    { label: `${arrow} IDE view (${p} i)`, key: "i", intent: "ide.open" },
    { label: `${arrow} Chat view (${p} c)`, key: "c", intent: "chat" },
    {
      label: `${arrow} Hide/show agent (${p} a)`,
      key: "a",
      intent: "agent.toggle",
    },
    { label: `${arrow} Retry Pi (${p} r)`, key: "r", intent: "retry" },
    { label: `${arrow} Workspace status (${p} s)`, key: "s", intent: "status" },
    { label: `${arrow} Key guide (${p} ?)`, key: "?", intent: "help" },
    { label: `${arrow} Safe quit (${p} q)`, key: "q", intent: "quit" },
  ];
}

/** The helper action names that route to panels. */
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
