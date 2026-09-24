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
  switch (s.lifecycle) {
    case "error":
      return { text: fit(label, width), role: "error" };
    case "waiting":
      return { text: fit(label, width), role: "accent" };
    case "interrupted":
      return { text: fit(label, width), role: "warning" };
    case "idle":
      return { text: fit(label, width), role: "success" };
    default:
      return { text: fit(label, width), role: "text" };
  }
}

export function queueChip(queued: number, g: GlyphSet): Chip | null {
  if (queued <= 0) return null;
  return { text: `${g.queued} ${queued} queued`, role: "muted" };
}

/** 10-cell context gauge: `▮▮▮▮▮▯▯▯▯▯ 42%`; hidden entirely when unknown. */
export function contextGauge(percent: number | null, width = 10): Chip | null {
  if (percent === null) return null;
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((clamped / 100) * width);
  const bar = "▮".repeat(filled) + "▯".repeat(Math.max(0, width - filled));
  return {
    text: `${bar} ${clamped}%`,
    role: clamped >= 90 ? "error" : clamped >= 75 ? "warning" : "muted",
  };
}

export function modelChip(model: string | null | undefined): Chip | null {
  if (!model) return null;
  return { text: fit(model, 24), role: "muted" };
}

export function thinkingChip(level: string | null | undefined): Chip | null {
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
  return { text: `think ${short[level] ?? level}`, role: "muted" };
}

/** Render chips with a separator, fitting to the width budget. */
export function chipLine(
  chips: (Chip | null)[],
  width: number,
  sep = "  ·  ",
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
  return joined.length > width ? fit(joined, width) : joined;
}
