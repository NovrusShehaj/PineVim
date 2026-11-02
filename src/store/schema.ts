/**
 * PineVim run-index database schema and migrations (Tier 2 #7).
 *
 * PineVim's durable state lives in the Store directory (one per workspace).
 * The run index is a SQLite database (`runs.db`) beside `state.json`. Its
 * schema version is stored in `PRAGMA user_version` — atomic with the file,
 * so a half-applied migration can never claim to be current.
 *
 * Migrations are production infrastructure: a versioned registry applied in
 * ascending order inside transactions. Ad-hoc "CREATE TABLE IF NOT EXISTS"
 * calls scattered through feature code are exactly what this replaces.
 */
import { createRequire } from "node:module";
import { PineError } from "../diagnostics.js";

/**
 * Schema history:
 *   1 — legacy workspaces: Store directory with `state.json` only, no run
 *       index. Databases created before versioning existed never carried a
 *       user_version other than 0, so 0 maps to "v1 unversioned".
 *   2 — canonical `runs` table plus the `runs_fts` FTS5 index used for
 *       cross-session run search (#4). FTS5 is a derived index over `runs`;
 *       the canonical rows remain queryable without FTS.
 */
export const SCHEMA_VERSION = 2;

/** The database file PineVim owns inside the Store directory. */
export const RUNS_DB_FILE = "runs.db";

/**
 * Minimal surface of `node:sqlite`'s DatabaseSync used here. Declared
 * locally so this module compiles against every @types/node in range;
 * the import itself is validated at runtime by `openRunsDatabase`.
 */
export interface RunsDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

/** One ordered, transactional schema step. */
export interface Migration {
  /** The `user_version` value after this step succeeds. Strictly ascending. */
  readonly version: number;
  readonly description: string;
  readonly up: (db: RunsDatabase) => void;
}

/** v2 body: canonical run rows + FTS5 search index kept in sync by triggers. */
const MIGRATION_2 = `
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  seconds REAL,
  tools INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  interrupted INTEGER NOT NULL DEFAULT 0,
  tool_names TEXT NOT NULL DEFAULT '',
  tool_paths TEXT NOT NULL DEFAULT '',
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_total REAL NOT NULL DEFAULT 0
);
CREATE INDEX runs_started ON runs(started_at);
CREATE INDEX runs_session ON runs(session_id);
CREATE VIRTUAL TABLE runs_fts USING fts5(
  tool_names,
  tool_paths,
  session_id,
  content='runs',
  content_rowid='id',
  tokenize='porter unicode61'
);
CREATE TRIGGER runs_ai AFTER INSERT ON runs BEGIN
  INSERT INTO runs_fts(rowid, tool_names, tool_paths, session_id)
  VALUES (new.id, new.tool_names, new.tool_paths, new.session_id);
END;
CREATE TRIGGER runs_ad AFTER DELETE ON runs BEGIN
  INSERT INTO runs_fts(runs_fts, rowid, tool_names, tool_paths, session_id)
  VALUES ('delete', old.id, old.tool_names, old.tool_paths, old.session_id);
END;
CREATE TRIGGER runs_au AFTER UPDATE ON runs BEGIN
  INSERT INTO runs_fts(runs_fts, rowid, tool_names, tool_paths, session_id)
  VALUES ('delete', old.id, old.tool_names, old.tool_paths, old.session_id);
  INSERT INTO runs_fts(rowid, tool_names, tool_paths, session_id)
  VALUES (new.id, new.tool_names, new.tool_paths, new.session_id);
END;
`;

/** Registry, ascending. A step may assume all earlier steps are applied. */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 2,
    description: "create runs table with FTS5 search index",
    up(db) {
      db.exec(MIGRATION_2);
    },
  },
];

function userVersion(db: RunsDatabase): number {
  const row = db.prepare("PRAGMA user_version").get() as
    { user_version?: unknown } | undefined;
  const value = row?.user_version;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new PineError(
      "MIGRATION",
      "Cannot read the run index schema version; inspect runs.db manually.",
    );
  return value;
}

function begin(db: RunsDatabase): void {
  db.exec("BEGIN IMMEDIATE");
}

function commit(db: RunsDatabase): void {
  db.exec("COMMIT");
}

function rollback(db: RunsDatabase): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    /* no transaction was open; nothing to unwind */
  }
}

/**
 * Bring a newly opened database to the current version.
 *
 * - Fresh database (no tables, user_version 0) initializes directly at the
 *   latest version in one transaction; it never replays history.
 * - A legacy/unversioned database upgrades through each step in order; each
 *   step commits together with its version bump, so a failure leaves the
 *   previous version intact and re-appliable.
 * - A database newer than this binary refuses to open (downgrade guard).
 *
 * `registry` defaults to the shipped {@link MIGRATIONS}; tests may pass a
 * custom one to exercise failure paths.
 *
 * Returns the list of applied step descriptions (empty when current).
 */
export function applyMigrations(
  db: RunsDatabase,
  registry: readonly Migration[] = MIGRATIONS,
): string[] {
  const applied: string[] = [];
  let current = userVersion(db);
  if (registry === MIGRATIONS && current > SCHEMA_VERSION)
    throw new PineError(
      "MIGRATION",
      `Run index schema v${current} is newer than this PineVim understands (v${SCHEMA_VERSION}). Update PineVim or restore the workspace state directory.`,
    );
  for (const migration of registry) {
    if (migration.version <= current) continue;
    try {
      begin(db);
      migration.up(db);
      db.prepare(`PRAGMA user_version = ${migration.version}`).run();
      commit(db);
    } catch (error) {
      rollback(db);
      if (error instanceof PineError) throw error;
      throw new PineError(
        "MIGRATION",
        `Migration to v${migration.version} failed (${migration.description}); the schema is left at v${current}. ${reword(error)}`,
      );
    }
    applied.push(migration.description);
    current = migration.version;
  }
  return applied;
}

function reword(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("no such module")
    ? "This Node build lacks SQLite FTS5 support; cross-session search is unavailable."
    : message.slice(0, 200);
}

/**
 * Open (and migrate) the runs database. `open` is injected so tests can pass
 * any DatabaseSync; production passes node:sqlite's constructor.
 */
export function openRunsDatabase(
  path: string,
  open: (path: string) => RunsDatabase,
): { db: RunsDatabase; applied: string[] } {
  let db: RunsDatabase;
  try {
    db = open(path);
  } catch (error) {
    throw new PineError(
      "STORAGE",
      `Cannot open the PineVim run index at ${path}: ${reword(error)}`,
    );
  }
  try {
    // TRUNCATE journal: no -wal/-shm side files in the private state dir.
    db.exec("PRAGMA journal_mode = TRUNCATE");
    const applied = applyMigrations(db);
    const check = db.prepare("PRAGMA quick_check").get() as
      { quick_check?: unknown } | undefined;
    if (
      check &&
      typeof check.quick_check === "string" &&
      check.quick_check !== "ok"
    )
      throw new PineError(
        "STORAGE",
        `Run index integrity check failed (${check.quick_check}); the database may be corrupt. Delete runs.db to rebuild it from future runs.`,
      );
    return { db, applied };
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Load `node:sqlite` lazily; null when the runtime lacks it. */
export function sqliteFactory(): ((path: string) => RunsDatabase) | null {
  try {
    // Node >=22.19 ships node:sqlite; @types/node may lag the runtime, so the
    // module surface is validated here rather than trusted from typings.
    const require = createRequire(import.meta.url);
    const mod = require("node:sqlite") as {
      DatabaseSync?: new (path: string) => RunsDatabase;
    };
    const DatabaseSync = mod?.DatabaseSync;
    if (typeof DatabaseSync !== "function") return null;
    return (path) => new DatabaseSync(path);
  } catch {
    return null;
  }
}
