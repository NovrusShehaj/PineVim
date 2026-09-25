import type { Theme } from "@earendil-works/pi-coding-agent";

/** Semantic roles shared by PineVIM's frame components. */
export type StyleRole =
  | "accent"
  | "muted"
  | "dim"
  | "border"
  | "success"
  | "warning"
  | "error"
  | "text";

const COLOR: Record<
  StyleRole,
  | "accent"
  | "muted"
  | "dim"
  | "border"
  | "success"
  | "warning"
  | "error"
  | "text"
> = {
  accent: "accent",
  muted: "muted",
  dim: "dim",
  border: "border",
  success: "success",
  warning: "warning",
  error: "error",
  text: "text",
};

/** Apply a PineVIM semantic role to a theme. */
export function style(theme: Theme, role: StyleRole, text: string): string {
  return theme.fg(COLOR[role] ?? "text", text);
}

/** Emphasize a small piece of text without making the whole frame loud. */
export function strong(theme: Theme, role: StyleRole, text: string): string {
  const painted = style(theme, role, text);
  // A few lightweight test doubles only implement fg(). Keep the component
  // useful in those environments while real Pi themes get the full treatment.
  const bold = (theme as Theme & { bold?: (value: string) => string }).bold;
  return typeof bold === "function" ? theme.bold(painted) : painted;
}

/**
 * Add a quiet selected surface to a short label. PineVIM uses this for
 * action hints, not for long content, so backgrounds stay out of the way.
 */
export function surface(theme: Theme, role: StyleRole, text: string): string {
  const painted = style(theme, role, text);
  const bg = (
    theme as Theme & { bg?: (color: "selectedBg", value: string) => string }
  ).bg;
  return typeof bg === "function" ? theme.bg("selectedBg", painted) : painted;
}

/** A themed horizontal rule; the caller supplies the width-safe glyph. */
export function rule(theme: Theme, glyph: string, width: number): string {
  return style(theme, "border", glyph.repeat(Math.max(0, width)));
}
