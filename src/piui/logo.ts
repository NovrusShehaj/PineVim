/**
 * PineVIM brand assets: the pine-tree logo that replaces Pi's built-in "π"
 * wordmark in the header chrome and the terminal title.
 *
 * The full mark is the hand-drawn ASCII pine below (11 lines, 21 cells wide,
 * pure ASCII). Every glyph occupies exactly one terminal cell under every
 * width model (pi-tui's get-east-asian-width included), so the header's
 * alignment arithmetic is exact, and no Unicode/ASCII glyph-mode divergence
 * is needed. Color is applied by the header through the theme's accent role,
 * so the tree recolors with every theme.
 */

/** The full pine: 11 lines, widest line 21 cells (PINE_TREE_WIDTH). */
export const PINE_TREE: readonly string[] = [
  "            /\\",
  "         /\\//\\/\\",
  "        /\\ //\\\\ /\\",
  "       /\\ //||\\\\ /\\",
  "      /\\ ///||\\\\\\ /\\",
  "     /--\\--/||\\--/--\\",
  "     \\  ||/ || \\||  /",
  "      \\ ||\\ || /|| /",
  "       \\|| \\||/ ||/",
  "        \\|  \\/  |/",
  "         \\/\\/\\/\\/",
];

/** Visible width of the widest pine line; side info starts after this + gap. */
export const PINE_TREE_WIDTH = 21;

/**
 * Rows 0..4 form the needle canopy; 5..10 the branch ledge and trunk.
 * The header renders the canopy in the theme's accent color and the trunk
 * in a darker shade of the same hue (two-tone treatment).
 */
export const PINE_CROWN_LINES = 5;

/**
 * Luminance factor applied to the accent to derive the trunk tone.
 * <1 darkens (dark themes: the trunk sinks toward the background);
 * >1 lightens (light themes: a dark trunk would read as a heavy black-green
 * on a white background, so it is lifted instead). Channels clamp at 255;
 * 1 disables the treatment. Per-theme values: see PINE_TRUNK_FACTOR_OVERRIDES.
 */
export const PINE_TRUNK_FACTOR = 0.6;

/**
 * Per-theme overrides keyed by the resolved Pi theme name. Light-background
 * themes lift the trunk (> 1) — scaling a dark accent down only makes it
 * stand out harder against white, so the direction flips for them.
 */
export const PINE_TRUNK_FACTOR_OVERRIDES: Readonly<Record<string, number>> = {
  "pinevim-snow": 1.35,
  "pinevim-light": 1.3,
};

/**
 * Resolve the trunk factor for a theme. Unknown or unnamed themes fall back
 * to PINE_TRUNK_FACTOR; shipped light-background themes override.
 */
export function trunkFactorFor(themeName: string | undefined): number {
  if (themeName === undefined) return PINE_TRUNK_FACTOR;
  return PINE_TRUNK_FACTOR_OVERRIDES[themeName] ?? PINE_TRUNK_FACTOR;
}

/** Compact mark (crown, base), 4 cells wide — the collapsed header form. */
export const TREE_CROWN = " /\\ ";
export const TREE_BASE = "/||\\";

/** The compact logo lines (crown, base), 4 cells wide each. */
export function treeLines(): readonly [string, string] {
  return [TREE_CROWN, TREE_BASE];
}

/** Terminal title prefix (pure ASCII — window chrome fonts vary). */
export function titleBrand(): string {
  return "pinevim";
}

/**
 * Scale an SGR truecolor foreground sequence's RGB by `factor` (any positive
 * number; individual channels clamp at 255, so factors above 1 are safe).
 * Returns null for anything that is not a plain `38;2;r;g;b` sequence —
 * 256-color and 8-color modes fall back to the single-tone render.
 */
export function shadeFgAnsi(ansi: string, factor: number): string | null {
  // eslint-disable-next-line no-control-regex
  const m = /^\x1b\[38;2;(\d{1,3});(\d{1,3});(\d{1,3})m$/.exec(ansi);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) =>
    Math.max(0, Math.min(255, Math.round(Number(v) * factor))),
  );
  return `\x1b[38;2;${r};${g};${b}m`;
}
