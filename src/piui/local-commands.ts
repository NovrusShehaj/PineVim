import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  draftFromTools,
  listSkills,
  saveProposal,
  setSkillStatus,
} from "../skills/registry.js";
import type { PiUi } from "./index.js";
import { formatInsightsLines, formatSearchResults } from "./search-commands.js";
import { localRunIndex } from "./run-store.js";

/** Paths for the review dialog. Empty runs get one inert line. */
export function reviewOptions(paths: readonly string[]): string[] {
  return paths.length > 0
    ? [...paths]
    : ["No file changes recorded for this run."];
}

/** Local /pinevim verbs that do not go through the controller. */
export async function handlePinevimLocal(
  args: string,
  context: ExtensionContext,
  ui: PiUi | null,
): Promise<boolean> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const head = parts[0] ?? "";
  if (
    head !== "review" &&
    head !== "learn" &&
    head !== "skills" &&
    head !== "search" &&
    head !== "insights"
  )
    return false;
  if (head === "search") {
    const query = parts.slice(1).join(" ");
    if (!query) {
      context.ui.notify(
        "Usage: /pinevim search <words>. Searches tools, files and sessions across runs.",
        "info",
      );
      return true;
    }
    const opened = localRunIndex();
    if (!opened) {
      context.ui.notify(
        "Run index unavailable; cross-session search is disabled this session.",
        "warning",
      );
      return true;
    }
    try {
      const results = opened.index.search(query, 20);
      const lines = formatSearchResults(query, results);
      await context.ui.select("pinevim search", lines);
    } finally {
      opened.release();
    }
    return true;
  }
  if (head === "insights") {
    const raw = parts[1];
    let days = 30;
    if (raw !== undefined) {
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 3650) {
        context.ui.notify(
          "Usage: /pinevim insights [days] with days 1–3650.",
          "warning",
        );
        return true;
      }
      days = parsed;
    }
    const opened = localRunIndex();
    try {
      const snapshot = opened?.index.insights(days) ?? null;
      const lines = formatInsightsLines(days, snapshot);
      await context.ui.select("pinevim insights", lines);
    } finally {
      opened?.release();
    }
    return true;
  }
  if (head === "review") {
    const summary = ui?.lastSummary;
    const title = summary?.changes
      ? `pinevim review · ${summary.changes}`
      : "pinevim review";
    // Pi's selector owns focus and restores it on dismiss. The choice is ignored
    // so this never opens a buffer or sends keys to Neovim.
    await context.ui.select(title, reviewOptions(summary?.toolPaths ?? []));
    return true;
  }
  if (head === "learn") {
    const names = ui?.lastSummary?.toolNames ?? [];
    const draft = draftFromTools(names);
    if (!draft) {
      context.ui.notify(
        "No repeated tool pattern in the last run. Nothing was saved.",
        "info",
      );
      return true;
    }
    await saveProposal(draft);
    context.ui.notify(
      `Skill proposal ${draft.name} saved. /pinevim skills approve ${draft.name}`,
      "info",
    );
    return true;
  }
  const action = parts[1];
  const name = parts[2];
  if (action === "approve" && name) {
    const problem = await setSkillStatus(name, "active");
    context.ui.notify(
      problem ?? `Skill ${name} active. It loads through Pi skill paths.`,
      problem ? "warning" : "info",
    );
    return true;
  }
  if (action === "disable" && name) {
    const problem = await setSkillStatus(name, "disabled");
    context.ui.notify(
      problem ?? `Skill ${name} disabled.`,
      problem ? "warning" : "info",
    );
    return true;
  }
  const skills = await listSkills();
  const line =
    skills.length === 0
      ? "No skills yet. /pinevim learn after a run captures a proposal."
      : skills.map((skill) => `${skill.status} ${skill.name}`).join(" · ");
  context.ui.notify(line, "info");
  return true;
}
