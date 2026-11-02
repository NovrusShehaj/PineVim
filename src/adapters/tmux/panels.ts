/**
 * PineVIM tmux panels.
 *
 * Panels are controller-owned, so they remain useful when Pi is busy or
 * unavailable. Dynamic values are reduced to printable text before styling;
 * the only colors in this file are PineVIM-authored SGR roles.
 */
import { plain, recoveryCopy, sanitizeUntrusted } from "../../diagnostics.js";
import { fit } from "../../piui/glyphs.js";
import type { InsightsSnapshot } from "../../piui/run-index.js";
import type { TimelineEntry } from "../../piui/runs.js";
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

/**
 * D8: state-aware help rows. Show only the relevant subset of chords
 * given the current controller state. Caller passes the same
 * `StatusFacts` it uses for the status popup.
 */
export function helpRowsForState(
  prefix: string,
  facts: StatusFacts,
  _ascii = false,
): HelpRow[] {
  const p = prefixLabel(prefix);
  const rows: HelpRow[] = [];
  const dead = facts.telemetry?.lifecycle === "error" || false;
  // We have no direct `state` here; use the agent-dead signal from telemetry
  // and the slash flags for visibility. Conservative defaults: include
  // every chord, omit those that are not currently meaningful.
  if (!dead) {
    rows.push({ key: `${p} i`, action: "IDE view" });
    rows.push({ key: `${p} c`, action: "chat view" });
    rows.push({ key: `${p} a`, action: "hide/show agent" });
    rows.push({ key: `${p} Tab`, action: "switch focus" });
    rows.push({ key: `${p} Left`, action: "agent width -5" });
    rows.push({ key: `${p} Right`, action: "agent width +5" });
  }
  rows.push({
    key: `${p} r`,
    action: dead ? "retry Pi (required)" : "retry Pi (if dead)",
  });
  rows.push({ key: `${p} q`, action: "safe quit" });
  rows.push({ key: `${p} s`, action: "workspace status" });
  rows.push({ key: `${p} t`, action: "session timeline" });
  rows.push({ key: `${p} m`, action: "command menu" });
  rows.push({ key: `${p} ?`, action: "this help" });
  rows.push({ key: `${p} ${p}`, action: "literal prefix" });
  return rows;
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
    { key: `${p} t`, action: "session timeline" },
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
    "/pinevim search   find runs across sessions",
    "/pinevim insights cross-session analytics",
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
/** The controller-owned facts the timeline panel renders. */
export interface TimelineFacts {
  prefix: string;
  /** Whether a run is active right now (rendered as a live marker). */
  busyNow: boolean;
  /** Newest last, bounded by TIMELINE_LIMIT at the source. */
  history: TimelineEntry[];
}

/**
 * Session timeline: one line per closed run (newest last, matching the
 * in-pane run ledger's direction), plus the live run when one is active.
 * Read-only v1 (plan T-02): navigation and per-run drill-down come later.
 */
export function timelinePanelLines(
  facts: TimelineFacts,
  ascii = false,
): string[] {
  const g = panelGlyphs(ascii);
  const title = `${paint("accent", " PINEVIM ")}${paint("muted", " session timeline")}`;
  const lines: string[] = [title, panelRule(g)];
  const rows: { label: string; detail: string; role: SgrRole }[] = [];
  for (const entry of facts.history)
    rows.push({
      label: `run ${entry.index}`,
      detail:
        (entry.seconds === null ? "?" : `${Math.round(entry.seconds)}s`) +
        ` ${g.bullet} tools ${entry.tools}` +
        (entry.failed ? ` ${g.bullet} fail ${entry.failed}` : "") +
        (entry.interrupted ? ` ${g.bullet} stopped` : "") +
        (entry.toolNames.length
          ? ` ${g.bullet} ${entry.toolNames
              .slice(0, 3)
              .map((n) => sanitizeUntrusted(n, 24))
              .filter(Boolean)
              .join(" ")}`
          : ""),
      role: entry.failed || entry.interrupted ? "warning" : "text",
    });
  if (facts.busyNow)
    rows.push({
      label: "live",
      detail: "running now",
      role: "accent",
    });
  if (rows.length === 0)
    rows.push({ label: "", detail: "no runs yet this session", role: "muted" });
  // The surrounding template and numbers are PineVIM-authored, so they keep
  // the panel's Unicode bullets; every agent-supplied name is sanitized
  // above, and fit() still bounds the result to the panel width.
  for (const r of rows.slice(-22))
    lines.push(
      `${paint("muted", fit(r.label, 12, g.ellipsis).padEnd(12, " "))}${paint(r.role, fit(r.detail, CONTENT_WIDTH - 13, g.ellipsis))}`,
    );
  lines.push(
    panelRule(g),
    panelHeading("keys", g),
    `${paint("muted", prefixLabel(facts.prefix).padEnd(12, " "))}${paint("text", "close with any key")}`,
  );
  return lines;
}

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

/** The controller-owned facts the insights panel renders. */
export interface InsightsFacts {
  prefix: string;
  /** Aggregate snapshot; null when the run index is unavailable. */
  snapshot: InsightsSnapshot | null;
  /** Window the snapshot covers, in days. */
  days: number;
}

/** Compact USD, matching the deck chip's 3-decimal small-value style. */
function usd(value: number): string {
  return `$${value.toFixed(value < 10 ? 3 : 2)}`;
}

/**
 * Cross-session insights (Tier 2 #5): aggregates computed from the durable
 * run index, rendered with the same panel grammar as status/timeline.
 * Complements the deck's session cost chip with cross-session history.
 */
export function insightsPanelLines(
  facts: InsightsFacts,
  ascii = false,
): string[] {
  const g = panelGlyphs(ascii);
  const title = `${paint("accent", " PINEVIM ")}${paint("muted", ` insights · last ${facts.days} days`)}`;
  const lines: string[] = [title, panelRule(g)];
  const snapshot = facts.snapshot;
  if (!snapshot) {
    lines.push(
      paint(
        "muted",
        fit(
          "Run index unavailable for this workspace.",
          CONTENT_WIDTH,
          g.ellipsis,
        ),
      ),
      paint(
        "muted",
        fit(
          "Runs are indexed from now on; check back after a run.",
          CONTENT_WIDTH,
          g.ellipsis,
        ),
      ),
    );
  } else if (snapshot.runs === 0) {
    lines.push(
      paint(
        "muted",
        fit("No runs indexed in this window yet.", CONTENT_WIDTH, g.ellipsis),
      ),
    );
  } else {
    const row = (
      label: string,
      value: string,
      role: SgrRole = "text",
    ): string =>
      `${paint("muted", fit(plain(label, 12), 12, g.ellipsis).padEnd(12, " "))}${paint(role, fit(value, CONTENT_WIDTH - 13, g.ellipsis))}`;
    const tokensText =
      snapshot.totalTokens >= 10000
        ? `${(snapshot.totalTokens / 1000).toFixed(1)}k`
        : snapshot.totalTokens.toLocaleString("en-US");
    lines.push(
      row(
        "runs",
        `${snapshot.runs} across ${snapshot.sessions} session${snapshot.sessions === 1 ? "" : "s"}`,
      ),
      row("tokens", tokensText),
      row("cost", usd(snapshot.costTotal), "accent"),
      row(
        "outcomes",
        `${snapshot.tools} tool${snapshot.tools === 1 ? "" : "s"}` +
          (snapshot.failedTools ? `, ${snapshot.failedTools} failed` : "") +
          (snapshot.interrupted ? `, ${snapshot.interrupted} stopped` : ""),
        snapshot.failedTools || snapshot.interrupted ? "warning" : "text",
      ),
    );
    if (snapshot.topTools.length > 0)
      lines.push(
        panelHeading("top tools", g),
        ...snapshot.topTools
          .slice(0, 4)
          .map((tool) =>
            row(
              tool.name,
              `${tool.count} run${tool.count === 1 ? "" : "s"}`,
              "text",
            ),
          ),
      );
    const days = snapshot.perDay.slice(-5);
    if (days.length > 0)
      lines.push(
        panelHeading("recent days", g),
        ...days.map((day) =>
          row(
            day.day,
            `${day.runs} run${day.runs === 1 ? "" : "s"}${day.cost > 0 ? ` · ${usd(day.cost)}` : ""}`,
            "text",
          ),
        ),
      );
  }
  lines.push(panelRule(g), paint("dim", ` ${g.arrow} press any key to close`));
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
    {
      label: `${arrow} Session timeline (${p} t)`,
      key: "t",
      intent: "timeline",
    },
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
