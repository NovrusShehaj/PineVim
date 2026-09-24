/**
 * Shared UI primitives: chips, context gauge, formatters.
 * Pure functions; both the in-pane chip band and the status deck compose from
 * here so vocabulary never drifts between components (plan §14, §32).
 */
import type { GlyphSet } from "./glyphs.js";
import { fit } from "./glyphs.js";
import { lifecycleLabel, type LifecycleState } from "./lifecycle.js";

/** A styled chip: text carries meaning, style carries emphasis. */
export interface Chip {
  text: string;
  /** Semantic role resolved by the caller against the theme. */
  role: "accent" | "muted" | "success" | "warning" | "error" | "text";
}

export function modeChip(
  mode: "CHAT" | "IDE",
  focus?: "agent" | "editor",
): Chip {
  const text = focus ? `${mode} ${focus}` : mode;
  return { text, role: "accent" };
}

export function lifecycleChip(
  s: LifecycleState,
  g: GlyphSet,
  width = 28,
): Chip {
  const label = lifecycleLabel(s, g);
  const ellipsis = g.rule === "-" ? "..." : "…";
  switch (s.lifecycle) {
    case "error":
      return { text: fit(label, width, ellipsis), role: "error" };
    case "waiting":
      return { text: fit(label, width, ellipsis), role: "accent" };
    case "interrupted":
      return { text: fit(label, width, ellipsis), role: "warning" };
    case "idle":
      return { text: fit(label, width, ellipsis), role: "success" };
    default:
      return { text: fit(label, width, ellipsis), role: "text" };
  }
}

/** Boolean means "some messages are queued" without a real count. */
export function queueChip(queued: number | boolean, g: GlyphSet): Chip | null {
  if (queued === true) return { text: `${g.queued} queued`, role: "muted" };
  if (typeof queued === "number" && queued > 0)
    return { text: `${g.queued} ${queued} queued`, role: "muted" };
  return null;
}

/** 10-cell context gauge. ASCII mode uses `#` and `-` so glyphs stay one cell. */
export function contextGauge(
  percent: number | null,
  width = 10,
  ascii = false,
): Chip | null {
  if (percent === null) return null;
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((clamped / 100) * width);
  const on = ascii ? "#" : "▮";
  const off = ascii ? "-" : "▯";
  const bar = on.repeat(filled) + off.repeat(Math.max(0, width - filled));
  return {
    text: `ctx ${bar} ${clamped}%`,
    role: clamped >= 90 ? "error" : clamped >= 75 ? "warning" : "muted",
  };
}

export function modelChip(
  model: string | null | undefined,
  ascii = false,
): Chip | null {
  if (!model) return null;
  return {
    text: `model ${fit(model, 18, ascii ? "..." : "…")}`,
    role: "muted",
  };
}

/** Git branch is environment context, so it belongs in the footer deck. */
export function branchChip(
  branch: string | null | undefined,
  ascii = false,
): Chip | null {
  if (!branch) return null;
  return {
    text: `branch ${fit(branch, 16, ascii ? "..." : "…")}`,
    role: "muted",
  };
}

export function thinkingChip(
  level: string | null | undefined,
  ascii = false,
): Chip | null {
  if (!level) return null;
  const short: Record<string, string> = {
    off: "off",
    minimal: "min",
    low: "low",
    medium: "med",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  };
  return {
    text: `think ${fit(short[level] ?? level, 12, ascii ? "..." : "…")}`,
    role: "muted",
  };
}

/** Render chips with a separator, fitting to the width budget. */
export function chipLine(
  chips: (Chip | null)[],
  width: number,
  sep = "  ·  ",
  ascii = false,
): string {
  const present = chips.filter((c): c is Chip => c !== null);
  const texts = present.map((c) => c.text);
  const budget = (line: string[]): number =>
    line.reduce((n, t) => n + [...t].length, 0) +
    sep.length * (line.length - 1);
  let line = texts;
  while (line.length > 1 && budget(line) > width) {
    // Drop from the tail: the head of the band carries primary state.
    line = line.slice(0, -1);
  }
  const joined = line.join(sep);
  return joined.length > width
    ? fit(joined, width, ascii ? "..." : "…")
    : joined;
}

/** Same fit rules as chipLine, with each surviving chip styled by its role. */
export function styledChipLine(
  chips: (Chip | null)[],
  width: number,
  style: (role: Chip["role"], text: string) => string,
  sep = "  ·  ",
  styleSeparator?: (text: string) => string,
  ascii = false,
): string {
  const present = chips.filter((c): c is Chip => c !== null);
  const budget = (line: Chip[]): number =>
    line.reduce((n, c) => n + [...c.text].length, 0) +
    sep.length * (line.length - 1);
  let line = present;
  while (line.length > 1 && budget(line) > width) line = line.slice(0, -1);
  if (line.length === 1 && line[0] && [...line[0].text].length > width)
    return style(line[0].role, fit(line[0].text, width, ascii ? "..." : "…"));
  const separator = styleSeparator?.(sep) ?? sep;
  return line.map((c) => style(c.role, c.text)).join(separator);
}
