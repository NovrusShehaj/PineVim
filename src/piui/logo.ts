/**
 * PineVIM brand assets: the pine-tree logo that replaces Pi's built-in "π"
 * wordmark in the header chrome and terminal title.
 *
 * Design constraints (verified against pi-tui's width engine):
 * - no emoji: 🌲 (U+1F332) measures 2 cells via get-east-asian-width but
 *   renders 1 cell in many macOS terminals, which drifts right-alignment;
 * - every glyph below occupies exactly one terminal cell in every font
 *   pi-tui's eastAsianWidth model knows about, so alignment math is exact;
 * - color is applied by the header through the theme's accent role, so the
 *   tree renders bright pine green in the color themes and plain white/bright
 *   in pinevim-mono (color is the theme's decision, shape is fixed).
 */
import type { GlyphMode } from "./glyphs.js";

/**
 * Two-line pine outline: crown + base, 3 cells wide.
 * `▲` over `/|\` reads as a pine at a glance and survives copy/paste.
 */
export const TREE_UNICODE = [" ▲ ", "/|\\"] as const;

/** ASCII fallback (ui.glyphs = "ascii"): same shape, safest glyphs. */
export const TREE_ASCII = [" ^ ", "/|\\"] as const;

/** The logo lines for the configured glyph mode (crown, base). */
export function treeLines(mode: GlyphMode): readonly [string, string] {
  return mode === "ascii" ? TREE_ASCII : TREE_UNICODE;
}

/** Terminal title prefix (ascii-safe when the ASCII vocabulary is forced). */
export function titleBrand(mode: GlyphMode): string {
  return mode === "ascii" ? "pinevim" : "▲ pinevim";
}
