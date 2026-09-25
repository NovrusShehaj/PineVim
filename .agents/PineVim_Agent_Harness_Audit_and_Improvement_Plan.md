---
title: PineVim Agent Harness Audit and Improvement Plan
repository: PineVim
branch: chore/UI-Improvements (the prompt specified `core/UI-Improvements`; that branch does not exist — the working branch is `chore/UI-Improvements` and the audit was performed against it)
base_branch: main
auditor: GLM 5.3 Max reasoning
date: 2026-09-25
---

# PineVim Agent Harness Audit and Improvement Plan

Evidence labels used throughout, matching the repository's existing plan
convention (`.agents/pinevim-production-ui-ux-self-improving-harness-implementation-plan.md`):

- **[fact]** — verified directly in this repository during this audit (commands in §12.1).
- **[defect]** — a fact that is also a bug, gap, or contract violation.
- **[proposed]** — a recommendation; new paths are marked *(new)*.
- **[verify]** — must be confirmed by a spike, test, or maintainer answer before dependent work starts.

## 1. Executive Summary

**Overall health of recent changes.** The ten commits on
`chore/UI-Improvements` ahead of `main` (2b3be1a…005fb3f) are a large but
disciplined UI/harness push: 88 files changed, +12,178/−83 [fact]. They add a
coherent in-pane UI subsystem (`src/piui/`), tmux panel/statusline adapters,
a theme system (7 registered themes + mono/no-color), a 1,548-line header
snapshot suite, fault-injection integration tests, and two CI workflows. The
full check chain passes at HEAD: format:check, lint, typecheck, 164/164 tests
(unit + integration with real Pi 0.87.1/tmux/Neovim) [fact]. There are zero
TODO/FIXME markers in `src/` [fact]. Commit hygiene was deliberately repaired
during this audit: `src/piui/style.ts` and the 3-argument `fit()` signature now
land before the commits that use them, so the sequence typechecks at every
commit [fact].

**Biggest production risks** [fact/defect unless labeled]:

1. **Release verification is incomplete.** `Docs/Compatibility.md` states
   release status is "not yet release-verified"; Linux, SSH, physical keys,
   real fonts/Unicode widths, and per-emulator clipboard remain open gates.
   The new `Docs/Release-Checklist.md` encodes these gates but nothing has
   closed them yet.
2. **Interactive recovery is not automatable.** `intent("retry")` with a dead
   agent raises a tmux `confirm-before` prompt, which requires an attached
   tmux client. Headless contexts (CI, SSH-less automation, crashed
   controllers) cannot confirm it. Documented in `Docs/Testing.md` and worked
   around in `tests/integration/fault.test.ts` by using the manual
   detach→acquire→`start(true)` path instead [fact].
3. **Observability defaults to off.** `logLevel` supports only `"off" |
   "debug"` with default `"off"` (`src/config.ts`), and logging is a local
   JSONL event log. There are no metrics, no tracing, no error reporting
   channel, and no recorded benchmark results in the repository even though
   `npm run benchmark` exists and `Docs/Testing.md` requires "results must be
   recorded, not inferred" [fact/defect].
4. **The rewritten history is not yet on the remote.** Local
   `chore/UI-Improvements` has diverged from `origin/chore/UI-Improvements`
   (the remote still points at the pre-rewrite tip `e02225e`); a
   `--force-with-lease` push is pending [fact]. Until then, CI runs against
   the old, non-bisectable history.
5. **Pi is hard-pinned to 0.87.1** and other versions are rejected
   (`src/adapters/pi/compatibility.ts`) [fact]. This is a deliberate support
   stance, but it means every Pi release requires a compatibility review
   before users can upgrade PineVim.

**Biggest UX/UI opportunities** (detail in §5–§6): a keyboard-first
approval/confirmation flow that works without an attached client; a
session-timeline/tool-inspection surface built on the existing run ledger
(`src/piui/runs.ts`, `src/piui/renderers/runLedger.ts`); token/cost and
context indicators in the band/deck; a fuzzy command palette on top of the
existing completions/local-commands modules; and recorded, visible
performance numbers.

**Top 5 recommended actions:**

1. Force-push the repaired history and make the `Integration` workflow run on
   every PR to main (currently dispatch/label-gated) [proposed].
2. Implement a non-interactive confirmation path (configurable policy:
   `ask | always | never` per action) so recovery and quit work headless and
   are testable end-to-end [proposed].
3. Record benchmark results and add them to the release checklist as a
   blocking gate; add a `--log-level` CLI flag and a structured log viewer
   (`/pinevim log`) [proposed].
4. Close the Linux environment gate using the new integration workflow's
   matrix, and run the phase-0 + PTY suites there on every release candidate
   [proposed].
5. Ship the session timeline popup (F12 t) reusing run-ledger data — highest
   uniqueness-per-effort item, zero new state to persist [proposed].

**Production-readiness verdict: conditionally production ready.** The harness
is architecturally sound, heavily tested for its size (164 tests, real
children, fault injection, security suite), and documented to an unusual
standard. It is not production ready today because the environment gates
(Linux/SSH/physical input), release process (versioning, packaging sign-off,
recorded benchmarks), and non-interactive recovery are unfinished. §8 lists
the exact closure path.

## 2. Audit Scope and Method

**What was inspected** [fact]:

- Branch state: `git branch -a`, `git log --oneline origin/main..HEAD`,
  `git diff --name-status origin/main...HEAD` (88 files; full list retained
  in §12.2).
- Harness internals: `src/core/controller.ts` (start/intent dispatch/reconcile/
  adopt/retry/finish), `src/core/state.ts` (13-intent vocabulary), `src/
  persistence.ts` (lock/acquire/reclaim), `src/control/protocol.ts` (epoch,
  generation, request dedup, queue limits), `src/control/helper.ts`, `src/
  adapters/tmux/client.ts` (inventory/layout convergence/confirm/removeDead),
  `src/adapters/tmux/config.ts` (generated tmux.conf, helper command
  grammar), `src/config.ts` (defaults + validation), `src/piui/style.ts`,
  `src/piui/components/header.ts`.
- Tests: `tests/unit/piui.test.ts`, `tests/integration/harness.ts`,
  `lifecycle.test.ts`, `stress.test.ts`, `pi.test.ts`, `fault.test.ts` (all
  read); `security.test.ts`, `product-plan.test.ts`, `statusline.test.ts`,
  `core.test.ts` inventoried by name and coverage claims only [verify for
  line-level claims].
- Docs/CI: `Docs/Compatibility.md`, `Docs/Testing.md`,
  `Docs/Release-Checklist.md`, `.github/workflows/ci.yml`,
  `.github/workflows/integration.yml`, `package.json` scripts.
- Live verification runs during this audit: full `npm test` (164/164),
  typecheck, lint, format:check at the pre-005fb3f tree plus the fault suite
  in isolation [fact].

**Comparison used:** `origin/main...HEAD` three-dot diff on the local branch.
`main` and `origin/main` exist locally; no `git fetch` was performed (offline
audit; remote state taken from local refs) [fact].

**Assumptions:**

- The remote `origin/chore/UI-Improvements` still points at `e02225e` because
  the local ahead/behind counters say so [fact]; whether the maintainer has
  pushed elsewhere since was not verifiable [verify].
- Pi's extension API is exactly the pinned 0.87.1 surface; no attempt was made
  to validate against newer Pi [fact by construction].

**Could not be verified:**

- Real terminal behavior (physical keys, fonts, clipboard, SSH latency) —
  explicitly out of scope for automated tests per `Docs/Testing.md` [fact].
- Recorded benchmark numbers (none found in the repository) [fact/defect].
- Line-level contents of `src/skills/registry.ts`, `src/piui/report-gate.ts`,
  `scripts/pine-preview.mjs`, and the security/product-plan test bodies —
  inventoried but not fully read in this pass [verify].

## 3. Recent Changes Summary

**Major themes** (commits in order, oldest first) [fact]:

| Commit | Theme |
| --- | --- |
| 2b3be1a | UI controls in config, telemetry, tmux notification/popup support, README UI section |
| 54fd56b | Theme registration, header branding, tool-card rendering, API-surface test updates |
| 7e85d1e | Docs, diagnostics copy, welcome-session persistence, popup/status hardening |
| 65584f6 | Logo/trunk-factor rendering, light-theme accent lifting, unit tests |
| 8dd3366 | *(new during audit)* `src/piui/style.ts` extracted for bisectability |
| 9ff66a2 | *(new during audit)* 3-arg `fit(value, maxCells, ellipsis)` extracted for bisectability |
| 8ceaf58 | Header rendering + 17 snapshot fixtures + manifest-validated updater script |
| 8f68e7b | Cyberpunk theme, editor theme script, snapshot sync, band/deck/statusline work |
| 005fb3f | ASCII glyph threading through tmux bindings, lifecycle telemetry normalization, fault-injection suite, integration workflow, release checklist, header boundary tests |

**Files/components most affected:** `src/piui/*` (new subsystem, ~20 files),
`src/adapters/tmux/*` (panels/statusline/styled are new), `src/core/
controller.ts`, `tests/unit/piui.test.ts` (1,548 lines), `tests/fixtures/`
(17 header snapshots + manifest).

**Areas that look stable** [fact]: the controller lifecycle (serialized
intent queue, epoch/generation rejection, identity-checked adoption,
dead-owner lock reclaim with OS-confirmed PIDs), the persistence lock
protocol, the header layout engine (bands at <60/60–79/80–99/≥100 columns,
live-rows rendering, width-fit assertions across 60…200 columns and 16/24/30
rows), and the fault suite (streaming kill, mid-run kill + resume, editor
kill mid-switch, 500-event IPC flood, dead-owner lock reclaim).

**Areas that look incomplete or risky** [fact/defect]:

- `confirm-before`-based recovery is interactive-only (see §7.4).
- Benchmark results are required by `Docs/Testing.md` but no recorded results
  exist in the repo.
- The `Integration` workflow is dispatch/label-gated, so the Linux/macOS
  integration gates do not run by default on PRs.
- The remote branch still references the pre-rewrite history (force-push
  pending).
- `eslint.config.js` ignores unused variables matching a pattern (added in
  2b3be1a) — convenient, but it can hide dead code; lint currently passes
  with `--max-warnings 0` [fact; risk is prospective, not active].

**Apparent regressions:** none found. One transient issue was diagnosed and
documented rather than fixed in code: running integration tests under `tsx`
resolves Pi's `--extension` to a nonexistent `extension.js`, killing the pane
and surfacing as misleading `LAYOUT` errors; `Docs/Testing.md` now mandates
the compiled path [fact].

## 4. Detailed Findings

| ID | Severity | Area | Finding | Evidence | Recommendation |
| --- | --- | --- | --- | --- | --- |
| F-01 | High | Release | Release verification incomplete; Linux/SSH/physical-input gates open | `Docs/Compatibility.md` opening paragraph; `Docs/Release-Checklist.md` open-gates section | Work the checklist; start with the Linux gate via the integration workflow matrix |
| F-02 | High | Harness | Interactive-only confirmation blocks headless recovery and full test coverage | `src/core/controller.ts` `confirm()` → tmux `confirm-before`; `Docs/Testing.md` exclusion note; `tests/integration/fault.test.ts` workaround | Add confirmation policy config (§7.4) |
| F-03 | High | Observability | No metrics/tracing; default log level `off`; benchmark results unrecorded | `src/config.ts` defaults; `Docs/Testing.md` benchmark paragraph | Record benchmarks; add structured logs + `/pinevim log` viewer (§8.3) |
| F-04 | High | Process | Rewritten history not pushed; remote CI validates stale commits | Local vs `origin/chore/UI-Improvements` divergence [fact] | `git push --force-with-lease` after maintainer sign-off |
| F-05 | Medium | CI | Integration workflow is dispatch/label-gated; PRs to main run unit-only | `.github/workflows/integration.yml` `on:` block; `ci.yml` comment | Run linux integration on PRs touching `src/` or `tests/` |
| F-06 | Medium | Compatibility | Pi pinned to exactly 0.87.1; every Pi upgrade blocks PineVim | `src/adapters/pi/compatibility.ts` | Add a compatibility-matrix doc + an upgrade drill to the release checklist |
| F-07 | Medium | Testing | `tsx`-run integration tests fail cryptically (documented footgun, still easy to hit) | `Docs/Testing.md` new paragraph | Add a guard in `tests/integration/harness.ts` that detects the src-relative extension path and fails with an explanatory error |
| F-08 | Medium | Uniqueness | Strong run-ledger/session data exists with no inspection surface | `src/piui/runs.ts`, `src/piui/renderers/runLedger.ts`, `src/piui/renderers/turnSummary.ts` | Timeline popup reusing ledger state (§6.1) |
| F-09 | Medium | UX | No token/cost or context-percentage history; band shows current ctx% only | `src/piui/components/band.ts`, `deck.ts` [fact for presence; history absence inferred from no such file] [verify] | Sparkline in deck; ledger entries already carry ctxPercent |
| F-10 | Medium | Harness | No tool-approval workflow surfaced in PineVim; tool safety is delegated entirely to Pi | No approval-related intent in `src/core/state.ts` intents; `Docs/Compatibility.md` tool-card parity note | Design approval bridge over Pi's extension hooks (§7.5) [verify Pi 0.87.1 hook surface] |
| F-11 | Low | Config | `agentRatio` has no runtime adjust command beyond width intents | `src/config.ts`; intents list | Add `width.less/more` persistence or a `/pinevim ratio` command |
| F-12 | Low | Testing | Intermediate-commit test coverage was reshuffled for bisectability; band `run`-field assertions exist only at later commits | History rewrite during this audit [fact] | Acceptable trade-off; documented here so it isn't re-flagged |
| F-13 | Low | Docs | Two large `.agents/` plans coexist with overlapping roadmaps; supersession is stated but easy to miss | `.agents/pinevim-production-ui-ux-self-improving-harness-implementation-plan.md` header | Add a status header to the older plan pointing here and to §9 |
| F-14 | Info | Hygiene | Zero TODO/FIXME in `src/`; lint at `--max-warnings 0`; prettier enforced over docs+src+tests | grep + package.json scripts | Keep |
| F-15 | Info | Security | Security suite exists (IPC framing, epoch/generation, canaries, hostile paths) per `Docs/Testing.md`; line-level re-verification not performed in this audit | `tests/integration/security.test.ts` [verify] | Keep in CI; add fuzz-style property tests later (§8.4) |
| F-16 | Info | Packaging | `test:package` smoke exists; no published artifact or version tag process documented | package.json scripts; `Docs/Release-Checklist.md` packaging-adjacent items | Add tag→build→smoke→attach release pipeline (§8.5) |

## 5. TUI Improvement Plan

### T-01 · Non-interactive confirmation banner
- **Priority:** P0 · **Impact:** High · **Effort:** M · **Risk:** M · **GLM-implementable:** yes
- **Description:** Replace the tmux `confirm-before` dependency for quit/retry with an in-pane PiUI modal when no attached-client prompt is possible, driven by a new confirmation policy in config.
- **UX benefit:** Recovery works over SSH and in scripts; no "nothing happens" moments.
- **Files:** `src/core/controller.ts`, `src/piui/local-commands.ts`, `src/config.ts`, `src/control/protocol.ts`.
- **Sketch:** Add `confirm: { quit: "ask" | "always" | "never", retry: … }` to `UiConfig`. `confirm()` checks policy: `never` proceeds immediately, `always`/`ask` uses `confirm-before` when `tmux` has a client (probe via `list-clients`) and falls back to writing a modal state file consumed by the PiUI frame; the modal maps `y/n` to the existing `confirm-*` helper actions.
- **Tests:** Unit — policy matrix; integration — retry with dead agent under `policy.retry = "never"` recovers Pi; `ask` falls back headless.
- **Acceptance:** `fault.test.ts` gains an end-to-end respawn test (currently impossible); `Docs/Testing.md` exclusion note updated.

### T-02 · Session timeline popup (F12 t)
- **Priority:** P1 · **Impact:** High · **Effort:** M · **Risk:** L · **GLM-implementable:** yes
- **Description:** Scrollable popup listing turns/tool runs from the run ledger with timestamps, durations, tool names, failure marks; enter on an entry shows its tool card and diff summary.
- **UX benefit:** Makes agent history inspectable without scrolling the chat buffer; distinctive "audit view".
- **Files:** `src/piui/runs.ts` (data), new `src/piui/components/timeline.ts` *(new)*, `src/adapters/tmux/panels.ts` (popup plumbing), `src/control/helper.ts` (`popup` action exists).
- **Sketch:** Reuse the popup mechanism (`helper` action `popup` reads `popup.txt`); add a `timeline` action that renders ledger state to that file.
- **Tests:** Unit render tests in `piui.test.ts` style (width-fit, ascii fallback); integration — open popup after a fixture run, assert entries.
- **Acceptance:** F12 t shows ≥ the current run's entries at 60/80/120 columns; ASCII mode renders without Unicode.

### T-03 · Token/cost + context sparkline in the deck
- **Priority:** P1 · **Impact:** Medium · **Effort:** S · **Risk:** L · **GLM-implementable:** yes
- **Description:** Compact sparkline of last N context percentages plus cumulative token usage in the environment row.
- **Files:** `src/piui/components/deck.ts`, `src/piui/runs.ts`.
- **Sketch:** Ring buffer of ctxPercent in runs state (already recorded per turn [verify field name]); render with existing glyphs/ascii fallback.
- **Tests:** Width-fit at 60 columns; ascii fallback; mono theme.
- **Acceptance:** Visible in all four width bands without overflow (reuse the header fit test matrix pattern).

### T-04 · Keybinding discoverability overlay
- **Priority:** P1 · **Impact:** Medium · **Effort:** S · **Risk:** L · **GLM-implementable:** yes
- **Description:** `F12 ?` currently exists via menus; extend to a two-column cheat sheet including sequence-dependent hints (e.g., shows `r` only when retry is meaningful — agent dead).
- **Files:** `src/adapters/tmux/panels.ts`, `src/adapters/tmux/menu-*.ts` if present [verify], `src/core/controller.ts` status rendering.
- **Tests:** Snapshot-style render tests per state (alive/dead/busy).
- **Acceptance:** Hints change correctly across the lifecycle states covered by `lifecycle.test.ts`.

### T-05 · Rendering hardening under long output
- **Priority:** P2 · **Impact:** Medium · **Effort:** M · **Risk:** M · **GLM-implementable:** yes
- **Description:** Add a stress test that streams high-volume fixture output while resizing, asserting no flicker artifacts (double-capture diff) and bounded CPU.
- **Files:** `tests/integration/stress.test.ts`, `tests/fixtures/provider.ts`.
- **Sketch:** Extend the provider fixture with a `fixture-flood` command emitting N large chunks; capture pane twice per tick and diff.
- **Acceptance:** No duplicate frames across 200 samples; benchmark transition p95 unchanged (<100 ms target).

### T-06 · Theme contract tests
- **Priority:** P2 · **Impact:** Low · **Effort:** S · **Risk:** L · **GLM-implementable:** yes
- **Description:** Property-style test: every registered theme must render header/band/deck with zero escapes under mono, and fit widths under every other theme.
- **Files:** `tests/unit/piui.test.ts` (extends the no-color test added this audit).
- **Acceptance:** Adding a theme without fallback safety fails CI.

## 6. Unique PineVim Experience

1. **Session timeline & audit view** (T-02). *Why:* agent runs are opaque; PineVim already records the data. *Value:* trust + debugging. *Complexity:* M. *Risk:* L. *First version:* read-only popup. *Future:* export to file, jump-to-turn in scrollback.
2. **Keyboard-first approval workflow** (T-01 + §7.5). *Why:* distinctive "the harness never surprises you" identity; Vim-like modal confirmation (`y/n/a`). *First version:* quit/retry policy. *Future:* per-tool approval classes surfaced in PiUI.
3. **Context/budget cockpit** (T-03). *Why:* cost awareness is rare in terminal agents. *First version:* sparkline + totals. *Future:* configurable thresholds that tint the band.
4. **Diff-first change review** (`F12 d`): popup showing files changed this run (tool ledger already tracks `toolPaths`) with Neovim handoff to open the diff. *Complexity:* M. *Risk:* M (handoff plumbing). *First version:* list-only.
5. **Recovery HUD:** after crash/resume, a one-frame summary of what was preserved (PIDs, session id, unsaved-buffer protection status) — turns a scary moment into a signature moment. *Complexity:* S. *Risk:* L.
6. **Themeable identity with mono-first discipline:** already distinctive (7 themes + true no-color path [fact]); keep "looks right even in `TERM=dumb`" as an explicit brand promise.

Deliberately rejected: animated ASCII art, sound, mouse-heavy interactions, emoji-heavy chrome — misaligned with the Vim-like, production-grade positioning and the existing ASCII-fallback contract.

## 7. Agent Harness Functionality Improvements

### 7.1 Agent lifecycle
**H-01 · Lifecycle state machine docs + invalid-transition tests.** P1, effort S.
[fact] transitions are enforced in `src/core/controller.ts`/`state.ts`; add an exhaustive transition-table unit test so new intents cannot silently bypass guards. *Acceptance:* adding an intent without a transition entry fails a test. GLM-implementable: yes.

### 7.2 Context assembly
**H-02 · Session-file validation hardening.** P2, effort S.
[fact] `retry()` validates the session file header (type/cwd/id, O_NOFOLLOW, uid check). Add fuzz-ish unit tests over malformed headers (truncated JSON, wrong cwd, symlink swap mid-read). GLM-implementable: yes.

### 7.3 Tool/function calling
**H-03 · Tool-ledger completeness test.** P1, effort S.
[fact] `src/piui/runs.ts` + `runLedger.ts` track tool names/paths; add an integration assertion that every fixture tool call appears in the ledger exactly once, in order. *Acceptance:* ledger is provably a complete audit surface (this is what `Docs/Compatibility.md` leans on for tool-card parity). GLM-implementable: yes.

### 7.4 User approval flows
**H-04 · Confirmation policy (implements T-01 at harness level).** P0, effort M.
Config `ui.confirm` per action; headless fallback; protocol `confirm` message already exists with nonce+expiry [fact]. *Tests:* policy matrix + expired-nonce rejection (partially covered today). *Acceptance:* no recovery path requires an attached client. GLM-implementable: yes.

### 7.5 Streaming, cancellation, retries/timeouts
**H-05 · Abort-contract tests.** P1, effort M.
[fact] The fixture provider honors `options.signal` abort; fault tests cover process kill. Add: explicit user-cancel mid-stream (ESC path [verify keybinding]) records `abort` exactly once and restores prompt state; bridge reconnect during stream resynchronizes without duplicate partials. GLM-implementable: yes.

**H-06 · Deadline telemetry.** P2, effort S.
[fact] `tmux.deadline` guards layout bursts; log deadline violations as structured events with operation + duration (they are currently swallowed into user-facing errors). GLM-implementable: yes.

### 7.6 Session persistence
**H-07 · Lock-protocol property tests.** P2, effort M.
[fact] Dead-owner reclaim works (proven by `fault.test.ts`); add property tests: concurrent acquirers, corrupted `owner.json`, guard dir left behind (error path is already user-facing per `src/persistence.ts`). GLM-implementable: yes.

### 7.7 Memory/context strategy
**H-08 · Context-pressure signal.** P2, effort M.
Surface Pi's context usage in the ledger (already partly present) and warn at thresholds; do not summarize/compact autonomously in v1 [proposed; Pi capability verify].

### 7.8 Error handling & logging
**H-09 · Structured log levels + viewer.** P1, effort M.
Extend `logLevel` to `off|error|debug`, keep JSONL, add `/pinevim log` popup rendering recent events filtered by level (reuses popup plumbing). *Acceptance:* a failure can be diagnosed from the log alone. GLM-implementable: yes.

### 7.9 Configuration
**H-10 · Config lint command.** P2, effort S.
`pinevim --check-config` validates config + executables + terminfo up front, printing a readiness report (reuses `validateConfig`, `executable()`, `terminfo()`). GLM-implementable: yes.

### 7.10 Hook/plugin architecture
**H-11 · Extension event surface doc.** P2, effort S.
[fact] PineVim ships its own Pi extension (`src/adapters/pi/extension.ts`); document which events third-party extensions may observe vs own (collision tests exist for command/namespace collisions [fact]). No new API in v1.

### 7.11 Testing hooks & developer ergonomics
**H-12 · Harness fixture flag for deterministic clock.** P3, effort S.
Inject a clock into controller timers (2 s coalescer, 30 s confirm expiry) to make timeout tests instant. GLM-implementable: yes.

### 7.12 Security & permission boundaries
**H-13 · Boundary test consolidation.** P1, effort S.
Keep and extend `security.test.ts`: argv-array execution everywhere [fact per Testing.md], tmux-format escaping in paths (documented underscore rendering), helper action grammar regex, socket path containment. Mark each boundary with a named test title so audits map 1:1. GLM-implementable: yes.

## 8. Production Readiness Plan

### 8.1 Reliability
- Crash handling: controller SIGKILL/resume proven [fact]; add controller-crash-during-intent test (kill the controller process mid-dispatch from a spawned process) *(new test)*.
- Graceful degradation: missing nvim executable path already preserves Pi [fact in `stress.test.ts`]; add missing-tmux and missing-Pi startup error paths.
- Timeouts/retries: layout deadline exists [fact]; add deadline-violation telemetry (H-06) and document `--resume` as the user-facing retry for all child-loss cases.
- Recovery from failed agent/tool calls: provider-error path proven without mode loss [fact in `pi.test.ts`].

### 8.2 Security
- Secrets: fixture canary sweep over state/logs exists [fact per `pi.test.ts`]; add canary scan over popup/log files too.
- Command injection: argv arrays + fixed helper grammar [fact]; keep hostile-path corpus in security tests; add tmux `;` argv-delimiter regression test (the mechanism is documented in `client.ts` comments).
- Filesystem: private runtime dirs with 0600/0700 modes [fact]; add a mode-audit test.
- Safe defaults: prefix F12, `allow-passthrough off`, `set-clipboard external`, `exit-empty on` [fact in generated tmux.conf]. Document each as a security decision in Compatibility.md.

### 8.3 Observability
- Logging: JSONL event log exists; ship H-09 (levels + viewer).
- Tracing: add a `traceId` to intent log entries (uuid per user action) so multi-step flows can be reconstructed.
- Metrics: minimum viable — print a session summary on quit (intents, tool runs, durations, deadline violations) to the log; no daemon required.
- Session audit trails: the run ledger + log together; expose via T-02.
- Benchmark: record `npm run benchmark` output in `Docs/` per release candidate; make the release checklist item blocking (F-03).

### 8.4 Testing
- Unit: current 5 suites; add transition-table (H-01) and theme-contract (T-06).
- Integration: current 6 files incl. fault suite; add flood/streaming (T-05), controller-mid-dispatch crash (8.1), approval-policy matrix (H-04).
- TUI behavior: header snapshot matrix is the model [fact]; add band/deck snapshot manifests using the same updater script pattern (`scripts/update-header-snapshots.mjs`).
- Terminal compatibility: keep PTY transport suite; Linux matrix via CI (F-05 closure).
- Agent simulation: fixture provider is the harness-simulation layer; extend with tool-call + abort + flood scenarios rather than adding a second simulation system.

### 8.5 CI/CD
- Current: unit gate on all PRs [fact]; integration workflow (Linux tmux 3.5 from source + Neovim 0.12.4 + SSH smoke; macOS brew + version gate) dispatch/label-gated [fact].
- Change (F-05): run Linux integration on PRs touching `src/`/`tests/`; keep macOS on nightly/dispatch to control runner cost.
- Release: tag → `npm run test:package` → smoke → attach tarball + checksums; document in Release-Checklist §Release-blocking decisions; add `npm version`/changeset-style version bump step.
- Versioning: Pi compatibility gate (F-06) belongs in the release drill.

### 8.6 Documentation
- Exists and is unusually strong: Testing, Compatibility, Release-Checklist, Implementation-Evidence, two `.agents/` plans, README UI section, copilot instructions [fact].
- Gaps: user guide (install/first-run/keybindings quickstart), keybinding reference generated from the bindings table (single source of truth), troubleshooting guide (the tsx footgun, SSH + confirm-before, resume semantics), and a one-page architecture map (controller/tmux/Pi/editor data flow).
- Add `Docs/User-Guide.md` *(new)* and `Docs/Architecture.md` *(new)*; generate `Docs/Keybindings.md` from `src/adapters/tmux/client.ts` bindings to prevent drift.

## 9. Prioritized Roadmap

### Phase 1 — Immediate / 24–48 h
**Goal:** make the current state visible and shippable.
- Tasks: force-push repaired history (F-04); record benchmark baseline (F-03); run Linux integration gate once end-to-end and record results (F-01 first slice); update stale `.agents/` plan headers (F-13).
- Dependencies: maintainer sign-off on force-push; one macOS/Linux machine.
- Outcome: CI validates true history; performance numbers exist; Linux gate has a first data point.
- Success metrics: remote tip = `8f68e7b`-lineage; benchmark doc section filled; zero red checks.

### Phase 2 — Short term / 1–2 weeks
**Goal:** remove the headless-recovery blocker and harden CI.
- Tasks: H-04/T-01 confirmation policy; F-05 PR-triggered Linux integration; F-07 tsx guard; H-01 transition-table tests; H-09 log levels + `/pinevim log`; H-03 ledger completeness test.
- Dependencies: none external.
- Outcome: recovery testable end-to-end; failures diagnosable from logs.
- Success metrics: fault suite gains a respawn test; CI runs integration on PRs; time-to-diagnose a seeded failure < 5 min using logs alone.

### Phase 3 — Medium term / 2–6 weeks
**Goal:** distinctive UX + release mechanics.
- Tasks: T-02 timeline popup; T-03 cockpit; T-04 hints; F-16 release pipeline; Docs/User-Guide + Keybindings generation; 8.4 band/deck snapshot manifests; H-13 boundary consolidation.
- Dependencies: Phase 2 protocol/config changes merged.
- Outcome: PineVim demonstrably different from generic terminal agents; tagging a release is a checklist, not an adventure.
- Success metrics: all Release-Checklist automated gates green; timeline usable at 60 columns; keybinding doc generated, zero drift.

### Phase 4 — Longer term / 6+ weeks
**Goal:** environment-gate closure and deeper agent UX.
- Tasks: Linux/SSH/physical-input environment record completion (F-01); H-05 abort contract; H-08 context-pressure; diff-first review (§6.4); Pi upgrade drill process (F-06); optional approval bridge design spike (F-10).
- Dependencies: hardware/terminals for the environment record; Pi hook-surface verification.
- Outcome: production-ready declaration becomes defensible; upgrade path de-risked.
- Success metrics: Compatibility.md open-gates list empty or explicitly accepted; upgrade drill documented with two Pi versions.

## 10. GLM-Implementable Work List

| Task | Priority | Status | Expected outcome | Files | Steps | Verification | Rollback risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tsx guard in harness | P1 | Implemented (2026-09-25) | Clear error instead of LAYOUT confusion | `tests/integration/harness.ts` | Detect missing compiled `extension.js` relative to `import.meta.url`; throw explanatory `LOADER` PineError | tsx run fails in ~1 ms/test with the remedy; compiled suite stays green | None |
| Transition-table test | P1 | Ready | Invalid intent/state combos throw | `tests/unit/core.test.ts` | Enumerate intents × lifecycle states vs `transition()` | `npm run test:unit` | None |
| Ledger completeness test | P1 | Ready | Tool runs fully audited | `tests/integration/pi.test.ts`, `tests/fixtures/provider.ts` | Add tool-calling fixture command; assert ledger rows | Run integration suite | Low |
| Log levels + `/pinevim log` | P1 | Ready | Diagnosable sessions | `src/config.ts`, `src/core/controller.ts`, `src/adapters/tmux/panels.ts` | Extend logLevel; render recent events into popup | Unit + manual at 60 cols | Low — additive config |
| Confirmation policy | P0 | Implemented (2026-09-25) | Headless recovery | `src/config.ts`, `src/core/controller.ts`, `fault.test.ts` | `ui.confirm` per-action policy; attached-client probe via `list-clients`; `always` repeat-to-confirm window; `never` direct execution | `fault.test.ts`: headless respawn under `never`, headless refusals under `ask`, two-stroke busy quit under `always` | Medium — touched recovery path |
| Benchmark recording harness | P1 | Implemented (2026-09-25) | Recorded perf baselines | `Docs/Release-Checklist.md` | First baseline recorded (two runs, commit d27a9d9): launch-to-bridge p95 ~4× over target, transition p95 straddling, idle CPU passing — gate stays open | Table + interpretation in Release-Checklist | None |
| Theme contract test | P2 | Ready | Fallback safety enforced | `tests/unit/piui.test.ts` | Loop all themes × widths × mono | Unit suite | None |
| Band/deck snapshot manifests | P2 | Ready | Visual regression safety | `tests/fixtures/`, `scripts/update-header-snapshots.mjs` | Extend manifest schema; regenerate | Snapshot suite | None |
| Generated keybinding doc | P2 | Ready | Docs never drift | `scripts/`, `Docs/Keybindings.md` *(new)* | Export bindings table; render md | Diff against client.ts | None |
| Diff-first review popup | P3 | Needs clarification | Change review surface | `src/piui/`, `src/editor.ts` | Needs Pi ledger diff-format decision | — | — |
| Approval bridge over Pi tools | P3 | Blocked by missing access/context | Safe tool execution UX | `src/adapters/pi/extension.ts` | Requires Pi 0.87.1 hook-surface verification | — | — |
| Linux environment record | P1 | Ready (human step) | Gate closure evidence | `Docs/Compatibility.md` | Run Testing.md steps 1–9 on Linux | Recorded rows | None |

## 11. Missing Information or Open Questions

1. **Force-push authorization** for `chore/UI-Improvements` (F-04) and whether other collaborators base work on the old commits.
2. **Branch naming**: prompt says `core/UI-Improvements`; repo has `chore/UI-Improvements`. Confirm which is canonical going forward.
3. **Target terminals/OS matrix** the maintainer actually supports (affects which emulator rows are mandatory in the environment record).
4. **Pi upgrade policy**: how quickly should new Pi 0.87.x releases be adopted (F-06)?
5. **Pi 0.87.1 hook surface** for tool interception/approval (F-10) — needs the pinned `node_modules` `.d.ts` review or a maintainer statement.
6. **Budget/telemetry scope**: is displaying cumulative cost desired given no-network test policy (fixture-only cost data is synthetic)?
7. **Line-level review** of `security.test.ts`, `skills/registry.ts`, `report-gate.ts` was not completed in this pass [verify].
8. **Remote CI state**: whether GitHub-side checks exist beyond the two committed workflows (secrets, required checks) could not be inspected.

## 12. Appendix

### 12.1 Commands used

```sh
git branch -a
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
git diff --name-status origin/main...HEAD
git show 005fb3f --stat
git grep -n "TODO\|FIXME\|XXX\|HACK" -- src/
npm run typecheck && npm run lint && npm run format:check
npm test
node --test --test-concurrency=1 build/tests/integration/fault.test.js
```

All read-only with respect to repository content; the history rewrite described
in §3 (commits 8dd3366/9ff66a2) was explicitly requested by the maintainer
during this engagement and is included in the audited range.

### 12.2 File map (audit-relevant)

- Core harness: `src/core/{controller.ts,state.ts}`, `src/persistence.ts`, `src/control/{protocol.ts,client.ts,helper.ts}`
- Terminal adapter: `src/adapters/tmux/{client.ts,config.ts,panels.ts,statusline.ts,styled.ts}`
- Pi adapter: `src/adapters/pi/{extension.ts,adapter.ts,compatibility.ts}`
- In-pane UI: `src/piui/**` (header/band/deck/glyphs/style/logo/themes/renderers/runs/completions/local-commands/lifecycle/changes/chips)
- Editor: `src/editor.ts`, `src/editor/theme-script.ts`
- Tests: `tests/unit/{core,editor,piui,product-plan,statusline}.test.ts`, `tests/integration/{fault,lifecycle,pi,security,stress}.test.ts`, `tests/integration/harness.ts`, `tests/terminal/transport.py`, 17 header fixtures + manifest
- Ops: `.github/workflows/{ci,integration}.yml`, `scripts/{copy-themes,pine-preview,update-header-snapshots}.mjs`, `Docs/{Testing,Compatibility,Release-Checklist,Implementation-Evidence}.md`

### 12.3 Suggested issue titles

- "Recovery requires an attached tmux client; add confirmation policy"
- "Record benchmark baselines and gate releases on them"
- "Run Linux integration suite on PRs touching src/tests"
- "Fail fast with a clear error when integration tests run under tsx"
- "Session timeline popup over the run ledger"
- "Generated keybinding reference to prevent doc drift"
- "Complete the Linux/SSH environment record for release"

### 12.4 Suggested commit messages

```text
feat(harness): add confirmation policy for quit and recovery
test(harness): verify intent transition table exhaustively
feat(tui): session timeline popup backed by the run ledger
ci: run linux integration suite on pull requests
docs: record benchmark baselines for the release gate
fix(tests): detect tsx execution and explain the extension-path failure
```

### 12.5 Example configuration improvement

```jsonc
// ~/.config/pinevim/config.json (proposed fields marked)
{
  "prefix": "F12",
  "agentRatio": null,
  "logLevel": "debug",              // proposed: error|debug (was off|debug)
  "ui": {
    "enabled": true,
    "motion": "on",
    "glyphs": "unicode",
    "theme": "auto",
    "confirm": {                    // proposed (H-04)
      "quit": "ask",                // ask | always | never
      "retry": "ask"
    }
  }
}
```

### 12.6 Example keybinding improvement

Keep the F12 prefix vocabulary unchanged (muscle memory + tests depend on it
[fact]); add only sequence-conditional hints so the cheat sheet reflects what
is currently valid — e.g. surface `r` (retry) exclusively when the agent pane
is dead, and `q` confirmation copy that mirrors the configured confirmation
policy.

### 12.7 Suggested test cases (new, named)

1. `retry with dead agent under confirm.retry=never respawns Pi headless`
2. `stream abort records exactly one abort event and restores the prompt`
3. `every fixture tool call appears in the run ledger exactly once, in order`
4. `intent dispatch in stopping lifecycle is rejected with STOPPING`
5. `all themes render width-safe at 60/80/120 and emit zero escapes in mono`
6. `flood output + concurrent resizes produce no duplicate frames`
7. `runtime files and directories keep private modes (0600/0700)`
8. `controller killed mid-intent leaves recoverable state and no orphan panes`
