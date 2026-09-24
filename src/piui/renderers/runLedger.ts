import type { Component } from "@earendil-works/pi-tui";
import type { CustomEntry, Theme } from "@earendil-works/pi-coding-agent";
import type { GlyphSet } from "../glyphs.js";
import { formatDuration } from "./turnSummary.js";

export const RUN_SUMMARY_TYPE = "pinevim.run";

export interface RunSummaryData {
  index: number;
  seconds: number | null;
  tools: number;
  failed: number;
  interrupted: boolean;
  ctxPercent: number | null;
  changes: string | null;
  toolNames: string[];
  toolPaths: string[];
}

export function renderRunLine(
  data: RunSummaryData,
  g: GlyphSet,
  width: number,
): string {
  const parts = [`run ${data.index}`];
  const dur = formatDuration(data.seconds);
  if (dur) parts.push(dur);
  parts.push(`${data.tools} tool${data.tools === 1 ? "" : "s"}`);
  if (data.failed > 0) parts.push(`${data.failed} failed`);
  if (data.interrupted) parts.push("interrupted");
  if (data.changes) parts.push(data.changes);
  if (data.ctxPercent !== null)
    parts.push(`ctx ${Math.round(data.ctxPercent)}%`);
  const head = `${g.rule} ${parts.join(" · ")} `;
  const used = [...head].length + 1;
  const fill = used < width ? g.rule.repeat(width - used) : "";
  return `${head}${fill}`;
}

export function runSummaryRenderer(
  g: GlyphSet,
): (
  entry: CustomEntry<RunSummaryData>,
  options: { expanded: boolean },
  theme: Theme,
) => Component | undefined {
  return (entry, _options, theme): Component | undefined => {
    if (entry.customType !== RUN_SUMMARY_TYPE) return undefined;
    const data = entry.data as RunSummaryData | undefined;
    if (!data) return undefined;
    const role = data.failed > 0 || data.interrupted ? "warning" : "muted";
    return {
      invalidate(): void {},
      render(width: number): string[] {
        return [theme.fg(role, renderRunLine(data, g, Math.max(20, width)))];
      },
    };
  };
}

export const WELCOME_TYPE = "pinevim.welcome";

export function welcomeRenderer(): (
  entry: CustomEntry<{ text: string }>,
  options: { expanded: boolean },
  theme: Theme,
) => Component | undefined {
  return (entry, _options, theme): Component | undefined => {
    if (entry.customType !== WELCOME_TYPE) return undefined;
    const text =
      typeof entry.data?.text === "string"
        ? entry.data.text
        : "type to work · F12 ? keys · /pinevim help";
    return {
      invalidate(): void {},
      render(width: number): string[] {
        return [theme.fg("muted", text.slice(0, Math.max(1, width)))];
      },
    };
  };
}
