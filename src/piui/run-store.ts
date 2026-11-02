/**
 * Headless read access to the workspace run index (Tier 2 #5).
 *
 * The controller renders the insights popup from the same `runs.db` the
 * extension writes. Opening SQLite here is read-cheap and the popup path is
 * synchronous, so a tiny sync-open helper is the right shape; failures
 * degrade to `null` and the panel explains that instead of crashing.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  RUNS_DB_FILE,
  openRunsDatabase,
  sqliteFactory,
} from "../store/schema.js";
import { RunIndex, type InsightsSnapshot } from "./run-index.js";

/** One open index with deterministic cleanup. */
interface IndexHandle {
  readonly db: RunIndex;
  close(): void;
}

function openLocalIndex(storeDirectory: string): IndexHandle | null {
  const factory = sqliteFactory();
  if (!factory) return null;
  // Read path: a missing database means "nothing indexed yet", not an error,
  // and must never be created as a side effect of reading.
  if (!existsSync(join(storeDirectory, RUNS_DB_FILE))) return null;
  try {
    const opened = openRunsDatabase(
      join(storeDirectory, RUNS_DB_FILE),
      factory,
    );
    const db = opened.db;
    return {
      db: new RunIndex(db),
      close() {
        try {
          db.close();
        } catch {
          /* close is best-effort; the file is safe to reopen */
        }
      },
    };
  } catch {
    return null;
  }
}

/**
 * Read the insights snapshot for `days` from the store directory's run
 * index. Returns null when SQLite/FTS5 is unavailable or the database
 * cannot be opened.
 */
export function readInsights(
  storeDirectory: string,
  days: number,
): InsightsSnapshot | null {
  const handle = openLocalIndex(storeDirectory);
  if (!handle) return null;
  try {
    return handle.db.insights(days);
  } finally {
    handle.close();
  }
}

/**
 * Extension-side index for the local `search`/`insights` commands: opens
 * PINEVIM_STATE_DIR's runs.db read-only-ish (queries only). Returns null
 * when unavailable; callers must call `release()` when finished, but leaks
 * are bounded because each command opens at most one short-lived handle.
 */
export function localRunIndex(): { index: RunIndex; release(): void } | null {
  const dir = process.env.PINEVIM_STATE_DIR;
  if (!dir) return null;
  const handle = openLocalIndex(dir);
  return handle ? { index: handle.db, release: handle.close } : null;
}
