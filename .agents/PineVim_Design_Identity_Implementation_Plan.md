---
title: PineVim Visual Design Identity & TUI/LazyVim-IDE Improvement Plan
repository: PineVim
branch: chore/UI-Improvements
auditor: MiniMax-M3 (post-2026-09-25 design review)
date: 2026-09-25
status: planning — no implementation
---

# PineVim Visual Design Identity & TUI/LazyVim-IDE Improvement Plan

> **Scope.** This plan focuses exclusively on **visual identity, design language, and
> differentiation** for the PineVim Agent Harness TUI (the chrome that lives inside Pi's
> pane — header, band, deck, tool cards, popups, themes, glyphs) and the **PineVim IDE
> pane** (the Neovim instance PineVim launches, currently styled via
> `src/editor/theme-script.ts`). Technical/architectural fixes (confirmation policy,
> non-interactive recovery, benchmark gating, etc.) already have first-class coverage in
> `.agents/PineVim_Agent_Harness_Audit_and_Improvement_Plan.md` and
> `.agents/pinevim-production-ui-ux-self-improving-harness-implementation-plan.md`;
> this document does not duplicate them. Where it overlaps, this plan adds the
> design rationale and the precise visual contract; the prior plans own the
> mechanics.
>
> **Evidence labels.**
> - **[observed]** — verified directly in `src/`, `tests/`, `Docs/`, theme JSON,
>   or the current `tests/fixtures/header-*.txt` snapshot set.
> - **[gap]** — the absence itself is a design problem (e.g. no explorer, no
>   startup splash, no brand wordmark in the IDE).
> - **[proposed]** — new design or file that does not exist yet.
> - **[risky]** — could regress snapshots, theme parity, or Pi-extension contract.

---

## 1. The Core Problem: PineVim Still Reads Like Two Products Stacked

A design audit against the current `chore/UI-Improvements` tree (commit
`125433c` + uncommitted `src/` working tree, 2026-09-25) finds that PineVim
is **functionally distinct but visually unbranded**. The work that *is* done
(the pine-tree ASCII mark, the seven-theme palette, the activity band, the
ENV deck, the run ledger, the timeline popup, the styled tmux status line)
is structurally PineVim, but the chrome is so restrained that a first-time
user opening PineVim sees:

1. A 4-line pine mark above a Pi transcript that still uses Pi's default
   user-message bubbles, default assistant markdown, default tool execution
   blocks, and Pi's own header chrome outside the pine [observed in
   `src/piui/components/header.ts:138-194`; **Pi's own header is fully
   replaced**, but everything else is unchanged — see §3.1 for the residual].
2. A Neovim instance that looks like a stock LazyVim install (because it
   *is* — the user's LazyVim config is untouched) with a few PineVim
   highlight groups overlaid from `src/editor/theme-script.ts` [observed in
   `src/editor/theme-script.ts:95-225` — only ~50 highlight groups are
   overridden; everything else inherits LazyVim's defaults].
3. A tmux status line that, after the styling pass in
   `src/adapters/tmux/statusline.ts`, is colored and segmented, but reads as
   a generic agent strip — no PineVim wordmark, no pine motif, no sense of
   "this is a workspace" vs. "this is a chat" [observed — the segments are
   `workspace · MODE focus · agent=<lifecycle> · <prefix> ?` with no brand].

**[gap]** A user cannot tell from any single frame whether they are in
PineVim, stock Pi, or stock LazyVim. The pine tree in the header is the
*only* branded element on screen, and only at 60+ columns.

**The opportunity.** The unique affordances that are *already present* (run
ledger, ENV deck with model + thinking + ctx, session timeline popup, two-
tone trunk, lifecycle chip with running/thinking/waiting/tooling/error/
interrupted states, worktree numstat, theme color-mood names — forest,
cyberpunk, snow, neon) are themselves the brand. The fix is not to add
more pixels; it is to compose what exists into a coherent visual identity
that a viewer recognizes in under a second.

---

## 2. Brand Pillars (the four design commitments)

Every proposed change must serve at least one pillar. If a change serves
none, it is decorative chrome and should be cut.

1. **The forest is the identity.** Pine trees, evergreens, biomes. The
   palette, the names, the running-indicator frames, the help panels, the
   wordmark, and the splash all carry the same metaphor. Not a logo slapped
   on a generic layout — the layout itself is the metaphor.
2. **Quiet by default, loud only when it matters.** Idle frames are
   nearly monochrome; the moment state changes (thinking → tooling →
   waiting → error), the chrome shifts. This is the opposite of stock
   LazyVim's "everything is on" and Pi's "neutral chrome with everything
   colored by role." PineVim reserves color for the thing the user needs to
   look at *right now*.
3. **The frame is information, not decoration.** Borders, rules, rails,
   and gutters all carry data (mode, focus, lifecycle, queue, warning).
   Decorative borders are forbidden. Decorative glyphs (symbols with no
   attached meaning) are forbidden.
4. **Same colors, two panes, one workspace.** The Neovim IDE pane and
   the Pi chat pane must be unambiguously the same product. Same accent,
   same status line family, same warning/success/error semantics, same
   divider language. The current `NVIM_THEME_LUA` already maps the seven
   PineVIM palettes into `:highlight` groups; the §4 work makes that mapping
   visible everywhere, not just in `:hi Normal`.

---

## 3. PineVim Agent Harness TUI — Current State and Design Gaps

### 3.1 What already works (do not redo)

- Pine tree ASCII mark (`src/piui/logo.ts:14-26`); two-tone canopy + trunk
  with per-theme `PINE_TRUNK_FACTOR_OVERRIDES` (`logo.ts:52-55`).
- Compact 4-line identity for ≤ 24 rows (`components/header.ts:175-188`).
- Width-adaptive header at 60/80/100/120 (`components/header.ts:137-195`).
- Activity band above the composer with state glyph + tool name + queue +
  hint (`components/band.ts:92-130`).
- Environment deck with `ENV` label, context gauge, model, thinking,
  branch, hint (`components/deck.ts:55-81`).
- Tool card grammar (running/success/warning/failure/interrupted/waiting
  with ASCII fallback) (`renderers/cards.ts`).
- Run ledger on settled runs (`renderers/runLedger.ts`).
- Timeline popup with 22 most recent runs and a live marker
  (`adapters/tmux/panels.ts:177-213`).
- Status popup with mode, lifecycle, slash ownership, versions, themes
  (`adapters/tmux/panels.ts:215-307`).
- Help popup with sectioned prefix + commands (`panels.ts:91-117`).
- 17-fixture snapshot matrix at 60/80/120 columns × 16/24/30 rows ×
  unicode/ascii × IDE/CHAT/long-identity (`tests/fixtures/header-*.txt`).
- Terminal title brand `pinevim` (`logo.ts:83-85`,
  `piui/index.ts:248-253`).
- 7-theme palette (`pinevim-dark`, `-light`, `-mono`, `-neon`,
  `-cyberpunk`, `-forest`, `-snow`) with `auto` policy
  (`theme.ts:62-68`).
- Styled tmux status line with `#[fg=…]` SGR tokens
  (`adapters/tmux/styled.ts:40-56`).

### 3.2 What still looks like Pi

**[gap] · Residual Pi chrome.** The bundled extension replaces the header
(`piui/index.ts:201-213`) and footer (`piui/index.ts:216-228`) and adds a
widget band (`piui/index.ts:231-241`), but it does **not** override:

- The user-message bubble styling (still Pi's default `userMessageBg` /
  `userMessageText`).
- The assistant message `Markdown` component (still Pi's default md
  palette).
- The `ToolExecutionComponent` rendering (still Pi's built-in tool
  renderers; PineVim's `renderers/cards.ts` exports a parallel grammar
  that is **not currently registered** — see `cards.ts:17-31`: *"Parity
  spike (AGENT-003): not passed. … These formatters stay unused by the
  live frame."*).
- The `SelectList` / `SettingsList` styling (model picker, session picker,
  settings list).
- The `Editor` border (composer is stock Pi; the proposed §3.6 composer
  redesign has not landed).

**[gap] · No welcome moment.** A `WELCOME_TYPE` renderer exists
(`renderers/runLedger.ts:115-159`) and is opt-in via `PINEVIM_WELCOME=1`,
but it is not on by default and the welcome is three muted lines with the
pine accent on the first [observed in `piui/index.ts:167-178`]. There is
no full-screen first-run moment.

**[gap] · No command palette.** Per the original plan
(`pinevim-ui-ux-redesign-plan.md:559-572`), command palette is **rejected
for v1**. The plan stands. This document does not introduce one.

**[gap] · No explorer, no file tree.** Intentional per the README
constraint at `README.md:113` ("PineVim does not add … a file tree").
The plan honors that.

**[gap] · No idle motion.** The animated working-indicator frames
`WORK_FRAMES_UNICODE = ["·", "›", "»", "›"]` at 120 ms are the only motion
in the system (`piui/index.ts:193-198`); idle frames are static. Good.
Do not add idle animation — it conflicts with pillar #2.

### 3.3 What still looks like a generic tmux status line

**[gap] · No PineVim mark in the tmux strip.** The status line at
`adapters/tmux/statusline.ts:89-114` is `workspace · MODE · agent · ?`.
No wordmark. No divider identity (the `|` between segments is bare
ASCII, not the themed `│`/`·` rail used inside the Pi pane). Adding a
PineVim motif here is the single highest-visibility change available —
it is the **only** surface visible at every moment, including when Pi
is dead and the pane is empty.

**[gap] · Statusline doesn't track the agent's *theme*.** The
`#[fg=…]` colors are hard-coded in `styled.ts:25-34` to a single dark
palette and do not track the active PineVIM theme. A snow-themed
session still gets dark-green status text.

**[gap] · Toasts are colorless and ASCII.** `Tmux.notify()` routes
through `literal()` in `diagnostics.ts`, which strips ANSI and
non-ASCII by construction. This is correct for security-sensitive
interpolation (workspace names, error messages from external tools) but
wrong for **PineVim-authored toasts** ("Pi started", "Editor exited",
"Recovery confirmed") which are 100% trusted PineVim strings. A styled
writer for PineVim-authored messages is the second highest-visibility
fix.

---

## 4. PineVim-as-LazyVim IDE — Current State and Design Gaps

The IDE pane is launched by `src/editor.ts:17-39` with a runtime path
that points at a Lua module `require('pinevim').arm()`. That module:

1. Reads the same theme JSON the Pi pane is using
   (`theme-script.ts:36-77`).
2. Overrides ~50 `:highlight` groups (`theme-script.ts:105-184`).
3. Restyles `lualine` if present (`theme-script.ts:186-225`).
4. Wires the autocmd group so the theme reapplies after `LazyDone`
   (`theme-script.ts:228-246`).

The **strength** of this approach is restraint: PineVim does not edit
the user's LazyVim config, install plugins, or own Neovim RPC. The
**weakness** is that *everything LazyVim does not delegate to those 50
groups* stays stock LazyVim.

### 4.1 What already works

- Theme parity with the Pi pane (same JSON drives both sides) [observed in
  `theme-script.ts:36-77`].
- Trunk factor handling equivalent to the Pi side
  (`theme-script.ts` is theme-aware; `logo.ts:52-55` resolves at render
  time).
- Lualine mode-aware sections (normal/insert/visual/replace/command with
  themed bg colors) [observed `theme-script.ts:186-225`].
- BufferLine selected indicator + modified marker
  (`theme-script.ts:178-184`).
- One status line, flat separators, no powerline arrows (README
  constraint at `README.md:111`).
- An autocmd to reapply after `LazyDone` so plugin-installed highlights
  don't clobber the palette (`theme-script.ts:233-238`).

### 4.2 What still looks like LazyVim

**[gap] · No PineVim wordmark in Neovim.** The Neovim window has no
brand. The startup screen, the empty-buffer state, the `MESSAGE` of the
day — all stock LazyVim.

**[gap] · No startup splash.** `nvim` shows its default startup screen
with the LazyVim banner. A PineVim splash that fades into the user's
normal config (LazyVim banner → brief pine motif → editor) would make
the identity unambiguous.

**[gap] · The status line is lualine, not PineVim-authored.** When
lualine is not installed, there is no styled status line at all. When
it *is* installed, the per-mode colors are PineVim-themed, but the
section *content* (file name, git branch, file format, encoding,
cursor position) is whatever lualine ships. A PineVim-authored status
component would let the IDE pane echo the same `ENV` vocabulary the
chat pane uses — `model · think · ctx · branch · agent`.

**[gap] · No tab line.** `BufferLineFill/Background/BufferVisible/
BufferSelected/Separator/IndicatorSelected/ModifiedSelected` are
overridden (`theme-script.ts:178-184`), but only when bufferline is
installed. When it isn't, there is no tab line and the user's open
buffers are indistinguishable from stock Neovim.

**[gap] · No IDE-specific indicator for the active "mode"** (CHAT vs
IDE focus). When the user is in the IDE pane of a paired split, there
is no visible cue that this pane is the "editor" sibling of the
"agent" pane. The plan §6 below proposes a focused-pane chrome (a
single character in the gutter or a transient banner in the tabline).

**[gap] · No file tree, no sidebar.** Intentional. README constraint.
This plan does not add one.

**[gap] · No Pi-status indicator in Neovim.** The IDE pane cannot tell
that Pi is busy, dead, or waiting. A `vim.g.pinevim_agent_lifecycle`
augment + a `StatusLine` component would surface this without RPC.

---

## 5. PineVim Agent Harness TUI — Design Improvements

The following sections each name one design surface, describe the
**current state** (with file:line evidence), specify the **proposed
state** as a visual contract, list the **exact files** to touch, and
call out the **acceptance test**. No section changes the protocol,
the lifecycle reducer, or the persistence layer; each is a chrome-
scoped diff.

### D1 · Branded tmux status line

**Current.** `src/adapters/tmux/statusline.ts:89-114` produces
`workspace · MODE focus · agent · <prefix> ?` with hard-coded dark
colors. No brand mark. No theme tracking.

**Proposed.**
- Always render the **PineVim mark** as the first segment:
  `▲ pinevim ·` where `▲` is a 1-cell pine motif
  (the small `TREE_LINES[0]` row, recolored by theme accent).
- Use **themed separators** (`·` unicode / `-` ascii) instead of `|`,
  matching the in-pane band grammar.
- Mirror the **theme** of the active PineVIM theme: `theme.fg('accent',
  '▲')`, then statusline colors map onto the same 8-role palette as
  the Pi pane (accent/muted/dim/border/success/warning/error/text).
- Show **agent lifecycle chip** in the accent color when the bridge is
  up; in warning color when the bridge is down; in error color when
  the agent is dead.
- Show **bridge/agent summary at ≤ 30 chars** when the terminal is
  narrow; show **full `ENV` row** (model · think · ctx · branch · agent)
  at ≥ 80 cols.
- At < 60×16, fall back to the existing "resize to 60×16 · <prefix> ?
  help" guidance.

**Visual contract — 120×30 session in `pinevim-forest`:**

```
▲ pinevim · ~/proj · IDE editor · ● agent tools 3 · model gpt-5 · think med · ctx ▮▮▮▮▯ 42% · main · F12 ?
```

**Visual contract — 60×16 panic state (agent dead, no bridge):**

```
▲ pinevim · ~/proj · CHAT · ✗ pi dead · F12 r retry · F12 ? help
```

**Files.**
- `src/adapters/tmux/statusline.ts` (extend `StatusInput` with
  `theme: AgentPalette`, replace `statusLine()` renderer).
- `src/adapters/tmux/styled.ts` (add `AgentPalette` type mirroring
  PineVim's 8 roles; theme-keyed palette lookup helper).
- `src/core/theme-install.ts` (push active theme colors into the
  controller so status line is theme-aware).
- `src/core/controller.ts` (re-render on theme change, not only on
  state change).

**Acceptance.**
- Unit: `statusLine()` with 4 themes × 5 widths × ascii/unicode =
  40 snapshots.
- Integration: starting a session with theme `forest` produces
  status-left containing the forest accent token
  (`#[fg=green]` / `#[fg=brightgreen]`) not the dark default.
- Visual: agent-dead state renders the error palette within 1 frame
  of `pane-died`.

**Risk / rollback.** **[risky]** tmux `#[fg=…]` tokens are sensitive to
the terminal's color palette in 256/8-color modes; preserve the
current `TMUX_COLOUR` mapping (`styled.ts:41-50`) and add a
`palette-truecolor` path side-by-side. Rollback: revert
`statusLine()` to the prior implementation; tests will diff.

---

### D2 · Themed toasts (PineVim-authored messages only)

**Current.** `Tmux.notify()` in `src/adapters/tmux/client.ts:326-344`
passes every message through `literal()`, which strips ANSI and
non-ASCII. This is correct for **external / user-input** messages but
wrong for **PineVim-authored** messages ("Pi started", "Editor
exited", "Recovery confirmed", "Themes not copied").

**Proposed.**
- Split `Tmux.notify()` into two paths:
  - `notifySafe(text, severity)` — current behavior; for any text
    that has touched external input or a process spawn.
  - `notifyBranded(text, severity, role)` — new path for
    PineVim-authored strings; passes the text through `sgr(role, …)`
    from `styled.ts` (NOT `literal()`) and chooses a glyph-prefix
    matching the existing `glyphs.ts` vocabulary
    (`✓` success / `▲` warning / `✗` error / `·` info).
- Callers in `src/core/controller.ts` switch to `notifyBranded()` for
  PineVim-authored messages; the `core/controller.ts` toast surface
  for "Pi started", "Editor exited", "Theme install copy failed",
  "Bridge reconnect succeeded", and similar lifecycle events.

**Visual contract (60-col IDE mode, editor just exited):**

```
display-message -d 8000 "✗ editor exited · F12 i retry · /ide open"
```

(themed `error` role on `✗`; themed `muted` on the rest; ASCII mode
uses `x` for the glyph.)

**Files.**
- `src/adapters/tmux/client.ts` (`notify()` → split to
  `notifySafe()` + `notifyBranded()`).
- `src/adapters/tmux/styled.ts` (already exports `sgr()` — no new
  code, just the call).
- `src/core/controller.ts` (every `tmux.notify()` site reviewed and
  routed to the correct path).

**Acceptance.**
- Unit: every `notifyBranded()` call site listed in
  `tests/unit/controller-notify.test.ts` (new file) with a snapshot.
- Integration: simulated `pane-died` event within 100 ms produces a
  `display-message` containing the themed `✗` glyph and the recovery
  hint.

**Risk / rollback.** **[risky]** Existing tests assert that
`tmux.notify(message)` rejects control chars. Keep `notifySafe()`'s
validator; only add a second path. Rollback: revert
`notifyBranded()`'s call sites in `controller.ts`.

---

### D3 · Run ledger as a first-class transcript anchor

**Current.** `src/piui/renderers/runLedger.ts:27-51` renders a single
`─ run N · … ──────` rule on each settled run. It is *one line per run*
with optional expanded `tools: …` / `files: …` details
(`runLedger.ts:53-83`). The visual weight is identical to Pi's own
horizontal rule — easy to overlook.

**Proposed.** Make the run ledger a **branded anchor** by:
- Prefix the rule with the **same pine motif** used in the status line
  (`▲` or the unicode `›` accent in PineVIM colors) — not a bare `─`.
- Move the run index to **outside** the rule
  (`▲ run 7 ── 5 tools · 0 failed · 38.2 s · ctx 51% ──────`) so
  the eye finds it without scanning the rule.
- Right-align `ctx N%` and `+12 −3` diffstat (using `formatDiffstat`
  from `renderers/cards.ts:99-106`) so the eye compares context
  pressure across runs.
- When expanded (Pi's `expanded: true` option), show a **two-line
  detail block** with a themed `│` rail, not a flat dim line:
  ```
  │ tools read, edit, bash, bash (×2), bash
  │ files src/auth/session.ts · src/auth/refresh.ts
  │ +12 −3 · ctx 51%
  ```

**Files.**
- `src/piui/renderers/runLedger.ts` (extend `renderRunLine()` +
  `summaryDetails()`).
- `src/piui/components/band.ts` (render an additional chip variant
  `last run` with `+N −M` diffstat for the most-recent closed run).

**Acceptance.**
- Snapshot: 8 fixtures (`compact-80x24-ide-editor-run-N.txt`,
  `compact-80x24-run-with-diffstat.txt`, etc.) extending the existing
  manifest at `tests/fixtures/header-snapshots.json`.
- ASCII mode: every `─`, `│`, `·`, `›` has its ASCII form already in
  `glyphs.ts`.

---

### D4 · Context history sparkline in the deck

**Current.** `src/piui/components/deck.ts:55-81` renders one `ctx`
gauge with 6 or 10 cells. No history. The `runs.ts` already records
`ctxPercent` per turn (`renderers/runLedger.ts:14-18`) but the data
is dropped before reaching the deck.

**Proposed.**
- Add a **bounded ring buffer** (length 20) of `ctxPercent` per turn
  to `src/piui/runs.ts` (`ContextSeries` type).
- Replace the gauge with a **sparkline + percentage** when width ≥ 80:
  ```
  ctx ▁▂▃▅▆▇ 71%
  ```
  Sparkline glyphs: `▁▂▃▄▅▆▇█` (Braille baseline; ASCII fallback
  `.,-,=,i,I,#`).
- At 60–79 cols, fall back to the existing 6-cell gauge.
- Color the **rightmost segment** with the current threshold palette
  (`muted` < 75, `warning` 75–89, `error` ≥ 90) so the spike is
  immediately readable.

**Files.**
- `src/piui/components/deck.ts` (`renderEnvironment()` swaps gauge
  for sparkline at width ≥ 80).
- `src/piui/runs.ts` (add `ContextSeries`, `pushContext(ctxPercent)`,
  ring-buffer bound).
- `src/piui/glyphs.ts` (add `spark` glyph set + ASCII fallback).
- `src/piui/index.ts` (`agent_settled` handler calls
  `pushContext()` after `formatChangeSummary`).

**Acceptance.**
- Unit: 4 sparkline fixtures at widths 60/80/120 across
  pinevim-dark/light/mono.
- Width-fit: sparkline width matches the per-row width budget.

---

### D5 · Composer redesign (CustomEditor override)

**Current.** The composer is Pi's stock editor. There is no override
registered for `setEditorComponent`. The chip band sits *above* the
editor (`piui/index.ts:231-241`), so identity is fragmented between
two surfaces.

**Proposed.** Per the original plan §10
(`pinevim-ui-ux-redesign-plan.md:520-558`), build `PineComposer extends
CustomEditor` with:

- `embedWorkingStatus: true` so working/compaction/retry renders in
  the top border (Pi-native).
- Override `renderTopBorder(width, hiddenLineCount)` to emit a
  themed top border with the **mode chip + lifecycle chip** on the
  left, **F12 ?** hint on the right at ≥ 80 cols.
- Override the bottom border to render the **context sparkline +
  model + thinking** as in §D4 above (composer border becomes the
  persistent location; the deck sparkline is removed or downgraded
  to "current % only").
- Border color follows lifecycle (mirrors Pi's own convention;
  `muted` idle, accent when waiting, error after error). Color is
  duplicated by the chip text — never the sole carrier.

**Visual contract — focused, idle, 100 cols, `pinevim-forest`:**

```
┌ CHAT · ● idle ─────────────────────────────────────── F12 ? keys ┐
│ fix the flaky auth test                                              │
└ ctx ▁▂▃▅▆▇ 71% · gpt-5 · think med ──────────────────────── ⏎ send ──┘
```

**Visual contract — busy, waiting for tool result, 80 cols:**

```
┌ CHAT · ● tools 3 · read ──────────────────────────── Esc interrupts ┐
│ fix the flaky auth test                                              │
└ ctx ▆▆▆▆▆▇ 71% · gpt-5 · think med ─────────────────────────── ⏎ send ┘
```

**Files.**
- `src/piui/components/composer.ts` *(new)* (`PineComposer` class
  extending `CustomEditor`).
- `src/piui/components/borders.ts` *(new)* (`topBorder()`,
  `bottomBorder()` pure functions, theme-aware).
- `src/piui/index.ts` (register via `ctx.ui.setEditorComponent`).

**Acceptance.**
- Composer focus test: `Esc` interrupts, `Ctrl+L` opens model
  picker, all native app keybindings pass through (covered by
  extending `tests/unit/piui.test.ts`).
- Width fit: 60/80/100/120 columns, ascii/unicode, 7 themes =
  56 snapshots.

**Risk / rollback.** **[risky]** Override conflicts — if another
extension (e.g. `model-picker`, `signal-ui`, `skill-compat` from the
installed extensions list at `Docs/PineVim-Agent-Harness-Implementation-Plan.md`
E08) registers its own `setEditorComponent`, the conflict gate at
`src/piui/index.ts:142-150` already detects this; honor the existing
disarm behavior and re-check after this lands.

---

### D6 · SelectList / SettingsList theme override

**Current.** Pi's `SelectList` (model picker, session picker, settings
list) uses Pi's default colors for `borderAccent`, `selectedBg`,
`borderMuted`. The seven PineVIM themes already map these slots
correctly, but the **layout chrome** (the title, the item height, the
hint at the bottom) is not PineVim-styled.

**Proposed.**
- Define `PINEVIM_LIST_PAD` constants in `src/piui/layout.ts`
  *(new)* — title height 1, item height 1, footer hint height 1.
  These are *visual* constants only; do not change the component API.
- Add a `theme.overlay` namespace in each theme JSON
  (`overlay.border`, `overlay.title`, `overlay.hint`) with values
  derived from the existing palette. **8-key delta per theme; no
  schema change.**
- A small wrapper `ThemedSelectList` *(new)* that adapts Pi's
  `SelectList` to use these constants when a `pinevim` overlay flag
  is set on the chooser config. Where Pi does not allow override,
  document the gap and skip; do not fight the framework.

**Visual contract — `:models` picker in `pinevim-forest`, 80 cols:**

```
┌─ models · 23 ───────────────────────────────────────── F12 ? keys ─┐
│ ● openai / gpt-5                                  $3/M in · $15/M out│
│   openai / gpt-5-mini                             $0.20/M in · $0.60/M out│
│ ▶ anthropic / claude-3.7-sonnet                    $3/M in · $15/M out│
│ …                                                                Esc ━┘
```

**Files.**
- `src/piui/layout.ts` *(new)* (visual constants only).
- `src/piui/themes/pinevim-*.json` (8-key `overlay` namespace per
  theme).
- `src/piui/components/selectList.ts` *(new)* (wrapper).

**Acceptance.**
- Picker test: the model picker renders with the overlay when
  invoked via `/models` (covered by `tests/integration/pi.test.ts`
  fixture).

---

### D7 · Welcome splash (default-on, terminal-size-aware)

**Current.** `piui/index.ts:167-178` registers a `WELCOME_TYPE` entry
*only when* `PINEVIM_WELCOME=1`. Default behavior is no welcome. The
renderer at `renderers/runLedger.ts:124-159` produces three muted
lines.

**Proposed.** Make the welcome the **default first-run moment** with
three grades:

1. **First run ever** (`~/.local/share/pinevim/welcomed` absent) →
   full ASCII pine + 4-line orientation block:
   ```
                 /\
                /||\
               /_/\_\
                 ||
   ▲ pinevim — a forest you can work in.
   type to work  ·  F12 ? keys  ·  /pinevim help
   review the last run with /pinevim review  ·  learned skills with /pinevim skills
   ```
2. **Subsequent launches** → single-line chip:
   `▲ pinevim · type to work · F12 ? keys`
3. **Skipped entirely** at < 60 cols (current behavior).

**Files.**
- `src/piui/index.ts` (welcome logic; persist welcomed flag at
  `~/.local/share/pinevim/welcomed`).
- `src/piui/renderers/runLedger.ts` (extend `welcomeRenderer()` to
  handle a multi-line ASCII pine preamble when the data carries a
  `splash: true` flag).

**Acceptance.**
- Integration: first run of a fresh user dir produces the full
  splash; second run produces the chip; < 60 cols produces no
  welcome.

---

### D8 · Help overlay — sequence-dependent hints

**Current.** `src/adapters/tmux/panels.ts:52-69` lists **all** 13
prefix chords every time, including ones that are not currently
valid (e.g. `r` when the agent is alive, `i` when already in IDE).

**Proposed.** Make `helpPanelLines()` *state-aware*:
- Always show the help popup.
- Show **only the relevant** subset of chords: when the agent is
  alive, drop `r`; when in CHAT_ONLY mode, drop `i`/`a`/`Tab`/`Left`/
  `Right`; when the editor pane is dead, add `r` editor equivalent.
- Top three lines become a **state digest**: a one-line "what now"
  summary derived from the existing `nextAction()` logic at
  `panels.ts:153-160`.

**Visual contract — agent dead, no editor, 60 cols:**

```
┌─ pinevim · workspace controls ──────────────────── F12 ? keys ──┐
├─ now ──────────────────────────────────────────────────────────┤
│  ✗ pi dead · F12 r to retry                                    │
├─ keys ─────────────────────────────────────────────────────────┤
│  F12 s  workspace status                                       │
│  F12 t  session timeline                                       │
│  F12 ?  this help                                              │
│  F12 m  command menu                                           │
├─ commands ─────────────────────────────────────────────────────┤
│  /pinevim status   workspace status                            │
│  /pinevim help     this key list                               │
│  /pinevim review   files from the last run                    │
├─ press any key to close ───────────────────────────────────────┤
```

**Files.**
- `src/adapters/tmux/panels.ts` (`helpPanelLines()` takes the same
  `StatusFacts` as `statusPanelLines()`).

**Acceptance.**
- Unit: 6 fixtures — idle, busy, dead agent, no bridge, no editor,
  both-alive.

---

### D9 · Notification card (transient, in-pane, for in-band events)

**Current.** Toasts use `display-message` outside the Pi pane. They
disappear, they cannot be expanded, and they appear over terminal
chrome the user is reading.

**Proposed.** A lightweight **in-pane notification card** rendered
via a transient `Widget` (above the composer, replacing the band for
5 s, then auto-collapsing). Used only for **PineVim-authored
lifecycle events that the user might want to read later**:
"Pi restarted", "Editor exited", "Recovery confirmed", "Theme
applied".

- The card is one line: `▲ <message> · F12 ? to inspect`.
- Pressing the right prefix key opens the corresponding popup
  (timeline / status / help).
- Auto-collapses after 5 s; remains until dismissed by any keypress
  if mouse is not available.

**Files.**
- `src/piui/components/notification.ts` *(new)*.
- `src/piui/index.ts` (lifecycle hooks).

**Acceptance.**
- Integration: a forced agent restart produces the card within 100
  ms of the bridge reconnect; the card disappears after 5 s; the
  card can be dismissed with any key.

**Risk / rollback.** Adds a fifth widget to the PineVim-owned
surface area; verify against the `BAND_KEY = "pinevim"` widget slot
collision in `piui/index.ts:100`.

---

### D10 · Glyph vocabulary extension (state, not decoration)

**Current.** `src/piui/glyphs.ts:9-76` defines 14 glyphs across
user/running/success/failure/warning/interrupted/waiting/
compacting/thinking/stopped/queued/rule/rail/error. All have ASCII
fallbacks. No decorative glyphs.

**Proposed.** Extend the vocabulary by **8 glyphs** that carry data,
none decorative:
- `compacted` (`⌂` / `c`) — used after `session_compact` to mark the
  turn that was compacted.
- `forked` (`⑃` / `f`) — when the user explicitly forks a session.
- `edited` (`✎` / `~`) — when a turn produced a `toolPaths` entry
  (matches `runs.ts:73-77`).
- `cached` (`↻` / `@`) — when a tool result is reused from the
  session cache (Pi exposes this in `tool_execution_end`).
- `parallel` (`⫶` / `&`) — when two or more tools ran concurrently
  this turn (derived from `state.toolsRun` rate, no new API needed).
- `agent` (`▲` / `^`) — the PineVIM mark glyph (was named "pine" but
  repurposed as the brand mark in §D1).
- `pine` (`⌐` / `+`) — used as the **separator** in identity rails
  (replacing `·`/`-` between brand-mark and workspace).
- `frame` (`◌` / `o`) — used in the band rail between chips when
  the band is wide enough to need a heavier visual element.

**Constraint.** Every new glyph has an ASCII fallback. Every new
glyph carries or sits beside a label. None are decorative.

**Files.**
- `src/piui/glyphs.ts` (extend `GlyphKey`, `UNICODE`, `ASCII`).
- `src/piui/components/header.ts`, `band.ts`, `deck.ts` (consume
  the new glyphs at the relevant sites).

**Acceptance.**
- Unit: every `GlyphKey` resolves in both modes; mono theme renders
  zero SGR (existing pattern, extended).
- Visual: ASCII mode never contains the Unicode variants.

---

### D11 · PineVim palette philosophy and 2 new theme families

**Current.** Seven themes:
- `pinevim-dark` — pine-green, teal, sand accents on slate.
- `pinevim-light` — same hues, desaturated, on bone.
- `pinevim-mono` — grayscale only; the terminal-safe path.
- `pinevim-neon` — neon variants of the same roles.
- `pinevim-cyberpunk` — adapted from Theo's Cyberpunk Neon
  (`pinevim-cyberpunk.NOTICE`).
- `pinevim-forest` — high-saturation pine, dense green background.
- `pinevim-snow` — light-mode cousin of forest with desaturated
  accents.

**[gap] · No themes that establish mood**, only role-mapped
variants.

**Proposed.** Add **2 theme families** (4 themes total) that
establish mood, not just role mapping:

- `pinevim-dusk` — muted blues + amber accents; for late-night
  work; mapped onto existing 8-role palette.
- `pinevim-sunrise` — warm oranges + sage; for morning work.
- `pinevim-aurora` — magenta + cyan gradients (using truecolor
  only — degrades to mono gracefully).
- `pinevim-paper` — high-contrast paper-like light mode
  (currently `pinevim-snow` is the only light variant; `paper`
  is a higher-contrast, less-saturated alternative).

**Files.**
- `src/piui/themes/pinevim-dusk.json` *(new)*.
- `src/piui/themes/pinevim-sunrise.json` *(new)*.
- `src/piui/themes/pinevim-aurora.json` *(new)*.
- `src/piui/themes/pinevim-paper.json` *(new)*.
- `src/piui/theme.ts` (extend `PINEVIM_THEMES`).
- `src/core/theme-install.ts` (extend theme copy/install paths).
- `scripts/copy-themes.mjs` (new themes copied alongside the
  existing 7).

**Acceptance.**
- All 11 themes render at 60/80/120 cols × ascii/unicode ×
  mono-safe = 66 new fixtures in the snapshot matrix.

---

## 6. PineVim-as-LazyVim IDE — Design Improvements

The IDE pane is launched by `src/editor.ts` with a runtime path
pointing at `require('pinevim').arm()`. Improvements here must
**not** edit the user's LazyVim config or install plugins. They
ride on `vim.api.nvim_set_hl` calls at startup, on `vim.g.*`
augments the rest of the user's config can read, and on a single
optional `User PinevimReady` autocmd the user's config can opt into.

### E1 · PineVim startup splash (neovim-side)

**Current.** `nvim` shows the LazyVim splash. PineVim has no entry
in the startup sequence.

**Proposed.** A **transient pine motif** in the `MESSAGE` of the
day, executed from `theme-script.ts` at `VimEnter`:

```
                 /\
                /||\
               /_/\_\
                 ||
        pinevim — a forest you can work in.
```

Rendered once for ~800 ms (`vim.defer_fn` to clear and let
LazyVim's normal flow continue), themed by the active PineVIM
palette. Not modal; not blocking; not a full-screen takeover.
Skipped at `vim.o.lines < 16`.

**Files.**
- `src/editor/theme-script.ts` (`M.splash()` function; defer-clear
  from `VimEnter`).
- `src/editor/splash.lua` *(new)* (extracted for testability).

**Acceptance.**
- Integration: `:source` of `theme-script.ts` produces the splash
  on `VimEnter`; cleared by 800 ms.
- Manual: at < 16 lines, no splash.

---

### E2 · PineVim wordmark in the editor

**Current.** No brand in the editor chrome.

**Proposed.** Three minimal brand markers, all theme-driven:

1. **`tabline`** — when bufferline is **not** installed, register a
   minimal `tabline` that renders `[▲] filename · modified` per
   buffer.
2. **`statusline`** — when lualine is **not** installed, register a
   single-line `statusline` that renders
   `[▲ pinevim] %f · %m · %y · %{get(g:, "pinevim_agent",
   "offline")} · %l:%c`. The `pinevim_agent` `vim.g.*` is set by §E3
   below.
3. **Empty buffer** — when `&buftype == ""` and the buffer is
   empty, prepend a one-line brand header
   (`▲ pinevim — buffer unsaved. type to begin.`).

**Files.**
- `src/editor/wordmark.lua` *(new)* (tabline, statusline, empty-
  buffer header).
- `src/editor/theme-script.ts` (require + apply from `M.arm`).

**Acceptance.**
- Manual: launch PineVim with no lualine / no bufferline; brand
  markers visible.
- Manual: launch PineVim with both installed; behavior unchanged
  (delegated to user plugins).

**Risk / rollback.** **[risky]** Overriding the user's `tabline`
without a guard is intrusive. Guard on `vim.g.pinevim_chrome`
(default `true`); honor user opt-out.

---

### E3 · `vim.g.pinevim_agent_lifecycle` augment + statusline component

**Current.** The Neovim pane cannot tell that Pi is busy, dead, or
waiting. No bridge, no signal.

**Proposed.**
- A **read-only `vim.g`** namespace, populated by an in-Neovim
  `Timer` that polls a per-session bridge file
  (`{runtime}/pinevim-agent.json`, written by the PineVim controller
  every 250 ms — extends `src/core/controller.ts`'s existing
  status-render loop).
- `vim.g.pinevim_agent_lifecycle` — `idle | thinking | streaming |
  tooling | waiting | compacting | error | interrupted | offline`.
- `vim.g.pinevim_agent_tools` — number string.
- `vim.g.pinevim_agent_ctx` — percent string.
- `vim.g.pinevim_agent_model` — short name string.
- A `StatusLine` Lua snippet `require('pinevim').statusline()`
  exported from `wordmark.lua` (§E2) for users who want to embed
  these into their existing lualine/bufferline config.

**Visual contract — paired IDE mode, 80 cols:**

```
▲ pinevim · fix-auth · bufferline │ ● tools 3 · gpt-5 · ctx 42% │ utf-8 · 14:32
```

**Files.**
- `src/editor/wordmark.lua` (statusline component).
- `src/editor/bridge-poll.lua` *(new)* (the Timer + JSON read).
- `src/core/controller.ts` (extend the existing status render loop
  to write `pinevim-agent.json`).
- `src/piui/index.ts` (extend `bridgeStatus()` to include the
  lifecycle fields).

**Acceptance.**
- Integration: agent dead for 1 s → `vim.g.pinevim_agent_lifecycle
  == "error"` within 1.5 s of `pane-died`.
- Manual: agent resumes → `vim.g.pinevim_agent_lifecycle == "idle"`
  within 1.5 s.

**Risk / rollback.** **[risky]** Adds a small file write per render
loop; the loop already runs. Cap write rate at 4 Hz; debounce in
the bridge poll. Rollback: delete the JSON file write; the
`vim.g.*` namespace stays defined as `"offline"`.

---

### E4 · Focused-pane chrome (single-character gutter)

**Current.** When paired in IDE mode, the editor and the agent
panes look like two identical LazyVim panes. There is no visible
cue for which pane is "the editor sibling of the chat" beyond the
border.

**Proposed.** A one-character **gutter indicator** that the user
can read at a glance:
- The **editor pane** has a thin `▌` (3/8-cell block) in
  `borderAccent` on its left edge — visible only on the active
  pane, fades to `dim` on the inactive.
- The **agent pane** mirrors the right edge in the same color.

Implemented via `WinBar` highlights (`hi WinBar ctermfg=…`) on the
two windows; **no `WinSeparator` change** (already themed in
`theme-script.ts:110`).

**Files.**
- `src/editor/wordmark.lua` (`setup_focused_chrome()`).

**Acceptance.**
- Visual: the gutter indicator is visible in the active pane, dim
  in the inactive pane, and absent when the editor is the only
  pane.

---

### E5 · Theme-tracked status line for the IDE

**Current.** `theme-script.ts:185-225` styles lualine when lualine
is installed. When it is not, the IDE has no styled status line.

**Proposed.** Extend `theme-script.ts` so the **statusline
foreground colors track the active PineVIM theme** even when
lualine is installed:

- `:hi StatusLine fg=<text> bg=NONE` — always.
- `:hi StatusLineNC fg=<muted> bg=NONE` — always.
- The user's lualine config is honored; the PineVIM
  `StatusLine`/`StatusLineNC` highlights serve as the floor.

**Visual contract — 80 cols, no lualine, `pinevim-forest`:**

```
▲ pinevim · fix-auth.lua · ~/code/api · main ● tools 3 · gpt-5 · ctx 42% · 14:32
```

(themed `muted` on the segments, themed `accent` on the model
name, themed `text` on the filename.)

**Files.**
- `src/editor/theme-script.ts` (extend the existing
  `M.apply()` block).
- `src/editor/wordmark.lua` (default `statusline` expression when
  no plugin owns it).

**Acceptance.**
- Manual: launch with no plugins → brand-themed status line.
- Manual: launch with lualine → lualine's status line keeps its
  PineVIM-themed colors.

---

### E6 · Trunk-factor parity (visual continuity across panes)

**Current.** `theme-script.ts` reads the same JSON theme and
applies the accent / muted / dim / border / text roles directly.
It does **not** apply the trunk factor that `logo.ts:45-65` uses on
the Pi side to derive a darker accent for the canopy/trunk
two-tone treatment. The result: the Neovim pane has no second
tone of the accent.

**Proposed.** Compute a trunk factor in Lua equivalent to
`trunkFactorFor()` (`logo.ts:61-64`) and expose the shaded accent
as `vim.g.pinevim_trunk_accent`. Used by the splash, the empty-
buffer header, and any other PineVim-authored highlight group that
wants the two-tone treatment.

**Files.**
- `src/editor/theme-script.ts` (`load_trunk_factor()` + assign
  `vim.g.pinevim_trunk_accent`).
- `src/editor/wordmark.lua` (consume `vim.g.pinevim_trunk_accent`).

**Acceptance.**
- Manual: `pinevim-snow` session shows a slightly lighter accent
  in the Neovim splash than `pinevim-dark`.

---

### E7 · IDE pane "you are in PineVim" status footer (toggle)

**Current.** No persistent indicator that the user is inside a
PineVim IDE pane.

**Proposed.** A **toggleable** (`vim.g.pinevim_footer = true |
false`, default `true`) two-line footer beneath the message area:
```
▲ pinevim IDE · paired with agent pane
● tools 3 · gpt-5 · ctx 42% · F12 ? keys
```

Honors `vim.g.pinevim_chrome` for the master toggle. **Off by
default** for users with established statusline configurations;
documented as a recommended opt-in for first-time users.

**Files.**
- `src/editor/wordmark.lua` (`M.footer()` helper).

**Acceptance.**
- Manual: `:lua vim.g.pinevim_footer = true` shows the footer;
  `:lua vim.g.pinevim_footer = false` hides it.

**Risk / rollback.** Off by default; opt-in. Rollback: default
to `false` in `theme-script.ts`.

---

## 7. Cross-Pane Continuity

The PineVim brand identity must be **the same** on both sides of
the split. The following items are shared concerns.

### X1 · Synchronized themes (already in place, harden)

**Current.** `src/core/theme-install.ts` and
`src/editor/theme-script.ts` read the same theme JSON. The Lua
side resolves the active theme via `PINEVIM_UI_THEME` env var or
`vim.o.background`.

**Proposed.**
- **Harden** the resolution: when neither env var nor `background`
  is set, default to `pinevim-dark` (not "follow Pi" — the IDE
  does not see Pi's theme, so following it silently is misleading).
- **Live theme switch**: when the user runs `/settings → theme →
  pinevim-neon`, both panes repaint within 500 ms. The controller
  writes the new theme to the same JSON; the Lua side re-reads on
  a 500-ms `Timer`; the Pi side repaints on the next
  `theme_changed` event.
- **Theme palette parity test**: a unit test that, for each theme,
  asserts that both the Pi side and the Neovim side map the same
  8-role palette to the same hex values (modulo the trunk-factor
  treatment).

**Files.**
- `src/editor/theme-script.ts` (`reload_theme()` function).
- `src/core/theme-install.ts` (watch the JSON file for changes).
- `tests/unit/theme-parity.test.ts` *(new)*.

**Acceptance.**
- Unit: 7 themes × 8 roles = 56 parity assertions.
- Integration: live theme switch from `dark` → `forest` repaints
  both panes within 500 ms.

---

### X2 · Identical ENV vocabulary

**Current.** The Pi pane has `ENV model think ctx branch hint` in
the deck (`components/deck.ts:55-81`). The Neovim pane has
nothing equivalent.

**Proposed.** Expose the same five values as
`vim.g.pinevim_{model,think,ctx,branch}` (§E3 above), and document
them as the canonical **PineVim ENV** vocabulary. A user
configuring their own statusline can rely on these names being
stable across the workspace.

**Files.**
- `src/editor/wordmark.lua` (export the namespace).
- `Docs/User-Guide.md` *(new)* (document the namespace).

---

### X3 · Help panel parity

**Current.** `src/adapters/tmux/panels.ts:91-117` renders a
sectioned help popup. The Neovim pane has `:help pinevim` if the
docs are shipped (currently they are not — only `Docs/*.md`
exists).

**Proposed.** Generate `:help pinevim` at build time from the
existing `helpRows(prefix)` array (the source of truth) into a
plain-text help file (`dist/editor/pinevim.txt`), `:helptags`-ready.
Pin the file path so users get it from any workspace with the
PineVim runtime.

**Files.**
- `scripts/build-helptags.mjs` *(new)* (generator).
- `src/editor/theme-script.ts` (`:helptags dist/editor` at arm
  time).

**Acceptance.**
- Manual: `:help pinevim` opens a sectioned help file matching
  the tmux popup.

---

## 8. Snapshot & Visual Regression Strategy

The existing 17-fixture matrix at
`tests/fixtures/header-*.txt` + `tests/fixtures/header-snapshots.json`
is the right model. Extend it for every new design surface.

### S1 · Header/band/deck snapshot manifest

- Extend the JSON manifest with new entries for `band` and `deck`
  surfaces (currently header-only).
- 6 lifecycle states × 4 width bands × 2 glyph modes × 7 themes =
  336 fixtures for the band alone (downsample to the
  most-discriminating subset: 4 states × 4 widths × 2 modes ×
  3 themes = 96).
- Reuse `scripts/update-header-snapshots.mjs` (rename to
  `scripts/update-chrome-snapshots.mjs`).

### S2 · Tool card fixture manifest

- 6 tool states × 4 width bands × 2 glyph modes = 48 fixtures.
- Pin to `tests/fixtures/tool-card-*.txt` with a `tool-card-snapshots.json`
  manifest.

### S3 · Timeline popup fixture manifest

- Empty / 1 run / 12 runs / live + 1 / busy + failed = 5 fixtures.
- Pin to `tests/fixtures/timeline-*.txt`.

### S4 · Theme parity snapshot

- Per §X1 above: 7 themes × 8 roles × 2 sides = 112 assertions,
  captured as a JSON fixture (`tests/fixtures/theme-parity.json`).

### S5 · ASCII-fallback smoke

- A single test that loads every theme in ASCII mode and asserts
  the rendered output is **entirely 7-bit printable** (no Unicode
  escapes, no SGR). The mono theme and the `ui.glyphs: "ascii"`
  config must produce identical renderings modulo the trunk factor.

---

## 9. Implementation Roadmap

The roadmap groups changes by **uniqueness-per-effort** and by
**risk to the existing snapshot matrix**. Phase ordering
deliberately preserves the audit plan's release-gating priority
(.agents/PineVim_Agent_Harness_Audit_and_Improvement_Plan.md §9)
and inserts design improvements where they unblock identity
adoption.

### Phase 1 — Identity foundation (1 week, no protocol change)

**Goal.** Make the PineVim mark visible everywhere it currently
isn't.

| Order | ID | Surface | Files | Effort |
|---|---|---|---|---|
| 1.1 | D1 | Branded tmux status line | `statusline.ts`, `styled.ts`, `theme-install.ts`, `controller.ts` | M |
| 1.2 | D2 | Themed toasts | `client.ts`, `controller.ts` | S |
| 1.3 | D11 | 4 new theme families | `themes/pinevim-{dusk,sunrise,aurora,paper}.json`, `theme.ts`, `theme-install.ts` | S |
| 1.4 | E1 | PineVim startup splash (neovim-side) | `theme-script.ts`, `editor/splash.lua` | S |
| 1.5 | E2 | PineVim wordmark in editor | `editor/wordmark.lua`, `theme-script.ts` | S |

**Risk.** Snapshot matrix churn is heavy in 1.1; budget a
regenerate-and-review pass. **[risky]** E2 may surprise users
without `vim.g.pinevim_chrome` opt-in; ship 1.5 with the opt-out
defaulted to `true`.

**Outcome.** A new user can identify PineVim in under 1 second at
every visible surface: tmux status line, splash, editor chrome,
toasts.

### Phase 2 — Frame polish (1 week, render-only changes)

**Goal.** Compose what already exists into a more coherent frame.

| Order | ID | Surface | Files | Effort |
|---|---|---|---|---|
| 2.1 | D3 | Run ledger as branded anchor | `renderers/runLedger.ts`, `components/band.ts` | S |
| 2.2 | D4 | Context sparkline in deck | `components/deck.ts`, `runs.ts`, `glyphs.ts`, `piui/index.ts` | M |
| 2.3 | D7 | Welcome splash (default-on) | `piui/index.ts`, `renderers/runLedger.ts` | S |
| 2.4 | D8 | State-aware help popup | `adapters/tmux/panels.ts` | S |
| 2.5 | E5 | Theme-tracked status line for IDE | `theme-script.ts`, `editor/wordmark.lua` | S |
| 2.6 | X3 | Help panel parity (`:help pinevim`) | `scripts/build-helptags.mjs`, `theme-script.ts` | S |

**Outcome.** The PineVim frame carries information that was
already there but unrendered (context history, run diffstat, state-
aware hints, welcome moment).

### Phase 3 — Custom editor + cross-pane wiring (2 weeks, biggest payoff)

**Goal.** Replace the stock Pi editor with `PineComposer` and
wire the Neovim pane to the same lifecycle vocabulary.

| Order | ID | Surface | Files | Effort |
|---|---|---|---|---|
| 3.1 | D5 | Composer redesign | `components/composer.ts`, `components/borders.ts`, `piui/index.ts` | L |
| 3.2 | D6 | SelectList / SettingsList overlay | `layout.ts`, themes, `components/selectList.ts` | M |
| 3.3 | D9 | In-pane notification card | `components/notification.ts`, `piui/index.ts` | M |
| 3.4 | E3 | `vim.g.pinevim_agent_*` augment | `editor/wordmark.lua`, `editor/bridge-poll.lua`, `controller.ts`, `piui/index.ts` | M |
| 3.5 | E4 | Focused-pane chrome | `editor/wordmark.lua` | S |
| 3.6 | X1 | Live theme switch | `theme-script.ts`, `theme-install.ts`, `tests/unit/theme-parity.test.ts` | M |

**Outcome.** The two panes share an `ENV` vocabulary; the user
sees agent lifecycle in the editor chrome without any RPC bridge.

### Phase 4 — Distinctive identity (1 week, low risk, high visibility)

**Goal.** Establish PineVim's distinctive identity at every gap.

| Order | ID | Surface | Files | Effort |
|---|---|---|---|---|
| 4.1 | D10 | Extended glyph vocabulary | `glyphs.ts`, all components | S |
| 4.2 | E6 | Trunk-factor parity | `theme-script.ts`, `editor/wordmark.lua` | S |
| 4.3 | E7 | IDE footer (opt-in) | `editor/wordmark.lua` | S |
| 4.4 | X2 | ENV vocabulary documented | `Docs/User-Guide.md` | S |

**Outcome.** PineVim has a distinctive vocabulary that survives
all theme and width permutations.

---

## 10. Acceptance Criteria

A change is **done** when **all** of the following are true:

1. The visual contract (the rendered ASCII mockup in §3/§4) is
   captured in a snapshot fixture under `tests/fixtures/`.
2. The snapshot fixture is registered in the relevant manifest
   (header / band / deck / tool card / timeline / theme parity).
3. ASCII mode renders without Unicode escapes — a property test
   fails if any SGR or non-7-bit byte slips through.
4. The mono theme and the `ui.glyphs: "ascii"` config produce
   identical renderings modulo the trunk factor.
5. The new render path does not break the existing
   `tests/unit/piui.test.ts` snapshot matrix.
6. The new component does not duplicate the protocol or the
   lifecycle reducer; if it needs a new field, the audit plan's
   "small additive schema extension" rule applies.
7. A `Docs/User-Guide.md` entry exists for any new config key or
   `vim.g.*` augment.
8. A `pinevim` snapshot diff is reviewed manually before the
   snapshot is regenerated (the existing
   `scripts/update-header-snapshots.mjs` pattern).

---

## 11. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Snapshot matrix churn breaks the build | High | Update manifests in a **single PR per phase**; pin the snapshot updater to require explicit `--review` flag |
| Override conflict with `model-picker` / `signal-ui` / `skill-compat` extensions | Medium | Honor the existing disarm behavior at `piui/index.ts:142-150`; document in `Docs/Compatibility.md` |
| Status line color tokens collapse in 256/8-color modes | Medium | Keep the existing `TMUX_COLOUR` mapping (`styled.ts:41-50`); add truecolor as a parallel path |
| Trunk-factor computation in Lua diverges from the JS implementation | Medium | Single shared fixture (`tests/fixtures/trunk-factor.json`) consumed by both sides via build-time codegen |
| New `vim.g.*` namespace leaks into the user's statusline | Low | Document the namespace in `Docs/User-Guide.md`; namespace is `pinevim_*` only |
| Welcome splash feels like a "registration screen" | Low | Multi-grade welcome (§D7) — full splash only on first run; chip on subsequent runs; skipped at narrow widths |
| Idle motion creep (animated borders, blinking cursors) | Low | Pillar #2 forbids it; review each PR against §2 |

---

## 12. What This Plan Does Not Do (Explicit Non-Goals)

These are inherited from the existing plans and confirmed here:

- No command palette (`pinevim-ui-ux-redesign-plan.md:559-572`).
- No file tree / sidebar (`README.md:113`).
- No permission cards — PineVim delegates tool approval to Pi's
  built-in flow (per `.agents/PineVim_Agent_Harness_Audit_and_Improvement_Plan.md` F-10).
- No third pane, no custom terminal emulator.
- No emoji-heavy chrome (conflicts with pillar #3).
- No animated ASCII art, no sound, no mouse-heavy interactions
  (inherited from §6 of the audit plan).
- No edits to the user's LazyVim / Neovim config.
- No new Pi-internal API dependence beyond what is already used.

---

## 13. Open Questions

1. **`vim.g.pinevim_chrome` default.** E2's master toggle defaults
   to `true` (show brand markers) — confirm with the user before
   the first PR; default `true` matches pillar #1 (the forest is
   the identity) but conflicts with the user's existing config. - Keep true

2. **Welcome persistence path.** `~/.local/share/pinevim/welcomed`
   is proposed; the existing runtime dirs are under
   `${XDG_RUNTIME_DIR:-/tmp}`. Confirm path policy before the
   first PR. - Confirm

3. **Theme family names.** "Dusk", "Sunrise", "Aurora", "Paper" are
   mood names; existing families are role names ("dark", "light",
   "mono", "neon", "cyberpunk", "forest", "snow"). Mixing mood
   and role families is fine but should be documented in
   `Docs/Compatibility.md`. - Confirm

4. **Trunk factor in 256-color modes.** The JS side falls back to
   single-tone when not truecolor (`logo.ts:88-101`); the Lua
   side has no equivalent guard. Confirm whether the guard should
   land in the Lua side or in the theme loader. - Lua Side

5. **`Docs/User-Guide.md`** does not exist yet. Confirm the doc
   location before §E3 / §X2 land; the existing `Docs/*.md`
   structure suggests `Docs/User-Guide.md` is correct, but
   `README.md` may be the canonical place for first-time user
   docs. - Create Docs/User-Guide.md

---

## 14. Cross-References to Existing Plans

- Technical/architectural audit (P0 release-gating, F-01..F-16):
  `.agents/PineVim_Agent_Harness_Audit_and_Improvement_Plan.md`.
- Original UI/UX redesign (the design ground covered before any
  implementation, including the `CustomEditor` composer mockup at
  §10 and the `SelectList` design at §11):
  `.agents/pinevim-ui-ux-redesign-plan.md`.
- Production UX self-improving harness (data model, events, skill
  architecture, phased roadmap): `.agents/pinevim-production-ui-
  ux-self-improving-harness-implementation-plan.md`.
- The original implementation contract (the architecture record):
  `Docs/PineVim-Agent-Harness-Implementation-Plan.md`.

This plan is **not** a replacement for any of the above. It is a
**design-focused supplement** that picks up where the original
UI/UX redesign left off (post-implementation), centered on
**identity, differentiation, and visual continuity** across the
two panes.

---

## Appendix A · Quick Mockup Index

All mockups in this plan are rendered as 7-bit ASCII so they
appear identical on a `TERM=dumb` terminal, on a `pinevim-mono`
session, and in the snapshot fixtures. The Unicode glyphs are the
*production* form; the ASCII form is the **fallback contract** and
is what the snapshot tests assert.

| ID | Width | State | Render |
|---|---|---|---|
| D1 (status, paired) | 120 | paired IDE | `▲ pinevim · ~/proj · IDE editor · ● agent tools 3 · model gpt-5 · think med · ctx ▮▮▮▮▯ 42% · main · F12 ?` |
| D1 (status, panic) | 60 | agent dead | `▲ pinevim · ~/proj · CHAT · ✗ pi dead · F12 r retry · F12 ? help` |
| D2 (toast) | — | editor exited | `display-message -d 8000 "✗ editor exited · F12 i retry · /ide open"` |
| D3 (run ledger) | 80 | settled run 7 | `▲ run 7 ── 5 tools · 0 failed · 38.2 s · ctx 51% ──────` |
| D4 (sparkline) | 80 | ctx 71% | `ctx ▁▂▃▅▆▇ 71%` |
| D5 (composer, idle) | 100 | idle | `+-- CHAT · ● idle ────────────────────────────────────── F12 ? keys -+` |
| D5 (composer, busy) | 80 | tooling | `+-- CHAT · ● tools 3 · read ─────────────────────── Esc interrupts -+` |
| D6 (model picker) | 80 | model picker | `+-- models · 23 ──────────────────────────────────── F12 ? keys -+` |
| D7 (welcome, first run) | 60 | first run | `▲ pinevim — a forest you can work in.` |
| D8 (help, dead) | 60 | agent dead | `+-- pinevim · workspace controls ─────────────── F12 ? keys -+` |
| E1 (splash) | 60 | startup | `▲ pinevim — a forest you can work in.` |
| E3 (statusline, paired) | 80 | paired IDE | `▲ pinevim · fix-auth · bufferline │ ● tools 3 · gpt-5 · ctx 42% │ utf-8 · 14:32` |

---

## Appendix B · Glossary

- **Brand marker** — a single ASCII character (`▲`) or a small
  motif (`/\\`) that signals "PineVim" at a glance. Reserved for
  the brand; never used decoratively.
- **ENV row** — the canonical five-segment status row
  (`model · think · ctx · branch · agent`) shared by the chat pane
  deck and the editor pane statusline.
- **Pillar** — one of the four design commitments in §2. Every
  change must serve at least one.
- **Trunk factor** — the multiplier applied to the accent to
  derive the trunk/canopy two-tone treatment; light themes use
  factors > 1, dark themes < 1 (`logo.ts:45-65`).
- **Two-tone** — canopy in accent, trunk in trunk-shade; the
  visual signature of the pine tree mark. Applied in the JS side
  today; §E6 extends to the Lua side.
- **PineVim-authored vs. external** — PineVim-authored strings
  are trusted and can carry color/glyphs (subject to the
  notification validator); external strings must pass through
  `literal()` / `plain()` to strip color and non-ASCII.
