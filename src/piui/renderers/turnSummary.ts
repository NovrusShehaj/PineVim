/**
 * Turn summaries (plan §8.4, §20): durable transcript anchors persisted as
 * custom entries (never sent to the LLM) and rendered via a registered entry
 * renderer, so they survive --resume without replaying fabricated UI.
 */
import type { Component } from "@earendil-works/pi-tui";
import type { CustomEntry, Theme } from "@earendil-works/pi-coding-agent";
import { type GlyphSet } from "../glyphs.js";

export const TURN_SUMMARY_TYPE = "pinevim.turn_summary";

export interface TurnSummaryData {
  turn: number | null;
  /** Elapsed seconds for the turn. */
  seconds: number | null;
  tools: number;
  failed: number;
  interrupted: boolean;
  /** Context utilization at turn end, percent. */
  ctxPercent: number | null;
}

export interface TurnSummaryOptions {
  expanded: boolean;
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  return `${Math.round(seconds)} s`;
}

/** `─ turn 7 · 5 tools · 0 failed · 38.2 s · ctx 51% ────────────` */
export function renderTurnSummaryLine(
  data: TurnSummaryData,
  g: GlyphSet,
  width: number,
): string {
  const parts: string[] = [];
  if (data.turn !== null) parts.push(`turn ${data.turn}`);
  parts.push(`${data.tools} tool${data.tools === 1 ? "" : "s"}`);
  if (data.failed > 0) parts.push(`${data.failed} failed`);
  const dur = formatDuration(data.seconds);
  if (dur) parts.push(dur);
  if (data.ctxPercent !== null)
    parts.push(`ctx ${Math.round(data.ctxPercent)}%`);
  const label = data.interrupted ? "interrupted · " : "";
  const head = `${g.rule} ${label}${parts.join(" · ")} `;
  const used = [...head].length + 1;
  const fill = used < width ? g.rule.repeat(width - used) : "";
  return `${head}${fill}`;
}

export function turnSummaryRenderer(
  g: GlyphSet,
): (
  entry: CustomEntry<TurnSummaryData>,
  options: TurnSummaryOptions,
  theme: Theme,
) => Component | undefined {
  // Render on demand at the live viewport width; no cached state, so Pi's
  // diff renderer always sees fresh lines.
  return (entry, _options, theme): Component | undefined => {
    if (entry.customType !== TURN_SUMMARY_TYPE) return undefined;
    const data = entry.data as TurnSummaryData | undefined;
    if (!data) return undefined;
    const role = data.failed > 0 || data.interrupted ? "warning" : "muted";
    return {
      invalidate(): void {},
      render(width: number): string[] {
        const w = renderTurnSummaryLine(data, g, Math.max(20, width));
        return [theme.fg(role, w)];
      },
    };
  };
}
