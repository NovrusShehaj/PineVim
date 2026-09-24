/**
 * Styled tmux writers (plan §7.3, §23, §27): PineVIM-authored strings may
 * carry SGR color and tmux style attributes. The trust boundary is explicit:
 *
 * - `styleLiteral` is for CONSTANT PineVIM text only (labels, separators).
 * - Every dynamic value (workspace, session, branch, model, errors) must be
 *   passed through `plain()`-equivalent escaping FIRST (diagnostics.plain
 *   maps non-printables to '?'), then wrapped with `tputAf`-style SGR by the
 *   assembler - never interpolated into tmux format strings.
 * - `#` doubling happens at the very end (tmux format escaping), matching
 *   the existing diagnostics.literal() behavior.
 *
 * Color is applied as raw SGR wrapped in #{?} nothing - tmux status-left
 * accepts embedded SGR sequences directly; they count toward the 250-cell
 * budget only by their visible width, but the option itself is capped, so
 * assemblers enforce a conservative text budget (statusline.ts).
 */

/** Truecolor/256 SGR foreground wrapper for a trusted role color. */
export type SgrRole =
  "accent" | "muted" | "success" | "warning" | "error" | "text" | "reset";

const SGR: Record<SgrRole, string> = {
  accent: "\x1b[38;2;127;208;160m",
  muted: "\x1b[38;2;125;136;127m",
  success: "\x1b[38;2;127;208;160m",
  warning: "\x1b[38;2;216;198;144m",
  error: "\x1b[38;2;224;112;112m",
  text: "\x1b[38;2;205;214;207m",
  reset: "\x1b[0m",
};

export function sgr(role: SgrRole, text: string): string {
  return `${SGR[role]}${text}${SGR.reset}`;
}

/**
 * Escape a string for safe inclusion in a tmux option value:
 * doubles `#` (tmux format escaping). Input must already be printable-only
 * (pass through diagnostics.plain for anything dynamic).
 */
export function escapeTmuxFormat(text: string): string {
  return text.replace(/#/g, "##");
}

/** Visible width of a styled string (SGR sequences are zero-width). */
export function visibleWidth(styled: string): number {
  // Strip C1 SGR sequences, then count code points.
  // Only sequences PineVIM emits are simple SGR params; a permissive strip is
  // safe here because inputs are PineVIM-authored.
  // eslint-disable-next-line no-control-regex
  const bare = styled.replace(/\x1b\[[0-9;]*m/g, "");
  return [...bare].length;
}
