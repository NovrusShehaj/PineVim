/**
 * PineVIM tmux status line (plan §23, design D1): a segmented control-plane
 * strip with a brand mark and theme tracking.
 *
 * Segments (dropped tail-first when narrow, per §15):
 *   ▲ pinevim · workspace · MODE focus · agent=lifecycle · <prefix> ?
 *
 * Sources of truth: workspace/mode/focus/geometry from State; lifecycle/ctx
 * from the bridge telemetry line when connected, else the controller's
 * fallback (busy bit). Precedence mirrors the controller's own status():
 * dead agent > bridge down > lifecycle. Untrusted text (workspace basename)
 * is passed through diagnostics.plain before inclusion. The assembled value
 * is deduplicated upstream (renderStatus) and written via set-option -g
 * status-left with `#` escaping at the boundary (escapeTmuxFormat).
 *
 * Brand mark (D1): the pine motif (`▲` unicode / `^` ascii) is the first
 * segment and uses the active theme's accent role. The wordmark `pinevim`
 * is rendered with the same accent. At < 60x16 the brand is preserved in
 * the resize guidance row so it is visible even in the panic state.
 */
import { basename } from "node:path";
import { plain } from "../../diagnostics.js";
import { fit, glyphs } from "../../piui/glyphs.js";
import { tmuxFg, visibleWidth, type SgrRole } from "./styled.js";
import type { State } from "../../core/state.js";
import {
  type AgentPalette,
  paletteForTheme,
} from "./palette.js";

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
  /** Active PineVim theme name (e.g. "pinevim-forest"). Optional. */
  theme?: string | null;
  /** Hide the brand segment (used in narrow-fallback paths). */
  brand?: boolean;
}

const MODE_LABEL: Record<State["mode"], string> = {
  CHAT_ONLY: "CHAT",
  IDE_WITH_AGENT: "IDE",
  IDE_FOCUS: "FOCUS",
};

/** Brand mark (D1): the pine motif rendered as the first segment. */
function brandMark(ascii: boolean): string {
  return ascii ? "^" : "▲";
}

/** Separator between status line segments. Themed, matching the in-pane band. */
function statusSeparator(ascii: boolean): string {
  return ascii ? " - " : " · ";
}

function agentSegment(input: StatusInput): { text: string; role: SgrRole } {
  const s = input.state;
  const g = glyphs(input.ascii ? "ascii" : "unicode");
  // Distinguish "never launched" from "launched then died": a null Child is
  // the pre-launch window, not a crash (state.ts models agent as Child | null).
  if (s.agent === null)
    return { text: `${g.running} agent starting`, role: "muted" };
  if (!s.agent.alive)
    return {
      text: `${g.failure} pi dead · prefix r after confirmation`,
      role: "error",
    };
  if (!s.bridge)
    return {
      text: `${g.warning} bridge disconnected · prefix still works · --resume`,
      role: "warning",
    };
  const t = input.telemetry;
  const lifecycle = t?.lifecycle ?? (s.busy ? "run" : "idle");
  switch (lifecycle) {
    case "idle":
      return { text: `${g.running} agent idle`, role: "success" };
    case "waiting":
      return {
        text: `${g.waiting} needs you${t?.waitingKind ? ` (${t.waitingKind})` : ""}`,
        role: "accent",
      };
    case "error":
      return { text: `${g.failure} agent error`, role: "error" };
    case "interrupted":
      return { text: `${g.stopped} stopped`, role: "warning" };
    case "compacting":
      return { text: `${g.compacting} compacting`, role: "muted" };
    default:
      return {
        text: `${g.running} agent ${lifecycle}${t?.toolsRun ? ` ${t.toolsRun}` : ""}`,
        role: "text",
      };
  }
}

function segments(input: StatusInput): { text: string; role: SgrRole }[] {
  const s = input.state;
  const workspace = fit(
    plain(basename(input.workspace), 24),
    24,
    input.ascii ? "..." : "…",
  );
  const mode = MODE_LABEL[s.mode];
  const focus = s.mode === "CHAT_ONLY" ? null : s.focus;
  const modeText = focus ? `${mode} ${focus}` : mode;
  const agent = agentSegment(input);
  const includeBrand = input.brand !== false;
  const segs: { text: string; role: SgrRole }[] = includeBrand
    ? [
        // Brand mark first (D1): the PineVim identity is visible at every
        // moment including when Pi is dead and the pane is empty.
        { text: `${brandMark(input.ascii)} pinevim`, role: "accent" },
        { text: workspace, role: "text" },
        { text: modeText, role: "accent" },
        agent,
      ]
    : [
        { text: workspace, role: "text" },
        { text: modeText, role: "accent" },
        agent,
      ];
  // Context stays on the in-pane deck. The strip mirrors lifecycle only.
  if (s.geometry.columns < 60 || s.geometry.rows < 16) {
    return includeBrand
      ? [
          { text: `${brandMark(input.ascii)} pinevim`, role: "accent" },
          { text: "resize to 60x16", role: "warning" },
          { text: `${input.prefix} ? help`, role: "muted" },
        ]
      : [
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
 *
 * Pass a `palette` (resolved from the active theme via `paletteForStatus`)
 * to make the brand mark and accents theme-aware. When omitted, the
 * legacy hard-coded palette from styled.ts is used (preserves existing
 * tests).
 */
export function statusLine(
  input: StatusInput,
  color = true,
  palette: AgentPalette | null = null,
): string {
  const sep = statusSeparator(input.ascii);
  const budget = 200;
  const segs = segments(input);
  const parts: string[] = [];
  let used = 0;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const withSep = i === 0 ? seg.text.length : seg.text.length + sep.length;
    if (used + withSep > budget && parts.length > 0) break;
    // Dynamic text is already plain()'d. Double # before style tokens exist.
    const text = seg.text.replace(/#/g, "##");
    parts.push(tmuxFg(seg.role, text, color, palette));
    used += withSep;
  }
  const rendered = parts.join(sep);
  if (visibleWidth(rendered) > budget) {
    const first = segs[0]!;
    return tmuxFg(
      first.role,
      fit(first.text, budget, input.ascii ? "..." : "…").replace(/#/g, "##"),
      color,
      palette,
    );
  }
  return rendered;
}

/** Tmux-ready status-left value. No ESC. Style hashes are single; data hashes are doubled. */
export function statusOptionValue(
  input: StatusInput,
  color = true,
  palette: AgentPalette | null = null,
): string {
  return statusLine(input, color, palette);
}

/**
 * Resolve the statusline palette from the active PineVim theme.
 * Returns `null` when no theme is supplied — callers fall back to the
 * terminal-native colors defined in styled.ts.
 */
export function paletteForStatus(
  themeName: string | null | undefined,
  _ascii = false,
): AgentPalette {
  return paletteForTheme(themeName ?? null, _ascii);
}
