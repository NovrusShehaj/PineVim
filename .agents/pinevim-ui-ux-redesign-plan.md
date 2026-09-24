# PineVIM UI/UX Redesign Plan

Status: planning document (no implementation). Written 2026-09-23 against the repository state on branch `chore/UI-Improvements`.

Convention used throughout:

- **[confirmed]** — a fact verified directly in this repository's source (`src/`, `Docs/`, `tests/`, `scripts/`, `.github/copilot-instructions.md`) or in the pinned dependency `node_modules/@earendil-works/pi-coding-agent@0.87.1` (`.d.ts` and compiled `.js` inspected).
- **[proposed]** — new architecture, behavior, or files that do not exist yet and are recommended by this plan.
- **[unknown]** — could not be determined from available files; must be validated during implementation.

---

## 1. Executive Summary

**Current situation.** PineVIM is *not* a fork of the pi-agent UI. **[confirmed]** It is a Node.js/TypeScript CLI (`src/cli.ts`, shipped as `bin: pinevim → dist/cli.js`) that runs the stock Pi coding agent (`@earendil-works/pi-coding-agent` 0.87.1, pinned in `src/adapters/pi/compatibility.ts`) and the user's normal Neovim inside a private tmux server (`src/adapters/tmux/`). The entire chat experience the user sees — transcript, composer, tool rendering, model/session pickers, dialogs — is **Pi's own TUI running unmodified in a tmux pane**. **[confirmed]** PineVIM's own user-facing surface today consists of:

1. a single plain-text tmux status line, written by `AppController.renderStatus()` (`src/core/controller.ts`) through `Tmux.status()` into `status-left` (format fixed in `tmuxConfig()`, `src/adapters/tmux/config.ts`: `status-position bottom`, `status-right ''`, `status-format[0] '#{status-left}'`);
2. plain ASCII `display-message` toasts (`Tmux.notify()`, stripped by `plain()`/`literal()` in `src/diagnostics.ts` to codepoints 32–126);
3. tmux `confirm-before` prompts for quit/retry (`Tmux.confirm()`);
4. five slash commands registered by the bundled extension (`/ide`, `/pinevim …`, `src/adapters/pi/extension.ts`);
5. one-line help and status strings assembled in `AppController` (`intent === "help"` and `status()`).

**Primary weaknesses.** PineVIM has zero visual ownership of the conversation surface; its identity is carried by command names and one text line. Agent observability is a boolean (`state.busy`), so "running" in the status line is the only lifecycle signal, and it can disagree with what Pi shows. Help is a single dense sentence. Toasts and the status line are colorless and ASCII-clipped *by construction* (`plain()` strips ANSI and non-ASCII). Tool activity, turn progress, context pressure, waiting states, and interruption are invisible on every PineVIM-owned surface. There is no empty state that says "you are in a PineVIM workspace."

**The opportunity (verified, not assumed).** Pi 0.87.1's public extension API exposes deep, supported UI customization that PineVIM's bundled extension currently does not use beyond `registerCommand` and `ui.notify`. **[confirmed]** Verified exports and extension hooks include:

- `ctx.ui.setFooter(factory)` / `setHeader(factory)` — full replacement components, factory receives `(tui, theme, footerData: ReadonlyFooterDataProvider)`;
- `ctx.ui.setEditorComponent(factory)` with the exported `CustomEditor` base class (border rendering, working-status embedding, app keybindings);
- `ctx.ui.setWidget(key, content, { placement: "aboveEditor" | "belowEditor" })`;
- `ctx.ui.setWorkingIndicator({ frames, intervalMs })`, `setWorkingMessage()`, `setWorkingVisible()`, `setHiddenThinkingLabel()`;
- tool presentation override: `registerTool()` with the same name as a built-in replaces its definition in the session registry (`definitionRegistry.set(...)` in `agent-session.js`; `withBuiltInRenderers()` honors an extension-supplied `renderCall`/`renderResult` over the built-in), plus `renderShell: "default" | "self"`;
- theme registration via the `resources_discover` event (`ResourcesDiscoverResult.themePaths`) and non-persistent application via `ctx.ui.setTheme(themeInstance)` (a `Theme` *instance* does not write Pi settings; a *name* does — verified in `interactive-mode.js`);
- `registerMessageRenderer` / `registerEntryRenderer` for persisted custom entries, `registerMarkdownTransformer`, `registerShortcut`, `addAutocompleteProvider`, `ui.custom<T>()` overlays, `ui.setStatus()` footer segments;
- ~40 event types including `turn_start/turn_end`, `tool_execution_start/update/end`, `ui_prompt_start/end`, `agent_settled`, `session_compact`, `model_select`, `thinking_level_select`.

On the controller side, PineVIM already owns the tmux chrome and can grow it: `display-popup` and `display-menu` are available on the required tmux ≥ 3.5 **[confirmed requirement; popup availability per tmux ≥ 3.2]**, and the status line budget (`status-left-length 250`) is unused.

**Recommended direction.** A hybrid of Direction B (Workspace Canvas) and Direction A (Instrumented Console), called **"Canvas core, Console telemetry."** The bundled extension claims the *frame* of the chat pane — theme, header banner, footer status deck, composer, tool-card grammar, lifecycle indicators, turn summaries — using only the public extension API above. The controller upgrades the tmux layer — a styled, segmented status line, styled toasts, popup help/status panels, a prefix menu — and the control protocol gains a small additive status extension so the tmux line and deck agree. Differentiation is structural (layout of chrome, block grammar, lifecycle semantics, control-plane panels), not cosmetic.

**Expected result.** With colors removed, PineVIM is still identifiable by: its chrome anatomy (banner → transcript → status deck → composer), its gutter-and-rail message grammar, its tool-card system with state glyphs, its turn-summary blocks, and its tmux control plane (segmented status line, popup panels, coherent F12 chord set). The result reads as "a PineVIM workspace running Pi," not "pi-agent with different colors."

---

## 2. Current UI Architecture

This section maps every UI-relevant component in the repository. **[confirmed unless noted]**

### 2.1 Process and ownership map

```
pinevim (src/cli.ts)
  ├─ validates platform/Node/TTY/geometry (tooSmall, src/core/layout.ts)
  ├─ loads strict config (src/config.ts): prefix, agentRatio, pi/nvim/tmux paths, logLevel
  ├─ acquires exclusive workspace lock, creates/resumes metadata (src/persistence.ts)
  ├─ spawns private tmux server (src/adapters/tmux/client.ts, config in tmuxConfig())
  │    ├─ pane %0: pi --extension dist/adapters/pi/extension.js   (Pi's own TUI)
  │    └─ pane %1: nvim                                           (IDE mode, created on /ide)
  ├─ attaches as tmux client (tmux.attach)
  └─ AppController (src/core/controller.ts)
       ├─ serializes intents through an operation queue (MAX_QUEUE 64, OP_MS 10s)
       ├─ control server: unix socket + token auth (src/control/server.ts)
       ├─ bridge peer: the Pi extension (src/adapters/pi/extension.ts, src/control/client.ts)
       ├─ helper peer: one-shot tmux run-shell helper (src/control/helper.ts)
       ├─ state machine (src/core/state.ts): Mode × Focus × Child × lifecycle
       └─ layout convergence (Tmux.layout()) + persisted metadata
```

### 2.2 The state that UI surfaces can see

`State` (`src/core/state.ts`) carries exactly: `mode` (`CHAT_ONLY | IDE_WITH_AGENT | IDE_FOCUS`), `focus` (`agent | editor`), `agent`/`editor` `Child` records (`pane`, `pid`, `alive`, `ready`, `exitCode`, `signal`), `geometry`, `ratio`, `compact`, `generation`, `epoch`, `bridge`, `busy`, `pending`, `lifecycle` (`running | stopping | detached | stopped`), `sessionId`, `sessionFile`, `previousMode`. The bridge enriches `busy`, `sessionId`, `sessionFile`, and slash-ownership via `bridgeStatus()` from the extension's `status` payload (`cwd`, `sessionId`, `sessionFile`, `busy`, `ide`, `pinevim` — an exhaustive whitelist in `src/control/protocol.ts`). **Everything else about the conversation (turns, tools, model, context usage) is invisible to the controller — deliberately, because terminal-output scraping is a forbidden pattern in this repo** (`.github/copilot-instructions.md`: "do not introduce shell interpolation or terminal-output scraping").

### 2.3 PineVIM-owned rendering today

| Surface | Producer | Format | Limits |
|---|---|---|---|
| tmux `status-left` | `AppController.renderStatus()` → `Tmux.status()` → `set-option -g status-left` | `basename(workspace,16) \| MODE focus agent \| prefix ?` + hint | ≤ 500 chars stored; displayed budget `status-left-length 250`; **[confirmed]** `literal()` strips all color/Unicode |
| Toasts | `Tmux.notify()` → `display-message -d 8000` | single plain line | ≤ 500 chars, ASCII-only via `literal()` |
| Confirmations | `Tmux.confirm()` → `confirm-before -p "… (y/n)"` | tmux native prompt | ≤ 160 chars |
| `/pinevim status` | `AppController.status()` returned to extension → `ui.notify(..., "info")` | one flat string, truncated to 100 chars of display name, 500 total | rendered as a Pi toast, not a panel |
| `/pinevim help`, F12 `?` | `dispatch("help")` → `tmux.notify()` | one dense sentence | 8000 ms toast |
| Slash commands | `registerCommand("ide"|"pinevim")` in `src/adapters/pi/extension.ts` | Pi autocomplete entries | ownership-gated by `commandOwnership()` (`src/adapters/pi/compatibility.ts`) |

tmux chrome facts (`tmuxConfig()`): `status on`, `status-position bottom`, `status-interval 0`, `status-left-length 250`, `status-right ''`, `status-format[0] '#{status-left}'`, `mouse on`, `allow-passthrough off`, `set-clipboard external`, `history-limit 10000`, `remain-on-exit on`, `automatic-rename off`, `set-titles off`, `prefix <config>`, `prefix2 None`, `unbind -a -T prefix`. Prefix bindings (`Tmux.bindings()`): `i`, `c`, `a`, `Tab`, `Left`, `Right`, `q`, `r`, `?`, double-prefix literal. Hooks: `client-resized`, `window-layout-changed`, `pane-focus-in`, `pane-died`, `client-detached` → coalesced reconcile (`Coalescer`, 50–150 ms).

### 2.4 Pi-side rendering stack (the pane contents)

**[confirmed from `node_modules/@earendil-works/pi-coding-agent/dist/` and `.../pi-tui/dist/`]**

- Renderer: `pi-tui` — main-screen (non-alt) renderer by default with components `VStack/HStack/Box/Text/TruncatedText/Markdown/Editor/SelectList/SettingsList/ScrollView/Loader/CancellableLoader/Image`, an overlay system (`OverlayOptions`: width/maxHeight/anchor/offset/`visible(width,height)` predicate), mouse regions, OSC-8 hyperlinks, kitty/iTerm2 image protocols, fuzzy matching, kill-ring editor.
- Interactive mode (`modes/interactive/interactive-mode.js`) hosts the chat: `UserMessageComponent`, `AssistantMessageComponent` (thinking blocks + markdown), `ToolExecutionComponent` (per-tool renderers from `core/tools/renderers/`), footer (`FooterComponent`: cwd, token stats, context usage), header (startup banner), working indicator (`WorkingStatusIndicator`), extension widget containers above/below the editor, extension dialogs replacing the editor area while open.
- Theme: `Theme` class with `fg(color, text)` / `bg(bg, text)` / `bold/italic/underline/inverse/strikethrough`; `ThemeColor` union (`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`, `userMessageText`, `customMessageText`, `customMessageLabel`, `toolTitle`, `toolOutput`, `md*`, `toolDiffAdded/Removed/Context`, `syntax*`, `thinking<level>`, `bashMode`); `ThemeBg` union (`selectedBg`, `searchMatchBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`); color modes `truecolor | 256color`; themes are JSON files loadable from paths.
- Editor: `Editor` (pi-tui) extended by `CustomEditor` (pi-coding-agent) which adds app keybindings (`app.interrupt`, `app.clear`, `app.exit`, `app.thinking.*`, `app.model.*`, `app.tools.expand`, `app.message.*`, `app.session.*`, …), an optional `embedWorkingStatus` mode that renders working/compaction/retry status in the editor's top border, overridable `renderTopBorder(width, hiddenLineCount)`, and `onExtensionShortcut`.
- Extension UI surface in use by PineVIM today: `registerCommand` ×2 and `ui.notify`. **Everything else listed in §1 is unused headroom.**

### 2.5 What this architecture means for a redesign

- **Enables:** every visual change to the chat surface has a supported, versioned entry point (§1 list). No forking of Pi, no scraping. The bundled extension is compiled TypeScript shipped inside `dist/` and loaded by absolute path (`piCommand()` adds `--extension`), so it can grow into a multi-module `src/piui/` tree compiled alongside (the same pattern `src/control/helper.ts` already uses with sibling imports). **[confirmed pattern; multi-file layout proposed]**
- **Constrains:** Pi is pinned to 0.87.1 and every release must revalidate the public contract (`SUPPORTED_PI`, `piExecutable()` package-metadata walk). Any Pi-internal appearance we rely on (component behavior details) is upgrade-coupled; the compatibility gate must be extended to assert the specific API surface we use.
- **Needs restructuring first (small):** (a) `plain()`/`literal()` force ASCII-only, style-free tmux text — styled writers must be added rather than fighting these helpers (they remain correct for security-sensitive interpolation); (b) the control protocol whitelist needs an additive schema extension to carry richer agent state (both endpoints ship in this one package, so there is no cross-version compatibility hazard; the 16 KiB record cap is respected by design).

---

## 3. Current-State UX Audit

### 3.1 What works (preserve)

| Strength | Evidence | Verdict |
|---|---|---|
| Prefix chords work even when Pi is busy or dead (independent of the bridge) | bindings via tmux `bind-key` + `run-shell` helper; controller queue independent | **Keep unchanged** |
| Safe-quit choreography (confirm-before when busy, never kills children, deadline) | `AppController.quit()`, `Tmux.confirm()` | **Keep; improve wording/styling only** |
| Layout rules: 101×24 paired threshold, agent width `clamp(round(0.35×(cols−1)), 40, 64)` with editor ≥ 60, ratio memory, compact single-pane + Tab | `src/core/layout.ts`, `Tmux.layout()` validation | **Keep; these are PineVIM structural identity** |
| Status dedup (only write `status-left` on change) | `renderStatus()` `lastStatus` guard | **Keep; extend to new writer** |
| Recovery/resume flows with conservative identity checks | `persistence.ts`, `cli.ts --resume` | **Keep** |
| Slash-ownership collision handling (`/ide`, `/pinevim` refused when ambiguous) | `commandOwnership()`, controller `COLLISION` errors | **Keep** |
| Tool output truncation and expansion in Pi (native) | Pi `truncate*`, `app.tools.expand` | **Keep (Pi-owned)** |

### 3.2 What feels inherited from pi-agent

- 100% of conversation pixels: transcript grammar, composer, tool cards, dialogs, pickers, header/footer (Pi's own), spinner, markdown styling. **[confirmed — PineVIM's extension renders none of these]**
- Two slash commands with Pi-generic descriptions ("Open/close the live editor view", "PineVim workspace controls").
- Identity signals today: the string `PineVim 0.1.0` inside `/pinevim status` text, `pinevim` in the tmux status line, and command names. That is the entire brand presence.

### 3.3 Usability problems (with locations)

1. **Help is a wall of text.** `dispatch("help")` emits one sentence listing 9 chords; `ui.notify`/`display-message` shows it for 8 s. A new user cannot scan it, and it vanishes.
2. **Status is a flat string.** `status()` interleaves workspace, mode, focus, agent state, editor state, three version strings, and the hint, truncated at 500 chars — unscannable, and duplicated by the status line in a different format (drift risk between `status()` and `renderStatus()`).
3. **Toasts lose emphasis.** `plain()` maps every codepoint outside 32–126 to `?` and drops ANSI entirely, so even error toasts carry no signal beyond words.
4. **No empty state.** A fresh workspace shows Pi's generic startup; nothing indicates "this is a PineVIM workspace, here is what the prefix does."
5. **Mode transitions are silent.** `/ide` re-splits the window with no orientation cue about what changed or what is now focused.
6. **Death states are passive.** `renderStatus()` prints "Pi dead"/"disconnected"; the recovery action (prefix `r`) is only discoverable via the help toast. `previousMode` exists in state but is never surfaced.
7. **Two status vocabularies.** `renderStatus()` says `CHAT`/`IDE`/`FOCUS`, `status()` prints raw enum values (`CHAT_ONLY | IDE_WITH_AGENT`); users must learn both.

### 3.4 Visual identity problems

- No glyph or marker system; no gutter/rail grammar; no PineVIM color application anywhere (`plain()` forbids it); the chat pane could belong to any pi-agent setup.
- The status line — PineVIM's one owned pixel row — is plain text with no segmentation, color, or state emphasis.

### 3.5 Agentic UX problems

- **Lifecycle is one bit.** `busy = !isIdle() || hasPendingMessages()` (extension `data()`). No distinction between streaming text, executing tools, waiting for permission (`ui_prompt_start`), compacting (`session_compact`), or settling (`agent_settled`) — all of which the extension *could* observe today.
- **No turn abstraction.** A 30-tool turn is an undifferentiated scroll of alternating messages; nothing marks where work began/ended or what it cost (time, tokens, context).
- **No tool-outcome scanning.** Pi renders each tool result natively, but there is no compact "what happened this turn" surface, and failures do not get special treatment on PineVIM surfaces.
- **Status-line contradictions.** The controller's `busy` may lag Pi's real state (status is reported on `agent_start`, `model_select`, `session_info_changed`, `agent_settled` — not continuously), so "agent running" in tmux can be stale while Pi has settled, or vice versa.

### 3.6 Cognitive load

- The `/pinevim status` string and help toast both front-load version/environment trivia (`Pi 0.87.1; tmux 3.5a; Node 22.x`) that belongs on demand, not in a scan path.
- Conversely, the status line *under*-communicates: no context pressure, no model, no lifecycle beyond running/idle.

### 3.7 Discoverability

- The prefix is invisible until the user reads the README: the status line shows `F12 ?` (good, minimal), but nothing teaches the chord set interactively; no menu, no panels.
- Slash discovery is Pi's generic autocomplete with two entries; no descriptions of subcommands (`agent hide/show` etc. are parsed free-text by `parseCommand()` and only documented in error text).

### 3.8 Technical constraints recap

- `plain()`/`literal()` ASCII stripping (by design, security-motivated) — needs new bounded styled writers for tmux markup.
- `status-left-length 250` total budget for the whole status line (markup included).
- Control protocol: exhaustive payload whitelists, 16 KiB records, no unknown fields — additive change required for richer status.
- Ownership contract: README and `.github/copilot-instructions.md` state PineVim "does not … replace Pi's custom editor/header/footer." This redesign intentionally revises that contract for PineVIM's own components (see §5.4 and §17 Phase 0); it must be done as a documented amendment with opt-outs and respect for user-installed customizations, not silently.
- Pi pin 0.87.1: UI work must extend `compatibility.ts` gating (assert presence/behavior of each API used).

---

## 4. PineVIM Design Principles

These seven principles govern every recommendation below and future UI decisions.

1. **Own the frame, respect the engine.** PineVIM owns chrome (header, status deck, tmux surfaces, panels), Pi owns conversation content and pickers. All in-pane integration flows through the public extension API; PineVIM never reimplements or patches Pi internals.
2. **Structure over color.** Any state must remain distinguishable with all color removed — via position, glyphs, density, and labels. Color is an accelerator, never the sole carrier.
3. **Lifecycle-first observability.** The agent's lifecycle (idle → streaming → tooling → waiting → settling → error/interrupted) is a first-class display object with exactly one authoritative source (the extension's event stream), projected onto all surfaces (deck, composer, tmux status, toasts).
4. **Progressive disclosure.** One line by default for anything enumerable (tools, status, help); expansion on demand; nothing permanent that only matters occasionally.
5. **Calm surface.** No ambient motion. Animation exists only to mark state transitions (working indicator, state flips) and stops when work stops. Redraws are event-driven, never timed loops beyond the working indicator.
6. **Terminal-native.** Keyboard-first, tmux-aware, honest about being a terminal app. Unicode glyphs enhance; ASCII equivalents always exist. Nothing requires truecolor, images, or mouse.
7. **Honesty.** Show what is knowable (turn index, tool names/outcomes, context %, model, thinking level); never fabricate plans, progress percentages, or "thinking…" narratives the model did not emit.

---

## 5. Three Design Directions

### Direction A — Instrumented Console (PineVIM as control plane)

**Philosophy:** Pi's chat stays untouched; PineVIM's identity lives in the tmux layer it already owns.

- **Layout:** unchanged (Pi pane / editor split rules stay).
- **Conversation structure:** Pi default.
- **Input:** Pi default editor.
- **Agent-state visualization:** tmux status line becomes a segmented, colored chip row: `workspace · CHAT/IDE · agent=idle|streaming|tools|waiting · ctx 42% · F12 ?`; lifecycle derived from an extended status payload.
- **Tool calls:** Pi default rendering.
- **Status presentation:** `display-popup` help panel (full chord table), status panel (key/value grid), `display-menu` under the prefix for context actions; styled toasts with severity colors and short prefix (`pinevim:`).
- **Visual identity:** tmux chrome only.
- **Strengths:** smallest scope; no ownership-contract change; zero Pi-upgrade coupling; works even when Pi is dead (panels are controller-side).
- **Weaknesses:** the chat pane — where users spend 95% of attention — remains 100% generic; fails the "recognizable without colors" bar for the conversation itself; differentiation is shallow against "pi-agent + a nice tmux status."
- **Technical complexity:** Low–medium (new tmux writers, protocol extension, two popups).
- **Usability tradeoffs:** big discoverability win (popups), no readability win in-transcript.
- **Differentiation from pi-agent:** mostly *workflow* (control plane), little *visual/structural* in-conversation.

### Direction B — Workspace Canvas (PineVIM claims the frame)

**Philosophy:** the bundled extension dresses the entire chat pane as a PineVIM surface, structurally.

- **Layout (in-pane):** banner header (workspace · session · mode chip), transcript with gutter/rail grammar, status deck footer (lifecycle band + context gauge + model/thinking + branch/hints), composer with border grammar and mode/lifecycle chips.
- **Conversation structure:** message grammar with gutters and rail glyphs (§7); turn-summary blocks appended after each settled turn (§8); tool calls as unified state-glyph cards (§9).
- **Input:** PineComposer extending `CustomEditor` — bordered frame, contextual hint row, working-status embedded in the top border, PineVIM autocomplete layer for `/pinevim`/`/ide` subcommands.
- **Agent-state visualization:** lifecycle band in the deck, working indicator restyled as state glyph + current activity label, thinking level glyph, `ui_prompt` waiting band.
- **Tool calls:** renderer overrides for all built-ins (bash/read/edit/write/grep/find/ls/powershell) sharing one card grammar; diffstat emphasis for edits; collapse/expand honored from Pi's `app.tools.expand`.
- **Status presentation:** the deck is the single in-pane source of truth; tmux status line stays minimal (workspace + mode + lifecycle + ctx).
- **Visual identity:** PineVIM theme (registered via `resources_discover` themePaths, applied non-persistently via a `Theme` instance), glyph set, spacing rules, header/deck anatomy.
- **Strengths:** maximal in-conversation differentiation; all through public API; monochrome-recognizable; the composer and tool cards are the two surfaces users look at constantly.
- **Weaknesses:** largest scope; revises the "does not replace Pi's editor/header/footer" contract (needs amendment + opt-outs); strongest Pi-version coupling (must revalidate per release — but the gate already exists for exactly this purpose).
- **Technical complexity:** Medium–high (composer, ~8 renderer overrides, deck, theme, summaries).
- **Usability tradeoffs:** users lose Pi's default footer/editor familiarity; mitigated by opt-out config and keeping all Pi keybindings (`CustomEditor` delegates by default).
- **Differentiation from pi-agent:** structural + interaction + product identity.

### Direction C — Split-identity Cockpit (tmux-native first, minimal Pi work)

**Philosophy:** meet in the middle — Direction A's console plus only the cheapest Pi-side wins (theme + footer), skipping composer/tool cards.

- **Strengths:** medium scope; visible change in both layers quickly.
- **Weaknesses:** incoherent mid-state — the deck describes a lifecycle the transcript doesn't visualize; the composer stays generic (the single most-looked-at component); tool cards absent means the deck's "tools: 3" has no in-transcript counterpart.
- **Technical complexity:** Medium.
- **Differentiation:** moderate; likely to still read as "pi-agent with a footer."

### Recommended Direction — Hybrid B+A: **"Canvas core, Console telemetry"**

Rationale:

1. The brief's bar — "recognizable as PineVIM even if brand colors were removed" — can only be met inside the conversation surface, which only Direction B touches. A canvas without a console leaves PineVIM's genuine differentiator (workspace control, recovery, focus) unexpressed; A supplies that cheaply and independently.
2. The dependency graph naturally fuses them: the tmux status line (A) and the status deck (B) should render from the same extension-computed lifecycle model and the same extended status payload (protocol v1.1). Building A first creates the data spine B needs on the controller side; B's extension-side components read Pi state directly via `ctx` and do not wait on the protocol.
3. Direction C is rejected as incoherent (deck narrates what the transcript doesn't show). Direction A alone is rejected as cosmetically sufficient but structurally thin — precisely the failure mode the brief forbids.
4. Risk management: A is independently shippable and survives Pi upgrades trivially; B is gated per-phase behind the compatibility assertions, and every B component has an opt-out and a fallback to Pi's default (§21).

---

## 6. Proposed Interface Architecture

**[proposed]** Regions and ownership:

```
┌─────────────────────────────── terminal (tmux client) ───────────────────────────────┐
│  PineVIM-owned: tmux status-left (bottom row, segmented, styled)                     │
│ ┌──────────────────────────── private tmux window ──────────────────────────────────┐│
│ │  Pi pane (chat)                             │  nvim pane (IDE_WITH_AGENT, ≥101×24)││
│ │  ┌───────────────────────────────────────┐  │                                     ││
│ │  │ HEADER (PineVIM, ext)                 │  │   PineVIM never draws inside the    ││
│ │  │  workspace · session · mode chip      │  │   editor pane. Neovim owns it.      ││
│ │  ├───────────────────────────────────────┤  │                                     ││
│ │  │ TRANSCRIPT (Pi-owned content,         │  │                                     ││
│ │  │  PineVIM grammar via renderers)       │  │                                     ││
│ │  │  gutters · rails · tool cards ·       │  │                                     ││
│ │  │  turn summaries                       │  │                                     ││
│ │  ├───────────────────────────────────────┤  │                                     ││
│ │  │ [extension widgets aboveEditor]       │  │                                     ││
│ │  ├───────────────────────────────────────┤  │                                     ││
│ │  │ COMPOSER (PineComposer, ext)          │  │                                     ││
│ │  │  top border: mode · lifecycle · hint  │  │                                     ││
│ │  │  input area (Pi Editor behavior)      │  │                                     ││
│ │  │  bottom border: ctx gauge · model     │  │                                     ││
│ │  ├───────────────────────────────────────┤  │                                     ││
│ │  │ STATUS DECK (PineVIM footer, ext)     │  │                                     ││
│ │  └───────────────────────────────────────┘  │                                     ││
│ └────────────────────────────────────────────────────────────────────────────────────┘│
│  [api] CHAT agent=idle · ctx 42% · F12 i/c/a Tab q ?          ← tmux status-left     │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

Controller-owned overlays (work regardless of Pi state, including dead/busy Pi):

```
F12 ?  →  display-popup (≥40×12, closes on Esc/q)          F12 s  →  display-popup status
┌─ PineVIM keys ─────────────────────────┐                 ┌─ workspace ────────────────────┐
│ F12 i  IDE view        F12 c  chat     │                 │ workspace  ~/code/api          │
│ F12 a  hide/show agent F12 Tab focus   │                 │ mode/focus CHAT · agent        │
│ F12 <  agent width −   F12 >  width +  │                 │ pi pane     alive · ready      │
│ F12 r  retry pi        F12 q  quit     │                 │ editor      not started        │
│ F12 s  this status     F12 ?  keys     │                 │ bridge      connected          │
│ F12 F12 literal F12    Esc    close    │                 │ session     fix-auth (a1b2…)   │
└─────────────────────────────────────────┘                 │ versions    pi 0.87.1 tmux 3.5 │
                                                            └────────────────────────────────┘
```

Wireframe — `CHAT_ONLY`, 100×30 (the default first-run view):

```
┌────────────────────────────────────────────────────────────────────────┐
│ pinevim  ~/code/api   session fix-auth                     CHAT  ● idle │  header
├────────────────────────────────────────────────────────────────────────┤
│ › fix the flaky auth test                                              │  user (gutter ›)
│                                                                        │
│ ✓ read  tests/auth/session.test.ts          18 ms                      │  tool card
│ ✓ bash  npm test -- auth                    4.2 s   12 passed 1 failed │  tool card
│ ✗ edit  src/auth/session.ts                 no match for "refresh()"  │  tool card (fail)
│                                                                        │
│ The flake comes from a shared clock: `refresh()` uses a 30 s window…   │  agent text
│                                                                        │
│ ─ turn 3 · 3 tools · 1 failed · 12.4 s · ctx +2.1k ────────────────── │  turn summary
├────────────────────────────────────────────────────────────────────────┤
│ ● idle   ctx ▮▮▮▮▯ 42%   gpt-5 · think med   ~/code/api  fix-auth      │  status deck
│ › …                                        /commands   F12 ? keys      │  composer
└────────────────────────────────────────────────────────────────────────┘
 [api] CHAT agent=idle ctx 42%                                    F12 ?   tmux status
```

Wireframe — `IDE_WITH_AGENT` at 112×30 (agent right, editor ≥ 60 cols; compact header, one-line deck):

```
┌──────────────────────────────────────┬─────────────────────────────────┐
│                                      │ pinevim  fix-auth        IDE ●  │
│           nvim (user's editor)       ├─────────────────────────────────┤
│        PineVIM draws nothing here    │ › fix the flaky auth test       │
│                                      │ ✓ read … · ✓ bash … · ✗ edit …  │
│                                      │ The flake comes from a shared…  │
│                                      │ ─ turn 3 · 3 tools · 1 fail ──  │
│                                      ├─────────────────────────────────┤
│                                      │ ctx 42% · gpt-5 · med   F12 ?   │
│                                      │ › …                             │
└──────────────────────────────────────┴─────────────────────────────────┘
 [api] IDE editor+agent ctx 42%                                   F12 Tab
```

Compact (< 101 cols or < 24 rows, per `layout.ts compact()`): single pane, Tab toggles focus; header suppressed below 24 rows; deck collapses to its first line; tmux status line gains the `Tab switches` hint (already implemented today).

---

## 7. Conversation Design

**[proposed unless marked]** The transcript keeps Pi's rendering engine (Markdown, code highlighting, wrapping). PineVIM adds a *grammar*: where blocks sit, what marks them, and how metadata attaches. All color roles resolve through the PineVIM theme (§13); all semantics survive in monochrome via glyph + position.

### 7.1 Message grammar

| Element | Glyph | Position | Text treatment | Metadata | Monochrome cue |
|---|---|---|---|---|---|
| User message | `›` | gutter col 0; text indented 2 | `userMessageText` (theme), bold | none (keep clean) | glyph + indent |
| Agent response | *(none)* | flush left, no gutter | `text`, normal | none | absence of gutter = agent |
| Agent thinking (collapsed) | `◦` | rail | `muted`, one line `◦ thinking · med · 214 tok` | tokens [unknown if available per-block; hide if not] | glyph |
| PineVIM system notice | `·` | gutter | `muted`, lowercase label `· pinevim: …` | — | glyph |
| Tool card | state glyph (`● ✓ ✗ ▲`) | rail col 0 | label `toolTitle`, summary `toolOutput` | duration, counts (§9) | glyph |
| Turn summary | `─` rule line | full width | `muted`, one line (§8) | elapsed · tools · ctx delta | rule + text |
| Warning | `▲` | rail | `warning` | — | glyph |
| Error | `✗` | rail | `error` | — | glyph |
| Permission waiting | `?` | rail + composer chip | `accent` | kind (select/confirm/input) | glyph + composer chip |
| Compaction marker | `⌁` | rail | `muted`, `⌁ compacted · N entries summarized` | — | glyph |

ASCII fallback set (used when `ui.glyphs: "ascii"` config is set or the terminal fails a capability probe): `›`, `●`→`*`, `✓`→`+`, `✗`→`x`, `▲`→`!`, `⌁`→`~`, `?` unchanged, `◦`→`-`, `─`→`-`, `▮`→`#`, `▯`→`-`.

### 7.2 Code and Markdown

- Code blocks keep Pi's highlighter; the PineVIM theme restyles `mdCodeBlockBorder`, `mdCode`, `mdHeading`, `mdListBullet` etc. PineVIM adds **no** new chrome inside code blocks (copy fidelity beats decoration; rectangular selection stays clean).
- `registerMarkdownTransformer`: normalize horizontal rules (`---`) in assistant output to the PineVIM section rule (`─` repeated to width, `muted`) so agent-drawn separators match the native grammar; collapse 3+ consecutive blank-line artifacts during streaming; no other transformation (transformers run on content — keep it presentation-only and reversible). **[proposed; transformer signature confirmed: `(markdown, {messageType, isStreaming, availableWidth}) => string`]**

### 7.3 Long responses, long conversations

- Wrapping and scrolling remain Pi's (main-screen renderer with scrollback; copy/paste preserved). PineVIM does not introduce a custom viewport (that would fight tmux copy-mode and the repo's no-scraping rule).
- Scannability comes from the grammar: rail glyphs let the eye track tool outcomes; turn summaries create anchors every turn; nothing else changes density.

### 7.4 Message metadata

- Per-message metadata is **not** added (noise). Time/tokens/cost attach to the *turn summary* only (§8). The model and thinking level live in the deck and composer bottom border, not per message.
- Exception: the user message shows no metadata; agent errors inline keep Pi's error rendering, plus the `✗` rail glyph via the theme's `error` role where Pi already marks it.

### 7.5 What stays exactly as-is

- Pi's markdown block rendering, syntax highlighting, image rendering (kitty/iTerm2), diff rendering primitives (`renderDiff`), autocomplete dropdown visuals, session/model/tree pickers and dialogs, kill-ring and editor text behavior, external editor (`app.editor.external`), tool output truncation policy.

## 8. Agent Activity & Progress Design

### 8.1 Visible states

The extension derives a single `AgentLifecycle` from Pi events (all confirmed observable in 0.87.1): `idle | thinking | streaming | tooling | waiting | compacting | settling | error | interrupted`.

| Lifecycle | Derived from (confirmed events) | Primary display | Secondary |
|---|---|---|---|
| `idle` | `agent_settled` + `isIdle()` | deck band `● idle`, composer chip | tmux status `agent=idle` |
| `thinking` | `message_update` with thinking content on latest assistant message | `◦ thinking · med` + working indicator restyle | composer chip |
| `streaming` | `message_start`/`message_update` text content | working indicator + composer top border | tmux `agent=run` |
| `tooling` | `tool_execution_start` (count, latest tool name) | deck `✓ 3 tools · read`, live tool card glyph `●` | tmux `agent=run` |
| `waiting` | `ui_prompt_start`/`ui_prompt_end` with `kind` | deck band `? needs you`, composer chip with kind | tmux `agent=wait` |
| `compacting` | `session_before_compact` → `session_compact(_failed)` | deck `⌁ compacting`, then rail marker | — |
| `settling` | `agent_end` until `agent_settled` | deck `● settling` (brief) | — |
| `error` | assistant message with `stopReason === "error"` / `errorMessage` [confirmed fields on AgentMessage; mapping validated in Phase 3] | deck `✗ error`, tool card `✗` | toast styling |
| `interrupted` | abort signal / `agent_end` after interrupt | deck `■ interrupted`, turn summary notes abort | — |

Rules: exactly one lifecycle at a time; the extension computes it and exposes it to (a) deck, (b) composer chips, (c) a queued `status` report to the controller. The controller never guesses lifecycle from its own `busy` bit once the extension is connected; `busy` remains the fallback when the bridge is down.

### 8.2 Transitions

```
idle ──turn_start──▶ thinking/streaming ──tool_execution_start──▶ tooling
  ▲                        │                                          │
  │              ui_prompt_start               tool_execution_end (more?)│
  │                        ▼                                          ▼
  └──agent_settled── settling ◀──agent_end── ... ◀──────────────────────┘
                                │
                 session_before_compact ──▶ compacting ──▶ resume stream
```

Waiting (`waiting`) and `error` override any in-flight display; they clear on `ui_prompt_end` / next `turn_start` respectively.

### 8.3 Reasoning/progress representation

- Thinking level is shown as a stable glyph + short word (`◦ off · min · low · med · high · max`) in the deck and composer border; color via the theme's per-level thinking colors (`getThinkingBorderColor` exists and Pi already uses it for the editor border — PineVIM reuses the same mapping for coherence). Monochrome-safe: the word is always printed.
- No fabricated progress bars for LLM streaming (unknowable); the working indicator communicates activity, the token/context gauge in the deck communicates consumption after each turn (`ctx.getContextUsage()`).
- Queued messages (`hasPendingMessages()`) add a `⇅ N queued` chip in the composer top border (Pi already displays queued messages above the editor; the chip adds a count only — confirmed Pi renders queued messages natively, count text is proposed).

### 8.4 Task progress (per turn)

Each turn gets a **turn summary line** appended when the turn ends (`turn_end`, confirmed payload includes `turnIndex`, `toolResults`, entry ids):

```
─ turn 7 · 5 tools · 0 failed · 38.2 s · ctx +4.6k · ▮ 51% ────────────
```

- Appended via `pi.appendEntry("pinevim.turn_summary", …)` (persists across resume; custom entries confirmed not sent to the LLM) and rendered through `registerEntryRenderer("pinevim.turn_summary")` — so it survives restart without replaying fake UI.
- Elapsed = `turn_end` timestamp minus `turn_start` timestamp (both confirmed present). ctx delta = `getContextUsage()` sampled at turn end vs. the previous turn's stored value (stored in the entry's `data`).
- Tool count/failures come from `toolResults[].isError` on the confirmed `turn_end` payload.
- On abort, the summary reads `─ turn 7 · interrupted after 3 tools ────`.

### 8.5 Waiting & interruption

- Waiting: the deck's band turns to `? needs you — /permissions` when kind is unknown, or `? confirm`, `? select`, `? input` per `ui_prompt_start.kind`; the composer border uses the `accent` role. Monochrome: the `?` glyph plus the word.
- Interrupt: Pi handles the keybinding; PineVIM's extension listens for the abort (via `ctx.signal` when streaming) and flips the lifecycle to `interrupted`, restyles the working indicator to `■ stopped`, and writes the turn summary noting the interruption. No modal dialogs are invented over Pi's native interrupt behavior.

### 8.6 Completion

`agent_settled` → deck returns to `● idle`, the working indicator disappears (restored via `setWorkingVisible(false)` then Pi's default on next run), and the turn summary line is appended. Multiple rapid settle/start cycles collapse: if a new `turn_start` arrives within 2 s and no user input intervened, the pending summary is dropped rather than stacking one-line summaries between continuous work (prevents summary spam during queued-message chains). [proposed heuristic]

---

## 9. Tool Execution Design

**[proposed]** One card grammar for all built-in tools via `registerTool()` overrides (name-shadowing confirmed viable, §1/§2.4) plus `renderShell: "self"` where the card replaces the standard colored shell. Card anatomy:

```
<glyph> <tool> <primary-arg> [<secondary>] [<counts>] [<duration>]
```

Single line when collapsed; expansion (Pi's global `app.tools.expand` toggle, and per-render `expanded` option in `ToolRenderResultOptions`) reveals output regions per tool.

State glyphs: `●` running · `✓` success · `▲` warning (exit≠0 but stderr-only, or truncation note) · `✗` failure · `⏸` interrupted (tool batch aborted) · `?` permission requested. ASCII fallbacks: `* + ! x = ?`.

### 9.1 Lifecycle treatments (examples at 100 cols)

Running (streaming bash, output arriving via `tool_execution_update` → `isPartial`):

```
● bash npm test -- auth                        2.1s
│   ✗ tests/auth/session.test.ts
│     expect(retry).toBe(1)
│   11 passed, 1 failed, 2 skipped
│▌                                             (spinner in card glyph; output tail max 6 lines)
```

Success (collapsed):

```
✓ bash npm test -- auth                        4.2s  12 passed 1 failed
```

Success (expanded — result view, Pi expansion state honored):

```
✓ bash npm test -- auth                        4.2s
│   12 passing (3.9s)
│   1 failing
│   1) auth › refresh › retries once
│   exit 1
```

Failed:

```
✗ edit src/auth/session.ts                     no match for "refresh()"
```

Permission request (tool `tool_call` blocked by Pi's native permission flow; PineVIM adds a `?` chip and the deck flips to `waiting`):

```
? bash rm -rf dist/cache
│   PineVIM: waiting for your approval (composer: y/n)
```

Interrupted:

```
⏸ bash npm run build                           stopped at 12.0s
```

### 9.2 Per-tool primary arguments (confirmed input shapes in 0.87.1)

| Tool | Collapsed line | Expanded adds |
|---|---|---|
| `read` | `✓ read src/core/state.ts` + line range if args say so | first lines preview (≤6) |
| `edit` | `✓ edit src/auth/session.ts` + **diffstat** `+12 −3` (from `details`/`generateDiffString` availability; fall back to file only if [unknown]) | the unified diff (Pi's `renderDiff` reused, themed) |
| `write` | `✓ write src/new.ts` + size | content preview ≤6 lines |
| `bash`/`powershell` | `✓ bash <cmd>` truncated to fit + duration | output tail (≤10 lines), exit code; `▲` when truncated |
| `grep`/`find` | `✓ grep "refresh" src/` + hit count | match list (≤8 lines) |
| `ls` | `✓ ls src/` + entry count | listing ≤10 lines |
| custom/extension tools | name + args JSON summary ≤1 line | raw JSON block |

### 9.3 Repeated and grouped calls

Consecutive identical tool+primary-arg pairs collapse to a repeat chip (rare; mostly distinct calls in practice — implemented only if logs show it matters):

```
✓ grep "refresh" src/   ×3 runs · 14 hits total
```

Nested operations are *not* synthesized (PineVIM does not see Pi's internal sub-steps; honesty rule §4.7).

### 9.4 Large output

Preserve Pi's truncation limits (`truncateHead/Tail`, `DEFAULT_MAX_LINES/BYTES` confirmed exported). Card expansion shows the same truncated-but-labeled view (`… 214 lines hidden (18.2 KiB) …`). `▲` + label when truncation occurred.

### 9.5 What stays Pi-owned

Execution, permission policy and approval dialogs, output truncation computation, image results, tool result persistence. The PineVIM renderers only re-present; they never alter `content` (the `tool_result` handler is not used for presentation — renderers receive the result read-only via `renderResult`).

---

## 10. Composer Redesign

**[proposed]** `PineComposer extends CustomEditor` (exported base class confirmed; `super.handleInput(data)` for unhandled keys keeps every Pi keybinding, kill-ring, paste, autocomplete, external editor). Registered via `ctx.ui.setEditorComponent(factory)`; factory receives `(tui, theme, keybindings)` and constructs `PineComposer` with `embedWorkingStatus: true` so working/compaction/retry status renders in the top border (Pi-native option).

### 10.1 Mockup (focused, idle, 100 cols)

```
┌ CHAT · ›  type a message, / for commands ───────────────────── F12 ? keys ┐
│ fix the flaky auth test                                                   │
└ ctx ▮▮▮▮▯ 42% · gpt-5 · think med ──────────────────────────── ⏎ send ───┘
```

- **Top border** (override `renderTopBorder(width, hiddenLineCount)`): left = mode chip (`CHAT`/`IDE`) + lifecycle chip (`● idle`, `● tools 3`, `? needs you`); right = `F12 ?` pointer when the terminal is ≥ 80 cols. Border color follows lifecycle (`muted` idle, thinking-level color while streaming — same mapping Pi already uses for the editor border, `accent` when waiting, `error` after error) — color is duplicated by the chip text, never sole carrier.
- **Input area**: unchanged Pi `Editor` behavior (multiline, history, kill-ring, paste collapse, image paste, autocomplete).
- **Bottom border**: context gauge (10-cell `▮▮▮▮▯` + %, from `ctx.getContextUsage()`; hidden when `tokens === null`), model short name (`ctx.model`), thinking level glyph; right side `⏎ send` hint only when the editor has text. At < 60 cols the bottom border hides; at < 40 the top border hides (plain Pi editor remains).
- **Placeholder**: Pi supports empty-state text in the editor; PineVIM sets `type a message, / for commands` (only when empty and unfocused-history is empty — match Pi's existing placeholder mechanics [unknown exact API; validated in Phase 3; fallback: skip placeholder]).

### 10.2 Modes & states

| State | Composer presentation |
|---|---|
| idle | as above |
| streaming/tooling | top-border lifecycle chip live; border color shift; `Esc interrupts` hint right side |
| waiting (ui_prompt) | chip `? needs you`; border `accent`; Pi's dialog replaces the editor area (native) |
| error | chip `✗ error — see above`; border `error` until next input |
| command mode | typed `/` opens Pi autocomplete; PineVIM adds providers for `/ide`, `/pinevim` with subcommand completion via `addAutocompleteProvider(factory)` (confirmed wrap-over-built-in) |
| compact terminal | borders drop progressively (see §15) |
| bridge down / Pi dead | not shown (pane dead); tmux layer takes over messaging |

### 10.3 Contextual information placement

Near input (always): lifecycle, context gauge, model, thinking. Elsewhere (never in composer): workspace path, git branch, session name, versions — these live in the header/deck/status line per §12.

### 10.4 What stays

All Pi editing behavior and keybindings (delegation via `super.handleInput`), autocomplete visuals, queued-message display above the editor, image paste flow, `app.editor.external` flow.

---

## 11. Navigation & Command UX

**[proposed]** Three planes, each keyboard-first:

1. **Pi plane (unchanged keys):** all native keybindings (`app.*`), slash commands, autocomplete, pickers. PineVIM adds two `registerShortcut` entries (see 3) and autocomplete providers for its own commands.
2. **Prefix plane (tmux, works always):** existing chords unchanged; additions: `F12 s` status popup, `F12 ?` keys popup (today `?` is a toast — *changed to a popup*, with the toast retained as fallback when popup creation fails), `F12 m` context menu (`display-menu`) offering the same intents (i/c/a/Tab/width/r/q/s/?) — mouse-optional, arrow-key navigable. Double-prefix literal preserved.
3. **Command surface (slash):** `/pinevim` gains real subcommand completion (hide/show/chat/ide/status/help/quit) and `/ide` gains `open|close` completion via `getArgumentCompletions` (confirmed field on `RegisteredCommand`). `parseCommand()` keeps its intent mapping (unchanged logic; completions only).

Help hierarchy: status line hint → `F12 ?` popup (always available) → `/pinevim help` text (replaced by popup in TUI). Command palette is **rejected** for v1: Pi's autocomplete + popups cover discovery without a second focus system.

Search/transcript navigation: Pi's native alt-screen search and `app.message.*` keybindings remain; PineVIM adds nothing here (no duplicate systems).

---

## 12. Header / Footer / Status Strategy

Information inventory and placement (proposed placement per item; all data sources confirmed available on the named surface):

| Information | Always | Contextual | On demand | Removed |
|---|---|---|---|---|
| PineVIM identity + version | header (banner) | — | status popup | status line |
| Workspace dir | header | — | status popup | composer |
| Session name | header | — | — | — |
| Mode (CHAT/IDE) + focus | header chip + composer chip | compact: composer only | — | — |
| Lifecycle | deck band + composer chip | — | — | — |
| Context % | deck gauge + composer gauge | hidden when null | — | — |
| Model, thinking level | deck, composer border | — | — | — |
| Git branch | deck | — | — | — |
| Turn summaries | transcript (per turn) | — | — | — |
| Versions (pi/tmux/node) | — | — | status popup | status line, help toast |
| Prefix chords | — | status line hint `F12 ?` | keys popup | help toast (replaced) |
| Bridge/recovery state | tmux status line | deck banner when degraded | status popup | — |
| Editor alive-hidden | tmux status + status popup | toast on transition | — | — |
| Slash collision warnings | — | toast (existing) | status popup | — |

- **Header** (`setHeader`): one line ≥ 80 cols (`pinevim · ~/code/api · session fix-auth · CHAT ●`), wraps to two lines 60–79, suppressed < 60. Non-scrolling region above transcript (Pi-native placement confirmed for custom headers).
- **Deck** (`setFooter`): two lines ≥ 24 rows (`lifecycle band` + `context · model · branch · hints`); one line in compact; uses `footerData.getGitBranch()`, `getExtensionStatuses()` (PineVIM pushes its own degraded-bridge status via `ui.setStatus` so it flows through the same pipe), `ctx.getContextUsage()`, `ctx.model`.
- **tmux status line**: minimal segmented chip row (workspace · mode · agent · ctx) — the mirror, not the source of truth.

---

## 13. Visual Design System

### 13.1 Typography conventions

- Monospace only; no font control (terminal-native). Weight/emphasis: `bold` for user input and section labels, `italic` only for thinking-preview text, never for body. Case: labels lowercase (`pinevim:`, tool names); chips UPPERCASE (`CHAT`, `IDE`) for scan-ability.
- No alignment-heavy tables in flowing content (breaks with resize); key/value grids only in popups (fixed layout there is safe).

### 13.2 Spacing

- Base unit = 1 row/col. Message gap: 1 blank row between turns (Pi-native rhythm kept); 0 within a turn. Tool cards contiguous (rail connects them visually). Deck: 0 blank rows to transcript (border provides separation). Header: 1 blank row below.
- Indentation: gutter width 1 col + 1 space text indent (total 2) for user messages; tool output continuation rail at col 1 (`│`); everything else flush.

### 13.3 Borders

- Composer: single-line box (Pi editor border, restyled colors only).
- Popups: double-line outer border (`╔═╗`) — distinct from in-pane single-line boxes so overlay vs. content is unambiguous in monochrome.
- Rules/summaries: `─` fill line, no end caps (reads as a rule, not a box).
- No borders around messages (rail grammar instead — borders around every message are the single biggest visual-noise trap in terminal chat UIs).

### 13.4 Symbols

State glyph set (§7.1, §9): `› ● ✓ ✗ ▲ ⏸ ? ⌁ ◦ ■ ⇅ ─ │ ╔`. Every glyph has an ASCII fallback (§7.1) and every glyph carries or sits beside text carrying the same meaning.

### 13.5 Semantic colors

PineVIM theme file (JSON theme confirmed loadable via `themePaths`) mapping onto Pi's fixed `ThemeColor`/`ThemeBg` slots — PineVIM does **not** fork the Theme class (public API constraint); identity comes from the chosen values + structure:

| PineVIM role | Pi slot(s) | Intent |
|---|---|---|
| brand/accent | `accent`, `borderAccent`, `customMessageLabel` | PineVIM chrome, waiting, interactive edges |
| structure | `border`, `borderMuted` | rails, rules, boxes |
| text | `text`, `userMessageText`, `customMessageText` | body |
| muted/dim | `muted`, `dim` | metadata, hints, summaries |
| success | `success` | tool success, completion |
| warning | `warning` | truncation, degraded, collisions |
| error | `error`, `toolErrorBg` | failures |
| tool surface | `toolTitle`, `toolOutput`, `toolPendingBg`, `toolSuccessBg`, `toolDiff*` | tool cards, diffs |
| code/markdown | `md*`, `syntax*` | content (restyle, don't restructure) |

The theme ships dark-first with a light variant; both validated in 256-color mode (Pi's `ColorMode` handles the downshift; PineVIM avoids colors that collapse in 256).

### 13.6 Hierarchy

Primary scan path: rail glyphs (column 0) → turn rules → deck band. Secondary: chips, gauges. Tertiary: metadata, hints. Enforced by: glyph budget (≤1 glyph role per line), color budget (≤3 fg colors visible per screen region), and the one-line-per-enumerable-thing rule.

### 13.7 Motion

Only three animated elements, all state-driven: (1) working indicator frames while streaming/tooling (replaced frames: `·` `›` `»` `›`, 120 ms — subtle, terminal-safe; configured via `setWorkingIndicator`), (2) live tool-card spinner glyph `●`→braille frames while that tool runs, (3) deck band text swap on lifecycle change (no transition animation — instant swap; terminal flicker-free by Pi's diff renderer). Nothing pulses, blinks, or runs when idle. `ui.motion: "off"` config swaps all frames for static glyphs.

### 13.8 Fallbacks

Capability ladder (probe order): truecolor → 256 → 16 → mono; unicode → ASCII; mouse → keyboard-only; images → skipped (Pi-native decision). Each degraded rung is silent (no warnings for normal terminals); only total failure of the ladder (no terminfo etc.) errors, which tmux already gates at startup (`terminfo()` check exists).

---

## 14. Component Architecture

**[proposed names/structure; all built on confirmed base classes/hooks from §1/§2.4]** New module tree compiled into `dist/` and referenced by the bundled extension (multi-file extension confirmed viable via relative imports — same pattern as `control/helper.ts`):

```
src/piui/
  index.ts            extension entry (merged into adapters/pi/extension.ts registration flow)
  lifecycle.ts        AgentLifecycle derivation from Pi events
  theme.ts            theme JSON assets + registration
  components/
    header.ts         banner (setHeader)
    deck.ts           status deck (setFooter factory)
    composer.ts       PineComposer (setEditorComponent; extends CustomEditor)
    chips.ts          mode/lifecycle/queue chips, gauges (shared by composer+deck)
    glyphs.ts         glyph + fallback tables
  renderers/
    cards.ts          shared tool-card frame
    tools/*.ts        per-tool renderCall/renderResult overrides
    turnSummary.ts    registerEntryRenderer("pinevim.turn_summary")
    markdown.ts       registerMarkdownTransformer rules
```

Controller-side (tmux layer):

```
src/adapters/tmux/
  statusline.ts       styled segmented status-left writer (replaces raw text in renderStatus)
  panels.ts           display-popup help/status, display-menu (helper-invoked or controller-invoked)
  styled.ts           bounded tmux-style writer (replaces literal() ONLY for trusted PineVIM strings)
```

Component matrix:

| Component | Purpose | States | Major interactions | Existing/New |
|---|---|---|---|---|
| `AppController` (ext) | dispatch intents, render status | unchanged | — | Existing (modified) |
| `Tmux.statusline` | styled status-left | idle/dead/compact variants | none (write-only) | New |
| `Tmux.panels` | help/status popups, menu | open/closed | keys navigate, Esc/q close | New |
| `PineTheme` | theme JSONs + registration | dark/light × truecolor/256 | `/theme` (Pi native) lists them | New |
| `Header` | identity banner | 1/2-line/suppressed | none | New |
| `StatusDeck` | lifecycle + context + branch | idle/working/waiting/error; 1/2-line | none (display) | New |
| `PineComposer` | input with PineVIM frame | per §10.2 | delegates all input to `CustomEditor` | New (wraps existing base) |
| `Chips` | reusable chip/gauge strings | text+color roles | none | New |
| `ToolCard` | unified tool presentation | running/success/warn/fail/waiting/interrupted; collapsed/expanded | Pi expansion toggle | New (overrides renderers) |
| `TurnSummary` | per-turn rule line | complete/interrupted | none | New |
| `Lifecycle` | event → state reducer | §8.1 states | emits to deck/composer/controller | New |
| `PineStatusBridge` | extension → controller status | connected/degraded | protocol v1.1 `status` payload | New (protocol ext) |
| `Slash completions` | `/ide` `/pinevim` completion | — | typing | New (small) |
| Pi transcript core | conversation rendering | — | — | Existing (untouched) |
| Pi dialogs/pickers | select/confirm/input/session/model | — | — | Existing (untouched) |
| `Coalescer`, `Store`, `Peer` | infra | — | — | Existing (untouched) |

Duplication-elimination notes: chip/gauge rendering lives once in `chips.ts` and is consumed by composer *and* deck; glyph tables live once in `glyphs.ts`; the tool-card frame is one function parameterized by (glyph, title, args, counts, duration, expanded-body) — per-tool files only supply extraction of args/counts from their confirmed input/detail shapes.

---

## 15. Responsive Terminal Behavior

| Width band | Header | Deck | Composer | Tool cards | tmux status |
|---|---|---|---|---|---|
| ≥ 101 cols (paired) | 1 line | 2 lines | full borders | full args + counts + duration | full segments |
| 80–100 (single pane) | 1 line | 2 lines | full borders | full args, counts abbreviated | mode + agent + ctx |
| 60–79 | 2 lines (or hidden < 24 rows) | 1 line (band + ctx%) | top border only | args truncated, no counts | mode + agent |
| < 60 (allowed only as resize, launch refused) | hidden | band merged into composer chip | no borders | name + glyph only | `resize 60x16` warning (existing) |

Rules: nothing horizontal that can't shrink becomes vertical (no two-column layouts in-pane at any width); gauges shrink cell count before disappearing; the compact single-pane + Tab behavior and the ≥ 60×16 recovery guidance remain exactly as implemented (`layout.ts`, `renderStatus()` hint).

Wide (> 160 cols): content column caps at ~120 cols with a single left indent (avoids 200-char unreadable lines); the cap applies to PineVIM chrome; Pi's own wrapping for transcript text is left native (outputPad setting already exists; PineVIM sets nothing by default — user-controlled).

---

## 16. Accessibility & Compatibility

- **Color-independence:** every state has glyph + text (§13.4); verified by a monochrome test render pass (§22). Color pairs chosen for ΔL contrast, not hue contrast (deuteranopia-safe: success/warning/error distinguished by glyph first).
- **Monochrome/16-color:** 256-color themes validated with Pi's ColorMode downshift; a `pinevim-mono` theme ships for e-ink/1-bit terminals.
- **Unicode:** full glyph set with ASCII fallback table; fallback selection via config (`ui.glyphs: "unicode" | "ascii"`) plus TERM sniffing (conservative: `screen*`, `vt*` default to ASCII).
- **tmux/SSH/outer-tmux:** all PineVIM chrome is plain text + SGR — no kitty keyboard protocol dependency, no passthrough (config keeps `allow-passthrough off`); popups use tmux's own renderer so they work over SSH exactly like existing `display-message`. CSI-u requirements are already documented and unchanged (README: outer tmux needs `extended-keys`).
- **Copy/paste:** rails/gutters are left-column prefixes that are part of the visible lines (tmux `set-clipboard external` unchanged); copying a tool card includes its glyph — acceptable tradeoff, documented; turn rules use `─` which copies as a line (documented; kept because removal would break scanning). No zero-width characters anywhere (copy-fidelity rule).
- **Screen readers:** terminal SR support is emulated at best; PineVIM's contribution is stable, predictable line grammar and no animated junk between content lines; reduced-motion config exists (`ui.motion: "off"`).
- **Resize/multiplexers:** existing hooks (`client-resized` → coalesced reconcile) unchanged; deck/header re-render on Pi's own resize path (no extra timer polling — event-driven only).

## 17. Implementation Roadmap

Phase 0 precedes code: it settles the ownership-contract amendment (README + `.github/copilot-instructions.md` currently say PineVim "does not … replace Pi's custom editor/header/footer"). The amendment: PineVIM's bundled extension may replace those components *with PineVIM components* when enabled, must yield to user-installed extensions that set the same hooks (last-writer-wins is Pi's runtime behavior — PineVIM must detect `getEditorComponent()`/existing custom footer at startup and stand down with a one-time notice), and must document opt-outs. Every phase below keeps `npm run typecheck && npm run lint && npm test` green.

### Phase 1 — Foundation: theme, glyphs, chips, protocol v1.1

**Objective:** the token layer everything else consumes.

**Changes:** PineVIM theme JSONs (dark/light/mono) registered via `resources_discover` → `themePaths`; applied via `ui.setTheme(themeInstance)` (non-persistent) at session start. `glyphs.ts` + `chips.ts` + fallback tables. `styled.ts` (bounded SGR writer for trusted strings) in tmux adapter. Control protocol: add fields to `status`/`hello` payload whitelists (`lifecycle`, `model`, `ctxPercent`, `toolsRun`, `toolsFailed`, `turnIndex` — all `text()`-bounded scalars, `busy` retained) in `src/control/protocol.ts`; extension computes and reports them; `bridgeStatus()` stores them on `State` (`src/core/state.ts` + `persistence.ts` metadata validation whitelist + `validateMetadata` key list). Compatibility: extend `src/adapters/pi/compatibility.ts` with an API-surface assertion (presence of `setFooter`/`setEditorComponent`/`registerTool`/`setTheme` on the loaded runtime, probed at `session_start`; absence ⇒ all PineVIM UI features disable and a notice explains).

**Likely files:** `src/adapters/pi/extension.ts`, `src/adapters/pi/compatibility.ts`, `src/control/protocol.ts`, `src/core/state.ts`, `src/persistence.ts`, new `src/piui/{theme,glyphs,chips,lifecycle}.ts`, new `src/adapters/tmux/styled.ts`, new theme assets.

**Dependencies:** none.

**Testing:** unit tests for lifecycle reducer and glyph/chip fallbacks; protocol schema tests (whitelist additions accepted, unknown still rejected); theme loads in truecolor+256 (fixture render via Pi's theme loader); typecheck/lint.

**Completion criteria:** lifecycle state machine proven from recorded event sequences; protocol round-trips new fields; theme renders through Pi's `fg()` calls with expected ANSI in both color modes.

### Phase 2 — Console telemetry (Direction A ships)

**Objective:** PineVIM identity in the tmux layer, independent of Pi.

**Changes:** `statusline.ts` replaces `renderStatus()` text assembly (segmented, styled, same dedup discipline, ≤ 250-char budget, ASCII variant); styled toasts (`notify()` gains severity + prefix `pinevim:` while keeping the bounded-literal safety for any interpolated content); help popup (`F12 ?`) and status popup (`F12 s`) via `display-popup` fed by controller data; `F12 m` menu; binding table + `helper.ts` action additions (`help`, `status`, `menu` — helper action regex in `tmux/config.ts` must be extended); README/help text updates.

**Likely files:** `src/core/controller.ts` (renderStatus, help intent, new popups), `src/adapters/tmux/{client,config,helper}.ts`, `src/control/helper.ts`, `tests/unit/core.test.ts`, `tests/integration/lifecycle.test.ts` (status line assertions).

**Dependencies:** Phase 1 (styled writer, lifecycle fields for `agent=` segment).

**Testing:** unit tests for status-line assembly (widths, truncation, dedup, compact variant); integration: popup invoked via helper through the control path; stress: rapid intent churn keeps line ≤ budget.

**Completion criteria:** `F12 ?`/`F12 s` show panels on tmux ≥ 3.5 without touching Pi; status line segments colored and ASCII-safe fallback verified; existing chords unchanged.

### Phase 3 — Conversation grammar: tool cards + turn summaries

**Objective:** the agentic transcript reads like PineVIM.

**Changes:** `renderers/cards.ts` + per-tool overrides via `registerTool` name-shadowing (bash/read/edit/write/grep/find/ls/powershell; `renderShell: "self"` for bash/powershell first, others incremental); `turnSummary.ts` (`appendEntry` on `turn_end` + `registerEntryRenderer`); interrupted-turn handling; `markdown.ts` transformer (rule normalization only).

**Likely files:** `src/piui/renderers/**` (new), `src/adapters/pi/extension.ts` (registration), `tests/unit/` (card snapshots), new fixture-based rendering tests.

**Dependencies:** Phase 1 (glyphs, theme, lifecycle for card spinner).

**Testing:** snapshot-style unit tests per tool × state (running/success/warn/fail/interrupted × collapsed/expanded) at 60/80/100/120 cols; monochrome render assertions (no color-only distinctions); Pi 0.87.1 fixture session replay.

**Completion criteria:** every built-in tool renders through the card grammar; failures carry `✗`; turn summaries persist across `--resume` (entry renderer round-trip).

### Phase 4 — Agent observability: deck, header, composer

**Objective:** the frame becomes PineVIM's.

**Changes:** `deck.ts` via `setFooter` (lifecycle band + gauge + model + branch; 1/2-line variants); `header.ts` via `setHeader`; `composer.ts` via `setEditorComponent` (`CustomEditor` subclass, `embedWorkingStatus`, border overrides, chips); working indicator frames via `setWorkingIndicator`; waiting band from `ui_prompt_*`; degraded-bridge notice via `ui.setStatus`. Opt-out config keys (`ui.components: "pinevim" | "pi"`, `ui.glyphs`, `ui.motion`) honored at registration.

**Likely files:** `src/piui/components/**` (new), `src/adapters/pi/extension.ts`, `src/config.ts` (new opt-out fields — config is strict, so additions must be whitelisted there), README.

**Dependencies:** Phase 1 (all), Phase 3 (deck's `tools` count matches cards).

**Testing:** unit tests for deck/header/composer line assembly at all width bands (§15 matrix); integration with fixture Pi session asserting components installed; fallback test: when `getEditorComponent()` already returns a user editor, PineVIM stands down and logs.

**Completion criteria:** header/deck/composer live by default; opt-out restores Pi defaults exactly; all Pi keybindings intact through the composer (delegation test suite).

### Phase 5 — Navigation & completions

**Objective:** command discovery is complete.

**Changes:** `getArgumentCompletions` for `/ide` and `/pinevim` subcommands; `addAutocompleteProvider` for command descriptions; help popup content refreshed (now includes slash commands + chords in one table).

**Likely files:** `src/adapters/pi/extension.ts`, `src/piui/` completions module, `src/core/controller.ts` (help content).

**Dependencies:** Phase 2 (popup exists), Phase 4 (composer).

**Testing:** unit tests for completion tables; integration: typing `/pinevim ` surfaces subcommands through Pi's autocomplete (fixture keystroke test like `phase0.py` pattern).

**Completion criteria:** every PineVIM command and chord discoverable from inside the TUI without README.

### Phase 6 — Edge states & resilience

**Objective:** the whole lifecycle matrix behaves.

**Changes:** startup/empty-state banner variants (fresh session vs. resumed vs. picker mode — picker reachable when tmux server loss triggers Pi's native picker, confirmed in README); narrow-terminal progressive collapse hardened; large-output stress paths; error/interrupted visual states verified end-to-end; bridge-down transitions (deck notice + tmux line agree).

**Likely files:** all UI modules (variant handling), `tests/integration/{lifecycle,pi}.test.ts` extensions.

**Dependencies:** Phases 2–4.

**Testing:** the §22 stress battery; scripted tmux resize sweep 60→200 cols × 16→50 rows asserting no render exceptions and correct variant selection.

**Completion criteria:** no phase of the lifecycle matrix (§8.1) renders a blank/incorrect state; resize sweep passes.

### Phase 7 — Polish, docs, gates

**Objective:** release quality.

**Changes:** monochrome pass (all screenshots re-verified with color stripped); glyph fallback audit; README + `Docs/Compatibility.md` + `Docs/Implementation-Evidence.md` updates; `benchmark.mjs` extended with UI-render cost probes (card render time for 500-entry fixture, deck assembly time); Pi-upgrade runbook note in `compatibility.ts` (which assertions to re-run).

**Dependencies:** all.

**Testing:** full suite + phase0 + package smoke; manual matrix from `Docs/Testing.md` extended with popup/chord checks on macOS Terminal/iTerm2/SSH.

**Completion criteria:** acceptance criteria §23 all pass.

---

## 18. Priority Matrix

| Priority | Improvement | User Impact | Engineering Scope | Dependency | Rationale |
|---|---|---|---|---|---|
| P0 | Theme + glyphs + chips + lifecycle reducer | Enabling (invisible alone) | M | — | Everything composes from these; cheap to build first |
| P0 | Protocol v1.1 status fields | Enables tmux-side truth | S | — | Two endpoints ship together; zero compat risk |
| P0 | API-surface compatibility assertions | Prevents silent breakage | S | — | Gate must exist before any Pi-UI dependency ships |
| P1 | tmux status line + popups + menu + styled toasts | High (control plane, always available) | M | P0 | Direction A value; works when Pi is dead; low risk |
| P1 | Tool cards (all built-ins) | Very high (agentic readability) | L | P0 | The single biggest in-transcript transformation |
| P1 | Turn summaries | High (long-session scanning) | M | P0 | Cheap once lifecycle + entry renderer exist |
| P1 | Status deck + header | High (identity + state visibility) | M | P0 | The frame claim |
| P2 | PineComposer (frame, chips, gauges) | High (most-looked-at component) | M–L | P0, deck | Highest Pi-coupling; after cards/deck prove the API patterns |
| P2 | Slash completions + help content refresh | Medium (discoverability) | S | P2 popups | Round-out navigation |
| P2 | Edge-state hardening + responsive variants | High (robustness) | M | P1 items | The matrix in §15/§12 must be exhaustive before calling it done |
| P3 | Tool-group repeat chips | Low–medium | S | cards | Only if telemetry shows repeated-call pain |
| P3 | `pinevim-mono` + light themes as separate ships | Medium (compat audiences) | S | P0 theme | Dark-first covers the majority; mono/light are quick follows |
| P3 | Command palette (rejected for v1) | — | — | — | Rejected: duplicates Pi autocomplete + popups |

Quick wins (any phase, hours not days): styled toasts; `F12 ?` popup replacing the toast; status-line segments; `/pinevim` subcommand completions; help-string rewrite. None of these alone satisfy the brief — they are acceleration, not the redesign.

---

## 19. Quick Wins

(see end of §18)

---

## 20. Structural Improvements

The changes that actually transform the product:

1. **Tool-card grammar** (Phase 3) — replaces per-tool ad-hoc rendering with one parameterized frame; the largest visual-structural delta from stock pi-agent.
2. **Turn summaries as persisted entries** (Phase 3) — a new conversation *structure* (not styling): every turn acquires a machine-anchored, resume-safe summary line.
3. **Status deck + header + composer frame** (Phase 4) — claims the pane's chrome anatomy; with §7 rails this makes layout itself the signature.
4. **Lifecycle as a derived, single-source state machine** (Phase 1, consumed everywhere) — replaces the `busy` bit with an honest observable model projected to both the in-pane deck and the tmux line.
5. **Console plane (popups/menu/segments)** (Phase 2) — a second, always-available interaction surface owned by the controller.

Quick wins alone = "pi-agent with a nicer status bar." Items 1–5 together = the structural identity the brief requires.

---

## 21. Risks and Mitigations

| Risk | Why It Matters | Mitigation |
|---|---|---|
| Pi API drift on upgrade (0.87.1 → future) | UI silently breaks or renders wrong | P0 assertion suite in `compatibility.ts`; per-phase fixture render tests against the pinned version; features degrade to Pi defaults on assertion failure |
| Ownership-contract conflict (README/copilot-instructions) | Undermines repo's stated invariants | Phase 0 amendment; runtime stand-down if a user extension already owns a hook; opt-out config; document in README |
| Visual noise / over-decoration | Brief explicitly forbids clutter | §13.6 budgets (glyph/color/line); monochrome pass in Phase 7; review gate: every element must name its principle (§4) |
| Flicker / render cost on large transcripts | Terminal UX killer | Event-driven renders only; no polling loops; deck/chip string assembly memoized per state; benchmark probes in Phase 7; Pi's diff renderer does line-level updates |
| Narrow-terminal regression | PineVIM already enforces 60×16/101×24 rules | §15 width-band table is exhaustive; resize sweep test; progressive border/chip collapse |
| Unicode gaps (SSH, old terminfo) | Garbled glyphs | ASCII fallback table + TERM sniffing + config override; glyphs never sole carriers |
| Copy/paste degradation | Developers copy output constantly | No zero-width chars; documented tradeoffs for rails/rules; keep Pi's copy flows untouched |
| Status-line budget overflow (250 cells incl. SGR) | tmux truncation/overlap | Unit-tested width budgeting with worst-case segments; dedup writer; ASCII variant counts cells, not chars |
| Divergence from upstream Pi UX conventions | Confuses users who know pi | Keep all Pi keybindings and flows; PineVIM adds grammar, never remaps; Pi settings/pickers untouched |
| Implementation complexity in extension | Extension is currently one file | `src/piui/` module tree (§14); strict TS + lint already enforced; each renderer unit-tested in isolation |
| Maintenance burden across 3 visual planes (pane, deck, tmux) | Drift between surfaces | Single source: lifecycle module + protocol fields; both surfaces are pure functions of that state; unit tests assert agreement |
| `plain()`/`literal()` misuse for styled output | Security helpers bypassed | `styled.ts` is a *separate* writer for constant PineVIM strings only; any dynamic/interpolated content keeps `literal()`; lint rule suggestion noted in Phase 2 |

---

## 22. Testing Plan

**Functional.** Extend `tests/unit/core.test.ts` + new unit files: lifecycle reducer tables (every §8.1 transition incl. error/interrupt/compaction), chip/glyph fallbacks, card frame parameterization, protocol schema additions (accept/reject matrices), status-line assembly (widths, truncation, dedup, compact), theme JSON validation.

**Visual.** Snapshot tests: render each component at 60/80/100/120/200 cols × states; assert monochrome render (SGR stripped) still encodes state (glyph+text present). Fixture: recorded Pi session JSON replayed through renderers (no live model needed).

**Interaction.** Integration (following `tests/integration/harness.ts` patterns, unique sockets, fabricated HOME): popup open/close via helper path; chord table regression (all prefix keys still bind); composer delegation (Pi keybinding fixtures through `PineComposer.handleInput`); resize sweep; bridge-loss → deck notice + tmux line agreement.

**Compatibility.** `Docs/Testing.md` matrix extended: iTerm2/Terminal.app/SSH × dark/light × truecolor/256; outer-tmux CSI-u case unchanged; `phase0.py` extended with PineVIM-UI presence checks (theme registered, footer factory installed) against real installed Pi 0.87.1.

**Stress.** Extend `tests/integration/stress.test.ts` + `benchmark.mjs`: 500-entry transcript with 200 tool cards (render time budget assert), rapid `tool_execution_update` bursts (coalesced invalidation), 100 resizes in 10 s (no exception, final state correct), 50 consecutive failed tools (deck + toasts stable), 16 KiB-adjacent status payload rejected cleanly.

**Gates per phase:** `npm run typecheck && npm run lint && npm test` green; no `any`; prettier clean.

---

## 23. Acceptance Criteria

1. With all color stripped (SGR-free render of every component), PineVIM is identifiable by chrome anatomy, rail/gutter grammar, tool-card system, turn summaries, and tmux segments.
2. User messages, agent text, tool cards, system notices, warnings, errors, waiting states are each distinguishable in monochrome at 80 cols.
3. A 30-tool turn is scannable: every tool outcome readable from column-0 glyphs alone; one rule line summarizes the turn.
4. Tool activity defaults to one line per call; expansion is user-controlled; no unbounded output enters the default view.
5. The composer carries mode + lifecycle + context + model + thinking; all Pi editing keybindings verified intact.
6. All nine lifecycle states (§8.1) render distinctly in deck + composer + tmux line, sourced from one state machine.
7. Full behavior at 60/80/100/160 cols and 16/24/40 rows per §15; nothing requires a specific width.
8. `ui.glyphs: "ascii"` + mono theme produce a fully usable UI; TERM=screen-256color defaults to ASCII glyphs without warnings.
9. Every prefix chord and Pi keybinding from the current build still works; `F12 ?` popup lists all of them.
10. No render loop or polling; deck/chip assembly memoized; 500-entry fixture renders under an asserted budget (Phase 7 sets the number from baseline).
11. `src/piui/` primitives (chips, glyphs, card frame) are the only presentation-code path — no per-component duplicated glyph/color strings (enforced by lint + review).
12. Fresh-eyes test: side-by-side with stock pi 0.87.1 shows structural difference within 5 seconds, with colors removed.
13. Opt-out config restores the exact Pi default UI (regression-tested).
14. Protocol additions are backward-rejected correctly (unknown fields still refused; oversized payloads rejected).
15. `--resume` replays turn summaries and custom entries correctly; no UI state is fabricated from stale metadata.

---

## 24. Recommended Implementation Order

```
0. Contract amendment (README + copilot-instructions)          → unblocks Phases 3–4 legally & socially
1. Phase 1 foundation (theme, glyphs, chips, lifecycle,
   protocol v1.1, compat assertions)                           → data + token spine for everything
2. Phase 2 console telemetry (statusline, popups, menu,
   styled toasts)                                              → ships Direction A value early;
                                                                 controller can render richer agent state
3. Phase 3a tool cards (bash/powershell first, then the rest)  → biggest transcript transformation;
                                                                 proves registerTool override pattern
4. Phase 3b turn summaries + markdown rules                    → conversation structure; reuses 3a glyphs
5. Phase 4a status deck + header                               → the frame claim; consumes lifecycle
6. Phase 4b PineComposer                                       → highest-coupling piece last, patterns proven
7. Phase 5 completions + help refresh                          → discovery round-out
8. Phase 6 edge states + responsive hardening                  → robustness across the full matrix
9. Phase 7 polish, monochrome audit, docs, benchmarks          → release gate
```

Each step unlocks the next: 1 → everything; 2 → controller-side observability independent of Pi; 3 → the renderer patterns 4–6 reuse; 5 → the deck the composer's chips share; 6 → completes the frame; 7 → closes discoverability; 8 → hardens; 9 → ships.

---

## 25. Final Target Experience

You run `pinevim ~/code/api`. Before Pi even finishes loading, the frame is unmistakably PineVIM: a banner naming the workspace and session, a status deck already ticking (idle, context, model), and a composer with a quiet bordered frame — not a bare prompt. The tmux line below reads like a chip row, not a debug string.

You type; the gutter marks it `›`. The agent answers; thinking shows as a one-line `◦` marker, not a wall. Tools arrive as cards — one line each, glyph at column zero: `✓ read`, `● bash` spinning while tests stream, `✗ edit` when a hunk fails to apply. You can read a whole turn's health by scanning one column. When the turn settles, a rule line closes it: time, tools, failures, context delta.

When the agent needs you, the whole surface agrees — deck band `? needs you`, composer chip, tmux segment `agent=wait` — because one state machine feeds all three. When Pi dies, the tmux plane keeps working: `F12 ?` still opens the key reference, `F12 s` still shows the workspace truth, `F12 r` still offers recovery — PineVIM's control plane never depended on the thing that died.

Strip every color: the rails, cards, summaries, deck anatomy, and segmented status line still say PineVIM. Launch stock pi in another pane: no segment, no rail grammar, no cards, no deck, no popups — the difference is structural, and it is visible in the first five seconds.

That is the target: **a workspace that looks, behaves, and recovers like PineVIM — running the best conversation engine available, with its chrome claimed and its honesty intact.**
