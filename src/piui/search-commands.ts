/**
 * Presentation for the extension-local search/insights commands (Tier 2
 * #4/#5). Pure formatting over data from the run index; mirrors the compact
 * chip style of the deck (`budgetChipText`) so insights complement rather
 * than duplicate it.
 */
import type { RunRecord, InsightsSnapshot } from "./run-index.js";

function usd(value: number): string {
  return `$${value.toFixed(value < 10 ? 3 : 2)}`;
}

function shortTokens(tokens: number): string {
  return tokens >= 10000
    ? `${(tokens / 1000).toFixed(1)}k tok`
    : `${tokens} tok`;
}

/** `MMM D HH:MM` in local time; stable and compact. */
function stamp(ms: number): string {
  const d = new Date(ms);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${months[d.getMonth()] ?? "?"} ${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Outcome text for a record; `running` for rows never closed. */
export function runOutcome(r: RunRecord): string {
  if (r.endedAt === null) return "running";
  if (r.interrupted) return "stopped";
  if (r.failed > 0) return `${r.failed} failed`;
  return "done";
}

/**
 * Result lines for `/pinevim search`. The first line always reports the
 * match count so empty results are explicit rather than a blank dialog.
 */
export function formatSearchResults(
  query: string,
  results: readonly RunRecord[],
): string[] {
  if (results.length === 0)
    return [
      `No runs match "${query}".`,
      "",
      "Search covers tool names, edit/write",
      "file paths and session ids of past runs.",
    ];
  const lines = [
    `${results.length} run${results.length === 1 ? "" : "s"} match "${query}"`,
    "",
  ];
  for (const r of results) {
    const files = r.toolPaths.slice(0, 2).join(", ");
    const more = r.toolPaths.length > 2 ? `, +${r.toolPaths.length - 2}` : "";
    lines.push(
      `${stamp(r.startedAt)} · ${runOutcome(r)} · ${r.tools} tools · ` +
        (r.costTotal > 0 ? usd(r.costTotal) : shortTokens(r.totalTokens)) +
        (files ? ` · ${files}${more}` : ""),
    );
    if (r.toolNames.length > 0)
      lines.push(`  ${r.toolNames.slice(0, 5).join(", ")}`);
  }
  return lines;
}

/**
 * Result lines for `/pinevim insights [days]`. `null` snapshot renders the
 * unavailable-index explanation.
 */
export function formatInsightsLines(
  days: number,
  snapshot: InsightsSnapshot | null,
): string[] {
  if (!snapshot)
    return [
      `Run index unavailable; insights need a PineVim workspace session.`,
      "",
      "Runs are indexed automatically once the index can be opened.",
    ];
  if (snapshot.runs === 0)
    return [`No runs indexed in the last ${days} day${days === 1 ? "" : "s"}.`];
  const lines = [
    `Last ${days} day${days === 1 ? "" : "s"} · ${snapshot.runs} run${snapshot.runs === 1 ? "" : "s"} across ${snapshot.sessions} session${snapshot.sessions === 1 ? "" : "s"}`,
    `${shortTokens(snapshot.totalTokens)} · ${usd(snapshot.costTotal)}`,
    `${snapshot.tools} tool${snapshot.tools === 1 ? "" : "s"}` +
      (snapshot.failedTools ? `, ${snapshot.failedTools} failed` : "") +
      (snapshot.interrupted ? `, ${snapshot.interrupted} stopped` : ""),
  ];
  if (snapshot.topTools.length > 0) {
    lines.push("");
    lines.push("Top tools");
    for (const tool of snapshot.topTools)
      lines.push(`  ${tool.name} ×${tool.count}`);
  }
  if (snapshot.perDay.length > 0) {
    lines.push("");
    lines.push("Runs per day");
    for (const day of snapshot.perDay.slice(-7))
      lines.push(
        `  ${day.day}  ${day.runs} run${day.runs === 1 ? "" : "s"}` +
          (day.cost > 0 ? ` · ${usd(day.cost)}` : ""),
      );
  }
  return lines;
}
