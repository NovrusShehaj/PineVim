# Implementation evidence and release decision

Audit date: 2026-09-23. Contract: the complete 688-line `PineVim-Agent-Harness-Implementation-Plan.md`, sections 1–33 and appendices A/B. It was read before implementation and again during the completion audit. The historical planning document is unchanged.

**Local implementation is functional; release approval is withheld.** Physical terminal fidelity, Linux and SSH still need the environment-specific checks below. Automated PTY input is not physical keyboard, clipboard or visual rendering evidence. No percentage-complete or production-ready claim is made.

PASS means directly inspected or exercised by the named automated test, within its stated environment. PARTIAL means implemented and partly verified, with an explicit remaining release test. DEFERRED means intentionally outside the contract's MVP, not missing production code.

## Reproducible evidence inventory

| Code | Implementation / verification                                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U    | `tests/unit/core.test.ts`: state/event tables, geometry, idempotence, schema/framing, config, quoting, diagnostics, canonical paths, locks, metadata, permissions, live-PID recovery refusal                                                                                    |
| L    | `tests/integration/lifecycle.test.ts`: real Pi/Neovim, child identity, buffer/cursor/undo, compact creation, native quit refusal, normal exit/crash, recovery, foreign-job preservation, complete cleanup                                                                       |
| P    | `tests/integration/pi.test.ts` and public `tests/fixtures/provider.ts`: deterministic offline provider, busy transitions, custom model picker, errors, new/fork/resume/reload, ownership collisions, no replay, secret canaries                                                 |
| S    | `tests/integration/security.test.ts`: real private tmux/socket, argv/format/helper injection, authentication, epoch, queue and framing limits, private permissions                                                                                                              |
| R    | `tests/integration/stress.test.ts`: concurrent open/hide/show, 200 resize notices, observed border/focus changes, missed hooks, stale generations/workspaces, lost creation result                                                                                              |
| T    | `tests/terminal/transport.py`: full CLI in an attached PTY, regular/fullscreen Pi, configured nested tmux, prefix/literal prefix, bracketed paste, CSI-u Shift+Enter, resize, SIGKILL/resume, confirmed retry/cancellation, startup rejection                                   |
| F    | `scripts/phase0.py`: installed Pi 0.87.1 public extension/custom editor/picker/reload/collision metadata, real Neovim, 18 geometry/zoom transitions                                                                                                                             |
| N    | `scripts/user-config-smoke.py`: normal installed personal Pi and Neovim, actual Ctrl+L picker semantic rendering at 120/80/60 columns and the wide split agent pane, same PID through view changes, normal quit, Neovim config hashes unchanged; no provider completion invoked |
| K    | `scripts/package-smoke.mjs`: tarball allowlist, disposable-prefix install, bin/help/version, compiled extension/helper, zero production npm dependencies                                                                                                                        |
| B    | `scripts/benchmark.mjs`: 20 warm-cache fresh CLI processes, bridge startup separately, 40 pane transitions, 60-second controller idle CPU                                                                                                                                       |
| M    | `Docs/Testing.md` required real-environment procedure: exact remaining physical terminal/Linux/SSH checks                                                                                                                                                                       |

## Validation run

The local validation commands and outcomes are recorded here so they are distinct from the external release checklist:

- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`: PASS.
- `npm test`: 39 tests passed, 0 failed, 0 skipped (25 unit and 14 integration cases).
- `npm exec --yes --package=node@22.19.0 -- node --test --test-concurrency=1 build/tests/unit/*.test.js build/tests/integration/*.test.js`: PASS, all 39 tests on the minimum Node runtime, 0 failed/skipped.
- `npm run test:phase0`: PASS, installed Pi public contracts and 18 geometry transitions.
- `python3 tests/terminal/transport.py`: PASS for startup rejections, direct regular/fullscreen PTYs and configured nested tmux; no physical keyboard claim.
- `python3 scripts/user-config-smoke.py`: PASS, actual picker semantic rendering at 120/80/60 columns and the wide split agent pane, normal Neovim and live continuity, safe quit, zero changed Neovim config hashes, no provider completion.
- `npm run test:package`: PASS, 43 allowlisted files installed in a disposable prefix; no runtime npm dependencies.
- Disposable checkout `npm ci --ignore-scripts --no-fund`, `npm run build`, `npm run typecheck`: PASS, 324 development packages installed, zero audit vulnerabilities. The upstream dev graph emits a `node-domexception` deprecation warning.
- `npm audit --omit=dev`: PASS, zero production vulnerabilities.
- `git diff --check` plus explicit whitespace scan of all untracked files: PASS. No commits existed, so an empty tracked diff alone was not used as evidence.

## Functional requirements

| Requirement | Implementation                                    | Evidence/result             | Qualification                                                                                                  |
| ----------- | ------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| PINE-FR-001 | `cli.ts`, Pi adapter, controller start            | PASS L/T/F/N                | Real interactive Pi, no initial editor; no replacement UI                                                      |
| PINE-FR-002 | bundled extension, controller editor creation     | PASS L/P/N                  | One normal editor; bare alias deliberately unavailable on a collision, with namespaced/prefix fallback         |
| PINE-FR-003 | tmux client layout, core layout                   | PASS L/F/T                  | Editor left, same Pi right; observed cell dimensions                                                           |
| PINE-FR-004 | reducer/controller, private prefix table          | PASS L/T                    | Agent hide zooms editor                                                                                        |
| PINE-FR-005 | persistent Pi pane; no view-triggered abort       | PASS L/P/T                  | PID/session/model continuity and busy run without abort                                                        |
| PINE-FR-006 | persistent Neovim pane                            | PASS L/N                    | PID plus synthetic unsaved text/cursor/undo tree equality                                                      |
| PINE-FR-007 | native Pi argv/environment boundary               | PASS P/N and source audit   | No credential reads/copies by PineVim; normal Pi-owned writes allowed; live credentialed completion not tested |
| PINE-FR-008 | package bin `pinevim`                             | PASS K                      | Local package name `pinevim-local`; publication not performed                                                  |
| PINE-FR-009 | chat transition/zoom                              | PASS L/T/N                  | Close hides a live editor; reopen reveals it                                                                   |
| PINE-FR-010 | pane death reconciliation                         | PASS L/R                    | Normal editor exit/crash leaves Pi; explicit reopen creates new editor                                         |
| PINE-FR-011 | agent death and explicit confirmed retry          | PASS L/T                    | Editor survives; cached Pi session validated; no automatic restart                                             |
| PINE-FR-012 | direct tmux input; separate IPC                   | PASS S/L/T and source audit | No production send-keys or terminal output scraping                                                            |
| PINE-FR-013 | workspace realpath, launch cwd, bridge validation | PASS U/S/R                  | Existing directory; no Git-root promotion; cross-workspace handshake refused                                   |
| PINE-FR-014 | untouched native Pi commands/custom UI            | PARTIAL P/F/N/T             | Actual picker semantic smoke passed; complete native key/visual matrix remains M                               |
| PINE-FR-015 | editor-first quit refusal, public Pi drain        | PASS L/T                    | Native modified-buffer refusal; no automated editor quit/kill; cancellation confirmed                          |
| PINE-FR-016 | compact presentation independent of mode          | PASS U/L/F/T/R              | 120×30, 101×24, 100×24, 80×24, 60×16 and below-minimum preservation                                            |
| PINE-FR-017 | config/compatibility/diagnostics                  | PASS U/S/T/K                | Unsupported Pi rejected, actionable local errors, bounded status and opt-in logs                               |
| PINE-FR-018 | epochs, no request replay, explicit recovery      | PASS P/R/T/U                | Retry restores session only; disconnected outstanding requests discarded                                       |
| PINE-FR-019 | private runtime and ownership boundaries          | PASS S/K/N and source audit | No global rewrites, telemetry, remote creation, credential export or auto-update                               |

## Acceptance cases

| Case  | Result  | Evidence / remaining check                                                                                                                               |
| ----- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-01 | PASS    | L/T/F/N: chat-only real Pi and canonical handshake                                                                                                       |
| AT-02 | PASS    | L/R: repeated slash/open requests retain one editor PID                                                                                                  |
| AT-03 | PASS    | U/L: 42-column agent at 120×30 and editor minimum                                                                                                        |
| AT-04 | PASS    | L/P: zoom/full width, same session/PID, no abort                                                                                                         |
| AT-05 | PASS    | P/L/T: same model/session, restored input routing                                                                                                        |
| AT-06 | PASS    | L: exact unsaved text, cursor, undo and PID equality                                                                                                     |
| AT-07 | PASS    | P/source audit: native provider authority, synthetic canary absent from controller state/logs                                                            |
| AT-08 | PASS    | P: custom picker selects model two; transitions and explicit public session resume preserve it                                                           |
| AT-09 | PASS    | U/L/R/T: thresholds and 200 resize notifications converge with same processes                                                                            |
| AT-10 | PASS    | L: normal editor exit and explicit restart                                                                                                               |
| AT-11 | PASS    | L/R: crash metadata and surviving Pi                                                                                                                     |
| AT-12 | PASS    | L/T: Pi crash, retained editor, confirmed retry, unchanged request count                                                                                 |
| AT-13 | PASS    | P: deterministic provider error leaves editor/mode intact; live provider optional                                                                        |
| AT-14 | PASS    | L/T: modified editor refusal, busy cancellation yes/no, duplicate quit, cleanup and foreign jobs                                                         |
| AT-15 | PARTIAL | T/L: Ctrl+C input, detach and controller death/recovery; physical Ctrl+C/D/Z, signals and terminal reset matrix remains M                                |
| AT-16 | PASS    | S/P/K plus package/source audit: fabricated canaries only, allowlisted metadata/logs/files                                                               |
| AT-17 | PASS    | Source audit and N: harness writes private paths; actual Neovim config hash unchanged; Pi-native writes explicitly allowed                               |
| AT-18 | PASS    | K: disposable-prefix tarball install and bin/help/version/assets                                                                                         |
| AT-19 | PASS    | P/F/U: exact public source ownership and both command collisions/reload                                                                                  |
| AT-20 | PARTIAL | F/P/N/T: Ctrl+L semantic picker and CSI-u Shift+Enter; Ctrl+B, LazyVim navigation, Alt+Enter and physical keys remain M                                  |
| AT-21 | PASS    | P: new/fork/resume/reload refresh generation/session while Pi PID survives                                                                               |
| AT-22 | PASS    | T/L/U: controller SIGKILL/resume, exclusive lock, same children; unknown liveness conservatively refused                                                 |
| AT-23 | PARTIAL | T: configured nested tmux passes; default outer settings initially collapsed CSI-u, documented; SSH unavailable                                          |
| AT-24 | PASS    | T/U/K: non-TTY, dumb TERM, undersize, malformed config and missing Pi reject before children; help/version bypass dependencies                           |
| AT-25 | PARTIAL | R/T: observed focus/border, synthetic paste, ASCII status and terminfo configuration; physical mouse, Unicode/color display and clipboard/OSC52 remain M |
| AT-26 | PASS    | R/U: foreign cwd/session identity rejected; no silent project switch                                                                                     |

## Non-functional targets and lifecycle/security invariants

| Contract                                           | Implementation and verification                                                                                                                                  | Result                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Warm controller <250 ms p95                        | B, measured immediately before tmux Pi launch                                                                                                                    | See measured run below                                   |
| Live reveal/hide <100 ms p95 at 120×30             | B, controller intent through reconciled metadata commit; excludes child redraw                                                                                   | See measured run below                                   |
| Controller idle <1% over 60 s                      | B, process CPU; child helper/tmux/Pi/Neovim CPU excluded                                                                                                         | See measured run below                                   |
| No input byte buffering / high-rate output polling | tmux owns outer terminal; hooks + 2-second liveness safety net; 50 ms/150 ms coalescer; source audit                                                             | PASS                                                     |
| Serialized writer, bounded/idempotent operations   | controller queue64, operation IDs, pre-execution queue expiry, command deadlines, actual inventory before state commit; U/R                                      | PASS                                                     |
| Stable IDs, no optimistic durable layout           | tmux session/window/pane IDs + PID, final layout inventory, recovery guard; L/R                                                                                  | PASS                                                     |
| Child failure/transport isolation                  | L/T: editor crash, Pi crash, controller kill/detach and explicit retry; no automatic SIGKILL path                                                                | PASS                                                     |
| Unsaved editor and busy Pi safety                  | L/T: native quit refusal, no editor injection, confirm/default-no/expiry and public abort/drain                                                                  | PASS                                                     |
| Private ownership and lock recovery                | 0700 dirs, 0600 token/state/socket/logs, realpath, no-follow reads, atomic replacement, instance/canonical identity; U/S                                         | PASS                                                     |
| Single transcript writer                           | Exclusive workspace lock; socket availability plus recorded live-PID refusal; metadata published before first child; lost editor result refuses duplicate; U/R/T | PASS                                                     |
| IPC authentication/bounds                          | Unix only, token file capability, exact role/schema/enums, 16KiB record, 64 queue/connections, 2s ack/10s result, epoch/generation; U/S/R                        | PASS                                                     |
| No replay and reconnect                            | 250ms–5s reconnect; old requests discarded; duplicate request IDs close connection; bounded 1024-ID set; P/S/T                                                   | PASS                                                     |
| Command/shell/format injection                     | shell:false, direct multi-argv panes, strict fixed helper shell quote, format # escaping, validated dynamic enums/nonces; S/U                                    | PASS                                                     |
| Cleanup scope and PID reuse                        | inventory and instance checks, conditional dead-pane PID check, never default-server kill, foreign jobs retained; L/S                                            | PASS                                                     |
| Diagnostic/secret boundary                         | allowlisted records, bounded ASCII status/errors, no transcript/environment/auth dumps, log rotation and no-follow append; U/P/S/K                               | PASS                                                     |
| Configuration isolation                            | strict own-property allowlist; no project code loading/provider import; normal native Pi/Nvim resources preserved; U/N/source audit                              | PASS                                                     |
| Terminal behavior                                  | CSI-u/mouse/clipboard baseline, literal prefix, no broad passthrough; F/T/R                                                                                      | PARTIAL: full physical matrix M                          |
| macOS/Linux/SSH support                            | macOS local tests only; Docker daemon unavailable and no SSH target provided                                                                                     | PARTIAL: Linux and SSH release gates                     |
| Node minimum/public Pi API compatibility           | Node 22.19.0 and 26.9.0 tests; pinned exported Pi 0.87.1 types; no runtime private imports                                                                       | PASS for tested versions                                 |
| tmux/Neovim compatibility                          | local tmux3.7c, Nvim0.12.4; required tmux>=3.5 features inspected                                                                                                | PASS local versions; tmux3.5 lower baseline not executed |
| Packaging/development                              | ESM, strict TS, lockfile, no runtime npm dependencies, compiled helper/extension, bin, disposable install; K                                                     | PASS                                                     |
| Documentation                                      | README, Compatibility, Testing and this matrix; no license/publication assumed                                                                                   | PASS                                                     |

Security fixes made during implementation included tmux cwd/format escaping, helper quoting, socket epoch/capability enforcement, log symlink refusal, prototype-property command/config rejection, cleanup's final-pane exit race, preserving zoom during focus, border-drag feedback prevention, detach write ordering, early startup metadata, refusing duplicate creation after a lost result, and expiring queued intents before late execution. Each material behavior has regression coverage. Same-UID malicious Pi extensions remain inside the stated trust boundary; this is not an OS sandbox.

## Task and phase exit coverage

| Task     | Status   | Evidence                                                                                       |
| -------- | -------- | ---------------------------------------------------------------------------------------------- |
| PINE-001 | PASS     | U/L/P/F disposable roots and compatibility record                                              |
| PINE-002 | PASS     | F/P public command inventory, custom editor, collisions                                        |
| PINE-003 | PASS     | F/L compact creation and observed cell/PID continuity                                          |
| PINE-004 | PARTIAL  | T nested/CSI-u/prefix routing; physical Enter/clipboard gates M                                |
| PINE-005 | PASS     | pinned ESM/TypeScript toolchain, strict checks and lockfile-backed install                     |
| PINE-006 | PASS     | U/T/K CLI/path/dependency/startup rejection                                                    |
| PINE-007 | PASS     | U/S runtime/metadata/lock permissions and identity                                             |
| PINE-008 | PASS     | U/S protocol, helper, sanitized diagnostics                                                    |
| PINE-009 | PASS     | S fixed argv/shell/format boundaries                                                           |
| PINE-010 | PASS     | F/P/N real explicit extension and native UI ownership                                          |
| PINE-011 | PASS     | U/R reducer, serialization, lost-result convergence/refusal                                    |
| PINE-012 | PASS     | L/R lazy editor and failure isolation                                                          |
| PINE-013 | PASS     | U/L sizing and ratio                                                                           |
| PINE-014 | PARTIAL  | T/R prefix/busy/dead behavior; physical native keys M                                          |
| PINE-015 | PASS     | L/R/T resize/compact and stable identities                                                     |
| PINE-016 | PASS     | L/P view/session/buffer preservation                                                           |
| PINE-017 | PASS     | L/T safe quit/detach and recoverable children                                                  |
| PINE-018 | PASS     | P new/fork/resume/reload and stale contexts                                                    |
| PINE-019 | PASS     | L/T/U explicit retry and controller resume                                                     |
| PINE-020 | PASS     | P synthetic provider/model/session continuity                                                  |
| PINE-021 | PASS     | S/U/P/K security and package/diagnostic boundaries                                             |
| PINE-022 | PASS     | K local tarball install/bin/assets                                                             |
| PINE-023 | PARTIAL  | local suites and personal-config semantic smoke passed; Linux/SSH/full terminal matrix remains |
| PINE-024 | PASS     | README/support/release checklist and explicit UNLICENSED/private status                        |
| PINE-025 | DEFERRED | Optional editor RPC/context phase intentionally excluded                                       |

| Phase               | Exit result                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0 feasibility       | Core public API, narrow creation, process continuity, CSI-u and configured nesting demonstrated; exact physical-terminal gate remains open. ADR-001 retained, no objective architecture failure found. |
| 1 foundation        | Implemented and automated startup/security gates passed.                                                                                                                                               |
| 2 editor lifecycle  | Implemented; repeated open, missing editor and child-failure gates passed.                                                                                                                             |
| 3 layout/input      | Layout, resize, compact and synthetic input passed; physical native keys/clipboard remain open.                                                                                                        |
| 4 visibility/exit   | Identity/buffer preservation and safe quit passed.                                                                                                                                                     |
| 5 recovery          | Public lifecycle/session/collision/provider fixtures and controller crash/retry passed.                                                                                                                |
| 6 packaging         | Local install passed; owner license/namespace decision required only before publication.                                                                                                               |
| 7 release readiness | NOT CLEARED: Linux, SSH and complete physical terminal matrix absent.                                                                                                                                  |
| 8 optional context  | DEFERRED by contract: no Neovim RPC/context transfer added.                                                                                                                                            |

## Definition-of-done audit

Source modules, runnable distribution, real interactive integration, lazy normal editor, persistent views, serialized lifecycle, bounded IPC, recovery, private tmux, safety/security regressions, deterministic provider tests, package install, measured performance and user/developer documentation are present. No production mocks, unimplemented stubs, disabled failing tests or broad cleanup bypasses are accepted. The repository remains uncommitted; no remote/global install/publication occurred.

The mandatory full terminal/platform acceptance gate is **not satisfied**. This prevents a full-completion or production-ready claim even though local implementation and deterministic verification pass. The non-goals (RPC, editor content upload, custom chat/provider/auth management, multiworkspace, native Windows, auto plugin/config migration) are intentionally satisfied by remaining outside MVP.

## Measurements and remaining environment work

The reproducible benchmark command is `npm run benchmark`. Record its actual final output with the release run; correctness tests do not assert noisy wall-clock thresholds. An earlier local optimization reduced live-view p95 from 161 ms (failed target) to 84.616 ms; that failed result was investigated, not relabeled. Final local run (Node26.9.0/macOS, 2026-09-23):

| Measurement                                       | Result             | Gate                                                                       |
| ------------------------------------------------- | ------------------ | -------------------------------------------------------------------------- |
| Controller prelaunch p95, 20 warm-cache processes | 63.673 ms          | PASS <250 ms                                                               |
| Full launch to Pi bridge ready p95                | 579.609 ms         | Recorded separately; includes Pi/extension and controller attach/bind work |
| Live-pane transition p95, 40 operations           | 85.774 ms          | PASS <100 ms                                                               |
| Controller idle CPU over 60.002 s                 | 0.275% of one core | PASS <1%                                                                   |

These are local measurements, not universal platform performance guarantees. Child redraw and child-process CPU are excluded as described in `Docs/Testing.md`.

To close remaining gates, follow every numbered step in `Docs/Testing.md` on the actual macOS emulator and on a Linux host and SSH connection, recording terminal/version/font/capabilities. Specifically verify native Ctrl+B and LazyVim Ctrl+H/J/K/L, Alt+Enter, physical F12, Ctrl+C/D/Z, actual mouse drag/click, bracketed paste, Unicode wide/combining glyphs, text clipboard/OSC52, 256-color/TrueColor, startup from a Neovim terminal, and narrow personal model-picker rendering. Images may remain explicitly unsupported per terminal. A live credentialed provider smoke is optional and was not performed.
