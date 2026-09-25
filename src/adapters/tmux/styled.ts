/**
 * Styled tmux writers.
 *
 * Status-left uses tmux `#[fg=colourN]` attributes, not raw SGR. tmux treats
 * `#` as a format introducer, so style tokens are assembled after dynamic
 * text has had its `#` doubled. Dynamic text is passed through `plain()`
 * first. The status option must contain no ESC byte.
 *
 * `sgr()` remains for in-process strings that are not written to status-left.
 */

/** Truecolor/256 SGR foreground wrapper for a trusted role color. */
export type SgrRole =
  | "accent"
  | "muted"
  | "dim"
  | "border"
  | "success"
  | "warning"
  | "error"
  | "text"
  | "reset";

const SGR: Record<SgrRole, string> = {
  accent: "\x1b[38;2;127;208;160m",
  muted: "\x1b[38;2;125;136;127m",
  dim: "\x1b[38;2;90;102;94m",
  border: "\x1b[38;2;58;68;62m",
  success: "\x1b[38;2;127;208;160m",
  warning: "\x1b[38;2;216;198;144m",
  error: "\x1b[38;2;224;112;112m",
  text: "\x1b[38;2;205;214;207m",
  reset: "\x1b[0m",
};

export function sgr(role: SgrRole, text: string): string {
  return `${SGR[role]}${text}${SGR.reset}`;
}

/** Terminal-named colors keep the strip legible in 16/256-color palettes. */
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
 * Wrap trusted text in a tmux status style, or return it unchanged.
 * Pass `palette` to use the active PineVim theme's tmux colors (D1);
 * falls back to the legacy hard-coded palette when omitted.
 */
export function tmuxFg(
  role: SgrRole,
  text: string,
  color = true,
  palette?: { accent?: string } | null,
): string {
  if (!color || role === "reset") return text;
  const colorName =
    palette && role === "accent" && palette.accent
      ? palette.accent
      : TMUX_COLOUR[role];
  return `#[fg=${colorName}]${text}#[default]`;
}

/**
 * Escape a string for safe inclusion in a tmux option value:
 * doubles `#` (tmux format escaping). Input must already be printable-only
 * (pass through diagnostics.plain for anything dynamic).
 */
export function escapeTmuxFormat(text: string): string {
  return text.replace(/#/g, "##");
}

/** Visible width of a styled string (SGR and tmux directives are zero-width). */
export function visibleWidth(styled: string): number {
  // Strip SGR and tmux style tokens, then count code points.
  const bare = styled
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/#\[[^\]]*\]/g, "");
  return [...bare].length;
}
