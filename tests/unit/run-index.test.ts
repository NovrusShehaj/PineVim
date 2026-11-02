import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  applyMigrations,
  MIGRATIONS,
  openRunsDatabase,
  RUNS_DB_FILE,
  SCHEMA_VERSION,
  type Migration,
  type RunsDatabase,
} from "../../src/store/schema.js";
import {
  ftsQuery,
  RunIndex,
  type RunRecord,
} from "../../src/piui/run-index.js";
import { readInsights } from "../../src/piui/run-store.js";
import { PineError } from "../../src/diagnostics.js";

function tempStore(): string {
  return mkdtempSync(join(tmpdir(), "pv-runs-"));
}

const open = (path: string): RunsDatabase => new DatabaseSync(path);

describe("schema migrations (Tier 2 #7)", () => {
  it("initializes a fresh database directly at the latest version", () => {
    const dir = tempStore();
    const { db, applied } = openRunsDatabase(join(dir, RUNS_DB_FILE), open);
    try {
      const version = (
        db.prepare("PRAGMA user_version").get() as { user_version: number }
      ).user_version;
      assert.equal(version, SCHEMA_VERSION);
      assert.deepEqual(applied, ["create runs table with FTS5 search index"]);
      // Core structures exist.
      for (const name of ["runs", "runs_fts", "runs_ai", "runs_au", "runs_ad"])
        assert.ok(
          db
            .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?")
            .get(name),
          `${name} must exist after migration`,
        );
    } finally {
      db.close();
    }
  });

  it("reopening a current database applies nothing (idempotent)", () => {
    const dir = tempStore();
    const path = join(dir, RUNS_DB_FILE);
    const first = openRunsDatabase(path, open);
    first.db.close();
    const second = openRunsDatabase(path, open);
    assert.deepEqual(second.applied, []);
    second.db.close();
  });

  it("upgrades a legacy unversioned store (v0 -> v2) preserving prior files", () => {
    const dir = tempStore();
    // Simulate a legacy workspace: state.json exists, no database anywhere.
    const legacy = { version: 1, workspace: "/tmp/w" };
    writeFileSync(join(dir, "state.json"), JSON.stringify(legacy));
    const { db, applied } = openRunsDatabase(join(dir, RUNS_DB_FILE), open);
    try {
      const version = (
        db.prepare("PRAGMA user_version").get() as { user_version: number }
      ).user_version;
      assert.equal(version, SCHEMA_VERSION);
      assert.ok(applied.length > 0);
      assert.ok(existsSync(join(dir, "state.json")), "state.json preserved");
      assert.deepEqual(
        JSON.parse(await_string(join(dir, "state.json"))),
        legacy,
        "state.json content preserved",
      );
    } finally {
      db.close();
    }
  });

  it("refuses to open a database newer than this binary", () => {
    const dir = tempStore();
    const path = join(dir, RUNS_DB_FILE);
    const { db } = openRunsDatabase(path, open);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    assert.throws(
      () => openRunsDatabase(path, open),
      (e: unknown) => e instanceof PineError && e.code === "MIGRATION",
    );
  });

  it("leaves the previous version applied when a migration fails", () => {
    const dir = tempStore();
    const path = join(dir, RUNS_DB_FILE);
    // Start at v2 (current), then run a registry whose next step fails
    // mid-transaction: the version must stay at 2 and the schema at v2 must
    // remain intact and usable.
    const { db } = openRunsDatabase(path, open);
    db.close();
    const reopen = open(path);
    const failing: Migration = {
      version: SCHEMA_VERSION + 1,
      description: "deliberately broken step",
      up(target) {
        target.exec("CREATE TABLE broken_mig (a)");
        target.exec("THIS IS NOT SQL");
      },
    };
    assert.throws(
      () => applyMigrations(reopen, [failing]),
      (e: unknown) => e instanceof PineError && e.code === "MIGRATION",
    );
    const version = (
      reopen.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    assert.equal(version, SCHEMA_VERSION, "version unchanged after failure");
    const broken = reopen
      .prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'broken_mig'",
      )
      .get() as { n: number };
    assert.equal(broken.n, 0, "failed step rolled back entirely");
    // The v2 schema still works.
    const index = new RunIndex(reopen);
    const id = index.openRun("s", 1);
    assert.ok(id !== null);
    reopen.close();
  });

  it("migration versions strictly ascend", () => {
    let previous = 0;
    for (const migration of MIGRATIONS) {
      assert.ok(migration.version > previous);
      previous = migration.version;
    }
    assert.equal(previous, SCHEMA_VERSION);
  });
});

function await_string(path: string): string {
  return readFileSync(path, "utf8");
}

interface RunSeed {
  session: string | null;
  startedAt: number;
}

function seedRun(index: RunIndex, seed: RunSeed): number {
  const id = index.openRun(seed.session, seed.startedAt);
  assert.ok(id !== null);
  return id;
}

describe("run index + FTS search (Tier 2 #4)", () => {
  it("records a full run round-trip with usage and outcome", () => {
    const dir = tempStore();
    const { db } = openRunsDatabase(join(dir, RUNS_DB_FILE), open);
    try {
      const index = new RunIndex(db);
      const id = seedRun(index, { session: "s1", startedAt: 1000 });
      index.addToolName(id, "edit");
      index.addToolName(id, "edit"); // duplicate is dropped
      index.addToolPath(id, "/repo/src/auth/middleware.ts");
      index.addToolCounts(id, 2, 1);
      index.addUsage(id, { totalTokens: 100, cost: { total: 0.01 } });
      index.addUsage(id, { totalTokens: -5, cost: { total: null } }); // ignored
      index.closeRun(id, 2000, 1, false);
      index.closeRun(id, 3000, 2, true); // duplicate close is a no-op
      const run = index.getRun(id) as RunRecord;
      assert.deepEqual(run.toolNames, ["edit"]);
      assert.deepEqual(run.toolPaths, ["/repo/src/auth/middleware.ts"]);
      assert.equal(run.tools, 2);
      assert.equal(run.failed, 1);
      assert.equal(run.totalTokens, 100);
      assert.equal(run.costTotal, 0.01);
      assert.equal(run.endedAt, 2000, "first close wins");
      assert.equal(
        run.interrupted,
        false,
        "late interrupt cannot rewrite a closed run",
      );
    } finally {
      db.close();
    }
  });

  it("searches across sessions by tool, path and session id", () => {
    const dir = tempStore();
    const { db } = openRunsDatabase(join(dir, RUNS_DB_FILE), open);
    try {
      const index = new RunIndex(db);
      const a = seedRun(index, { session: "sess-alpha", startedAt: 1000 });
      index.addToolName(a, "edit");
      index.addToolPath(a, "/repo/src/auth/middleware.ts");
      index.closeRun(a, 2000, 1, false);
      const b = seedRun(index, { session: "sess-beta", startedAt: 3000 });
      index.addToolName(b, "write");
      index.addToolPath(b, "/repo/README.md");
      index.closeRun(b, 4000, 1, true);
      assert.deepEqual(
        index.search("middleware").map((r) => r.sessionId),
        ["sess-alpha"],
        "path text matches across sessions",
      );
      assert.equal(index.search("write").length, 1);
      assert.equal(index.search("sess-beta").length, 1);
      // Newest first. Multi-word queries are implicit AND ("auth
      // middleware" = runs touching both), so a shared token is used here.
      assert.deepEqual(
        index.search("sess").map((r) => r.startedAt),
        [3000, 1000],
      );
      assert.deepEqual(index.search("zzz-no-match"), []);
    } finally {
      db.close();
    }
  });

  it("never throws on punctuation-heavy or empty queries", () => {
    const dir = tempStore();
    const { db } = openRunsDatabase(join(dir, RUNS_DB_FILE), open);
    try {
      const index = new RunIndex(db);
      assert.equal(ftsQuery(""), null);
      assert.equal(ftsQuery("  ... ((( "), null);
      for (const hostile of ["a.b(c)", '"quote"', "NEAR(", "a OR", "*"])
        assert.doesNotThrow(() => index.search(hostile));
      assert.deepEqual(index.search("*"), []);
    } finally {
      db.close();
    }
  });

  it("keeps open (crashed) runs searchable", () => {
    const dir = tempStore();
    const { db } = openRunsDatabase(join(dir, RUNS_DB_FILE), open);
    try {
      const index = new RunIndex(db);
      const id = seedRun(index, { session: "s", startedAt: 5 });
      index.addToolName(id, "bash");
      assert.ok(index.getRun(id)?.endedAt === null);
      assert.equal(index.search("bash").length, 1);
    } finally {
      db.close();
    }
  });

  it("degrades to a no-op index without a database", () => {
    const index = new RunIndex(null);
    assert.equal(index.available, false);
    assert.equal(index.openRun("s", 1), null);
    assert.deepEqual(index.search("anything"), []);
    assert.equal(index.insights(30), null);
  });
});

describe("insights aggregation (Tier 2 #5)", () => {
  it("aggregates tokens, cost, tools, failures and interruptions", () => {
    const dir = tempStore();
    const { db } = openRunsDatabase(join(dir, RUNS_DB_FILE), open);
    try {
      const index = new RunIndex(db);
      const day = 86_400_000;
      // Start of yesterday UTC, then start of today UTC: two deterministic
      // day buckets inside any 30-day window.
      const base = Date.now() - (Date.now() % day) - day;
      const a = seedRun(index, { session: "s1", startedAt: base });
      index.addToolName(a, "edit");
      index.addToolName(a, "read");
      index.addToolCounts(a, 2, 1);
      index.addUsage(a, { totalTokens: 1000, cost: { total: 0.02 } });
      index.closeRun(a, base + 1000, 1, false);
      const b = seedRun(index, { session: "s2", startedAt: base + day });
      index.addToolName(b, "edit");
      index.addToolCounts(b, 3, 0);
      index.addUsage(b, { totalTokens: 2000, cost: { total: 0.05 } });
      index.closeRun(b, base + day + 1000, 2, true);
      const snapshot = index.insights(30);
      assert.ok(snapshot);
      assert.equal(snapshot.runs, 2);
      assert.equal(snapshot.sessions, 2);
      assert.equal(snapshot.interrupted, 1);
      assert.equal(snapshot.failedTools, 1);
      assert.equal(snapshot.tools, 5);
      assert.equal(snapshot.totalTokens, 3000);
      assert.ok(Math.abs(snapshot.costTotal - 0.07) < 1e-9);
      assert.deepEqual(snapshot.topTools, [
        { name: "edit", count: 2 },
        { name: "read", count: 1 },
      ]);
      assert.equal(snapshot.perDay.length, 2);
      assert.equal(snapshot.perDay[0]?.runs, 1);
      assert.equal(snapshot.perDay[1]?.runs, 1);
    } finally {
      db.close();
    }
  });

  it("handles an empty dataset and rejects invalid windows", () => {
    const dir = tempStore();
    const { db } = openRunsDatabase(join(dir, RUNS_DB_FILE), open);
    try {
      const index = new RunIndex(db);
      const snapshot = index.insights(30);
      assert.ok(snapshot);
      assert.equal(snapshot.runs, 0);
      assert.deepEqual(snapshot.topTools, []);
      assert.deepEqual(snapshot.perDay, []);
      assert.equal(index.insights(0), null);
      assert.equal(index.insights(-5), null);
      assert.equal(index.insights(9999), null);
    } finally {
      db.close();
    }
  });

  it("reads through the headless store reader", () => {
    const dir = tempStore();
    assert.equal(readInsights(dir, 30), null, "no database yet");
    const { db } = openRunsDatabase(join(dir, RUNS_DB_FILE), open);
    const index = new RunIndex(db);
    const id = seedRun(index, { session: "s", startedAt: Date.now() });
    index.addUsage(id, { totalTokens: 10, cost: { total: 0.001 } });
    index.closeRun(id, Date.now(), 1, false);
    db.close();
    const snapshot = readInsights(dir, 30);
    assert.equal(snapshot?.runs, 1);
  });
});
