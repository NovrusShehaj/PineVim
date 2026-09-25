/**
 * PineVIM glyph system: one authoritative mapping for every state marker.
 *
 * Rules (plan §13.4, §32):
 * - every glyph has an ASCII fallback with the same meaning;
 * - glyphs never carry state alone - the adjacent label text always names the state;
 * - no zero-width characters (copy fidelity).
 */
export type GlyphKey =
  | "user"
  | "running"
  | "success"
  | "failure"
  | "warning"
  | "interrupted"
  | "waiting"
  | "compacting"
  | "thinking"
  | "stopped"
  | "queued"
  | "rule"
  | "rail"
  | "error";

export interface GlyphSet {
  user: string;
  running: string;
  success: string;
  failure: string;
  warning: string;
  interrupted: string;
  waiting: string;
  compacting: string;
  thinking: string;
  stopped: string;
  queued: string;
  rule: string;
  rail: string;
  error: string;
}

/** Full-width Unicode set (default). */
export const UNICODE: GlyphSet = {
  user: "›",
  running: "●",
  success: "✓",
  failure: "✗",
  warning: "▲",
  interrupted: "⏸",
  waiting: "?",
  compacting: "⌁",
  thinking: "◦",
  stopped: "■",
  queued: "⇅",
  rule: "─",
  rail: "│",
  error: "✗",
};

/** ASCII fallback: same vocabulary, terminal-safe everywhere. */
export const ASCII: GlyphSet = {
  user: ">",
  running: "*",
  success: "+",
  failure: "x",
  warning: "!",
  interrupted: "=",
  waiting: "?",
  compacting: "~",
  thinking: "-",
  stopped: "#",
  queued: "^",
  rule: "-",
  rail: "|",
  error: "x",
};

export type GlyphMode = "unicode" | "ascii";

export function glyphs(mode: GlyphMode): GlyphSet {
  return mode === "ascii" ? ASCII : UNICODE;
}

/** Working-indicator frames while the agent is active. Static when motion is off. */
export const WORK_FRAMES_UNICODE = ["·", "›", "»", "›"] as const;
export const WORK_FRAMES_ASCII = ["*", ">", ">", ">"] as const;

/**
 * Truncate a string to an approximate visible cell budget.
 * PineVIM chrome glyphs are single-width; this never splits surrogate pairs and
 * appends an ellipsis when content is dropped. Cell-exactness for exotic
 * double-width runs is not required because every chrome line ends in a label,
 * never mid-token data.
 */
export function fit(value: string, maxCells: number, ellipsis = "…"): string {
  if (maxCells <= 0) return "";
  const points = [...value];
  if (points.length <= maxCells) return value;
  const marker = [...ellipsis];
  if (marker.length >= maxCells) return marker.slice(0, maxCells).join("");
  return points.slice(0, maxCells - marker.length).join("") + ellipsis;
}
