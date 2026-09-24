/**
 * PineVIM tmux status line (plan §23): a segmented control-plane strip.
 *
 * Segments (dropped tail-first when narrow, per §15):
 *   workspace · MODE focus · agent=lifecycle · ctx N% · <prefix> ?
 *
 * Sources of truth: workspace/mode/focus/geometry from State; lifecycle/ctx
 * from the bridge telemetry line when connected, else the controller's
 * fallback (busy bit). Precedence mirrors the controller's own status():
 * dead agent > bridge down > lifecycle. Untrusted text (workspace basename)
 * is passed through diagnostics.plain before inclusion. The assembled value
 * is deduplicated upstream (renderStatus) and written via set-option -g
 * status-left with `#` escaping at the boundary (escapeTmuxFormat).
 */
import { basename } from "node:path";
import { plain } from "../../diagnostics.js";
import { fit } from "../../piui/glyphs.js";
import { escapeTmuxFormat, sgr, visibleWidth, type SgrRole } from "./styled.js";
import type { State } from "../../core/state.js";

/** Decoded bridge telemetry (parsed from the extension status payload). */
export interface AgentTelemetry {
  lifecycle: string | null;
  toolsRun: number | null;
  toolsFailed: number | null;
  turnIndex: number | null;
  waitingKind: string | null;
  ctxPercent: number | null;
}

export interface StatusInput {
  state: State;
  /** Canonical workspace (untrusted display: basename only). */
  workspace: string;
  prefix: string;
  /** Parsed telemetry when the bridge is connected; else null. */
  telemetry: AgentTelemetry | null;
  /** ASCII glyph mode renders segments without Unicode. */
  ascii: boolean;
}

const MODE_LABEL: Record<State["mode"], string> = {
  CHAT_ONLY: "CHAT",
  IDE_WITH_AGENT: "IDE",
  IDE_FOCUS: "FOCUS",
};

function agentSegment(input: StatusInput): { text: string; role: SgrRole } {
  const s = input.state;
  const g = input.ascii ? "*" : "●";
  // Distinguish "never launched" from "launched then died": a null Child is
  // the pre-launch window, not a crash (state.ts models agent as Child | null).
  if (s.agent === null) return { text: `${g} agent starting`, role: "muted" };
  if (!s.agent.alive)
    return { text: `${g} pi dead · r to retry`, role: "error" };
  if (!s.bridge)
    return { text: `${g} bridge down · --resume`, role: "warning" };
  const t = input.telemetry;
  const lifecycle = t?.lifecycle ?? (s.busy ? "run" : "idle");
  switch (lifecycle) {
    case "idle":
      return { text: `${g} agent idle`, role: "success" };
    case "waiting":
      return {
        text: `${g} needs you${t?.waitingKind ? ` (${t.waitingKind})` : ""}`,
        role: "accent",
      };
    case "error":
      return { text: `${g} agent error`, role: "error" };
    case "interrupted":
      return { text: `${g} stopped`, role: "warning" };
    case "compacting":
      return { text: `${g} compacting`, role: "muted" };
    default:
      return {
        text: `${g} agent ${lifecycle}${t?.toolsRun ? ` ${t.toolsRun}` : ""}`,
        role: "text",
      };
  }
}

function segments(input: StatusInput): { text: string; role: SgrRole }[] {
  const s = input.state;
  const workspace = fit(plain(basename(input.workspace), 24), 24);
  const mode = MODE_LABEL[s.mode];
  const focus = s.mode === "CHAT_ONLY" ? null : s.focus;
  const modeText = focus ? `${mode} ${focus}` : mode;
  const agent = agentSegment(input);
  const segs: { text: string; role: SgrRole }[] = [
    { text: workspace, role: "text" },
    { text: modeText, role: "accent" },
    agent,
  ];
  const ctx = input.telemetry?.ctxPercent ?? null;
  if (ctx !== null)
    segs.push({ text: `ctx ${Math.round(ctx)}%`, role: "muted" });
  // Recovery guidance outranks telemetry (§34): geometry warnings replace ctx.
  if (s.geometry.columns < 60 || s.geometry.rows < 16) {
    return [
      { text: "resize to 60x16", role: "warning" },
      { text: `${input.prefix} ? help`, role: "muted" },
    ];
  }
  segs.push({ text: `${input.prefix} ?`, role: "muted" });
  return segs;
}

/**
 * Assemble the styled status-left value.
 * Budget: tmux status-left-length is 250 cells; keep <= 200 visible so the
 * prefix + hidden markup stay well inside the option cap.
 */
export function statusLine(input: StatusInput): string {
  const sep = input.ascii ? " | " : "  ·  ";
  const budget = 200;
  const segs = segments(input);
  const parts: string[] = [];
  let used = 0;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const withSep = i === 0 ? seg.text.length : seg.text.length + sep.length;
    if (used + withSep > budget && parts.length > 0) break;
    parts.push(sgr(seg.role, seg.text));
    used += withSep;
  }
  const rendered = parts.join(sep);
  // Final guard: if even the first segment overflows (tiny budget), clip it.
  if (visibleWidth(rendered) > budget) {
    const first = segs[0]!;
    return sgr(first.role, fit(first.text, budget));
  }
  return rendered;
}

/** Escaped, tmux-ready option value. */
export function statusOptionValue(input: StatusInput): string {
  return escapeTmuxFormat(statusLine(input));
}
