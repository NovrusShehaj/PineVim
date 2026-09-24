/**
 * PineVIM brand assets: the pine-tree logo that replaces Pi's built-in "π"
 * wordmark in the header chrome and the terminal title.
 *
 * The mark is deliberately pure ASCII: "/\" crown over "/||\" trunk. Every
 * glyph occupies exactly one terminal cell under every width model (pi-tui's
 * get-east-asian-width included), so the header's alignment arithmetic is
 * exact, and no Unicode/ASCII glyph-mode divergence is needed — the ASCII
 * fallback for the mark is the mark itself. Color is applied by the header
 * through the theme's accent role, so the tree recolors with every theme.
 */
export const TREE_CROWN = " /\\ ";
export const TREE_BASE = "/||\\";

/** The logo lines (crown, base), 4 cells wide each. */
export function treeLines(): readonly [string, string] {
  return [TREE_CROWN, TREE_BASE];
}

/** Terminal title prefix (pure ASCII — window chrome fonts vary). */
export function titleBrand(): string {
  return "pinevim";
}
