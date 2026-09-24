# PineVIM Product Improvement Plan

Audit date: 2026-09-23. Scope is the repository as inspected. This document is a plan only. It does not change product code.

Confidence labels used throughout:

- **Confirmed** — read directly in source or docs during this audit.
- **Likely** — strongly indicated by the implementation, not re-executed.
- **Needs verification** — plausible, or reported by a prior pass, and not re-checked here.

This plan absorbs defects D1–D15 already recorded in `.agents/pinevim-production-ui-ux-self-improving-harness-implementation-plan.md`. It does not restart that design. Skills stay experimental. Neovim stays the user's editor.

Tests were not executed. `npm test` builds `dist/`, and this audit stayed read-only aside from this file.

---

## 1. Executive Summary

PineVIM 0.1.0 (`pinevim-local`) is a private-tmux lifecycle and layout controller. Pi 0.87.1 owns chat, models, tools, authentication, and history. The user's normal Neovim owns buffers, plugins, undo, and terminal jobs. PineVIM owns panes, prefix keys, recovery, and an in-pane frame under `src/piui/`.

**Current state.** The harness MVP is implemented and locally evidenced. The in-pane frame (header, chip band, footer deck, turn-summary rules, six theme files, ASCII pine mark) is real. The product still reads as themed Pi plus status chrome, not as a finished agent workspace. Several of those chrome paths are dishonest or unreachable.

**Strongest existing aspects.**

- Exclusive workspace lock, token-authed Unix IPC, and editor-first quit.
- Prefix controls that keep working when Pi is busy or dead.
- A real lifecycle vocabulary (`idle` through `interrupted`) shared by the frame.
- Width-aware chrome, glyph-plus-word labels, and an ASCII fallback.
- Non-persistent theme application that does not rewrite Pi `settings.json`.
- A serious local test suite (unit, integration, security, stress) and explicit release gates.

**Biggest weaknesses.**

- The tmux status writer destroys styled text (`literal()` / `plain()`).
- `F12 m` is documented and unbound from the protocol (`menu` is not an intent).
- Help and status popups are truncated shell one-liners.
- The header mode can say `CHAT` while IDE is showing.
- Lifecycle, model, and context are repeated, then painted muted on the band and deck.
- `ui.theme: "auto"` does not apply a PineVIM theme.
- A user request is summarized once per Pi turn, and nothing answers "what changed?"
- Release is not cleared: Linux, SSH, and physical-key gates are open. There is no CI workflow.

**Biggest opportunities.** Make the control plane truthful. Give each fact one home. Treat a user request (a run) as the unit of progress. Show a file-change summary at settle without opening Neovim buffers. Apply the pine theme by default only when the user has not already chosen one.

**Proposed direction.** A calm, keyboard-first, two-plane workspace. Editor left, agent right, one tmux strip that stays true when the agent pane is hidden or dead. Persistent chrome is identity, current activity, and slow environment. Review and help are overlays. PineVIM does not become a Neovim distribution or a second agent runtime.

---

## 2. Current Product Assessment

### What it is

Confirmed from `README.md`, `package.json`, and `src/cli.ts`: PineVIM launches interactive Pi and, on demand, the caller's normal `nvim`, inside a private tmux server. It does not select the Git root. One controller may own a canonical workspace. Native Windows is outside MVP scope.

```text
pinevim [dir|--resume]
  src/cli.ts
    loadConfig + workspace lock + private runtime
    AppController.start
      ControlServer (Unix socket)
      installThemesToPi()          -> Pi user themes dir
      tmux: pi --extension
      prefix keys -> control/helper.js -> intents
    attach
      pane A: Pi + bundled extension + PiUi frame
      pane B: nvim (lazy split; env only; no RPC)
```

### Modes and geometry

Confirmed in `src/core/state.ts` and `src/core/layout.ts`:

| Mode | Meaning |
|---|---|
| `CHAT_ONLY` | Pi visible. Editor, if started, stays alive and hidden. |
| `IDE_WITH_AGENT` | Editor left, Pi right. |
| `IDE_FOCUS` | Editor full width. Pi stays running. |

- Fresh launch below 60×16 is rejected. Resize below that preserves children and shows guidance.
- Compact mode when columns &lt; 101 or rows &lt; 24: one pane, prefix then Tab switches focus.
- Default agent width: `clamp(round(0.35 × (columns − 1)), 40, 64)`, leaving the editor at least 60 columns.

### Commands and keys

Slash commands, confirmed in the extension and README: `/ide`, `/ide open`, `/ide close`, `/pinevim ide|agent hide|agent show|chat|status|help|quit`.

Default prefix `F12`, then: `i` IDE, `c` chat, `a` hide/show agent, `Tab` focus, `Left`/`Right` width, `r` retry, `q` quit, `s` status, `m` menu, `?` help, prefix twice forwards the prefix. Bindings live in `src/adapters/tmux/client.ts`. The `m` path does not work. See REL-002.

### Configuration and state

Optional file: `${XDG_CONFIG_HOME:-~/.config}/pinevim/config.json`. Nothing is created by default. Confirmed fields in `src/config.ts`: `prefix`, `agentRatio` (0.1–0.9), absolute `pi` / `nvim` / `tmux`, `logLevel` (`off`|`debug`), and `ui` `{ enabled, motion, glyphs, theme }`. Unknown fields are rejected. `PINEVIM_LOG_LEVEL` is the only env override.

State and opt-in logs: `${XDG_STATE_HOME:-~/.local/state}/pinevim/`. Runtime sockets, token, and identity live in a private directory. Logs are allowlisted controller events, rotated at 5 MiB.

### Neovim integration

Confirmed in `src/editor.ts`: the editor child is `/usr/bin/env -u NVIM -u NVIM_LISTEN_ADDRESS <nvim>`. PineVIM sets `PINEVIM=1` and does not install a plugin, statusline, or Msgpack client. Quit never types `:qa`. Unsaved-buffer restore after editor death is Neovim's problem. RPC context transfer is deferred (PINE-025 in `Docs/Implementation-Evidence.md` and the original plan).

### In-pane UI that actually installs

Confirmed in `src/piui/index.ts` `PiUi.install()`:

- Header via `setHeader` (`src/piui/components/header.ts`): ASCII pine, wordmark `pinevim`, workspace, session, mode, lifecycle.
- Footer deck via `setFooter` (`src/piui/components/deck.ts`).
- Chip band via `setWidget("pinevim", { placement: "aboveEditor" })` (`src/piui/components/band.ts`).
- Working indicator (`src/piui/glyphs.ts` frames; static when `ui.motion` is `off`).
- Turn-summary custom entries (`src/piui/renderers/turnSummary.ts`) on `turn_end`.
- Terminal title `pinevim`.
- Argument completion for `/ide` and `/pinevim` (`src/piui/completions.ts`).

Not installed, though present:

- `src/piui/components/composer.ts` (`PineComposer`). Comments still describe a composer frame. The band is the shipped substitute because Pi 0.87.1 does not expose `renderTopBorder`.
- `src/piui/renderers/cards.ts`. Formatters and a `ToolCardComponent` exist. `registerTool` override is intentionally not wired. The production plan disputes the "unsafe" premise and requires a parity spike (AGENT-003).
- `src/piui/renderers/markdown.ts` is a note. Markdown stays Pi's. Themes supply `md*` colors only.

### Themes

Six Pi theme JSON documents: `pinevim-dark`, `pinevim-light`, `pinevim-mono`, `pinevim-neon`, `pinevim-forest`, `pinevim-snow` in `src/piui/themes/`. `src/core/theme-install.ts` copies them into Pi's user themes directory before spawn so `/settings` → Theme can resolve them on the next launch. Failures are swallowed.

`ui.theme: "auto"` (the default) does **not** call `applyTheme`. Confirmed in `src/adapters/pi/extension.ts` and `src/piui/index.ts`: application runs only when the name is an explicit `pinevim-*`. `preferredThemeName()` in `src/piui/theme.ts` is tested and unused at runtime. Applying a `Theme` object (not a name) avoids writing Pi `settings.json`. That part is correct.

### Control plane chrome

`src/adapters/tmux/statusline.ts` and `styled.ts` build a segmented status line. `Tmux.status()` then passes it through `literal()` (`src/diagnostics.ts`), which maps every code point outside 32–126 to `?` and escapes `#`. tmux status styling is `#[fg=…]`, not raw SGR. Unit tests assert the renderer, not the write path.

Help and status popups: `Tmux.popup()` joins lines, slices to 900 characters, and runs `printf '%b' '…'; read -n 1` (`src/adapters/tmux/client.ts`). Status popup lifecycle is `s.busy ? "running" : "idle"` (`src/adapters/tmux/panels.ts`), not the nine-state lifecycle.

### Agent observations PineVIM can actually see

PineVIM does not own the agent loop. Observations come from Pi extension events inside the Pi process. The controller receives only what the bridge reports. `report()` is confirmed on `agent_start`, `model_select`, `session_info_changed`, and `agent_settled` only. There is no controller→bridge push except `shutdown`, so prefix layout changes never update in-pane mode.

### Explicit non-goals already in force

From `Docs/PineVim-Agent-Harness-Implementation-Plan.md` §7 and the README: no replacement editor, no agent-loop rewrite, no provider/auth layer, no custom terminal emulator, no automatic plugin install, no multi-agent or multi-workspace UI, no native Windows MVP, no buffer upload, no autonomous RPC editing, no promise of unsaved-buffer restore. The production UI plan additionally rejects a general command palette, PineComposer borders, markdown content transformers, and permission cards that pretend Pi has a per-tool approval API.

### Documentation and release

`Docs/Implementation-Evidence.md` records local functional coverage and withholds release. `Docs/Compatibility.md` leaves Linux, SSH, and physical keyboard/mouse/TrueColor/clipboard as open or partial. `Docs/Testing.md` lists `npm test`, phase0, transport, package, and benchmark scripts. There is no `.github/workflows/`. The npm package is private (`pinevim-local`). The original plan header still says the application is not implemented. That header is stale.

### Working tree

**Confirmed** at the end of this audit, via `git status --short`: modified `src/piui/themes/pinevim-forest.json` and `src/piui/themes/pinevim-snow.json`, plus this untracked `.cursor/` plan. `src/piui/components/composer.ts` and `src/core/theme-install.ts` are not untracked. The conversation-start snapshot that listed a larger dirty set is stale. Do not reset, clean, or commit those theme files as part of following this plan. They were already dirty.

---

## 3. Product Vision

PineVIM should feel like one workspace with two engines, not like a Neovim config that happens to launch a chat process.

**Look.** A small ASCII pine and the word `pinevim` identify the session. Color is pine, teal, and sand on dark or light, with neon and forest as explicit choices. Chrome is flat rules and chips, not boxes around every fact. Semantic color is rare: waiting, failure, and a nearly full context window. Everything else is quiet.

**Feel.** Keyboard-first. Dense enough for a 101×24 split, calm enough that a 15-tool run does not paint 15 banners. Motion is the existing working indicator, and `ui.motion: "off"` already exists for people who do not want it. No extra animation.

**Behavior.**

- The editor is the user's Neovim. PineVIM never configures LSP, completion, or git inside it.
- The agent pane is Pi. PineVIM frames it and records runs. It does not reimplement tools or markdown.
- The tmux strip is the heartbeat a person sees while typing in Neovim: workspace, view, lifecycle, and how to get help.
- A run (one user request through settle) is the unit of progress, files changed, and later learning.
- Help is one popup and one welcome line, not a wizard.
- Recovery stays explicit. PineVIM does not replay a prompt or a tool.

**Qualities to lock.**

| Quality | Choice | Why it matches what already exists |
|---|---|---|
| Density | Dense, hierarchical | Width bands in header, band, and deck already collapse |
| Motion | Calm | `ui.motion` defaults to on for a small indicator only |
| Posture | Editor-capable, agent-visible | Split layout is the product |
| Panels | Persistent chrome, contextual overlays | Help and status are already popups |
| Defaults | Opinionated, overridable in `config.json` | Strict schema is a strength |
| Agent model | One Pi session, one workspace | Multi-agent is an explicit non-goal |

---

## 4. Current Strengths

Preserve these. Do not rewrite them to chase a different product.

1. **Ownership split.** Pi owns the agent. Neovim owns the editor. PineVIM owns layout and lifecycle. `README.md` states this clearly, and `src/editor.ts` honors it.
2. **Prefix plane independence.** F12 bindings go through `control/helper.ts`, not through Pi's input. Layout still works while Pi is busy or dead.
3. **Safe quit and explicit retry.** Neovim must quit itself. Busy Pi asks for confirmation. Shutdown timeout restores `running` instead of killing Pi. Retry validates a session header and does not replay tools.
4. **IPC discipline.** Token auth, epoch, generation, bounded queue, no replay after reconnect. Logs are allowlisted. This is the right base for more telemetry, after REL-004.
5. **Lifecycle reducer.** `src/piui/lifecycle.ts` is one state machine with a tested precedence order. Chrome should keep rendering from it, not from parallel guesses.
6. **Glyph contract.** `src/piui/glyphs.ts`: every glyph has an ASCII twin, and a word always sits beside it. No emoji, no zero-width characters.
7. **Theme application safety.** `applyTheme` passes a Theme instance so Pi does not persist the choice. Keep that.
8. **Progressive width.** Header hides under 60 columns. Band hides under 40. Deck collapses under 60. Compact tmux mode is a real layout, not a scroll.
9. **Collision behavior.** A competing custom editor makes PineVIM stand down with a notice. Slash collisions fall back to `/pinevim` and the prefix. Keep standing down; fix the header/footer detection gap separately (REL-009 is about mode truth, not about overriding user extensions).
10. **Tests around the harness.** Integration tests use a synthetic HOME and a private tmux socket. Do not weaken that to "test the UI by eye."

---

## 5. Current Pain Points / Issues

### Control plane is not trustworthy

**D1 — Confirmed.** `renderStatus()` builds SGR and Unicode. `Tmux.status()` in `src/adapters/tmux/client.ts` stores `literal(message, 500)`. `plain()` maps ESC and every non-ASCII code point to `?`. tmux will not honor raw SGR in `status-left` anyway. The strip is the only PineVIM surface visible from Neovim, and it cannot currently carry the design.

**D2 — Confirmed.** `Tmux.bindings()` maps `m` to intent `menu`. `intents` in `src/core/state.ts` has no `menu`, so `parseRecord` rejects it. `Tmux.menu()` pushes `display-menu -T pinevim -t "" name value` with no command per item. Help text in `src/adapters/tmux/panels.ts` still advertises "command menu". A documented key does nothing useful.

**D3 — Confirmed structure, Linux behavior Needs verification.** `Tmux.popup()` slices the payload to 900 characters and runs `printf '%b' '…'; read -n 1`. SGR-heavy help can truncate. `read -n` is not POSIX; on dash the popup can exit immediately. Dynamic text that contains backslashes can be interpreted by `%b`.

**D12 — Likely.** `statusPanelLines` prints lifecycle from `s.busy` as `running` or `idle`. The in-pane reducer has nine states. The popup and the strip can disagree with the band even after D1 is fixed, until they share one telemetry record.

### In-pane state can lie or stall

**D13 — Confirmed.** `PiUi` mode starts from `PINEVIM_IDE` and `setMode` runs after slash `ide.open` / `chat` only (`src/adapters/pi/extension.ts`). Prefix `i` / `c` / `a` and controller reconcile do not push a view to the bridge. The header can say `CHAT` while the editor is on screen.

**D4 — Confirmed.** Mid-run lifecycle (`thinking`, `tooling`, `waiting`, `compacting`) is visible in the Pi pane and invisible to tmux, because `report()` does not fire on those events. A person in Neovim cannot see "needs you".

**D14 — Confirmed.** `Peer.receive` in `src/control/protocol.ts` closes the connection when `seen.size >= 1024`. `seen` is never pruned. Long sessions blip the bridge. Sending more telemetry before fixing this makes the blip common. Fix REL-004 before REL-006.

**D5 — Likely.** The production plan records reducer edges that this audit did not re-simulate: `promptEnd` returns `tooling` even when the prompt started from idle; `session_compact` forces `streaming`; `session_compact_failed` is unhandled; `messageUpdate` reports `thinking` if any thinking block exists; `toolsRun` resets per Pi turn. Treat as likely until a unit fixture is re-run. The reducer file's own comment claims a precedence order that these edges can violate.

**D8 — Confirmed.** `bandInfo()` sets `queued: this.ctx.hasPendingMessages() ? 1 : 0`. Three queued messages display as `1 queued`.

### Visual system does not read as one product

**D7 — Confirmed.** Lifecycle appears in the header, the band, the deck, and (when the strip works) tmux. Context, model, and thinking appear in both band and deck. `chipLine()` returns a joined string. `PineBand.render` and `PineDeck.render` wrap that string in `theme.fg("muted", …)`, so chip roles (`error`, `warning`, `accent`, `success`) are discarded. The header does style the lifecycle chip by role. The `ROLE` map is copied in header, band, and deck.

**D9 — Confirmed.** Default `auto` leaves whatever theme Pi already resolved. PineVIM's palette is opt-in, so a first launch often does not look like PineVIM. Theme application is attempted twice when a name is explicit. `styled.ts` hard-codes a truecolor palette unrelated to the active theme. `contextGauge()` always uses `▮▯`, ignoring `ui.glyphs: "ascii"`.

**D6 — Confirmed format, Likely annoyance.** `renderTurnSummaryLine` emits `─ turn N · tools · failed · duration · ctx ─` on every Pi `turn_end`. `turn N` is Pi's index, not the user's request. A long run prints many rules. That is noise in the transcript.

**D11 — Confirmed dead paths.** `composer.ts` is exported and unit-tested and never passed to `setEditorComponent`. `degraded` is always `null` in `deckInfo()`. `markdown.ts` is a comment. `assertPiApiSurface` / `probePiApiSurface` duplicate `probeHooks` (per the production plan; spot-check this audit confirmed the install path uses `probeHooks`). `panelHelperActions` exists beside a protocol that cannot carry `menu`.

**Conflict detection — Confirmed incomplete.** `installUi` sets `conflict` from `getEditorComponent()` or `false`. The comment admits header/footer have no getters. Another extension's header can be overwritten. Last-writer-wins is documented as acceptable for registration order; it is still a product hazard.

### Agent work is hard to scan

There is no run object. Tool presentation is stock Pi. `cards.ts` is unused. Nothing aggregates files touched by `edit` / `write` or a diff stat at settle. Waiting for the user is a chip string (`needs you (kind)`), which is honest, and it is easy to miss because the band is muted and tmux does not hear it.

**D15 — Confirmed absence.** Pi 0.87.1, as used here, does not give PineVIM a per-tool approval flow to render. A card that says "waiting for approval" for ordinary tool calls would be false.

### Identity, docs, and release

User-facing strings mix `pinevim`, `PineVim`, and `PineVIM` (header wordmark, extension notices, tmux panel titles).

`Docs/PineVim-Agent-Harness-Implementation-Plan.md` still forbids `setHeader` / `setFooter` and says the app is not implemented. README and `.github/copilot-instructions.md` amend that contract. `Docs/Implementation-Evidence.md` does not record `src/piui/` or the theme files written under Pi's agent directory. `Docs/Compatibility.md` still describes an ASCII-safe status strip as if that were the intended end state. Evidence claims and the dead composer/cards modules disagree about "no unimplemented stubs."

Release gates in Compatibility and Evidence remain open. Benchmarks in Evidence (local macOS p95 startup and idle CPU under target) are not a universal performance claim. **Needs verification** on Linux and SSH.

### What is not a pain point

Neovim LSP, completion, and git are absent from this repo because they are the user's. That is a boundary, not a missing feature. Do not "fix" it by vendoring a distribution. See section 10 and section 24.

---

## 6. UI/UX Improvements

### UX-001 — One home per fact

**Priority:** P1. **Effort:** Medium. **Type:** UX.

**Observed:** `src/piui/components/header.ts`, `band.ts`, `deck.ts`, and `src/adapters/tmux/statusline.ts`.

**Current behavior:** Mode and lifecycle render in the header. Mode, lifecycle, queue, gauge, model, and thinking render in the band. Lifecycle, gauge, model, thinking, branch, and `F12 ?` render in the deck. The tmux line attempts another copy.

**Issue:** The eye cannot tell which line is authoritative. Duplicates drift, which is already happening (D13, D4, D12).

**Recommendation:** Assign one primary surface to each fact.

| Fact | Primary | Mirror | Never |
|---|---|---|---|
| Workspace, session, view mode | Header | Status popup | Band, deck |
| Lifecycle, current tool, queue, needs-you | Band | tmux strip, because the band is invisible from Neovim | Header, after ARCH-001 |
| Context, model, thinking, git branch, key hint | Deck | — | Band, except a short gauge when the deck is collapsed (&lt;60 cols) |
| Pane health, versions, slash collision | Status popup (`F12 s`) | — | Header |

**Why it matters:** Trust. A professional tool does not show two different answers for "what mode am I in?"

**Implementation direction:** Change `HeaderInfo` to drop `lifecycle` once view push exists. Change `BandInfo` to drop model and thinking at widths where the deck is visible (≥60). Keep a single-line merge under 60 columns in the deck only. Update `tests/unit/piui.test.ts` for the new bands.

**Impact:** Less chrome, faster scanning, one place to fix when a fact is wrong.

**Dependencies / risks:** Do this with ARCH-001. If the header loses lifecycle before mode updates are pushed, the header becomes a stale mode chip with no activity signal. The tmux mirror must use the same telemetry record as the band (REL-006), or the mirror will lie.

**Acceptance criteria:** At ≥80 columns, lifecycle text appears in the band and the tmux strip only. Model name appears in the deck only. Header render tests show workspace and mode, not a second lifecycle label. Narrow-width tests still show lifecycle somewhere on the Pi pane.

### UX-002 — Paint chip roles

**Priority:** P1. **Effort:** Small. **Type:** UX.

**Observed:** `chipLine()` in `src/piui/chips.ts` returns a `string`. `PineBand.render` and `PineDeck.render` call `style("muted", chipLine(...))`.

**Current behavior:** Roles are computed (`error`, `accent`, `warning`, `success`) and then discarded on the two surfaces people watch during a run. The header styles its lifecycle chip correctly.

**Issue:** Failure and "needs you" look like the model name.

**Recommendation:** Style each chip before joining. Idle and model stay `muted`. Waiting uses `accent`. Error uses `error`. Interrupted and context ≥75% use `warning`. Context ≥90% uses `error`. Do not color the entire line.

**Why it matters:** Color is the escalation channel. If everything is muted, escalation does not exist. This matches the production principle "quiet by default, loud on need."

**Implementation direction:** Add `styledChipLine(chips, width, style, sep)` next to `chipLine`, or have `chipLine` return the chips that fit and let the component map roles. Delete the duplicated `ROLE` objects by importing one map. Keep `chipLine` for tests that assert text. Add a unit test that the waiting chip is not wrapped in the muted styler. A fake theme that records the role argument is enough. No snapshot images required.

**Impact:** Errors and prompts become visible without new UI.

**Dependencies / risks:** Low. SGR inside a chip must not be counted as width. `fit()` already counts code points on plain text; style after fit, not before.

**Acceptance criteria:** A waiting lifecycle chip and an error chip take different theme roles in band and deck renders. A muted model chip stays muted. Width dropping still removes tail chips first.

### UX-003 — Real queue count

**Priority:** P1. **Effort:** Small. **Type:** UX. See REL-007.

**Observed:** `src/piui/index.ts` `bandInfo()`.

**Current behavior:** `hasPendingMessages() ? 1 : 0`.

**Issue:** The chip claims a count it does not have.

**Recommendation:** If Pi exposes a count, show it. If it exposes only a boolean, label the chip `queued`, with no number.

**Why it matters:** A wrong number is worse than no number.

**Implementation direction:** Check the Pi 0.87.1 context type used by `hasPendingMessages`. Branch in `queueChip`. Test both shapes with a stub context.

**Impact:** The queue hint becomes honest.

**Dependencies / risks:** Pi API surface. Add the chosen call to the compatibility probe.

**Acceptance criteria:** Three pending messages never render as `1 queued`. Zero messages omit the chip.

### UX-004 — First-run welcome, once

**Priority:** P2. **Effort:** Small. **Type:** Onboarding. See ONBOARD-001.

**Observed:** No custom empty state. First paint is stock Pi plus chrome. `/pinevim help` opens the popup.

**Current behavior:** A new user sees a chat transcript and must already know F12.

**Issue:** Discoverability ends at a key the user may not know, and that key's menu entry is broken.

**Recommendation:** On the first session for a workspace, append one custom entry, not a modal: `type to work · F12 ? keys · /pinevim help`. Store a marker in the private workspace state, not in the repo and not in Pi settings.

**Why it matters:** One line teaches the three planes. It does not nag on every launch.

**Implementation direction:** Follow the turn-summary pattern (`appendEntry` + entry type `pinevim.welcome`). Gate on a flag in the controller metadata for that workspace. Do not inject it into the model context.

**Impact:** First session is self-explanatory. Later sessions stay quiet.

**Dependencies / risks:** Must not fire again after `--resume`. Must not appear in RPC/print mode.

**Acceptance criteria:** First TUI session for a fresh workspace state shows the line once. Second session does not. The entry type is not sent to the model (same rule as turn summaries).

### UX-005 — Error copy names the next action

**Priority:** P2. **Effort:** Medium. **Type:** UX.

**Observed:** `safeError()` in `src/diagnostics.ts`. `Tmux.notify` prefixes `pinevim error:` / `pinevim warning:`. Extension install failures already include a sentence and "Prefix controls are unaffected."

**Current behavior:** Controller failures become a toast. Pi failures become an `error` chip. The two vocabularies are unrelated. Popups and toasts do not share a code list.

**Issue:** "Operation failed; processes are preserved" is safe and vague. Repeated failures do not say whether to `--resume`, change the prefix, or fix a dependency.

**Recommendation:** A short taxonomy, one surface each. Do not invent a notification center.

| Class | Surface | Next action in the text |
|---|---|---|
| Layout did not converge | toast, warning | Previous view kept. Resize or prefix Tab. |
| Bridge down, Pi alive | tmux strip + toast once | Prefix still works. `--resume` if it persists. |
| Pi dead | tmux strip + status popup | Prefix `r` after confirmation. |
| Editor exited | status popup | `/ide` starts a new editor. Unsaved buffers are not restored. |
| UI failed to install | Pi notify, once | Stock Pi. Prefix unaffected. |
| Theme copy failed | log only | Session continues. `/settings` theme list may omit PineVIM themes. |
| Dependency missing | launch error, already gated | Name the tool and the required version. |

**Why it matters:** Recovery is already designed. The words should point at it.

**Implementation direction:** Map `PineError.code` to a sentence in one module used by `notify`. Do not put paths, tokens, or prompts in the sentence. `safeError` stays the fallback.

**Impact:** Failures become operable.

**Dependencies / risks:** Copy must stay inside `literal()` length limits until REL-001 lands. Do not include exception stacks.

**Acceptance criteria:** Each code in the table has a test that the user-facing string contains the named next action and does not contain `process.env` values.

---

## 7. TUI Improvements

### TUI-001 — Frame layout (with UX-001)

**Priority:** P1. **Effort:** Medium. **Type:** TUI.

**Observed:** Wide Pi pane today, top to bottom: header (logo, mode, lifecycle), Pi transcript, band (mode, lifecycle, queue, gauge, model, thinking), stock composer, deck (lifecycle, then gauge, model, thinking, branch, keys).

**Issue:** Three status lines and a transcript. Activity has no single row.

**Recommendation:** Target frame at ≥80 columns:

```text
 /\  pinevim                 IDE
/||\ · ~/src/api · session

  (Pi transcript, including one run-ledger rule per user request)

  ● tooling · bash · 12s · 2 queued
  ------------------------------------------------ composer (Pi)
  ▮▮▮▮▯▯▯▯ 42% · claude · think med · main · F12 ?
```

tmux status, visible from both panes:

```text
 api · IDE · ● tooling · F12 ?
```

Under 60 columns, header hides (already), band hides (already), deck becomes one line: lifecycle + gauge.

**Why it matters:** This is the whole product surface. Hierarchy is the design.

**Implementation direction:** Implement as UX-001 plus AGENT-001. Do not add a third tmux pane. Do not draw borders around the band; the band is already a flat widget, which is the right weight.

**Impact:** The pane reads as a product frame around Pi.

**Dependencies / risks:** Pi's own footer widgets can collide. Keep the deck as `setFooter` and accept Pi's last-writer-wins, with the existing stand-down for a custom editor.

**Acceptance criteria:** Render tests for ≥80, 60–79, and &lt;60 match the homes in UX-001. No new permanent pane.

### TUI-002 — Replace the popup shell

**Priority:** P0. **Effort:** Medium. **Type:** TUI. See REL-003.

**Observed:** `Tmux.popup()` in `src/adapters/tmux/client.ts`.

**Current behavior:** `display-popup -E` runs `printf` and `read -n 1`. Width and height are capped. Payload is sliced to 900 characters. Help rows in `panels.ts` are styled with SGR before that slice.

**Issue:** Help can truncate. Linux dash can dismiss the popup immediately (**Needs verification** on a dash host). `%b` interprets escapes.

**Recommendation:** The controller writes the panel text to a private file in the runtime directory (mode 0600). `display-popup -E` runs `node helper.js` (or a tiny viewer already in the package) that prints the file and waits on a single stdin byte using Node, not `read -n`. Content is plain or tmux-safe. No `printf '%b'`.

**Why it matters:** `F12 ?` and `F12 s` are the discoverability system. They have to open and stay open.

**Implementation direction:** Reuse `helpPanelLines` / `statusPanelLines` to build the file body. Cap lines (for example 24) with an explicit "truncated" row rather than a silent byte slice. On popup failure, keep the existing `notify` fallback.

**Impact:** Help works on macOS and Linux. Status can grow to include telemetry without hitting 900 bytes of SGR.

**Dependencies / risks:** The viewer must not take a shell string from outside the runtime dir. Path is controller-owned. Quote with the existing `tmuxQuote` helper.

**Acceptance criteria:** A unit test builds a help body longer than 900 characters and asserts the file contains the last key row. An integration test runs `display-popup` against the private tmux and reads the pane content, or asserts the argv contains the node viewer and not `read -n`. A dash `/bin/sh` is not required for the wait.

### TUI-003 — Menu that actually dispatches

**Priority:** P0. **Effort:** Small. **Type:** TUI. See REL-002.

**Observed:** `menuEntries()` in `panels.ts` returns labels and intent names. `Tmux.menu()` does not turn those into tmux commands. The intent `menu` is not in `intents`.

**Recommendation:** Stop sending intent `menu`. Each `display-menu` item runs the helper with an existing intent (`ide.open`, `chat`, `agent.toggle`, `retry`, `status`, `help`, `quit`). Item form is `name`, `key`, `command` per tmux `display-menu`.

**Why it matters:** The help popup advertises a menu. Shipping a dead key is a product defect, not a missing feature.

**Implementation direction:** Either drop `m` until the argv is correct, or fix it in the same change. Prefer fix. Add `menu` to the protocol only if something still needs that intent. The cleaner design is "menu is tmux UI, items are existing intents." Delete the unreachable `intent === "menu"` branch in `src/core/controller.ts` if nothing sends it.

**Impact:** `F12 m` becomes a discoverable form of keys people already have.

**Dependencies / risks:** tmux menu syntax differs by version. Runtime floor is 3.5. Test against the local tmux and record the version in Compatibility. Keep the item list ≤ 8, as the code already slices.

**Acceptance criteria:** A test asserts argv contains a helper command for `ide.open` and does not contain the bare word `menu` as an intent. Pressing the menu key in `tests/terminal/transport.py`, if that harness can send the prefix, focuses or at least does not log a protocol reject. If transport cannot send the key, say so and cover argv only.

### TUI-004 — Status strip the editor can read

**Priority:** P0 for the writer, P1 for the content. **Effort:** Medium. **Type:** TUI. See REL-001 and THEME-002.

**Observed:** `src/adapters/tmux/styled.ts` emits raw SGR. `Tmux.status()` runs `literal()`.

**Recommendation:** A dedicated writer. Static decoration uses tmux formats (`#[fg=colourN,bg=default]`). Dynamic fields (workspace name, session) pass through `plain()` only. Glyphs in the strip are ASCII (`*`, `!`, `?`) so `plain()` does not turn them into `?`. Palette is a short named set, not the full Pi theme. See THEME-002.

**Why it matters:** This line is how PineVIM exists while the user is in Neovim.

**Implementation direction:** Split `statusLine()` text from `statusFormat()`. Test the string that `set-option status-left` receives, not only the pre-literal renderer. Add an integration read-back of `show-options -g status-left`.

**Impact:** The strip is readable. It can show `needs you` once telemetry exists.

**Dependencies / risks:** TrueColor `#[fg=#rrggbb]` is not safe on the open terminal matrix. Use `colour0`–`colour255` or named colors. 16-color terminals get the no-color ASCII variant.

**Acceptance criteria:** The value passed to `set-option` contains no ESC byte. It contains `#[fg=` or, in no-color mode, no style tokens. A workspace name with `#` and a newline cannot break the format. Read-back in integration matches the writer output.

### TUI-005 — Run ledger line in the transcript

**Priority:** P1. **Effort:** Large. **Type:** TUI. See AGENT-001.

**Observed:** `turn_end` appends `pinevim.turn_summary`.

**Recommendation:** One custom entry per user run, at settle:

```text
─ run 4 · 38s · 5 tools · 0 failed · 3 files +42 −7 · ctx 51% ────
```

Keep rendering old `pinevim.turn_summary` entries so existing sessions do not break. Stop appending new ones once the ledger ships.

**Why it matters:** Users think in requests. Pi turns are model calls. Fifteen rules per request bury the transcript.

**Implementation direction:** New entry type `pinevim.run`. Data from the lifecycle counters accumulated across turns until `agent_settled`, plus AGENT-002 file stats. Renderer reuses `renderTurnSummaryLine` patterns and `g.rule`.

**Impact:** The transcript gains a scannable spine without replacing Pi's tool UI.

**Dependencies / risks:** Defining "run" wrongly will under- or over-count. Use `agent_start` → `agent_settled` as the production plan specifies. Compaction mid-run must not close the run (**Likely** edge; cover with a fixture).

**Acceptance criteria:** A fixture with three `turn_end` events and one `agent_settled` appends one `pinevim.run` and zero new turn summaries. An old turn-summary entry still renders.

---

## 8. Theme & Visual System Improvements

### THEME-001 — Default theme when the user has not chosen

**Priority:** P1. **Effort:** Small. **Type:** Theme.

**Observed:** `preferredThemeName()` in `src/piui/theme.ts`. Call sites in `extension.ts` and `PiUi.install()` skip `auto`.

**Current behavior:** `ui.theme: "auto"` keeps Pi's resolved theme. PineVIM themes are installed on disk and listed in `/settings`, and they are not applied.

**Issue:** The product's palette is invisible on a default install. First impression is stock Pi with a pine header.

**Recommendation:** If `auto` and the active theme is still a Pi built-in default, apply `pinevim-dark` or `pinevim-light` from the terminal color scheme via `preferredThemeName`. If the active theme is anything else, including an explicit PineVIM theme the user picked, leave it. Never pass a theme name string to `setTheme` if that writes `settings.json`. Keep passing the Theme object.

**Why it matters:** Identity without stealing a choice the user already made.

**Implementation direction:** One call site, not two. Remove the duplicate `applyTheme` in the `setImmediate` install or make it a no-op when already applied. Log a debug event on failure. Do not notify on success.

**Impact:** New sessions look like PineVIM. Existing custom Pi themes stay.

**Dependencies / risks:** Must confirm, against Pi 0.87.1, which theme names count as "built-in default" (likely `dark` and `light`). If that list is wrong, auto will override a user. Ship the list in the compatibility probe. **Needs verification** of the exact default names in the installed package types.

**Acceptance criteria:** Config `auto` plus current theme `dark` applies `pinevim-dark` as an object. Config `auto` plus current theme `my-theme` applies nothing. Config `pinevim-forest` applies forest once. `settings.json` mtime does not change in the fixture.

### THEME-002 — One palette, two emitters

**Priority:** P1. **Effort:** Medium. **Type:** Theme.

**Observed:** Pi theme JSON uses keys such as `accent`, `success`, `error`, `warning`, `muted`, `text`, `border`, tool and markdown and syntax slots. `styled.ts` uses a separate truecolor map.

**Issue:** Light and snow themes cannot restyle the tmux strip. Mono collapses success and error if the strip depends on color. 16-color and SSH terminals are an open compatibility gate.

**Recommendation:** A tiny token module, not a design-system package.

| Token | Pi theme key | tmux (256-color) | No-color |
|---|---|---|---|
| accent | `accent` | a fixed colour index approximating pine/teal | plain |
| text | `text` | white or black by scheme | plain |
| muted | `muted` | colour 245 or similar | plain |
| warning | `warning` | colour 178 | prefix `!` |
| error | `error` | colour 167 | prefix `x` |
| success | `success` | colour 71 | prefix `+` |

The tmux indices do not have to color-match every theme. They must stay legible on dark and light. In-pane components keep using `theme.fg(role)`.

**Why it matters:** The strip and the pane should look related. They cannot share SGR, because tmux will not render Pi's SGR in `status-left`.

**Implementation direction:** Replace raw SGR in `styled.ts` with `#[fg=colourN]` builders used only by the status writer (TUI-004). Popup bodies can stay simpler once they are a Node viewer: use the same tokens or plain text. Do not read the live Pi theme from tmux. The controller does not have it.

**Impact:** Status survives 256-color terminals. Light mode is not a strip of bright-on-bright truecolor.

**Dependencies / risks:** Hard-coding indices will look slightly off next to `pinevim-neon`. That is acceptable. Do not parse theme JSON inside the tmux adapter on every status update.

**Acceptance criteria:** Status format uses `colourN` or no color. No `#rrggbb` in the default writer. A test toggles no-color and expects ASCII prefixes and no `#[fg=`.

### THEME-003 — Mono and ASCII still carry meaning

**Priority:** P2. **Effort:** Small. **Type:** Theme.

**Observed:** `pinevim-mono.json` collapses semantic colors. `contextGauge` always emits `▮▯`. Lifecycle glyphs already have ASCII twins. The gauge does not.

**Issue:** Mono and `ui.glyphs: "ascii"` fail the project's own rule that state is readable with color and with Unicode stripped.

**Recommendation:** Do not add color back into mono for decoration. Keep glyph plus word (already true for lifecycle). Add an ASCII gauge (`####---- 42%` or `42%` alone under a narrow width). In mono, error and waiting still differ by word (`error`, `needs you`), which they will once UX-002 stops painting them the same muted color. If mono's `error` and `text` are the same hex, the word is the signal. Document that.

**Why it matters:** Structure over color is already a project rule. The gauge breaks it.

**Implementation direction:** `contextGauge(percent, width, glyphs)` chooses the cell characters. Test ASCII mode for absence of `▮`.

**Impact:** SSH and ASCII users see the same facts.

**Dependencies / risks:** None beyond the chip width budget. An ASCII gauge is wider per cell only if you use multi-character cells. Use one character per cell.

**Acceptance criteria:** `glyphs: "ascii"` unit test shows no `▮` or `▯` in band output. Mono theme JSON still loads. Error label remains the word `error`.

### THEME-004 — Component consistency pass

**Priority:** P2. **Effort:** Small. **Type:** Theme.

**Observed:** Separator in the pane is `"  ·  "`. Tmux ASCII path uses `" | "` (per `styled.ts` / statusline comments). Deck comment mentions rows; `render` checks width only (`width >= 60`).

**Recommendation:** One separator helper. Fix the deck comment or implement the row check if a short terminal with huge columns is a real case. **Likely** the comment is simply wrong. Width-only is the right behavior for a footer; correct the comment.

**Why it matters:** Comments that contradict code cause the next change to "fix" the wrong thing.

**Implementation direction:** Comment edit plus a shared `SEP` constant in `chips.ts`. No visual redesign.

**Impact:** The next contributor does not reintroduce a row check that hides the footer on a short, wide terminal.

**Dependencies / risks:** None.

**Acceptance criteria:** Comment matches `width >= 60`. Separator string is defined once.

---

## 9. Branding / Logo / Product Identity

### BRAND-001 — One name, three jobs

**Priority:** P2. **Effort:** Small. **Type:** Branding.

**Observed:** Header wordmark is `pinevim` (`src/piui/logo.ts` `titleBrand()`). Notices say `PineVim UI unavailable`. Panel titles say `PineVIM keys` and `PineVIM workspace`. Package description says `PineVim`. README title is `PineVim`.

**Issue:** Three capitalizations read as three products.

**Recommendation:**

| Use | Form | Example |
|---|---|---|
| Prose, notices, docs | PineVim | `PineVim UI stood down.` |
| Command, binary, title, wordmark | `pinevim` | title `pinevim`, `/pinevim` |
| Panel headings | `pinevim` | ` pinevim keys ` |

Do not introduce `PineVIM` in new strings. Update existing panel titles and README headings in the docs pass (DOC-001). Do not rename the npm package in this pass. `pinevim-local` is an unpublished name and the README already says the namespace is undecided.

**Why it matters:** The wordmark is already good. Inconsistent chrome makes the frame feel bolted on.

**Implementation direction:** Grep user-facing string literals. Leave protocol field names and file names alone.

**Impact:** Notices, popups, and the header sound like one product.

**Dependencies / risks:** Tests that assert `PineVIM` in panel fixtures must move with the copy.

**Acceptance criteria:** `helpPanelLines` and `statusPanelLines` headings use `pinevim`. Extension notices use `PineVim`. `titleBrand()` stays `pinevim`.

### BRAND-002 — Keep the ASCII pine

**Priority:** P3. **Effort:** Small. **Type:** Branding.

**Observed:** `TREE_CROWN = " /\\ "` and `TREE_BASE = "/||\\"` in `src/piui/logo.ts`. Header paints both lines in `accent` at ≥80 columns, and the crown only at 60–79. The mark is one cell per glyph. Alignment math in the header depends on that.

**Recommendation:** Do not replace it with a bigger banner, a six-line splash, or an image logo. Optional later: a one-line crown for the tmux status (`/\`) if it survives `plain()`. It is not required for identity. The word `pinevim` on the strip is enough.

**Why it matters:** The mark is already distinctive and terminal-safe. A new logo would spend effort the control plane still needs.

**Implementation direction:** No code, unless a status glyph is added in THEME-002. If added, it must be ASCII.

**Impact:** Identity stays stable while defects are fixed.

**Dependencies / risks:** Changing the tree width breaks header padding. Any edit needs the existing header fit tests.

**Acceptance criteria:** Logo strings and header tests stay green. No new asset files.

### BRAND-003 — Voice

**Priority:** P3. **Effort:** Small. **Type:** Branding.

**Observed:** Labels are terse: `needs you`, `think med`, `F12 ? keys`, `Safe quit`. That voice fits an ops console.

**Recommendation:** Keep it. Do not add marketing sentences to the band. Welcome copy (UX-004) stays one line. Errors gain a next action (UX-005) without becoming paragraphs.

**Why it matters:** Personality is already there. Softening it would add noise.

**Implementation direction:** Apply the voice when writing new strings in Phases 0–2. No separate code change.

**Impact:** New UI does not sound like a different product.

**Dependencies / risks:** None.

**Acceptance criteria:** New user-visible strings in the Phase 0–2 diff are label-length, except the single welcome line and error sentences that name one action.

---

## 10. Neovim IDE Improvements

PineVIM does not configure Neovim. `src/editor.ts` builds an argv. The user's `init.lua`, LSP, formatter, and plugins start as they always do. Recommending a plugin stack would violate the product contract and duplicate the user's setup.

### IDE-001 — Document the seam

**Priority:** P2. **Effort:** Small. **Type:** Documentation. Also listed as DOC-002.

**Observed:** README explains `PINEVIM=1`, preserved `NVIM_APPNAME`, and removed remote-editor variables. It does not give a user a short "what you configure versus what PineVIM configures" contract.

**Current behavior:** People coming from a Neovim distribution will look for a statusline, which-key group, and LSP setup, and will not find them. That absence looks like an unfinished IDE if the docs do not claim it.

**Issue:** The product is easy to misread as a distro.

**Recommendation:** A short section in the README:

- PineVIM sets `PINEVIM=1` and the workspace cwd.
- Your Neovim config owns LSP, completion, diagnostics, formatting, git UI, test runners, and debugging.
- Keys PineVIM will not take: Pi Ctrl+L, Neovim Ctrl+H/J/K/L, Ctrl+C to the focused child. The prefix defaults to F12 so those stay free.
- PineVIM will not install plugins or run a package-manager sync.
- If you want a visual hint inside Neovim, read `PINEVIM` yourself. PineVIM will not ship that hint in your config.

**Why it matters:** The IDE experience is "your IDE, beside an agent, with a shared status strip." Saying that prevents a plugin shopping list.

**Implementation direction:** Docs only, in DOC-001. No `lua/` directory.

**Impact:** Evaluators stop expecting LazyVim inside this repo.

**Dependencies / risks:** None.

**Acceptance criteria:** README states the seam in one section. The repository still has no Neovim config that runs on user startup.

### IDE-002 — Cross-pane awareness without RPC

**Priority:** P1. **Effort:** Medium. **Type:** Neovim IDE, via the tmux strip.

**Observed:** While the editor is focused, the Pi pane is hidden in `IDE_FOCUS` and merely unfocused in the split. The only PineVIM pixels in the editor view are the tmux status line, and that line is currently broken (D1).

**Issue:** The integrated-environment advantage is invisible exactly when the user is editing.

**Recommendation:** Make the strip the IDE integration (TUI-004, REL-006): workspace, `IDE` or `CHAT`, lifecycle including `needs you`, and the prefix hint. Do not inject a Neovim statusline.

**Why it matters:** This is the feature a separate terminal and a separate editor cannot do as cheaply. The agent heartbeat stays on screen.

**Implementation direction:** No Neovim code. Controller status updates on telemetry. Coalesce (PERF-001).

**Impact:** Editing and agent work share one status line.

**Dependencies / risks:** Depends on REL-001 and REL-006. A noisy strip (update on every token) will flicker. Coalesce to lifecycle transitions and a 1s activity tick at most.

**Acceptance criteria:** With the editor focused, a fixture that moves lifecycle to `waiting` changes `status-left` to a string containing `needs you` or the ASCII equivalent, without an ESC byte.

### IDE-003 — Leave editor features to the user

**Priority:** P3 as an explicit non-build. **Effort:** None. **Type:** Neovim IDE.

**Observed:** No LSP client, no telescope, no gitsigns, no DAP, no test runner in this repo.

**Recommendation:** Do not add them. If a later product generation wants "open this file at this line," that is the deferred RPC phase (PINE-025), and it needs its own design for modified buffers and user keymaps. It is not part of the sequence in section 25.

**Why it matters:** A second editor config would fight the user's and expand the security story (PineVIM would then own editor automation).

**Implementation direction:** None.

**Impact:** Scope stays shippable.

**Dependencies / risks:** Pressure to "make it an IDE" during Phase 4. Resist it.

**Acceptance criteria:** Phase 4 diff contains no `nvim` plugin files and no `--cmd` / `-c` editor arguments beyond what `editor.ts` does today.

---

## 11. Agent Harness Improvements

### AGENT-001 — The run is the unit

**Priority:** P1. **Effort:** Large. **Type:** Agent UX.

**Observed:** `src/piui/lifecycle.ts` resets tool counters on the Pi turn. `turnSummary.ts` writes one rule per turn. There is no `src/piui/runs.ts`.

**Current behavior:** Counters and transcript anchors follow model calls.

**Issue:** A user cannot see one task's duration, tool count, failures, and outcome. They see a stack of turn rules (D6).

**Recommendation:** A run starts at `agent_start` and closes at `agent_settled`. The ledger entry (TUI-005) records duration, tools, failures, interrupted flag, context percent, and outcome (`done`, `failed`, `interrupted`, `needs you` if it settled while waiting — only if that transition is actually observable).

**Why it matters:** Every later feature (diff summary, review, skills) needs this object. Building them on turn summaries will be wrong.

**Implementation direction:** Pure reducer beside `lifecycle.ts`, unit-tested without Pi. The extension feeds events. Persist as a custom entry, not in the controller log (logs must not gain transcript text). File paths, if included, are counts in the log and paths only in the session entry. Follow the privacy rule already in the README: logs stay allowlisted.

**Impact:** One spine line per request.

**Dependencies / risks:** Pi event ordering. Cover start/settle, settle without start, and overlapping starts with fixtures. Do not close a run on `turn_end`.

**Acceptance criteria:** Fixtures in `tests/unit/piui.test.ts` for the transitions above. No prompt text in `controller.log` events.

### AGENT-002 — What changed

**Priority:** P1. **Effort:** Medium. **Type:** Agent UX.

**Observed:** Theme tokens include `toolDiffAdded` and `toolDiffRemoved`. `cards.ts` has an unused `formatDiffstat`. No code records paths from tool calls.

**Current behavior:** Diffs render inside Pi's tool widgets, one call at a time. Nothing sums the run.

**Issue:** After a run, the user hunts the transcript for writes.

**Recommendation:** At settle, record paths from `edit` and `write` tool events observed during the run, plus a bounded `git diff --numstat` via the existing process helpers if the workspace is a git repo. Ledger suffix: `3 files +42 −7`. If git fails, show the tool-path count only. Do not open those files in Neovim.

**Why it matters:** The editor and the agent share a directory. The cheapest "review" is a count and a list, not an RPC jump.

**Implementation direction:** Allowlist tool names. Cap the path list (for example 20) and the numstat bytes. Never pass commit messages or file contents into the ledger line. `pi.exec` or a small `git` argv with the workspace cwd, no shell. If the production plan's `pi.exec` assumption fails the probe, spawn `git` from the controller only when the bridge reports paths. Prefer the extension, so the controller does not learn file contents.

**Impact:** Settle tells you whether the tree moved.

**Dependencies / risks:** Dirty trees that the user edited themselves will appear in `git diff`. Label the line `worktree` rather than `agent wrote` when the source is numstat. Label `tools` when the source is edit/write names. Do not claim "the agent changed these" unless the path came from a tool event.

**Acceptance criteria:** A fixture run with two write events renders `2 files` from tool paths. A git failure still renders the tool count. No file contents in the entry.

### AGENT-003 — Tool cards only after a parity spike

**Priority:** P2. **Effort:** Medium for the spike, Large to ship. **Type:** Agent UX.

**Observed:** `src/piui/renderers/cards.ts` documents a one-line card anatomy and states that `registerTool` on a built-in name would replace Pi's tool and drop abort controllers. The production plan says Pi's own built-in renderer example shows a delegation pattern, and that parity is unproven (D10).

**Issue:** The transcript is still stock Pi. That may be correct. Shipping cards that break bash abort would be a serious regression.

**Recommendation:** A time-boxed spike, not a default implementation. Prove, on Pi 0.87.1, whether a custom renderer can wrap the built-in and keep session tool options, spawn hooks, and the mutation queue. If yes, ship one-line collapsed cards (glyph, tool, primary arg, counts, duration) and leave expansion to Pi's existing key. If no, delete the unused component or keep it unused behind a comment that records the spike result, and let the run ledger be the scan surface.

**Why it matters:** Scanability matters. So does not breaking tools.

**Implementation direction:** Spike notes go in `Docs/Compatibility.md`, not a new markdown novel. Tests use the fixture provider, not a live model.

**Impact:** Either the transcript becomes scannable, or the team stops planning as if cards are free.

**Dependencies / risks:** Pi upgrade. The pin is exact `0.87.1` (`src/adapters/pi/compatibility.ts`). Any renderer hook must be in the probe.

**Acceptance criteria:** Spike document states pass or fail with the hook name. On fail, no `registerTool` call for built-ins is merged. On pass, an integration test aborts a bash tool through Pi's normal path.

### AGENT-004 — Review overlay, after the ledger

**Priority:** P3. **Effort:** Large. **Type:** Agent UX.

**Observed:** No overlay module. Pi `ctx.ui.custom` is the extension point the production plan names.

**Recommendation:** `/pinevim review` lists the current run's paths and numstat in an overlay. Keys: `j`/`k`, `q` dismiss. It does not open Neovim. It does not stage or commit.

**Why it matters:** A list is the useful review step that does not require RPC.

**Implementation direction:** Build only after AGENT-001 and AGENT-002. One overlay component, reused later by skills. Empty state: `No file changes recorded for this run.`

**Impact:** Review without leaving the keyboard or pretending to be a merge tool.

**Dependencies / risks:** Overlay focus can steal Pi keys. Restore focus on dismiss. Do not ship this in Phase 2 if the ledger line already shows the count. The line is the P1. The overlay is the P3.

**Acceptance criteria:** Overlay opens and closes without a stuck alternate screen. Paths match the ledger. No `:edit` is sent to Neovim.

### AGENT-005 — Human-in-the-loop stays honest

**Priority:** P1. **Effort:** Small once REL-006 exists. **Type:** Agent UX.

**Observed:** `lifecycleLabel` renders `needs you (kind)` for `waiting`. Kind comes from Pi's `ui_prompt` event. D15: there is no per-tool approval backend.

**Recommendation:** Keep `needs you` as the only approval-shaped language, and only while `lifecycle === "waiting"`. Mirror it to the tmux strip. Do not draw a permission card for ordinary bash/edit calls.

**Why it matters:** A fake approval UI would teach users to trust a gate that does not exist.

**Implementation direction:** Copy change is "do not add". Strip mirror is REL-006. Prompt kind stays a parenthetical, truncated with `fit`.

**Impact:** When Pi actually blocks, both panes say so. When it does not, PineVIM does not invent a prompt.

**Dependencies / risks:** Prompt kind strings are Pi's. Pass them through `plain()` on the strip.

**Acceptance criteria:** Waiting telemetry contains `needs you`. No new UI string contains `approval` unless a real gate exists.

### AGENT-006 — Session resume copy

**Priority:** P2. **Effort:** Small. **Type:** Agent UX.

**Observed:** `--resume` adopts panes, starts a new controller epoch, and drops outstanding control requests. It does not replay a prompt. README explains this. The in-pane frame does not.

**Recommendation:** On resume, one toast: `Resumed workspace. Unfinished tool calls were not replayed.` Do not add a session browser. Pi already has one when the tmux server is gone.

**Why it matters:** The scary part of resume is silent continuation. Say what did not happen.

**Implementation direction:** One `notify` in the resume path in `src/cli.ts` or the controller. Use the existing toast.

**Impact:** Users do not assume a half-finished bash restarted.

**Dependencies / risks:** Toast must fire once, not on every reconcile.

**Acceptance criteria:** Resume integration test expects one notify containing `not replayed` and zero extra agent starts.

---

## 12. Productivity Improvements

These are workflow combinations that the architecture can actually support. They are not a second command palette.

### PROD-001 — Prefix and slash stay the only command surfaces

**Priority:** P1 as a constraint. **Effort:** Small. **Type:** Productivity.

**Observed:** Prefix keys, `/ide`, `/pinevim`, and Pi's own slash commands. The production plan already rejected a general command palette.

**Recommendation:** Do not add one. Add arguments to `/pinevim` only for new PineVIM verbs (`review` later, `skills` much later). Completions already exist in `src/piui/completions.ts`.

**Why it matters:** A palette would duplicate Pi's command UI and the prefix.

**Implementation direction:** Extend `completions.ts` when a verb ships. No new picker.

**Impact:** One way to discover PineVIM commands: `/pinevim` completion and `F12 ?`.

**Dependencies / risks:** Completion collisions. Existing tests cover `/ide` and `/pinevim`. Extend them.

**Acceptance criteria:** No new command UI module in Phases 0–2. New verbs appear in argument completion tests.

### PROD-002 — Width and focus stay on the prefix

**Priority:** P2. **Effort:** Small. **Type:** Productivity.

**Observed:** `Left` / `Right` adjust by five columns. `Tab` swaps focus. Ratio is retained. README documents this. There is no on-screen hint except `F12 ?`.

**Recommendation:** After TUI-002, the help popup is enough. Do not put width controls on the band. Optional deck hint `F12 ?` already exists at ≥80 columns. Keep it as the discovery affordance (UX-001 places it on the deck).

**Why it matters:** Layout is already fast. Extra on-screen controls would cost rows.

**Implementation direction:** None beyond a working help popup.

**Impact:** Users who find `?` get the layout keys. Experts are not trained with widgets.

**Dependencies / risks:** REL-003.

**Acceptance criteria:** Help rows still list `i`, `c`, `a`, `Tab`, `Left`, `Right`, `r`, `q`, `s`, `m`, `?`.

### PROD-003 — Changed-files as the jump list, not a file tree

**Priority:** P2. **Effort:** Medium. **Type:** Productivity.

**Observed:** No project drawer. The editor is a full Neovim, which already has the user's file finder.

**Recommendation:** Do not add a PineVIM file tree. The run's path list (AGENT-002, AGENT-004) is the only file UI PineVIM should own, because it is agent state, not project navigation.

**Why it matters:** A drawer would duplicate netrw, oil, nvim-tree, or whatever the user runs, and it would steal columns from the 60-column editor minimum.

**Implementation direction:** None in the editor pane.

**Impact:** Columns stay on code and chat.

**Dependencies / risks:** None.

**Acceptance criteria:** No new tmux pane and no file-tree component in the backlog's Phase 0–4.

### PROD-004 — One place to see that the agent is blocked

**Priority:** P1. **Effort:** Medium. **Type:** Productivity.

**Observed:** Waiting is a band chip. The editor user does not see the band in focus mode.

**Recommendation:** This is IDE-002 and AGENT-005. The productivity win is not a new panel. It is the strip updating to `needs you` so the user tabs back only when required.

**Why it matters:** The costly context switch is "check the agent to see if it is stuck."

**Implementation direction:** Same as REL-006.

**Impact:** Fewer focus switches.

**Dependencies / risks:** False `needs you` from D5 would be a serious annoyance. Fix reducer edges in the same phase.

**Acceptance criteria:** Same as IDE-002, plus a fixture where `promptEnd` during idle does not leave the strip on `tooling` (REL-005).

---

## 13. Reliability / Error Cleanup

Confirmed problems are safe to schedule. Likely problems need a failing test before a fix, so the fix does not invent a bug.

### REL-001 — Status write path (D1)

**Confirmed.** **Priority:** P0. **Effort:** Medium. **Type:** Reliability.

**Recommendation:** Implement TUI-004. Stop passing styled status through `literal()`. Keep `literal()` for `display-message` toasts, where stripping is correct.

**Acceptance criteria:** As in TUI-004. `tests/unit/statusline.test.ts` gains a case for the set-option value.

### REL-002 — Menu (D2)

**Confirmed.** **Priority:** P0. **Effort:** Small. **Type:** Reliability.

**Recommendation:** Implement TUI-003.

**Acceptance criteria:** As in TUI-003. Protocol tests still reject unknown intents, including a raw `menu` if it is not added.

### REL-003 — Popups (D3)

**Confirmed structure.** Linux dash behavior **Needs verification**. **Priority:** P0. **Effort:** Medium. **Type:** Reliability.

**Recommendation:** Implement TUI-002.

**Acceptance criteria:** As in TUI-002.

### REL-004 — Bound the bridge seen-set (D14)

**Confirmed.** **Priority:** P0. **Effort:** Small. **Type:** Reliability.

**Observed:** `src/control/protocol.ts` `Peer.receive` closes when `this.seen.size >= 1024`.

**Issue:** A long session, or a telemetry fix, disconnects a healthy bridge.

**Recommendation:** Prune acknowledged ids. Cap memory with a ring, not a hard close, unless the peer is actually misbehaving (duplicate flood). Closing on a full set treats normal traffic as an attack.

**Implementation direction:** On `result` sent, delete from `seen`, or store ids in a fixed-size structure that forgets the oldest. Keep duplicate suppression for ids still in the window. Add a unit test that 1025 sequential requests do not close the peer.

**Impact:** Sessions survive. Telemetry can increase.

**Dependencies / risks:** Pruning too eagerly could allow a replay. The protocol already refuses replay across reconnect by dropping outstanding requests. In-connection duplicates must still be ignored while the request is in flight. Document the window.

**Acceptance criteria:** Unit test: 1100 unique request ids, peer stays open, a repeated in-window id does not run the handler twice.

### REL-005 — Lifecycle edges (D5)

**Likely.** **Priority:** P1. **Effort:** Medium. **Type:** Reliability.

**Recommendation:** Write the failing fixtures first, from the D5 list in the production plan: `promptEnd` from idle, compact from idle, `session_compact_failed`, thinking-block plus text streaming, tool counters across turns inside one run. Fix only the fixtures that fail.

**Acceptance criteria:** Each edge has a test. No production change without a red test. Settled idle is `idle`. A failed compact does not stick on `compacting`.

### REL-006 — Telemetry matches the band (D4, D12)

**Confirmed gap.** **Priority:** P1. **Effort:** Medium. **Type:** Reliability.

**Observed:** `report()` event list in `src/adapters/pi/extension.ts`. Status popup uses `s.busy`.

**Recommendation:** After REL-004, report on lifecycle transitions, coalesced. Put structured fields on the status payload (lifecycle, prompt kind, mode is not the bridge's job). Status popup reads that record. Do not send a pipe-string that the controller re-parses if a small object already fits the existing JSONL frame. The current code sends `telemetry` as a string. **Confirmed** comment in the extension: "Additive telemetry (protocol v1.1)". Prefer structured fields if the schema can grow without breaking old peers. If it cannot, version the record.

**Implementation direction:** Schema change in `src/control/protocol.ts` with a test for unknown fields still rejected everywhere except the new optional object. Coalesce in the extension (PERF-001).

**Impact:** Strip, popup, and band agree.

**Dependencies / risks:** Must follow REL-004. Payload size is bounded (16 KiB frames, per the production plan's constraint). Lifecycle names only, no prompts.

**Acceptance criteria:** A fixture walks `idle → tooling → waiting → idle` and the controller's last telemetry equals the reducer. Status popup fixture prints `needs you` or `waiting`, not `running`, for the waiting state.

### REL-007 — Queue chip (D8)

**Confirmed.** **Priority:** P1. **Effort:** Small. **Type:** Reliability.

**Recommendation:** Implement UX-003.

**Acceptance criteria:** As in UX-003.

### REL-008 — View push (D13)

**Confirmed.** **Priority:** P1. **Effort:** Medium. **Type:** Reliability.

**Recommendation:** Implement ARCH-001. The controller already knows `mode` and `focus`. Push them to the bridge after a successful layout. The extension calls `setMode`. Do not infer mode from `PINEVIM_IDE` after the first push.

**Acceptance criteria:** Integration: prefix-equivalent intent `ide.open` updates the header model even when the slash command was not the source. A unit test on the extension message handler sets mode from a `view` message.

### REL-009 — Stand-down and theme-install honesty

**Confirmed.** **Priority:** P2. **Effort:** Small. **Type:** Reliability.

**Observed:** Header/footer conflict is `|| false`. `installThemesToPi` swallows all errors and writes outside the private runtime, into Pi's agent themes directory.

**Recommendation:** Keep the editor-component stand-down. Document that header/footer cannot be detected, so PineVIM may overwrite them if another extension also uses `setHeader`. Do not pretend otherwise in the README. For theme install, log a `failure` event with code `THEME` and no path contents. Return value is already `null` on failure. Surface that once in the status popup as `themes: not copied` only when null. Do not block startup.

**Acceptance criteria:** README sentence matches the `|| false` code. A forced copy failure produces a log code and a status row, and Pi still starts.

### REL-010 — Release gates are open

**Confirmed in docs.** **Priority:** P1 for honesty, not a code fix. **Type:** Reliability.

**Observed:** `Docs/Compatibility.md` and `Docs/Implementation-Evidence.md`. Linux host, SSH, physical keys, clipboard, TrueColor, tmux 3.5 lower bound, live provider smoke: pending or partial. Phase 7 release readiness is not cleared.

**Recommendation:** Do not mark the product production-ready in README. Phase 4 records what was actually run. Do not close these gates by editing the docs without running them.

**Acceptance criteria:** README status sentence remains qualified until Evidence says otherwise.

---

## 14. Performance Improvements

Do not start with startup time. Evidence already records local prelaunch p95 63.7 ms, live transition 85.8 ms, and idle CPU 0.275%, under the project's own targets. Those numbers are local macOS, not a universal guarantee (**Confirmed** as documented measurements, **Needs verification** on other hosts).

### PERF-001 — Coalesce telemetry

**Priority:** P1. **Effort:** Small. **Type:** Performance.

**Observed:** Today `report()` is rare, so this is not a current hot path. REL-006 makes it one.

**Recommendation:** Send when the lifecycle name, prompt kind, or model changes. While `streaming` or `tooling`, send at most one update per second if the label (tool name) changed. Do not send on every assistant token.

**Why it matters:** The strip should move on state changes, not on tokens. Token-rate IPC will compete with Pi's render.

**Implementation direction:** A 1s timer in the extension, flushed immediately for `waiting`, `error`, and `idle`.

**Impact:** Neovim's status line stays calm.

**Dependencies / risks:** REL-004 and REL-006.

**Acceptance criteria:** A test that feeds 50 `messageUpdate` events in one lifecycle produces one report, plus one more if the state name changes.

### PERF-002 — Do not scan the transcript to render chrome

**Priority:** P2. **Effort:** Small as a rule. **Type:** Performance.

**Observed:** Header, band, and deck render from `LifecycleState` and context fields. Turn summaries are custom entries. This is the right shape.

**Recommendation:** Keep it. The run ledger must not re-walk the session on each render. Accumulate during events.

**Acceptance criteria:** Run renderer is O(width) in the entry data, with no session scan. Review in the AGENT-001 patch.

### PERF-003 — Theme copy stays cheap

**Priority:** P3. **Effort:** Small. **Type:** Performance.

**Observed:** `installThemesToPi` content-compares and skips identical files. **Confirmed.**

**Recommendation:** Leave it. Do not copy themes on every status refresh. Startup already does it once.

**Acceptance criteria:** No new call sites of `installThemesToPi` outside controller start.

### PERF-004 — No pane scraping

**Priority:** P1 as a constraint. **Effort:** None. **Type:** Performance.

**Recommendation:** Do not poll `capture-pane` to discover agent state. Events only. Scraping is slow, racy, and hostile to the privacy rule.

**Acceptance criteria:** No `capture-pane` in `src/` for telemetry.

---

## 15. Architecture / Maintainability Improvements

### ARCH-001 — Controller to bridge view events

**Priority:** P1. **Effort:** Medium. **Type:** Architecture.

**Observed:** Bridge messages are hello, status, intent, and shutdown handling. Layout changes do not flow back. **Confirmed** by the extension's `setMode` call sites.

**Recommendation:** Add a `view` result or a server-pushed record `{ mode, focus }` after successful `apply`. The extension is the only writer of `PiUi` mode. Ignore view messages with a stale epoch.

**Why it matters:** D13 is a missing edge in the architecture, not a header bug.

**Implementation direction:** Extend `src/control/protocol.ts` with a tested schema. Helper stays a one-shot client. Only the bridge holds the UI.

**Impact:** Header mode matches tmux.

**Dependencies / risks:** REL-004 first. A push during dispose must no-op (`PiUi.disposed` already exists).

**Acceptance criteria:** As in REL-008. Old helpers that do not understand `view` are unaffected because they do not read it. Document the schema.

### ARCH-002 — One chip renderer

**Priority:** P1. **Effort:** Small. **Type:** Architecture.

**Observed:** Three copies of the `ROLE` map. `chipLine` drops roles.

**Recommendation:** `src/piui/chips.ts` exports the role styler and `styledChipLine`. Header, band, and deck import it. This is the implementation of UX-002.

**Acceptance criteria:** `ROLE` is defined once. Tests cover it.

### ARCH-003 — One telemetry record

**Priority:** P1. **Effort:** Medium. **Type:** Architecture.

**Observed:** In-pane `LifecycleState`, controller `busy`, status popup `running|idle`, and a string `telemetry` field.

**Recommendation:** Define `Telemetry` in one module: `lifecycle`, `tool`, `queued`, `ctxPercent`, `waitingKind`. The band, the strip, and the status popup render from it. `busy` remains a controller boolean for quit confirmation. Do not overload `busy` to mean "tooling."

**Why it matters:** D4 and D12 are split brains.

**Implementation direction:** The extension reduces events to `Telemetry` and sends it. The controller stores the last record on `State` or beside it. Popups read it.

**Impact:** One function to change when a label changes.

**Dependencies / risks:** Protocol compatibility. Optional field, default `idle` if absent, so a mixed-version resume degrades to today's behavior.

**Acceptance criteria:** Status popup and strip tests use the same fixture object.

### ARCH-004 — Delete or quarantine dead UI

**Priority:** P2. **Effort:** Small. **Type:** Architecture.

**Observed:** `composer.ts` installed nowhere. `markdown.ts` has no renderer. `cards.ts` unused pending AGENT-003. `degraded: null`.

**Recommendation:** Remove `composer.ts` from the install story and from exports if tests can move to the band. Keep `cards.ts` until the spike, with the header comment updated to "not installed; spike required." Delete `markdown.ts` or reduce it to nothing imported. Remove the `degraded` field until a real signal exists.

**Why it matters:** Dead composer code tells the next agent to wire `setEditorComponent`. That path is obsolete.

**Implementation direction:** After tests are updated. Do not delete `cards.ts` in the same patch as the spike. Sequence: Phase 1 deletes composer and markdown stub. Phase 3 decides cards.

**Impact:** The tree matches the product.

**Dependencies / risks:** `tests/unit/piui.test.ts` covers the composer. Move assertions that still matter (fit, keys hint) onto the band, or drop them if the band tests cover them.

**Acceptance criteria:** `rg setEditorComponent src` shows no install. README does not mention a custom editor component.

### ARCH-005 — Compatibility probe is the API list

**Priority:** P2. **Effort:** Small. **Type:** Architecture.

**Observed:** `probeHooks` gates install. The production plan says `assertPiApiSurface` is unused (D11). **Likely**, not re-proven line by line in this audit.

**Recommendation:** One probe function. Every Pi API PineVIM calls is listed there, including whatever AGENT-003 needs. `SUPPORTED_PI` stays exact `0.87.1`.

**Acceptance criteria:** Install and tests call the same probe. A missing hook disables the frame with the existing notice.

### ARCH-006 — Config stays strict

**Priority:** P1 as a constraint. **Effort:** Small per new key. **Type:** Architecture.

**Observed:** `validateConfig` rejects unknown fields. The production plan notes the unknown-field message may omit `ui`. **Likely.**

**Recommendation:** Any new key (`ui` already exists; future `skills`) is whitelisted, documented, and covered by `scripts/user-config-smoke.py` if that script walks config. Fix the error string if it omits `ui`, after a test shows the omission.

**Acceptance criteria:** Unknown `ui.foo` fails with a message that mentions `ui`. No executable project config.

---

## 16. Onboarding & Discoverability

### ONBOARD-001 — Welcome line

See UX-004. **Priority:** P2. **Effort:** Small.

**Acceptance criteria:** As in UX-004. Experienced users with an existing workspace marker see nothing.

### ONBOARD-002 — Help that lists slash commands

**Priority:** P2. **Effort:** Small. **Type:** Onboarding.

**Observed:** `helpRows()` lists prefix keys only. It does not mention `/ide` or `/pinevim`.

**Recommendation:** After TUI-002 removes the 900-character trap, add three lines: `/ide` open editor, `/pinevim help` this list, `/pinevim quit` safe quit. Do not dump Pi's command list.

**Why it matters:** Prefix and slash are both real. Help shows one of them.

**Implementation direction:** Extend `helpRows` or add a second section in `helpPanelLines`.

**Impact:** Users who never press F12 still see the prefix documented if they run `/pinevim help`.

**Dependencies / risks:** REL-003. A longer popup must scroll or fit. Cap at the viewer height and keep slash lines above the fold.

**Acceptance criteria:** Help text contains `/pinevim` and `F12` (or the configured prefix).

### ONBOARD-003 — No wizard, no which-key in Neovim

**Priority:** P2 as a constraint. **Effort:** None.

**Recommendation:** Do not run a first-launch modal. Do not inject which-key groups into the user's Neovim. The deck hint `F12 ?` plus the welcome line is the entire onboarding.

**Acceptance criteria:** No new modal component in Phase 2.

### ONBOARD-004 — Status popup is the health check

**Priority:** P1. **Effort:** Medium. **Type:** Onboarding.

**Observed:** `statusPanelLines` already shows workspace, mode, Pi pane, bridge, editor, a coarse lifecycle, session, versions, and slash collision. That is the right health surface. It is undermined by D3 and D12.

**Recommendation:** Fix the popup (REL-003) and feed it telemetry (REL-006). Add the theme-copy row from REL-009. Do not add `:checkhealth` inside Neovim.

**Acceptance criteria:** `F12 s` shows bridge, editor, lifecycle from telemetry, and slash collision, using the Node viewer.

---

## 17. Documentation Improvements

### DOC-001 — Reconcile the contract

**Priority:** P1. **Effort:** Medium. **Type:** Documentation.

**Observed:** Stale "not implemented" header and `setHeader` prohibition in `Docs/PineVim-Agent-Harness-Implementation-Plan.md`. README amendment. Evidence omits PiUI and theme installs. Compatibility describes the ASCII strip as product behavior. Copilot instructions match the README more than the original plan.

**Recommendation:**

- Original plan: a banner that the application exists and that section 14's "do not call setHeader" is superseded by the frame. Do not rewrite history silently. Date the amendment.
- Evidence: add a UI section that lists shipped chrome, known defects D1–D15 until they close, and the theme-install write to Pi's themes directory.
- Compatibility: status line section matches the writer after REL-001, and until then says the styled writer is broken at `literal()`.
- README: branding table from BRAND-001, seam from IDE-001, and `auto` theme behavior after THEME-001.

**Why it matters:** Implementers are following contradictory contracts. That is how `PineComposer` and the menu shipped half-wired.

**Implementation direction:** Docs edits only, in Phase 4, except a short README note in Phase 0 that `F12 m` and the status line are known broken if they are not fixed yet. Prefer fixing before documenting the break. If Phase 0 slips, the README must not advertise a working menu.

**Impact:** One story for the next phase.

**Dependencies / risks:** Do not claim release readiness.

**Acceptance criteria:** A reader of README and Evidence can list what is installed, what writes outside the private state dir, and which defects remain. The original plan's first paragraph does not say the app is unimplemented.

### DOC-002 — Seam and non-goals

**Priority:** P2. **Effort:** Small. **Type:** Documentation.

**Recommendation:** IDE-001's README section, plus an explicit list: no Neovim RPC in this generation, no command palette, no permission cards, no multi-agent, no generated executables.

**Acceptance criteria:** Those non-goals appear once, in the README or in `Docs/Testing.md`'s "out of scope" area, and match section 24 of this plan.

### DOC-003 — CI for the checks that already exist

**Priority:** P1. **Effort:** Medium. **Type:** Documentation / engineering.

**Observed:** `package.json` scripts: `format:check`, `lint`, `typecheck`, `test`, `test:phase0`, `benchmark`, `test:package`. No `.github/workflows/`.

**Recommendation:** A workflow that runs format, lint, typecheck, and unit tests on Ubuntu. Integration tests need Pi, tmux, and Neovim. Either install the pinned versions or mark integration as a manual workflow. Do not weaken tests to go green.

**Why it matters:** Release gates are already honest about what was not run. CI makes the unit gate hard to skip.

**Implementation direction:** `.github/workflows/ci.yml`. Node 22. Cache npm. Do not upload logs.

**Impact:** Regressions in the status writer and protocol fail in public.

**Dependencies / risks:** Integration on GitHub-hosted runners **Needs verification** (Pi install, tmux 3.5+, nvim). Start with unit tests if integration cannot be installed cleanly, and say so in the workflow comment.

**Acceptance criteria:** Pull requests run unit tests. The README development section links the workflow.

### DOC-004 — Keep this plan and the production plan distinct

**Priority:** P3. **Effort:** Small. **Type:** Documentation.

**Observed:** `.agents/pinevim-ui-ux-redesign-plan.md` is the v1 redesign. `.agents/pinevim-production-ui-ux-self-improving-harness-implementation-plan.md` supersedes it and adds skills. This file is the product audit and the build sequence.

**Recommendation:** Do not delete those files in this pass. Add a one-line pointer at the top of the production plan only if a later docs edit is already touching it: "Product sequence lives in `.cursor/pinevim-product-improvement-plan.md`." Until then, this file is the one to implement. Where they disagree, this file wins on sequencing (skills last, no palette, no RPC). The production plan wins on skill storage details if skills are ever built.

**Acceptance criteria:** Section 25 does not tell an implementer to follow the v1 plan's PineComposer phase.

---

## 18. Quick Wins

High impact, local, and safe if the acceptance test exists. Do these before new surfaces.

| ID | Improvement | Area | Priority | Effort | Impact | Relevant Files |
|---|---|---|---|---|---|---|
| REL-004 | Prune bridge `seen` so long sessions do not drop the socket | Reliability | P0 | Small | Sessions survive; unblocks telemetry | `src/control/protocol.ts` |
| REL-002 | Make `F12 m` run real helper commands, or stop advertising it | Reliability | P0 | Small | A documented key works | `src/adapters/tmux/client.ts`, `src/adapters/tmux/panels.ts`, `src/core/state.ts`, `src/core/controller.ts` |
| UX-002 | Style each chip by role instead of muting the whole line | UX | P1 | Small | Errors and "needs you" are visible | `src/piui/chips.ts`, `src/piui/components/band.ts`, `src/piui/components/deck.ts` |
| REL-007 | Stop showing a fake queue count | Reliability | P1 | Small | Honest queue chip | `src/piui/index.ts`, `src/piui/chips.ts` |
| THEME-001 | Apply pinevim-dark/light on `auto` only over Pi's built-in default | Theme | P1 | Small | Default sessions look like PineVIM | `src/piui/theme.ts`, `src/adapters/pi/extension.ts`, `src/piui/index.ts` |
| THEME-004 | Fix the deck row comment; one separator constant | Theme | P2 | Small | Stops a bad "fix" later | `src/piui/components/deck.ts`, `src/piui/chips.ts` |
| BRAND-001 | Standardize PineVim / `pinevim` strings | Branding | P2 | Small | One product name | `src/piui/logo.ts`, `src/adapters/tmux/panels.ts`, `src/adapters/pi/extension.ts` |
| THEME-003 | ASCII context gauge | Theme | P2 | Small | ASCII mode matches the glyph rule | `src/piui/chips.ts` |
| ARCH-004 | Remove dead composer from the install path and exports | Architecture | P2 | Small | Stops a resurrected obsolete design | `src/piui/components/composer.ts`, `src/piui/index.ts` |
| AGENT-006 | One resume toast: tools were not replayed | Agent UX | P2 | Small | Resume is less frightening | `src/cli.ts`, `src/core/controller.ts` |

REL-001 (status writer) is high impact but medium effort. It is Phase 0, not a quick win.

---

## 19. Master Improvement Backlog

| ID | Recommendation | Category | Priority | Effort | Impact | Dependencies | Relevant Files |
|---|---|---|---|---|---|---|---|
| REL-001 | Write tmux status with `#[fg=]` or plain text; stop passing it through `literal()` | Reliability | P0 | Medium | Strip readable from Neovim | REL-004 not required | `src/adapters/tmux/client.ts`, `src/adapters/tmux/styled.ts`, `src/diagnostics.ts`, `src/core/controller.ts` |
| REL-002 | Fix or un-document the prefix menu | Reliability | P0 | Small | Dead key removed | None | `src/adapters/tmux/client.ts`, `src/adapters/tmux/panels.ts`, `src/core/controller.ts` |
| REL-003 | Popup via a Node viewer and a private file | Reliability | P0 | Medium | Help and status stay open | None | `src/adapters/tmux/client.ts`, `src/control/helper.ts` |
| REL-004 | Prune protocol `seen` set | Reliability | P0 | Small | No 1024-request disconnect | None | `src/control/protocol.ts` |
| REL-005 | Fix lifecycle edges that a new test proves | Reliability | P1 | Medium | Strip and band do not stick | Failing tests first | `src/piui/lifecycle.ts`, `tests/unit/piui.test.ts` |
| REL-006 | Report lifecycle to the controller; popup uses it | Reliability | P1 | Medium | Surfaces agree | REL-004, ARCH-003 | `src/adapters/pi/extension.ts`, `src/control/protocol.ts`, `src/adapters/tmux/panels.ts` |
| REL-007 | Honest queue chip | Reliability | P1 | Small | No fake counts | Pi API probe | `src/piui/index.ts` |
| REL-008 | Push view mode to the bridge | Reliability | P1 | Medium | Header matches layout | REL-004, ARCH-001 | `src/core/controller.ts`, `src/adapters/pi/extension.ts`, `src/piui/index.ts` |
| REL-009 | Document header stand-down; log theme-copy failure | Reliability | P2 | Small | Honest failure | None | `src/adapters/pi/extension.ts`, `src/core/theme-install.ts`, `README.md` |
| REL-010 | Keep release status unqualified until gates run | Reliability | P1 | Small | No false production claim | Evidence updates | `README.md`, `Docs/Compatibility.md`, `Docs/Implementation-Evidence.md` |
| UX-001 | One home per fact | UX | P1 | Medium | Less duplication, less drift | REL-008 | `src/piui/components/header.ts`, `band.ts`, `deck.ts` |
| UX-002 | Per-chip theme roles | UX | P1 | Small | Escalation is visible | ARCH-002 | `src/piui/chips.ts`, `band.ts`, `deck.ts` |
| UX-003 | Same as REL-007 | UX | P1 | Small | Honest queue | REL-007 | `src/piui/index.ts` |
| UX-004 | One welcome entry per workspace | UX | P2 | Small | First launch is learnable | Turn-entry pattern | `src/piui/index.ts`, `src/persistence.ts` |
| UX-005 | Error strings name the next action | UX | P2 | Medium | Failures are operable | None | `src/diagnostics.ts`, `src/adapters/tmux/client.ts` |
| TUI-001 | Target frame in section 7 | TUI | P1 | Medium | Coherent pane | UX-001, AGENT-001 | `src/piui/components/*` |
| TUI-002 | Same as REL-003 | TUI | P0 | Medium | Popups work | REL-003 | `src/adapters/tmux/client.ts` |
| TUI-003 | Same as REL-002 | TUI | P0 | Small | Menu works | REL-002 | `src/adapters/tmux/client.ts` |
| TUI-004 | Same as REL-001 plus THEME-002 | TUI | P0 | Medium | Readable strip | REL-001 | `src/adapters/tmux/styled.ts` |
| TUI-005 | One run-ledger line per request | TUI | P1 | Large | Scannable transcript | AGENT-001 | `src/piui/renderers/turnSummary.ts`, new run renderer |
| THEME-001 | Auto theme over Pi built-in default only | Theme | P1 | Small | Brand on first launch | Probe default theme names | `src/piui/theme.ts`, `src/adapters/pi/extension.ts` |
| THEME-002 | Shared token table for tmux 256-color and no-color | Theme | P1 | Medium | Strip works off truecolor | REL-001 | `src/adapters/tmux/styled.ts` |
| THEME-003 | ASCII gauge; mono relies on words | Theme | P2 | Small | ASCII/mono stay honest | UX-002 | `src/piui/chips.ts`, `src/piui/themes/pinevim-mono.json` |
| THEME-004 | Comment and separator cleanup | Theme | P2 | Small | Maintainability | None | `src/piui/components/deck.ts` |
| BRAND-001 | Name casing | Branding | P2 | Small | Cohesion | None | `src/adapters/tmux/panels.ts`, extension notices |
| BRAND-002 | Keep ASCII pine; no new logo | Branding | P3 | Small | Stable identity | None | `src/piui/logo.ts` |
| BRAND-003 | Keep terse voice | Branding | P3 | Small | No copy bloat | None | New strings only |
| IDE-001 | Document editor seam | Neovim IDE | P2 | Small | Stops distro expectations | DOC-001 | `README.md` |
| IDE-002 | Agent heartbeat on the tmux strip | Neovim IDE | P1 | Medium | Awareness while editing | REL-001, REL-006 | `src/adapters/tmux/statusline.ts` |
| IDE-003 | Do not add Neovim plugins or RPC | Neovim IDE | P3 | None | Scope | None | `src/editor.ts` |
| AGENT-001 | Run reducer from start to settle | Agent UX | P1 | Large | Unit of work | REL-005 helpful | `src/piui/lifecycle.ts`, new `src/piui/runs.ts` |
| AGENT-002 | File and numstat summary at settle | Agent UX | P1 | Medium | "What changed" | AGENT-001 | extension tool events, git argv |
| AGENT-003 | Tool-card parity spike, then ship or drop | Agent UX | P2 | Medium | Scanability without breaking bash | Pi 0.87.1 probe | `src/piui/renderers/cards.ts` |
| AGENT-004 | `/pinevim review` overlay | Agent UX | P3 | Large | Path list | AGENT-001, AGENT-002 | new overlay module |
| AGENT-005 | `needs you` only when waiting; mirror it | Agent UX | P1 | Small | Honest HITL | REL-006 | `src/piui/lifecycle.ts`, statusline |
| AGENT-006 | Resume toast | Agent UX | P2 | Small | Clear recovery | None | `src/cli.ts` |
| PROD-001 | No command palette; extend `/pinevim` completions | Productivity | P1 | Small | One command surface | None | `src/piui/completions.ts` |
| PROD-002 | Layout stays on the prefix | Productivity | P2 | Small | No extra chrome | REL-003 | `src/adapters/tmux/panels.ts` |
| PROD-003 | No PineVIM file tree | Productivity | P2 | None | Keeps columns | None | — |
| PROD-004 | Blocked-agent signal on the strip | Productivity | P1 | Medium | Fewer focus switches | IDE-002 | statusline |
| ARCH-001 | View push | Architecture | P1 | Medium | Mode truth | REL-004 | `src/control/protocol.ts`, `src/core/controller.ts` |
| ARCH-002 | Single chip styler | Architecture | P1 | Small | One theme map | UX-002 | `src/piui/chips.ts` |
| ARCH-003 | Single telemetry record | Architecture | P1 | Medium | No split brain | REL-006 | `src/control/protocol.ts`, `src/piui/lifecycle.ts` |
| ARCH-004 | Remove dead composer and markdown stub | Architecture | P2 | Small | Tree matches product | Tests updated | `src/piui/components/composer.ts`, `src/piui/renderers/markdown.ts` |
| ARCH-005 | One Pi API probe | Architecture | P2 | Small | Upgrades stay explicit | None | `src/adapters/pi/compatibility.ts`, `src/piui/index.ts` |
| ARCH-006 | Strict config, error text mentions `ui` | Architecture | P1 | Small | Safe settings | Test for the message | `src/config.ts` |
| PERF-001 | Coalesce telemetry | Performance | P1 | Small | No token-rate IPC | REL-006 | `src/adapters/pi/extension.ts` |
| PERF-002 | Ledger does not scan the session | Performance | P2 | Small | Render stays cheap | AGENT-001 | run renderer |
| PERF-003 | Theme copy once per start | Performance | P3 | Small | Startup stays flat | None | `src/core/theme-install.ts` |
| PERF-004 | No capture-pane telemetry | Performance | P1 | None | Privacy and speed | None | `src/adapters/tmux/` |
| ONBOARD-001 | Welcome entry | Onboarding | P2 | Small | First run | UX-004 | `src/piui/index.ts` |
| ONBOARD-002 | Help lists slash commands | Onboarding | P2 | Small | Discoverability | REL-003 | `src/adapters/tmux/panels.ts` |
| ONBOARD-003 | No wizard | Onboarding | P2 | None | Experts not nagged | None | — |
| ONBOARD-004 | Status popup is the health view | Onboarding | P1 | Medium | One health surface | REL-003, REL-006 | `src/adapters/tmux/panels.ts` |
| DOC-001 | Reconcile README, Evidence, Compatibility, original plan | Documentation | P1 | Medium | Implementable contract | Phase 0 truth | `README.md`, `Docs/` |
| DOC-002 | Publish non-goals and editor seam | Documentation | P2 | Small | Fewer wrong contributions | DOC-001 | `README.md` |
| DOC-003 | CI for format, lint, typecheck, unit tests | Documentation | P1 | Medium | Gate stays run | Runner has Node 22 | `.github/workflows/ci.yml` |
| DOC-004 | Point future work at this sequence | Documentation | P3 | Small | Less plan drift | None | `.agents/` pointer only if already editing |
| SKILL-001 | Opt-in, instructions-only skills under XDG data | Experimental | P3 | Large | Reuse of repeated workflows | AGENT-001, privacy review | new `src/skills/`, not repo `.agents/skills` |

---

## 20. Recommended Implementation Phases

### Phase 0 — Truthful control plane

**Goals.** The keys and pixels PineVIM already advertises must work. No new product surface.

**Items.** REL-004, REL-001, THEME-002 (minimum for the strip), REL-002, REL-003, REL-005 (tests first), REL-007, UX-002, ARCH-002, ARCH-006 if the config message is wrong.

**Dependencies.** REL-004 before any extra bridge traffic. REL-001 before claiming the strip in docs.

**Outcome.** Status line is readable. Menu dispatches or is gone. Help stays open. Chips show error and waiting. Queue label is honest. Bridge survives a long session.

**Completion criteria.**

- Unit test: 1100 requests do not close the peer.
- Unit test: `status-left` value has no ESC byte.
- Unit test: menu argv contains a helper command for an existing intent.
- Popup argv does not contain `read -n`.
- Band render test: waiting and error use different roles.
- Existing integration suite still passes. This audit did not run it. Phase 0 must.

### Phase 1 — Visual foundation

**Goals.** Default look is PineVIM when the user has not chosen a theme. Each fact has one home. Dead code stops contradicting the design.

**Items.** THEME-001, THEME-003, THEME-004, UX-001, TUI-001 (structure only, ledger line can be a stub), BRAND-001, ARCH-004, REL-009.

**Dependencies.** Phase 0 chip styler. UX-001 should land with REL-008 if the header drops lifecycle. If REL-008 slips, keep a lifecycle chip on the header until mode push exists.

**Outcome.** A default session shows `pinevim-dark` or `pinevim-light` unless the user has another theme. Header, band, and deck stop repeating each other. Composer is not part of the product story.

**Completion criteria.** Theme fixture does not touch `settings.json`. Header test at ≥80 columns has no lifecycle label, or, if REL-008 is delayed, the exception is written in the test name. `composer.ts` is not installed. README casing matches BRAND-001 for any strings Phase 1 touches.

### Phase 2 — Agent run

**Goals.** One user request produces one summary. Both panes agree on lifecycle. The editor user can see `needs you`.

**Items.** ARCH-001, REL-008, ARCH-003, REL-006, PERF-001, AGENT-001, AGENT-002, AGENT-005, TUI-005, IDE-002, PROD-004, ONBOARD-004, UX-004, ONBOARD-001, ONBOARD-002, AGENT-006, UX-005.

**Dependencies.** Phase 0 bridge cap. Phase 1 homes, so the ledger line is not a fourth copy of the band.

**Outcome.** Transcript has a run rule. Strip follows the reducer, coalesced. Welcome shows once. Resume says work was not replayed.

**Completion criteria.** Three-turn fixture writes one run entry. Waiting state reaches `status-left`. Logs from the fixture contain no prompt text. Welcome marker survives `--resume` without a second entry.

### Phase 3 — Tool presentation decision

**Goals.** Decide cards with evidence.

**Items.** AGENT-003, ARCH-005.

**Dependencies.** Phase 2 ledger, so a failed spike still leaves a scan surface.

**Outcome.** A Compatibility note: pass and a card renderer, or fail and cards stay unwired with the comment corrected.

**Completion criteria.** No built-in `registerTool` override without an abort test. Probe lists every new hook.

### Phase 4 — Release baseline

**Goals.** Docs match the binary. CI runs the unit gate. Open external gates stay labeled open.

**Items.** DOC-001, DOC-002, DOC-003, REL-010, IDE-001, DOC-004.

**Dependencies.** Phases 0–2 so the docs describe the new strip, theme, and run line. Do not document Phase 3 cards until the spike result exists.

**Outcome.** A new contributor can trust README, Evidence, and this plan's sequence. PRs run unit tests.

**Completion criteria.** Evidence lists theme-install as a write outside private state. Original plan header is amended. CI is green on unit tests. Linux/SSH/physical-key rows are still "not run" unless someone actually ran them.

### Phase 5 — Experimental

**Goals.** Only after Phase 2 is honest.

**Items.** AGENT-004, SKILL-001.

**Dependencies.** Run ledger and file summary. Privacy review for any observation log. Skills default off. Instructions only. Storage under `${XDG_DATA_HOME:-~/.local/share}/pinevim/skills`, published through Pi `skillPaths`. Never write learned skills into the repo's `.agents/skills` or `.pi/skills`.

**Outcome.** Optional review list. Optional skill proposals. Neither is required for the product to feel finished.

**Completion criteria.** With skills config absent, behavior matches Phase 2. No generated `scripts/` directory. Review overlay does not send keys to Neovim.

---

## 21. Proposed Design System

A design system here is a short contract, not a component library.

### Color tokens

Use Pi theme keys as the in-pane API: `accent`, `text`, `muted`, `success`, `warning`, `error`. Do not invent Neovim highlight groups. There is no PineVIM colorscheme for the editor.

Escalation:

| State | Role | When |
|---|---|---|
| Idle, model, branch, hints | `muted` | Default |
| View mode | `accent` | Header mode word only |
| Waiting | `accent` | Band and tmux mirror |
| Interrupted, context ≥ 75% | `warning` | Band or deck, whichever owns the fact |
| Error, context ≥ 90% | `error` | Band |
| Success | `success` | Use sparingly. Idle does not need a green dot if the word is `idle` |

tmux uses the THEME-002 index table, not these hex values.

### Type and glyphs

- One cell per glyph. No emoji. No zero-width characters.
- Word beside every glyph. `src/piui/glyphs.ts` stays the map.
- ASCII set when `ui.glyphs` is `ascii`, including the gauge (THEME-003).
- Working indicator frames stay as they are. `ui.motion: "off"` selects the static glyph.

### Spacing and borders

- Separator: `  ·  ` in the pane. One constant.
- No boxes around header, band, or deck.
- Rules (`─` / `-`) only for transcript ledger lines and popup separators.
- Width bands: header &lt; 60 hidden; band &lt; 40 hidden; deck one line &lt; 60; full split only at ≥ 101×24. These already exist. Do not add a new breakpoint without a test.

### Focus and component states

- Focus between panes is tmux's. Do not draw a second focus ring inside Pi.
- `modeChip` may include focus (`IDE editor`) only on the tmux strip, where the unfocused pane is the thing you cannot see. The header shows `CHAT` or `IDE`, not focus, once the strip exists.
- Disabled UI is omission, not a grayed control. Hide the queue chip at zero. Hide the gauge when context is unknown. Hide the band under 40 columns.

### Agent states

Render names from `Lifecycle` in `src/piui/lifecycle.ts`: `idle`, `thinking`, `streaming`, `tooling`, `waiting`, `compacting`, `settling`, `error`, `interrupted`. User-facing labels stay the existing `lifecycleLabel` words (`idle`, `needs you`, `error`, tool name while tooling). Do not add a tenth state for "the model is smart."

### Highlight naming

In-pane: `theme.fg(role, text)` with the roles above. No `PineHeaderAccent` highlight group. tmux: `#[fg=colourN]` from named tokens `accent|text|muted|warning|error`. Popup viewer: plain text plus the same words, color optional.

---

## 22. Proposed Product Layout / Information Architecture

The current split is the right architecture. Do not add a third column.

```text
┌ tmux status: workspace · IDE · lifecycle · prefix ? ─────────────┐
│                                    │ /\ pinevim            IDE   │
│                                    │/||\ · workspace · session   │
│                                    │                             │
│         Neovim                     │   Pi transcript             │
│         (user config)              │   run ledger lines          │
│                                    │                             │
│                                    │   ● lifecycle · tool · queue│
│                                    │   Pi composer               │
│                                    │   ctx · model · think · git │
└────────────────────────────────────┴─────────────────────────────┘
```

Compact (&lt;101 columns or &lt;24 rows): one pane, same frame inside Pi, same strip. Prefix Tab swaps.

Overlays, not panes:

```text
F12 ?   keys + three slash lines
F12 s   workspace health
F12 m   the same intents as the prefix
/pinevim review   path list (Phase 5)
/pinevim skills   only if SKILL-001 is approved later
```

Information architecture rules:

1. If a fact is on the band, it is not on the header.
2. The strip may repeat lifecycle because the band is not visible from the editor. It may not repeat model and context.
3. Transcript tools stay Pi's until AGENT-003 passes.
4. Empty, loading, and error for overlays are one line each, not illustrations.

---

## 23. Differentiating Ideas

These are worth a prototype only after Phase 2. They are not required for a coherent product.

### D-IDEA-1 — Run ledger with a worktree summary

**User value:** High. Answers "what did that request do?" inside the tool that ran it.

**Feasibility:** High. Tool events and `git diff --numstat` are available without RPC.

**Complexity:** Medium. AGENT-001 plus AGENT-002.

**Downside:** A dirty tree mixes user edits and agent edits. The label must say so.

**Placement:** Core, Phase 2. This is the one differentiating idea that should not stay experimental.

### D-IDEA-2 — Heartbeat on the tmux strip while editing

**User value:** High. The agent is visible without leaving Neovim.

**Feasibility:** High, after the status writer works.

**Complexity:** Medium. REL-006 and PERF-001.

**Downside:** A noisy or wrong strip is worse than a blank one. Coalesce, and prefer silence to a stuck `tooling`.

**Placement:** Core, Phase 2.

### D-IDEA-3 — Review list without opening files

**User value:** Medium. Useful when the ledger count is not enough.

**Feasibility:** High, as an overlay.

**Complexity:** Medium.

**Downside:** Users will expect Enter to jump to the file. Without RPC, Enter should do nothing except show the path, or the overlay will feel broken. Say that in the empty hint: `Paths only. Open them in Neovim.`

**Placement:** Experimental, Phase 5.

### D-IDEA-4 — Opt-in skills from repeated runs

**User value:** High for people who repeat one repo's commands. Zero for everyone else.

**Feasibility:** Medium. Pi already loads skills. The production plan's storage and validation design is the one to follow if this is built.

**Complexity:** Large. Observation, drafting, validation, review UI, rollback.

**Downside:** A skill that captures a secret or a destructive command is a serious incident. Default off. Instructions only. No generated scripts. No repo writes.

**Placement:** Experimental, Phase 5. Not a launch feature.

### D-IDEA-5 — Editor RPC, "open the file the agent touched"

**User value:** High in the abstract.

**Feasibility:** Low inside the current contract. Explicitly deferred (PINE-025).

**Complexity:** Large. Modified buffers, user mappings, remote Neovim, trust.

**Downside:** Breaks the ownership split that makes the product safe to run.

**Placement:** Not in this generation. Do not prototype it under a feature flag in Phase 5.

---

## 24. Things NOT to Do

- Do not ship a Neovim distribution, statusline, dashboard, or plugin manager. The editor is the user's.
- Do not add Msgpack RPC, buffer upload, or "open file" from the agent UI in this generation.
- Do not reimplement Pi's composer, markdown renderer, or tool execution. `PineComposer` stays unwired and should be removed from the story (ARCH-004).
- Do not register over built-in tools until AGENT-003 proves abort and hooks survive.
- Do not draw permission or approval cards. Pi does not provide that gate (D15).
- Do not add a command palette. Prefix, `/pinevim`, and Pi's own UI are enough.
- Do not apply a PineVIM theme when the user has already selected a non-default Pi theme.
- Do not write the theme choice into Pi `settings.json`.
- Do not increase telemetry until REL-004 lands.
- Do not show lifecycle in the header, band, deck, and strip all at once.
- Do not add a third tmux pane, a file tree, or a permanent log window.
- Do not scrape pane text to infer agent state.
- Do not put prompts, file contents, or secrets in controller logs.
- Do not generate executable skill scripts.
- Do not write learned skills into the git repo.
- Do not animate beyond the existing working indicator.
- Do not add more themes before `auto` applies one.
- Do not close Linux, SSH, or physical-key release gates in documentation without running them.
- Do not reset or clean the working tree while implementing this plan. Unrelated user changes stay.

---

## 25. Recommended Next Build Sequence

Implement in this order. Each step's tests land in the same change. Do not start a step whose dependency is red.

1. **REL-004** — Prune `seen` in `src/control/protocol.ts`. Test 1100 ids. Everything that talks more often depends on this.
2. **REL-001 + THEME-002** — Status writer. ASCII or `#[fg=colourN]`. Test the set-option value and, if the integration harness can, read it back. `literal()` remains for toasts.
3. **REL-002** — Menu argv uses helper commands for existing intents. Stop sending intent `menu`. Update help only if the menu works.
4. **REL-003** — Popup viewer. Then **ONBOARD-002** can add slash lines.
5. **REL-005** — Red tests for lifecycle edges, then fixes that the tests require.
6. **UX-002 + ARCH-002 + REL-007** — Chip roles and honest queue. Small, user-visible, no protocol change.
7. **ARCH-006** — Config error text, if a test shows `ui` is omitted.
8. **THEME-001** — Auto theme, one call site, object not name, never over a user theme.
9. **ARCH-001 + REL-008** — View push. Then **UX-001 / TUI-001** — remove duplicate facts. Do not remove the header lifecycle chip before the push is live.
10. **ARCH-004 + BRAND-001 + THEME-003 + THEME-004 + REL-009** — Dead composer, casing, ASCII gauge, comments, theme-copy honesty.
11. **ARCH-003 + REL-006 + PERF-001 + AGENT-005 + IDE-002** — One telemetry record, coalesced, mirrored to the strip, including `needs you`.
12. **AGENT-001 + TUI-005** — Run reducer and one ledger line. Stop appending new per-turn rules.
13. **AGENT-002** — Tool paths and bounded numstat on that line. Wording distinguishes worktree diff from tool paths.
14. **UX-004 + AGENT-006 + UX-005 + ONBOARD-004** — Welcome once, resume toast, error next-step, status popup fed by telemetry.
15. **DOC-001 + DOC-002 + DOC-003 + REL-010 + IDE-001** — Docs and CI. Release stays "not cleared" where gates were not run.
16. **AGENT-003** — Spike. Ship cards or write the negative result. Do not block 1–15 on it.
17. **AGENT-004, then SKILL-001** — Only with a separate decision. Skills stay off by default.

Dependency sketch:

```text
REL-004 ──► REL-006 ──► IDE-002 / AGENT-005
   │            ▲
   │            └── ARCH-003
   └─► REL-008 ──► UX-001

REL-001 ──► THEME-002 ──► IDE-002
REL-005 ──► AGENT-001 ──► AGENT-002 ──► TUI-005
AGENT-001 ──► (later) AGENT-004 ──► SKILL-001
```

Phase 0 is steps 1–6. Phase 1 is steps 7–10. Phase 2 is steps 11–14. Phase 3 is step 16. Phase 4 is step 15 and can start its CI workflow as soon as step 2's tests exist, without waiting for the ledger. Phase 5 is step 17.

When a step and an older plan disagree, follow this sequence. In particular: do not install `PineComposer`, do not add a command palette, do not add Neovim plugins, and do not build skills before the run ledger is honest.
