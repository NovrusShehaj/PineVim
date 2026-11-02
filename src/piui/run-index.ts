/**
 * Durable run index over the workspace's `runs.db` (Tier 2 #4/#5).
 *
 * Canonical run rows live in the `runs` table (schema v2, see
 * `src/store/schema.ts`); the `runs_fts` virtual table is a derived index
 * kept in sync by triggers. Every write is transactional; the index is
 * best-effort for the agent loop — callers wrap failures, never propagate
 * them into the run path.
 */
import type { RunsDatabase } from "../store/schema.js";

/** One closed (or still-open) run as stored in `runs`. */
export interface RunRecord {
  id: number;
  sessionId: string | null;
  startedAt: number;
  endedAt: number | null;
  seconds: number | null;
  tools: number;
  failed: number;
  interrupted: boolean;
  toolNames: string[];
  toolPaths: string[];
  totalTokens: number;
  costTotal: number;
}

/** Per-run usage contribution from one settled turn. */
export interface RunUsage {
  totalTokens?: unknown;
  cost?: { total?: unknown } | null;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Shared FTS query parser: bare text is searched as individual phrases so
 * punctuation-carrying input (`foo.ts`, `a-b`) is matched literally instead
 * of being parsed (and rejected) as FTS5 query syntax.
 */
export function ftsQuery(input: string): string | null {
  const words = input
    .split(/\s+/)
    .map((word) =>
      // Keep letters, digits and filename-ish separators; everything else
      // (FTS syntax, quotes, punctuation) is dropped so hostile or
      // punctuation-only input cannot break or widen the query.
      word.replace(/[^\p{L}\p{N}_.-]/gu, ""),
    )
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .map((word) => `"${word}"`);
  if (words.length === 0) return null;
  return words.join(" ");
}

/** Row shape returned by SQLite (snake_case columns). */
interface RunRow {
  id: number;
  session_id: string | null;
  started_at: number;
  ended_at: number | null;
  seconds: number | null;
  tools: number;
  failed: number;
  interrupted: number;
  tool_names: string;
  tool_paths: string;
  total_tokens: number;
  cost_total: number;
}

function fromRow(row: RunRow): RunRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    seconds: row.seconds,
    tools: row.tools,
    failed: row.failed,
    interrupted: row.interrupted === 1,
    toolNames: row.tool_names ? row.tool_names.split(" ") : [],
    toolPaths: row.tool_paths ? row.tool_paths.split(" ") : [],
    totalTokens: row.total_tokens,
    costTotal: row.cost_total,
  };
}

/** Aggregate snapshot for `/pinevim insights`, computed in SQL. */
export interface InsightsSnapshot {
  /** Inclusive window start (epoch ms) the percentages/buckets cover. */
  sinceMs: number;
  runs: number;
  sessions: number;
  interrupted: number;
  failedTools: number;
  tools: number;
  totalTokens: number;
  costTotal: number;
  /** Top tools with invocation counts. */
  topTools: { name: string; count: number }[];
  /** Runs per UTC day, oldest first. */
  perDay: { day: string; runs: number; cost: number }[];
}

const DAY_MS = 86_400_000;

export class RunIndex {
  /** null => SQLite/FTS5 unavailable; every method then degrades honestly. */
  private db: RunsDatabase | null;

  constructor(db: RunsDatabase | null) {
    this.db = db;
  }

  get available(): boolean {
    return this.db !== null;
  }

  /**
   * Begin recording a run. Returns the row id, or null when the index is
   * unavailable. Never throws into the agent path (callers also wrap).
   */
  openRun(sessionId: string | null, startedAt: number): number | null {
    if (!this.db) return null;
    try {
      const result = this.db
        .prepare("INSERT INTO runs (session_id, started_at) VALUES (?, ?)")
        .run(sessionId, startedAt);
      return Number(result.changes) === 1 ? this.lastId() : null;
    } catch {
      return null;
    }
  }

  private lastId(): number | null {
    if (!this.db) return null;
    const row = this.db.prepare("SELECT last_insert_rowid() AS id").get() as
      { id?: unknown } | undefined;
    return typeof row?.id === "number" ? row.id : null;
  }

  /** Append a sanitized tool name to the open run (bounded, deduped). */
  addToolName(id: number, name: string): void {
    this.updateOpenRun(id, (r) => {
      if (!name || r.toolNames.includes(name) || r.toolNames.length >= 32)
        return;
      r.toolNames.push(name);
    });
  }

  /** Append a sanitized edit/write path to the open run (bounded, deduped). */
  addToolPath(id: number, path: string): void {
    this.updateOpenRun(id, (r) => {
      if (!path || r.toolPaths.includes(path) || r.toolPaths.length >= 20)
        return;
      r.toolPaths.push(path);
    });
  }

  /** Increment tool/failure counters on the open run. */
  addToolCounts(id: number, tools: number, failed: number): void {
    this.updateOpenRun(id, (r) => {
      r.tools += tools;
      r.failed += failed;
    });
  }

  /** Mark the open run interrupted (e.g. abort observed). */
  markInterrupted(id: number): void {
    this.updateOpenRun(id, (r) => {
      r.interrupted = true;
    });
  }

  /**
   * Add one settled turn's usage to the open run. Shares the validation
   * rules with the session budget: malformed or negative values are ignored
   * entirely, never partially, so one bad event cannot poison the row.
   */
  addUsage(id: number, usage: RunUsage | null | undefined): void {
    if (!usage) return;
    const tokens = usage.totalTokens;
    const cost = usage.cost?.total;
    if (!isFiniteNonNegative(tokens) && !isFiniteNonNegative(cost)) return;
    this.updateOpenRun(id, (r) => {
      if (isFiniteNonNegative(tokens))
        r.totalTokens = Math.min(1e12, r.totalTokens + Math.round(tokens));
      if (isFiniteNonNegative(cost))
        r.costTotal = Math.min(1e6, r.costTotal + cost);
    });
  }

  /**
   * Close a run. Closing freezes the row: a duplicate close is a no-op, so
   * a late signal can never rewrite the recorded outcome.
   */
  closeRun(
    id: number,
    endedAt: number,
    seconds: number | null,
    interrupted: boolean,
  ): void {
    if (!this.db) return;
    try {
      this.db
        .prepare(
          `UPDATE runs SET ended_at = ?, seconds = ?, interrupted = ?
           WHERE id = ? AND ended_at IS NULL`,
        )
        .run(endedAt, seconds, interrupted ? 1 : 0, id);
    } catch {
      /* best-effort indexing; never break the agent run */
    }
  }

  /** Read one run. */
  getRun(id: number): RunRecord | null {
    if (!this.db) return null;
    try {
      const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as
        RunRow | undefined;
      return row ? fromRow(row) : null;
    } catch {
      return null;
    }
  }

  /**
   * Full-text search across sessions. `query` is raw user text (see
   * `ftsQuery`); `limit` bounds rows returned. Returns matches newest-first.
   */
  search(query: string, limit = 20): RunRecord[] {
    if (!this.db) return [];
    const fts = ftsQuery(query);
    if (!fts) return [];
    try {
      const rows = this.db
        .prepare(
          `SELECT runs.* FROM runs_fts
           JOIN runs ON runs.id = runs_fts.rowid
           WHERE runs_fts MATCH ?
           ORDER BY runs.started_at DESC
           LIMIT ?`,
        )
        .all(fts, limit) as RunRow[];
      return rows.map(fromRow);
    } catch {
      return [];
    }
  }

  /**
   * Aggregate analytics for `/pinevim insights` over the last `days` days
   * (plus all-time totals). Computed in SQL from canonical rows.
   */
  insights(days: number): InsightsSnapshot | null {
    if (!this.db) return null;
    if (!Number.isSafeInteger(days) || days < 1 || days > 3650) return null;
    try {
      const now = Date.now();
      const since = now - days * DAY_MS;
      const totals = this.db
        .prepare(
          `SELECT COUNT(*) AS runs,
                  COUNT(DISTINCT session_id) AS sessions,
                  COALESCE(SUM(interrupted), 0) AS interrupted,
                  COALESCE(SUM(failed), 0) AS failedTools,
                  COALESCE(SUM(tools), 0) AS tools,
                  COALESCE(SUM(total_tokens), 0) AS totalTokens,
                  COALESCE(SUM(cost_total), 0) AS costTotal
           FROM runs WHERE started_at >= ?`,
        )
        .get(since) as Record<string, unknown>;
      const topRows = this.db
        .prepare(
          `SELECT tool_names AS names, COUNT(*) AS n FROM runs
           WHERE started_at >= ? GROUP BY tool_names ORDER BY n DESC LIMIT 8`,
        )
        .all(since) as { names?: unknown; n?: unknown }[];
      const dayRows = this.db
        .prepare(
          `SELECT (started_at / 86400000) AS bucket, COUNT(*) AS runs,
                  COALESCE(SUM(cost_total), 0) AS cost
           FROM runs WHERE started_at >= ?
           GROUP BY bucket ORDER BY bucket ASC`,
        )
        .all(since) as { bucket?: unknown; runs?: unknown; cost?: unknown }[];
      // Tool frequency: names are space-joined per run; count occurrences
      // across the window's rows in JS (small bounded data).
      const counts = new Map<string, number>();
      for (const row of topRows) {
        if (typeof row.names !== "string") continue;
        for (const name of row.names.split(" ").filter(Boolean)) {
          if (!/^[\w .-]{1,40}$/.test(name)) continue;
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
      const topTools = [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 6);
      const perDay = dayRows
        .filter(
          (r) =>
            typeof r.bucket === "number" &&
            typeof r.runs === "number" &&
            typeof r.cost === "number",
        )
        .map((r) => ({
          day: new Date((r.bucket as number) * DAY_MS)
            .toISOString()
            .slice(0, 10),
          runs: r.runs as number,
          cost: r.cost as number,
        }));
      const num = (v: unknown): number =>
        typeof v === "number" && Number.isFinite(v) ? v : 0;
      return {
        sinceMs: since,
        runs: num(totals?.runs),
        sessions: num(totals?.sessions),
        interrupted: num(totals?.interrupted),
        failedTools: num(totals?.failedTools),
        tools: num(totals?.tools),
        totalTokens: num(totals?.totalTokens),
        costTotal: num(totals?.costTotal),
        topTools,
        perDay,
      };
    } catch {
      return null;
    }
  }

  /** Count runs for a session id (used to dedupe session aggregation). */
  countForSession(sessionId: string): number {
    if (!this.db) return 0;
    try {
      const row = this.db
        .prepare("SELECT COUNT(*) AS n FROM runs WHERE session_id = ?")
        .get(sessionId) as { n?: unknown } | undefined;
      return typeof row?.n === "number" ? row.n : 0;
    } catch {
      return 0;
    }
  }

  private updateOpenRun(
    id: number,
    mutate: (record: {
      toolNames: string[];
      toolPaths: string[];
      tools: number;
      failed: number;
      interrupted: boolean;
      totalTokens: number;
      costTotal: number;
    }) => void,
    write?: () => void,
  ): void {
    if (!this.db) return;
    try {
      const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as
        RunRow | undefined;
      if (!row) return;
      const record = {
        toolNames: row.tool_names ? row.tool_names.split(" ") : [],
        toolPaths: row.tool_paths ? row.tool_paths.split(" ") : [],
        tools: row.tools,
        failed: row.failed,
        interrupted: row.interrupted === 1,
        totalTokens: row.total_tokens,
        costTotal: row.cost_total,
      };
      const before = JSON.stringify(record);
      mutate(record);
      if (JSON.stringify(record) === before) return;
      this.db
        .prepare(
          `UPDATE runs SET tools = ?, failed = ?, interrupted = ?,
           tool_names = ?, tool_paths = ?, total_tokens = ?, cost_total = ?
           WHERE id = ?`,
        )
        .run(
          Math.min(1e6, record.tools),
          Math.min(1e6, record.failed),
          record.interrupted ? 1 : 0,
          record.toolNames.join(" ").slice(0, 512),
          record.toolPaths.join(" ").slice(0, 2048),
          record.totalTokens,
          record.costTotal,
          id,
        );
      write?.();
    } catch {
      /* best-effort indexing; never break the agent run */
    }
  }
}
