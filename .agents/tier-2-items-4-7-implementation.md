# Tier 2 Items 4–7 — Implementation Plan

Status: **implemented** (this document is updated to reflect the finished architecture; see
"Final architecture" notes inline and the audit at the bottom).

## 0. Scope and order

Tier 2 items, implemented in dependency order:

1. **#7** State schema version + migrations (prerequisite; implemented first).
2. **#4** Cross-session run search (SQLite FTS5 over PineVim's own run ledger).
3. **#5** `/pinevim insights` (cross-session analytics from the persisted data).
4. **#6** Session cost ceiling (`ui.budget.warnAt` / `ui.budget.stopAt`).

## 1. Architecture findings (Phase 1, verified by reading the repo)

- **Runtime**: TypeScript ESM, strict tsconfig (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), NodeNext. `engines.node >= 22.19.0`. No existing SQLite
  dependency. Tests: `node --test --test-concurrency=1`; lint is eslint `--max-warnings 0`.
- **Persistence** (`src/persistence.ts`): `Store` owns
  `${XDG_STATE_HOME:-~/.local/state}/pinevim/<sha256(workspace).slice(0,24)>/`
  containing `state.json` (strictly validated `Metadata`, includes `version: 1`),
  a `lock/` directory with `owner.json`, an `acquire` guard directory, and a `welcomed`
  marker. Helpers: `privateDirectory`, `privatePath`, `privateRead` (O_NOFOLLOW, 0600,
  size-capped), `atomicWrite` (temp file + rename, 0600).
- **Run ledger** (`src/piui/runs.ts`): `RunState`/`RunClose` (one run = one
  `agent_start`…`agent_settled`), `TimelineEntry` + `TIMELINE_LIMIT = 12`
  (bounded in-memory session timeline only), `TokenBudget` + `addTurnUsage`
  (session-cumulative tokens/cost, in-memory only, validated/capped).
- **Pi extension** (`src/piui/index.ts`, `src/adapters/pi/extension.ts`): PiUi wires
  `agent_start`, `tool_execution_start/end`, `turn_end` (usage accumulation),
  `agent_settled` (run close, timeline push, run summary entry). Config reaches the
  extension only via controller-spawned environment variables
  (`PINEVIM_UI*`, `PINEVIM_RUNTIME`, …). `data()` reports status over the Unix-socket
  control plane (protocol v1.2 fields validated strictly).
- **Controller** (`src/core/controller.ts`): intents → `transition()`, popup panels via
  `tmux.popup(lines, width, node, helper)` (`help`, `status`, `timeline`), `parseTimeline`
  for the bridge's bounded payload, tmux `bindings()` maps prefix chords to helper actions.
- **Commands** (`src/commands.ts`): `SLASH_COMMANDS` registry is the single source for the
  parser, help panel, and shell completions. `handlePinevimLocal`
  (`src/piui/local-commands.ts`) handles extension-local verbs (`review`, `learn`, `skills`)
  before controller dispatch.
- **Cost accounting**: the only spend data source is assistant `usage` arriving on
  `turn_end` (`usage.totalTokens`, `usage.cost.total`), accumulated by `addTurnUsage`
  into the deck's budget chip. There is no persisted cost anywhere.
- **Model invocation boundary** (verified against the pinned Pi 0.87.1 dist):
  - `before_agent_start` handlers **cannot cancel** a run: only `message` /
    `systemPrompt` fields of the result are consumed
    (`dist/core/extensions/runner.js`, `emitBeforeAgentStart`); `before_provider_request`
    handlers cannot block either (their errors are reported and swallowed; the payload is
    still sent).
  - `ctx.abort()` (`ExtensionContext.abort`) maps to `AgentSession.abort()`, which sets
    `_agentRunAbortRequested` and calls `agent.abort()`, aborting the active provider
    stream (`activeRun.abortController`). `_runAgentPrompt`'s `while` loop re-checks
    `_agentRunAbortRequested` before **every** `agent.continue()`, so an abort issued on
    `turn_end` prevents all subsequent requests of that run. There are also internal
    fail-closed guards: `AggregateHookRunner.beforePayload` wraps each `before_payload`
    hook in `gate.admit()` which throws `AbortRequested` after `beginAbort()`.
  - Therefore the **enforcement boundary** for `stopAt` is: (a) an awaited
    `agent_start` handler that aborts before any provider request when the budget is
    already exhausted, and (b) a `turn_end` handler that aborts the moment the ceiling is
    crossed, which deterministically prevents every later request of the run. This is a
    real boundary inside Pi's own run loop, not a UI notice.
- **Config** (`src/config.ts`): strict `validateConfig` throws `PineError("CONFIG", …)`
  on unknown fields; `ui` sub-object validation is exhaustive. Budget keys must be added
  here and flowed to the extension via environment.
- **Pre-existing ledger history**: none is durable. The timeline is capped at 12 entries
  in memory and token/cost totals never leave the process. There is therefore **no
  historical data to backfill**; the honest strategy is: create the durable store, index
  everything from the moment it exists, and say so. (Documented in §6 and §10.)

## 2. Storage layer decision

`node:sqlite` (`DatabaseSync`) — Node's built-in SQLite, stable in Node 22.13+/23+
and present with FTS5 in the repo's supported range (verified: FTS5 + porter
tokenizer work under the repo's engine constraint). This adds **zero native deps**,
consistent with the repo's zero-runtime-dependency posture (the only runtime dep is
Pi's own package). The database lives inside the existing `Store` directory as
`runs.db` — it is workspace-scoped state, exactly where `state.json` already lives,
and inherits the directory's 0700/0600 private-state conventions.

FTS5 is **not** the source of truth: canonical run rows live in a plain `runs` table;
the `runs_fts` virtual table is a derived index maintained in the same transaction as
row writes and rebuildable at any time (`rebuildFts`).

## 3. Item 7 — Schema versioning + migrations (`src/store/schema.ts`, `src/persistence.ts`)

- **Version storage**: `PRAGMA user_version` on the `runs.db` connection — atomic with
  the database file, no extra state file, no drift possible. `SCHEMA_VERSION = 2`
  (v1 = legacy unversioned layout with no database; v2 = current).
- **Migration registry** (`MIGRATIONS: Migration[]`): `{ version, description,
  up(db, ctx) }` applied strictly in ascending order; fresh databases initialize
  directly at the latest version (single `initializeSchema` transaction, no replay of
  history through intermediate versions).
- **Idempotence / reapplication protection**: version gate before each step
  (`if (current >= m.version) skip`), each step wrapped in a transaction
  (`BEGIN IMMEDIATE … COMMIT`), and `user_version` bumped **inside** the same
  transaction so a crash can never leave a half-applied schema that believes it is
  current. A failed migration throws `PineError("MIGRATION", …)`; the caller (Store
  open) surfaces it instead of proceeding with a stale-schema database.
- **Legacy state**: a workspace that has `state.json` but no `runs.db` (v1) migrates by
  creating the v2 schema fresh; its `Metadata.version` remains the metadata's own
  contract (1) and is *not* conflated with the database schema version (the metadata
  schema has not changed — adding a parallel version would be a lie). A database with a
  version **newer** than the binary refuses to open (downgrade guard).
- **Migration 1→2** creates the canonical `runs` table, indexes, and the
  `runs_fts` FTS5 virtual table (see §4).
- **Data preservation**: `state.json`, lock, welcomed marker are untouched; migrations
  only add the new database. Integrity check (`PRAGMA quick_check`) runs at open.

## 4. Item 4 — Run index + FTS5 search (`src/piui/run-index.ts`, `src/commands.ts`, panels)

### Schema (v2)

```sql
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  workspace TEXT NOT NULL,          -- store key (workspace-scoped db; constant, kept for clarity)
  session_id TEXT,                  -- Pi session id
  started_at INTEGER NOT NULL,      -- epoch ms
  ended_at INTEGER,                 -- epoch ms; NULL if never closed cleanly
  seconds REAL,                     -- wall seconds
  tools INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  interrupted INTEGER NOT NULL,     -- 0/1
  tool_names TEXT NOT NULL,         -- space-joined, sanitized at capture
  tool_paths TEXT NOT NULL,         -- space-joined, sanitized at capture
  total_tokens INTEGER NOT NULL,    -- tokens accumulated during this run's turns
  cost_total REAL NOT NULL          -- cost accumulated during this run's turns
);
CREATE INDEX runs_started ON runs(started_at);
CREATE VIRTUAL TABLE runs_fts USING fts5(
  tool_names, tool_paths, session_id,
  content='runs', content_rowid='id',
  tokenize='porter unicode61'
);
-- triggers keep FTS in sync with the canonical table in the same transaction
CREATE TRIGGER runs_ai AFTER INSERT ON runs BEGIN
  INSERT INTO runs_fts(rowid, tool_names, tool_paths, session_id)
  VALUES (new.id, new.tool_names, new.tool_paths, new.session_id);
END;
CREATE TRIGGER runs_ad AFTER DELETE ON runs BEGIN
  INSERT INTO runs_fts(runs_fts, rowid, tool_names, tool_paths, session_id)
  VALUES ('delete', old.id, old.tool_names, old.tool_paths, old.session_id);
END;
```

- **Event → record mapping**: one `agent_start` opens a run; `tool_execution_start`
  appends sanitized tool names and edit/write paths (existing `runToolName`/`runPath`
  capture, already sanitized — no new trust boundary); `turn_end` accumulates the
  turn's usage into the run's tokens/cost **and** the session budget; `agent_settled`
  closes the row (timestamps, seconds, outcome, lists) in one upsert. If PineVim dies
  mid-run the row stays `ended_at IS NULL` and is still searchable (honest record of a
  run that started and was never observed to finish).
- **Wiring**: `PiUi` (the extension already owns run lifecycles) writes through an
  injected `RunIndex` port. The extension creates the `RunIndex` from
  `PINEVIM_STATE_DIR` (new env var published by the controller next to the existing
  `PINEVIM_*` set). All writes are best-effort: a failure to index must never break the
  agent run (logged, swallowed) — the index is derived, the conversation is not lost.
- **No backfill**: there is no durable historical run data to import (verified —
  timeline is RAM-only, capped at 12; budget is RAM-only). Indexing starts from the
  first run after upgrade. This is stated honestly rather than faked.
- **Automatic indexing**: every future run is indexed by construction (the write path
  is the run lifecycle itself), satisfying "new runs become searchable automatically".

### Search UX

- `/pinevim search <query>` — local command (extension-side, like `review`). Renders
  results via `context.ui.select` (existing Pi selector UI) with metadata
  (`MMM D HH:MM · tools/fail/interrupt · $cost · files…`). Empty/missing query prints
  usage. Errors are user-facing via `userFacing`.
- `F12 s` stays workspace status; search is reachable from the command menu/help text
  (slash row added to the help panel) without consuming a scarce prefix chord.
- Query language: plain FTS5 `MATCH` text (tool names, paths, session ids). Special
  characters are handled by quoting the query into FTS phrase syntax where it would
  otherwise be a syntax error; results ranked by `bm25`, newest-first tiebreak.

## 5. Item 5 — `/pinevim insights` (`src/piui/run-index.ts`, `src/piui/local-commands.ts`)

- **Derived, not duplicated**: all aggregates are computed from the `runs` table with
  SQL (`COUNT`, `SUM`, grouped time buckets); no parallel counters.
- Metrics supported by the data (and shown): run count, session count, interrupted and
  failed-tool totals, tokens, cost, tool frequency (top N from `tool_names`),
  busiest day buckets (UTC day from `started_at`), busiest tools per failure rate.
  Metrics not in the data (e.g. per-model cost — Pi does not attribute usage to model
  in `turn_end` payloads) are **not fabricated**.
- **Default period**: last 30 days + all-time totals; `insights [days]` accepts an
  explicit window (validated integer 1–3650).
- **Rendering**: `/pinevim insights` renders through the extension's local-command
  path into `context.ui.select`-style output consistent with `review`/`skills`; the
  controller gets the same numbers via the existing status payload for a future
  controller panel. Formatting reuses `budgetChipText`-style compact formatting from
  `runs.ts` so insights complement (not duplicate) the deck's cost chip.

## 6. Item 6 — Cost ceiling (`src/config.ts`, `src/piui/budget.ts`, `src/piui/index.ts`)

- **Config** (JSON, repo convention):
  ```json
  { "ui": { "budget": { "warnAt": 2.0, "stopAt": 5.0 } } }
  ```
  Validation: numbers must be finite and > 0; `warnAt <= stopAt` required;
  unknown fields rejected; absent `budget` (or absent keys) ⇒ disabled (defaults keep
  `undefined`, no behavior change). Malformed ⇒ `PineError("CONFIG", …)` exactly like
  other `ui` fields. Env flow: `PINEVIM_BUDGET_WARN` / `PINEVIM_BUDGET_STOP` (USD),
  published by the controller's `uiEnvironment()` next to the other `PINEVIM_UI*`
  variables.
- **Single source of truth**: `TokenBudget`/`addTurnUsage` remains the only spend
  accumulator. The guard consumes the same `TokenBudget` object the deck renders, so
  the warning, the chip, and the stop decision cannot disagree. New runs get a fresh
  budget (session-scoped, like today's chip) — the ceiling is a *session* ceiling.
- **Warning**: when `costTotal` first crosses `warnAt`, one `ctx.ui.notify(...,
  "warning")` is shown. A `warned` latch (reset only by a new run after being
  un-crossed, which cannot happen since cost is monotonic) prevents repeat spam.
- **Stop**: two enforcement points inside Pi's run loop (see §1 findings):
  1. `agent_start` handler: if `costTotal >= stopAt`, abort immediately **before** any
     provider request for that run (the handler is awaited before Pi proceeds).
  2. `turn_end` handler: after adding the settled turn's usage, if `costTotal >=
     stopAt`, call `ctx.abort()`. `_agentRunAbortRequested` then breaks Pi's
     continuation loop before every subsequent `agent.continue()`, so no further
     billable request is sent mid-run.
  Both paths notify once with actionable copy (raise/stop budget). Retry/continuation
  paths cannot bypass this: every run begins at `agent_start` (checked) and every
  intra-run continuation passes through the loop that the abort flag gates.
- **No price info**: turns without numeric `cost.total` add no cost (`addTurnUsage`
  already ignores malformed usage) — the guard tracks what is knowable and the warning
  copy says the total may be understated when a turn contributed no cost data.

## 7. UI/command integration summary

| Surface | Change |
| --- | --- |
| `/pinevim search <query>` | new local command (extension-side) |
| `/pinevim insights [days]` | new local command (extension-side) |
| `SLASH_COMMANDS` | `search` and `insights` entries (single registry, so help + completions update automatically) |
| Help panel | command rows for search/insights |
| Deck cost chip | unchanged rendering; becomes the live value the guard enforces against |
| `state.json` / Store | gains `runs.db` sibling; metadata contract unchanged |

## 8. Failure & rollback behavior

- DB open/migration failure ⇒ `PineError("MIGRATION"|"STORAGE", …)` with user-facing
  next action; the controller/extension degrade to *no search/insights* rather than
  crashing the harness. Run-index writes and budget DB reads never throw into the
  agent path (best-effort wrapper).
- Every schema change is transactional; on failure the transaction rolls back and
  `user_version` stays at the previous value, so a retry re-applies cleanly.
- Rollback of the *feature* leaves the workspace's previous state fully intact
  (`state.json` untouched); the new `runs.db` is inert data.

## 9. Test strategy

- Unit (`tests/unit/migrations.test.ts`): fresh init at v2; legacy (no db) upgrade;
  already-current no-op; version ordering; failure behavior (bad step keeps old
  version); downgrade refusal; data preserved across upgrade; FTS structures exist.
- Unit (`tests/unit/run-index.test.ts`): record open→close round-trip; multi-session
  rows; token/cost accumulation per run; FTS MATCH queries (tool, path, session);
  special-character queries don't throw; duplicate ingestion (idempotent close);
  empty result set; insights aggregations (tokens/cost/tools/failures/interruptions,
  day buckets, empty dataset); malformed usage ignored.
- Unit (`tests/unit/budget.test.ts`): config validation matrix (missing/zero/negative/
  non-numeric/warn>stop/disabled/warn==stop); warn-once latch; stop-abort at boundary;
  no blocking when unset; unknown-cost behavior; env plumbing.
- Integration: extension wiring covered indirectly through the unit contracts above
  (the repo's integration suite drives real tmux/nvim and is gated separately).

## 10. Risks / edge cases

- `node:sqlite` is flagged experimental on some Node lines; the code imports it
  dynamically and degrades to "index unavailable" notices if absent (never crashes the
  harness).
- FTS5 availability: verified present in Node's bundled SQLite for the supported
  engine range; if a platform build lacks FTS5, migration throws a clear
  `PineError("MIGRATION", …)` and the Store surfaces it — search is the only affected
  feature.
- Cost monotonicity is per session; resuming a workspace starts a new session with a
  new budget (matches today's chip semantics).
- Concurrency: one controller owns a workspace (Store lock); the extension process is
  the only writer to `runs.db` in that workspace; SQLite's locking plus immediate
  transactions are sufficient.

## 11. Implementation sequence

1. `src/store/schema.ts` (migrations) + Store wiring + tests. **(#7)**
2. `src/piui/run-index.ts` (record types, RunIndex over DatabaseSync, search, insights
   aggregation) + tests. **(#4 data layer)**
3. Extension wiring: run open/close/usage persistence, `PINEVIM_STATE_DIR` env,
   `/pinevim search`, `/pinevim insights`, help/completions updates. **(#4/#5 UX)**
4. `src/piui/budget.ts` + config validation + env + enforcement handlers + warn/stop
   copy + tests. **(#6)**
5. Docs (README), audit-plan entries, final gates.

## 12. Completion criteria

- **#7**: explicit schema version exists; legacy state upgrades; fresh installs land
  at latest; deterministic, idempotent, transactional migrations; failure leaves the
  old version; tests cover all of it.
- **#4**: canonical run rows + FTS5 across sessions; auto-indexed new runs; search
  returns metadata-rich results from the harness ledger only; integrated UX.
- **#5**: `/pinevim insights` computes token/cost/tool/failure/interruption/run/session
  aggregates from persisted data; honest about unsupported metrics; consistent
  formatting with the existing cost chip.
- **#6**: `ui.budget.warnAt` warns once at the threshold; `ui.budget.stopAt` blocks
  model spend at a real boundary (agent_start pre-check + turn_end abort gating all
  continuations); unset config changes nothing; malformed config fails validation.
