import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRunsDatabase, RUNS_DB_FILE } from "../../src/store/schema.js";
import { RunIndex } from "../../src/piui/run-index.js";
import {
  formatInsightsLines,
  formatSearchResults,
  runOutcome,
} from "../../src/piui/search-commands.js";
import {
  helpPanelLines,
  insightsPanelLines,
  type InsightsFacts,
} from "../../src/adapters/tmux/panels.js";

const open = (path: string): DatabaseSync => new DatabaseSync(path);

function seededIndex(): { index: RunIndex; dir: string; close(): void } {
  const dir = mkdtempSync(join(tmpdir(), "pv-fmt-"));
  const { db } = openRunsDatabase(join(dir, RUNS_DB_FILE), open);
  const index = new RunIndex(db);
  const a = index.openRun("sess-alpha", Date.now() - 3600_000);
  if (a !== null) {
    index.addToolName(a, "edit");
    index.addToolPath(a, "/repo/src/auth/middleware.ts");
    index.addUsage(a, { totalTokens: 1200, cost: { total: 0.03 } });
    index.closeRun(a, Date.now() - 3500_000, 42, false);
  }
  return {
    index,
    dir,
    close() {
      db.close();
    },
  };
}

describe("search output contract", () => {
  it("reports an explicit empty state", () => {
    const lines = formatSearchResults("nothing-here", []);
    assert.ok(lines[0]?.includes("No runs match"));
    assert.ok(lines.join("\n").includes("nothing-here"));
  });

  it("summarizes matches with outcome, tools and cost", () => {
    const seeded = seededIndex();
    try {
      const results = seeded.index.search("middleware");
      const lines = formatSearchResults("middleware", results);
      assert.ok(lines[0]?.includes('1 run match "middleware"'));
      const body = lines.join("\n");
      assert.ok(body.includes("done"), "outcome shown");
      assert.ok(body.includes("$0.030"), "cost shown");
      assert.ok(body.includes("middleware.ts"), "path shown");
      assert.ok(body.includes("edit"), "tool shown");
    } finally {
      seeded.close();
    }
  });

  it("marks open and interrupted runs distinctly", () => {
    const dir = mkdtempSync(join(tmpdir(), "pv-fmt-"));
    const { db } = openRunsDatabase(join(dir, RUNS_DB_FILE), open);
    try {
      const index = new RunIndex(db);
      const open = index.openRun("s", Date.now());
      if (open !== null) index.addToolName(open, "bash");
      assert.equal(
        runOutcome(index.getRun(open as number) as never),
        "running",
      );
      const id = index.openRun("s2", Date.now());
      if (id !== null) index.closeRun(id, Date.now() + 1, 1, true);
      assert.equal(runOutcome(index.getRun(id as number) as never), "stopped");
    } finally {
      db.close();
    }
  });
});

describe("insights output contract", () => {
  it("explains an unavailable index instead of faking numbers", () => {
    const lines = formatInsightsLines(30, null);
    assert.ok(lines.join(" ").toLowerCase().includes("unavailable"));
  });

  it("explains an empty window", () => {
    const lines = formatInsightsLines(30, {
      sinceMs: 0,
      runs: 0,
      sessions: 0,
      interrupted: 0,
      failedTools: 0,
      tools: 0,
      totalTokens: 0,
      costTotal: 0,
      topTools: [],
      perDay: [],
    });
    assert.ok(lines[0]?.includes("No runs indexed"));
  });

  it("renders totals, top tools and day buckets", () => {
    const seeded = seededIndex();
    try {
      const snapshot = seeded.index.insights(30);
      const lines = formatInsightsLines(30, snapshot);
      const body = lines.join("\n");
      assert.ok(body.includes("1 run across 1 session"));
      assert.ok(body.includes("1200 tok"));
      assert.ok(body.includes("$0.030"));
      assert.ok(body.includes("Top tools"));
      assert.ok(body.includes("edit ×1"));
      assert.ok(body.includes("Runs per day"));
    } finally {
      seeded.close();
    }
  });
});

describe("insights popup panel", () => {
  it("renders an aggregate snapshot with panel grammar", () => {
    const facts: InsightsFacts = {
      prefix: "F12",
      days: 30,
      snapshot: {
        sinceMs: Date.now() - 86_400_000,
        runs: 4,
        sessions: 2,
        interrupted: 1,
        failedTools: 3,
        tools: 11,
        totalTokens: 53_800,
        costTotal: 0.42,
        topTools: [{ name: "edit", count: 3 }],
        perDay: [{ day: "2026-09-29", runs: 2, cost: 0.2 }],
      },
    };
    const lines = insightsPanelLines(facts, false);
    const body = lines.join("\n");
    assert.ok(body.toUpperCase().includes("INSIGHTS"));
    assert.ok(body.includes("4 across 2 sessions"));
    assert.ok(body.includes("53.8k"));
    assert.ok(body.includes("$0.42"));
    assert.ok(body.includes("edit"));
    assert.ok(body.includes("2026-09-29"));
  });

  it("renders the degraded path when the snapshot is null", () => {
    const lines = insightsPanelLines(
      { prefix: "F12", days: 30, snapshot: null },
      true,
    );
    const body = lines.join("\n");
    assert.ok(body.toLowerCase().includes("unavailable"));
    assert.ok(body.includes("indexed"));
  });

  it("help panel lists the new commands", () => {
    const body = helpPanelLines("F12").join("\n");
    assert.ok(body.includes("/pinevim search"));
    assert.ok(body.includes("/pinevim insights"));
  });
});
