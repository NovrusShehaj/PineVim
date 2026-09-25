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
  | "error"
  // D10: extended vocabulary (state, not decoration). Every glyph has an
  // ASCII fallback and carries or sits beside a label.
  | "compacted"
  | "forked"
  | "edited"
  | "cached"
  | "parallel"
  | "agent"
  | "pine"
  | "frame";

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
  // D10
  compacted: string;
  forked: string;
  edited: string;
  cached: string;
  parallel: string;
  agent: string;
  pine: string;
  frame: string;
}

/** Full-width Unicode set (default). */
export const UNICODE: GlyphSet = {
  user: "\u203a", // ›
  running: "\u25cf", // ●
  success: "\u2713", // ✓
  failure: "\u2717", // ✗
  warning: "\u25b2", // ▲
  interrupted: "\u23f8", // ⏸
  waiting: "?",
  compacting: "\u2301", // ⌁
  thinking: "\u25e6", // ◦
  stopped: "\u25a0", // ■
  queued: "\u21c5", // ⇅
  rule: "\u2500", // ─
  rail: "\u2502", // │
  error: "\u2717", // ✗
  // D10
  compacted: "\u2302", // ⌂
  forked: "\u2443", // ⑃
  edited: "\u270e", // ✎
  cached: "\u21bb", // ↻
  parallel: "\u2af6", // ⫶
  agent: "\u25b2", // ▲ (brand mark)
  pine: "\u2310", // ⌐
  frame: "\u25cc", // ◌
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
  // D10
  compacted: "c",
  forked: "f",
  edited: "~",
  cached: "@",
  parallel: "&",
  agent: "^",
  pine: "+",
  frame: "o",
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
