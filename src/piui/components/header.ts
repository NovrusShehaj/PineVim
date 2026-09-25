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
 *   >= 25 usable rows: the full 11-line pine is eligible; workspace and mode
 *                      hang right of the treetop. Lifecycle lives on the band.
 *   <= 24 usable rows: the four-line compact mark wins at launch, keeping
 *                      Pi's transcript and composer on screen in short panes.
 *   >= 100 cols:      the full pine remains permanent after first activity.
 *   60-99 cols:       the full pine greets at launch, then the header stays
 *                     compact on first activity (non-idle lifecycle).
 *   < 60 cols:        suppressed entirely.
 */
import { Container, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { fit } from "../glyphs.js";
import { type GlyphSet } from "../glyphs.js";
import { style, strong } from "../style.js";
import { type LifecycleState } from "../lifecycle.js";
import {
  PINE_CROWN_LINES,
  PINE_TREE,
  PINE_TREE_WIDTH,
  TREE_LINES_WIDTH,
  shadeFgAnsi,
  treeLines,
  trunkFactorFor,
} from "../logo.js";

/** A full 11-line splash is too tall for a Pi pane with 24 or fewer rows. */
export const MIN_FULL_SPLASH_ROWS = 25;

export interface HeaderInfo {
  workspace: string;
  sessionName: string | null;
  mode: "CHAT" | "IDE";
  /** Current pane focus when the IDE is visible. */
  focus?: "agent" | "editor";
  lifecycle: LifecycleState;
}

export class PineHeader extends Container {
  private info: HeaderInfo;
  /** Splash state for the 60-99 band: full pine until the first active turn. */
  private expanded = true;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private g: GlyphSet,
    info: HeaderInfo,
  ) {
    super();
    this.info = info;
  }

  update(info: HeaderInfo): void {
    this.info = info;
    // First turn activity collapses the splash (sticky for the session).
    if (info.lifecycle.lifecycle !== "idle") this.expanded = false;
    this.tui.requestRender();
  }

  /** Trunk SGR: the accent scaled by the theme's trunk factor (null off-truecolor). */
  private trunkAnsi(t: Theme): string | null {
    return shadeFgAnsi(t.getFgAnsi("accent"), trunkFactorFor(t.name));
  }

  /** The styled four-line compact mark: accent canopy, theme-shaded trunk. */
  private logo(): string[] {
    const t = this.theme;
    const trunk = this.trunkAnsi(t);
    return treeLines().map((line, index, lines) =>
      index < lines.length - 1 || !trunk
        ? style(t, "accent", line)
        : `${trunk}${line}\x1b[0m`,
    );
  }

  /** The full pine with a quiet identity rail to its right. */
  private renderTree(width: number): string[] {
    const t = this.theme;
    const i = this.info;
    const ascii = this.g.rule === "-";
    const separator = ascii ? "-" : "·";
    const ellipsis = ascii ? "..." : "…";
    const view = this.viewLabel();
    const sideWidth = Math.max(12, width - PINE_TREE_WIDTH - 2);
    const identityPrefix = `pinevim ${separator} workspace `;
    let session = i.sessionName
      ? ` ${separator} ${fit(i.sessionName, 20, ellipsis)}`
      : "";
    let workspaceBudget = sideWidth - identityPrefix.length - session.length;
    let ws = fit(i.workspace, Math.max(0, workspaceBudget), ellipsis);
    // At the minimum frame width there is not enough room for both a long
    // session and a useful workspace label. Drop the session rail first; the
    // workspace remains the stable identity anchor instead of overflowing.
    if (workspaceBudget < 8) {
      session = "";
      workspaceBudget = sideWidth - identityPrefix.length;
      ws = fit(i.workspace, Math.max(0, workspaceBudget), ellipsis);
    }
    // Two-tone treatment: the needle canopy renders in the theme accent; the
    // branch ledge and trunk in the same hue scaled by the theme's trunk
    // factor — down for dark themes, up (lifted) for light ones (logo.ts).
    // When the resolved color is not truecolor (256/8-color terminals) the
    // shade is unavailable and the whole pine stays single-tone — still correct.
    const trunk = this.trunkAnsi(t);
    const side: Record<number, string> = {
      0: `${style(t, "muted", "view")} ${strong(t, "accent", view)}`,
      1: `${strong(t, "accent", "pinevim")} ${style(t, "muted", separator)} ${style(t, "muted", "workspace")} ${style(t, "text", ws)}${style(t, "muted", session)}`,
    };
    return PINE_TREE.map((line, idx) => {
      const padded = line.padEnd(PINE_TREE_WIDTH);
      const styled =
        idx < PINE_CROWN_LINES || !trunk
          ? style(t, "accent", padded)
          : `${trunk}${padded}\x1b[0m`;
      const extra = side[idx];
      return extra ? `${styled}  ${extra}` : styled;
    });
  }

  private viewLabel(): string {
    const separator = this.g.rule === "-" ? "-" : "·";
    return this.info.mode === "IDE" && this.info.focus
      ? `IDE ${separator} ${this.info.focus}`
      : this.info.mode;
  }

  override render(width: number): string[] {
    if (width < 60) return [];
    // TUI.terminal.rows is Pi's public, live geometry source. Reading it during
    // each render keeps the header responsive to pane resizes without copying
    // controller state into the extension.
    const fullSplashFits = this.tui.terminal.rows >= MIN_FULL_SPLASH_ROWS;
    const t = this.theme;
    const i = this.info;
    const ascii = this.g.rule === "-";
    const separator = ascii ? "-" : "·";
    const ellipsis = ascii ? "..." : "…";
    const view = this.viewLabel();
    const ws = fit(
      i.workspace,
      Math.max(12, Math.floor(width / 2) - 18),
      ellipsis,
    );
    const session = i.sessionName
      ? ` ${separator} ${fit(i.sessionName, 20, ellipsis)}`
      : "";
    const identityText = `${style(t, "muted", separator)} ${style(t, "muted", "workspace")} ${style(t, "text", ws)}${style(t, "muted", session)}`;
    const identityWidth =
      3 + "workspace ".length + [...ws].length + session.length;

    // >= 100 cols: the full pine is permanent once the pane is tall enough.
    if (fullSplashFits && width >= 100) {
      return this.renderTree(width);
    }

    // Splash in the 60-99 band: the greeting pine only while the session is
    // idle AND never previously active (update() latches expanded=false on
    // the first active turn, so the splash never returns mid-session).
    if (fullSplashFits && this.expanded && i.lifecycle.lifecycle === "idle") {
      return this.renderTree(width);
    }

    if (width >= 80) {
      // Compact band: the four-line mark, wordmark, and identity rail.
      const logo = this.logo();
      const wordmark = strong(t, "accent", "pinevim");
      const leftWidth = TREE_LINES_WIDTH + 1 + "pinevim".length;
      const pad = Math.max(1, width - leftWidth - [...view].length);
      const logoLine =
        `${logo[0]!} ${wordmark}` + " ".repeat(pad) + strong(t, "accent", view);
      // Identity under the branch row, keeping the right side clear.
      const pad2 = Math.max(1, width - TREE_LINES_WIDTH - 1 - identityWidth);
      return [
        logoLine,
        `${logo[1]!} ${identityText}${" ".repeat(pad2)}`.trimEnd(),
        logo[2]!,
        logo[3]!,
      ];
    }
    // 60-79 cols: the same compact mark with identity on its first row.
    const logo = this.logo();
    const narrowWorkspace = fit(i.workspace, 18, ellipsis);
    const line = `${logo[0]!} ${strong(t, "accent", "pinevim")} ${style(t, "muted", "workspace")} ${style(t, "text", narrowWorkspace)} ${strong(t, "accent", view)}`;
    return [line.trimEnd(), logo[1]!, logo[2]!, logo[3]!];
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
