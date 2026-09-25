import type { Component } from "@earendil-works/pi-tui";
import type { CustomEntry, Theme } from "@earendil-works/pi-coding-agent";
import { fit, UNICODE, type GlyphSet } from "../glyphs.js";
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

function asciiText(value: string): string {
  return value
    .replace(/[·•]/g, "-")
    .replace(/[−–—]/g, "-")
    .replace(/[^\x20-\x7e]/g, "?");
}

export function renderRunLine(
  data: RunSummaryData,
  g: GlyphSet,
  width: number,
): string {
  const separator = g.rule === "-" ? "-" : "·";
  const ellipsis = g.rule === "-" ? "..." : "…";
  const brand = g.rule === "-" ? "^" : "▲"; // D3: pine motif anchors the rule
  const parts = [`run ${data.index}`];
  const dur = formatDuration(data.seconds);
  if (dur) parts.push(dur);
  parts.push(`${data.tools} tool${data.tools === 1 ? "" : "s"}`);
  if (data.failed > 0) parts.push(`${g.warning} ${data.failed} failed`);
  if (data.interrupted) parts.push(`${g.stopped} interrupted`);
  if (data.changes)
    parts.push(g.rule === "-" ? asciiText(data.changes) : data.changes);
  if (!data.failed && !data.interrupted && width >= 60)
    parts.push(`${g.success} done`);
  // D3: right-aligned diffstat + ctx% so the eye compares context pressure.
  const trail: string[] = [];
  if (data.ctxPercent !== null)
    trail.push(`ctx ${Math.round(data.ctxPercent)}%`);
  // D3: pull "+N -M" out of `changes` if it matches the worktree summary
  // format "worktree K files +N -M" emitted by formatChangeSummary.
  if (data.changes) {
    const m = /([+-]\d+)\s+([+-]\d+)/.exec(data.changes);
    if (m) trail.push(`${m[1]} ${m[2]}`);
  }
  const head = `${brand} ${parts.join(` ${separator} `)} `;
  const headLen = [...head].length;
  const trailText = trail.length > 0 ? ` ${trail.join("  ")} ` : "";
  const trailLen = [...trailText].length;
  const ruleBudget = Math.max(0, width - headLen - trailLen);
  const fill = ruleBudget > 0 ? g.rule.repeat(ruleBudget) : "";
  const line = `${head}${fill}${trailText}`;
  return [...line].length > width ? fit(line, width, ellipsis) : line;
}

function summaryDetails(
  data: RunSummaryData,
  g: GlyphSet,
  width: number,
): string[] {
  const details: string[] = [];
  const ascii = g.rule === "-";
  const ellipsis = ascii ? "..." : "…";
  const detail = (label: string, value: string): string => {
    const prefix = `${g.rail} ${label}: `;
    const safeValue = ascii ? asciiText(value) : value;
    const content = fit(
      safeValue,
      Math.max(0, width - prefix.length),
      ellipsis,
    );
    return fit(`${prefix}${content}`, width, ellipsis);
  };
  const toolNames = Array.isArray(data.toolNames) ? data.toolNames : [];
  const toolPaths = Array.isArray(data.toolPaths) ? data.toolPaths : [];
  if (toolNames.length) {
    const tools = toolNames.slice(0, 5).join(", ");
    const more = toolNames.length > 5 ? `, +${toolNames.length - 5}` : "";
    details.push(detail("tools", `${tools}${more}`));
  }
  if (toolPaths.length) {
    const files = toolPaths.slice(0, 4).join(", ");
    const more = toolPaths.length > 4 ? `, +${toolPaths.length - 4}` : "";
    details.push(detail("files", `${files}${more}`));
  }
  // D3: dedicated diffstat row, right-aligned.
  if (data.changes) {
    const m = /([+-]\d+)\s+([+-]\d+)/.exec(data.changes);
    if (m) details.push(detail("diff", `${m[1]} ${m[2]}`));
  }
  return details;
}

export function runSummaryRenderer(
  g: GlyphSet,
): (
  entry: CustomEntry<RunSummaryData>,
  options: { expanded: boolean },
  theme: Theme,
) => Component | undefined {
  return (entry, options, theme): Component | undefined => {
    if (entry.customType !== RUN_SUMMARY_TYPE) return undefined;
    const data = entry.data as RunSummaryData | undefined;
    if (!data) return undefined;
    const role = data.failed > 0 || data.interrupted ? "warning" : "muted";
    return {
      invalidate(): void {},
      render(width: number): string[] {
        const safeWidth = Math.max(20, width);
        const line = theme.fg(role, renderRunLine(data, g, safeWidth));
        if (!options.expanded) return [line];
        return [
          line,
          ...summaryDetails(data, g, safeWidth).map((detail) =>
            theme.fg("dim", detail),
          ),
        ];
      },
    };
  };
}

export const WELCOME_TYPE = "pinevim.welcome";

export interface WelcomeData {
  /** Legacy persisted form retained for sessions created by older builds. */
  text?: string;
  /** New first-run form: short, scan-friendly orientation lines. */
  lines?: string[];
}

export function welcomeRenderer(
  g: GlyphSet = UNICODE,
): (
  entry: CustomEntry<WelcomeData>,
  options: { expanded: boolean },
  theme: Theme,
) => Component | undefined {
  return (entry, _options, theme): Component | undefined => {
    if (entry.customType !== WELCOME_TYPE) return undefined;
    const data = entry.data as WelcomeData | undefined;
    const ascii = g.rule === "-";
    const separator = ascii ? "-" : "·";
    const lines =
      Array.isArray(data?.lines) && data.lines.length
        ? data.lines
        : data?.text
          ? [data.text]
          : [
              "PineVim workspace ready",
              `type to work ${separator} F12 ? keys ${separator} /pinevim help`,
              `review the last run with /pinevim review`,
            ];
    return {
      invalidate(): void {},
      render(width: number): string[] {
        const safeWidth = Math.max(1, width);
        return lines.map((line, index) => {
          const source = ascii ? asciiText(String(line)) : String(line);
          const text = fit(source, safeWidth, ascii ? "..." : "…");
          return index === 0
            ? theme.bold(theme.fg("accent", text))
            : theme.fg("muted", text);
        });
      },
    };
  };
}
