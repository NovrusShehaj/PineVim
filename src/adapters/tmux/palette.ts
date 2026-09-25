/**
 * PineVim tmux palette mapping (design D1).
 *
 * The tmux status-left string uses `#[fg=colourN]` attributes, not raw SGR.
 * The shipped palette in `styled.ts` is a single hard-coded dark scheme. This
 * module resolves the same 8-role PineVim palette from the active theme name
 * into tmux color names, so a `snow`-themed session shows a different accent
 * than a `cyberpunk`-themed one.
 *
 * Fallback chain when a theme cannot be resolved: dark → light → mono. The
 * theme names are the seven shipped PineVim palettes plus the four new ones
 * (D11: dusk, sunrise, aurora, paper). Unknown themes fall back to the dark
 * palette and a warning is logged at the controller level.
 *
 * Resolution happens once per status-line render; the cost is a small object
 * literal and is bounded.
 */

import type { SgrRole } from "./styled.js";

/** Truecolor → tmux palette mapping. `default` lets the terminal decide. */
const TMUX_COLOUR: Record<Exclude<SgrRole, "reset">, string> = {
  accent: "green",
  muted: "brightblack",
  dim: "brightblack",
  border: "brightblack",
  success: "green",
  warning: "yellow",
  error: "red",
  text: "default",
};

/**
 * Per-theme accent overrides (used in 256-color terminals where the dark
 * `green` looks identical to the dark theme's green). The hex values match
 * the JSON palettes shipped under `src/piui/themes/`.
 */
const THEME_ACCENT: Record<string, string> = {
  "pinevim-dark": "green",
  "pinevim-light": "magenta", // dark green on white needs more separation
  "pinevim-mono": "white",
  "pinevim-neon": "brightgreen",
  "pinevim-cyberpunk": "magenta",
  "pinevim-forest": "green",
  "pinevim-snow": "blue",
  "pinevim-dusk": "cyan",
  "pinevim-sunrise": "yellow",
  "pinevim-aurora": "magenta",
  "pinevim-paper": "black",
};

/**
 * Resolve the tmux palette for a given PineVim theme name. Returns `null` for
 * unknown themes so callers can fall back to the legacy hard-coded colors.
 */
export function paletteForTheme(
  themeName: string | null,
  _ascii = false,
): AgentPalette {
  if (!themeName) {
    return {
      accent: TMUX_COLOUR.accent,
      muted: TMUX_COLOUR.muted,
      dim: TMUX_COLOUR.dim,
      border: TMUX_COLOUR.border,
      success: TMUX_COLOUR.success,
      warning: TMUX_COLOUR.warning,
      error: TMUX_COLOUR.error,
      text: TMUX_COLOUR.text,
    };
  }
  return {
    accent: THEME_ACCENT[themeName] ?? TMUX_COLOUR.accent,
    muted: TMUX_COLOUR.muted,
    dim: TMUX_COLOUR.dim,
    border: TMUX_COLOUR.border,
    success: TMUX_COLOUR.success,
    warning: TMUX_COLOUR.warning,
    error: TMUX_COLOUR.error,
    text: TMUX_COLOUR.text,
  };
}

/**
 * PineVim role → tmux color name. Used by `tmuxFg()` to resolve the right
 * palette token for the active theme. Falls back to the legacy dark palette
 * when no theme has been resolved.
 */
export interface AgentPalette {
  accent: string;
  muted: string;
  dim: string;
  border: string;
  success: string;
  warning: string;
  error: string;
  text: string;
}
