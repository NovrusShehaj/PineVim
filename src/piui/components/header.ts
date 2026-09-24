/**
 * PineVIM header banner (plan §15): identity line above the transcript.
 * Registered through ctx.ui.setHeader; render-only, no input handling.
 *
 * Brand: a two-line pine-tree mark (src/piui/logo.ts) replaces Pi's built-in
 * "π" wordmark — Pi's built-in header is fully replaced by this component.
 * Every logo glyph occupies exactly one terminal cell (no emoji), so the
 * right-alignment arithmetic below is exact.
 *
 * Width bands (plan §15, tree adds one line in the wide band):
 *   >= 80 cols: logo band (tree + wordmark + mode/lifecycle), identity line.
 *   60-79 cols: single compact line `▲ pinevim · workspace`, then mode/chip.
 *   < 60 cols:  suppressed entirely.
 */
import { Container, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { fit } from "../glyphs.js";
import { type GlyphSet } from "../glyphs.js";
import { type GlyphMode } from "../glyphs.js";
import { type LifecycleState } from "../lifecycle.js";
import { lifecycleChip } from "../chips.js";
import { treeLines } from "../logo.js";

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
  private g: GlyphSet;
  private glyphMode: GlyphMode;

  constructor(
    private tui: TUI,
    private theme: Theme,
    g: GlyphSet,
    info: HeaderInfo,
    glyphMode: GlyphMode = "unicode",
  ) {
    super();
    this.info = info;
    this.g = g;
    this.glyphMode = glyphMode;
  }

  update(info: HeaderInfo): void {
    this.info = info;
    this.tui.requestRender();
  }

  /** The styled two-line pine mark (crown, base) at the configured width. */
  private logo(): [string, string] {
    const [crown, base] = treeLines(this.glyphMode);
    return [style("accent", this.theme, crown), style("accent", this.theme, base)];
  }

  override render(width: number): string[] {
    if (width < 60) return [];
    const t = this.theme;
    const i = this.info;
    const chip = lifecycleChip(i.lifecycle, this.g, 24);
    const ws = fit(i.workspace, Math.max(12, Math.floor(width / 2) - 8));
    const session = i.sessionName ? ` · ${fit(i.sessionName, 20)}` : "";
    const right = `${i.mode} ${chip.text}`;
    const rightWidth = [...right].length;
    const identityText =
      `${style("accent", t, "pinevim")} ${style("muted", t, "·")} ` +
      `${style("text", t, ws)}${style("muted", t, session)}`;
    const identityWidth = "pinevim".length + 3 + [...ws].length + session.length;
    if (width >= 80) {
      // Logo band: tree left, mode + lifecycle chip right-aligned.
      const [crown, base] = this.logo();
      const leftWidth = 3 + 1 + "pinevim".length; // tree + gap + wordmark
      const pad = Math.max(1, width - leftWidth - rightWidth);
      const logoLine =
        `${crown} ${style("accent", t, "pinevim")}` +
        " ".repeat(pad) +
        `${style("accent", t, i.mode)} ${style(chip.role, t, chip.text)}`;
      // Identity under the tree base, keeping the right side clear.
      const pad2 = Math.max(1, width - 3 - identityWidth);
      return [
        logoLine,
        `${base} ${identityText}${" ".repeat(pad2)}`.trimEnd(),
      ];
    }
    // 60-79 cols: compact crown + identity + mode/chip, single line.
    const [crown] = this.logo();
    return [
      `${crown} ${identityText} ${right}`.trimEnd(),
    ];
  }
}

/** Factory signature compatible with ctx.ui.setHeader. */
export function headerFactory(
  tui: TUI,
  theme: Theme,
  g: GlyphSet,
  info: HeaderInfo,
  glyphMode: GlyphMode = "unicode",
): PineHeader {
  return new PineHeader(tui, theme, g, info, glyphMode);
}
