/**
 * PineVIM header banner (plan §15): identity above the transcript.
 * Registered through ctx.ui.setHeader; render-only, no input handling.
 *
 * Brand: the hand-drawn ASCII pine (src/piui/logo.ts) replaces Pi's built-in
 * "π" wordmark — Pi's built-in header is fully replaced by this component.
 * Every logo glyph occupies exactly one terminal cell (pure ASCII), so all
 * alignment arithmetic is exact.
 *
 * Adaptive display (plan §15):
 *   >= 100 cols: the full 11-line pine, always; workspace and mode
 *                hang right of the treetop. Lifecycle lives on the band.
 *   60-99 cols:  splash — the full pine greets at launch, then the header
 *                collapses to the compact 2-line mark on the first active
 *                turn (non-idle lifecycle), keeping vertical space for work.
 *   < 60 cols:   suppressed entirely.
 */
import { Container, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { fit } from "../glyphs.js";
import { type GlyphSet } from "../glyphs.js";
import { type LifecycleState } from "../lifecycle.js";
import {
  PINE_CROWN_LINES,
  PINE_TRUNK_FACTOR,
  PINE_TREE,
  PINE_TREE_WIDTH,
  shadeFgAnsi,
  treeLines,
} from "../logo.js";

type RoleStyle = (t: Theme, s: string) => string;
const ROLE: {
  [k: string]: RoleStyle | undefined;
  accent: RoleStyle;
  muted: RoleStyle;
  success: RoleStyle;
  warning: RoleStyle;
  error: RoleStyle;
  text: RoleStyle;
} = {
  accent: (t, s) => t.fg("accent", s),
  muted: (t, s) => t.fg("muted", s),
  success: (t, s) => t.fg("success", s),
  warning: (t, s) => t.fg("warning", s),
  error: (t, s) => t.fg("error", s),
  text: (t, s) => t.fg("text", s),
};

function style(role: string, theme: Theme, text: string): string {
  const fn = ROLE[role] ?? ROLE.muted;
  return fn(theme, text);
}

export interface HeaderInfo {
  workspace: string;
  sessionName: string | null;
  mode: "CHAT" | "IDE";
  lifecycle: LifecycleState;
}

export class PineHeader extends Container {
  private info: HeaderInfo;
  /** Splash state for the 60-99 band: full pine until the first active turn. */
  private expanded = true;

  constructor(
    private tui: TUI,
    private theme: Theme,
    g: GlyphSet,
    info: HeaderInfo,
  ) {
    super();
    this.info = info;
    void g;
  }

  update(info: HeaderInfo): void {
    this.info = info;
    // First turn activity collapses the splash (sticky for the session).
    if (info.lifecycle.lifecycle !== "idle") this.expanded = false;
    this.tui.requestRender();
  }

  /** The styled two-line compact mark: accent crown, darker trunk. */
  private logo(): [string, string] {
    const t = this.theme;
    const [crown, base] = treeLines();
    const trunk = shadeFgAnsi(t.getFgAnsi("accent"), PINE_TRUNK_FACTOR);
    return [
      style("accent", t, crown),
      trunk ? `${trunk}${base}\x1b[0m` : style("accent", t, base),
    ];
  }

  /** The full pine with workspace/mode/lifecycle right of the treetop. */
  private renderTree(width: number): string[] {
    const t = this.theme;
    const i = this.info;
    const session = i.sessionName ? ` · ${fit(i.sessionName, 20)}` : "";
    const sideBudget = Math.max(
      12,
      width - PINE_TREE_WIDTH - 8 - session.length,
    );
    const ws = fit(i.workspace, sideBudget);
    // Two-tone treatment: the needle canopy renders in the theme accent; the
    // branch ledge and trunk in the same hue scaled down (see logo.ts). When
    // the resolved color is not truecolor (256/8-color terminals) the shade
    // is unavailable and the whole pine stays single-tone — still correct.
    const trunk = shadeFgAnsi(t.getFgAnsi("accent"), PINE_TRUNK_FACTOR);
    const side: Record<number, string> = {
      0: style("accent", t, i.mode),
      1: `${style("accent", t, "pinevim")} ${style("muted", t, "·")} ${style("text", t, ws)}${style("muted", t, session)}`,
    };
    return PINE_TREE.map((line, idx) => {
      const padded = line.padEnd(PINE_TREE_WIDTH);
      const styled =
        idx < PINE_CROWN_LINES || !trunk
          ? style("accent", t, padded)
          : `${trunk}${padded}\x1b[0m`;
      const extra = side[idx];
      return extra ? `${styled}  ${extra}` : styled;
    });
  }

  override render(width: number): string[] {
    if (width < 60) return [];
    const t = this.theme;
    const i = this.info;
    const ws = fit(i.workspace, Math.max(12, Math.floor(width / 2) - 8));
    const session = i.sessionName ? ` · ${fit(i.sessionName, 20)}` : "";
    const right = i.mode;
    const identityText = `${style("muted", t, "·")} ${style("text", t, ws)}${style("muted", t, session)}`;
    const identityWidth = 3 + [...ws].length + session.length;

    // >= 100 cols: the full pine is permanent, splash state irrelevant.
    if (width >= 100) {
      return this.renderTree(width);
    }

    // Splash in the 60-99 band: the greeting pine only while the session is
    // idle AND never previously active (update() latches expanded=false on
    // the first active turn, so the splash never returns mid-session).
    if (this.expanded && i.lifecycle.lifecycle === "idle") {
      return PINE_TREE.map((line) => style("accent", t, line));
    }

    if (width >= 80) {
      // Compact band: tree left, mode + lifecycle chip right-aligned.
      const [crown, base] = this.logo();
      const leftWidth = 4 + 1 + "pinevim".length; // tree + gap + wordmark
      const pad = Math.max(1, width - leftWidth - [...right].length);
      const logoLine =
        `${crown} ${style("accent", t, "pinevim")}` +
        " ".repeat(pad) +
        `${style("accent", t, i.mode)}`;
      // Identity under the tree base, keeping the right side clear.
      const pad2 = Math.max(1, width - 5 - identityWidth);
      return [logoLine, `${base} ${identityText}${" ".repeat(pad2)}`.trimEnd()];
    }
    // 60-79 cols: compact crown + identity + mode/chip, single line.
    const [crown] = this.logo();
    return [
      `${crown} ${style("accent", t, "pinevim")} ${identityText} ${right}`.trimEnd(),
    ];
  }
}

/** Factory signature compatible with ctx.ui.setHeader. */
export function headerFactory(
  tui: TUI,
  theme: Theme,
  g: GlyphSet,
  info: HeaderInfo,
): PineHeader {
  return new PineHeader(tui, theme, g, info);
}
