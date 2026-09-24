# PineVim

PineVim runs interactive Pi and your normal Neovim inside a private tmux workspace. Pi owns chat, models, authentication, tools, extensions, and conversation history. Neovim owns its configuration, plugins, buffers, undo, and terminal jobs. PineVim controls layout, lifecycle, and recovery.

**Status: implemented locally; release validation is still in progress.** See [Compatibility](Docs/Compatibility.md) and the [requirement evidence](Docs/Implementation-Evidence.md) for tested behavior and outstanding gates. This is not a production-readiness claim.

## Requirements and installation

- macOS or Linux; native Windows is outside MVP scope.
- Node **>=22.19.0**.
- Separately installed `@earendil-works/pi-coding-agent` **0.87.1**. Other Pi versions are rejected until their public API contracts are tested.
- tmux **>=3.5**, with `tmux-256color` or `screen-256color` terminfo.
- Your normal `nvim` for IDE mode; the locally tested version is **0.12.4**. A lower minimum is not established.
- An interactive terminal, initially at least **60 columns × 16 rows**.

```sh
npm ci
npm run build
node dist/cli.js /path/to/workspace
```

For a local packaged installation:

```sh
npm pack
npm install --prefix "$HOME/.local/pinevim" ./pinevim-local-0.1.0.tgz
"$HOME/.local/pinevim/node_modules/.bin/pinevim" /path/to/workspace
```

Or install the tarball using npm's global **user-controlled prefix** and add that prefix's `bin` to PATH yourself. PineVim never changes shell startup files. The source is licensed under MIT; the npm package remains private and has not been published. Its npm namespace is still undecided.

## Workflow

`pinevim` selects the caller's current directory. An explicit directory is canonicalized with realpath; it must already exist. PineVim does not select the Git root. One controller may own a canonical workspace at a time.

| Command                                             | Result                                                      |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `/ide`, `/ide open`, `/pinevim ide`                 | Start Neovim once, or reveal the same live editor; focus it |
| `/ide close`, `/pinevim ide close`, `/pinevim chat` | Show Pi; keep the editor running, hidden                    |
| `/pinevim agent hide`                               | Show the editor at full width; keep Pi running              |
| `/pinevim agent show`                               | Reveal and focus Pi without restarting either child         |
| `/pinevim status`, `/pinevim help`                  | Show workspace/controller information and controls          |
| `/pinevim quit`                                     | Request the safe application quit flow                      |

“Close” closes the **view**. It does not terminate Neovim. To terminate the editor, use its normal `:qa`, `:wqa`, or your configured keys. Modified-buffer refusal remains Neovim's responsibility. PineVim never types a quit command into the editor and never kills it to complete normal shutdown.

The private prefix defaults to **F12**, followed by a second key. Letters are lowercase:

| Second key       | Action                                          |
| ---------------- | ----------------------------------------------- |
| `i` / `c`        | IDE / chat view                                 |
| `a`              | Hide/show agent                                 |
| `Tab`            | Focus the other pane, revealing it if necessary |
| `Left` / `Right` | Adjust agent width by five columns              |
| `r`              | Confirm explicit Pi recovery if it has exited   |
| `q`              | Request safe quit                               |
| `?`              | Help                                            |
| `F12`            | Forward literal F12 to the application          |

Pi's Ctrl+L and Neovim's Ctrl+H/J/K/L remain application keys. Ctrl+C goes directly to the focused child. Prefix controls work independently of the Pi bridge, including while Pi is busy or unavailable.

At **101×24** or larger, IDE mode displays editor left and Pi right. The default agent width is `clamp(round(0.35 × (columns − 1)), 40, 64)`, further constrained to leave the editor at least 60 columns. Border dragging and prefix arrows retain a user ratio. Smaller terminals show one pane at a time; prefix then Tab switches focus. Resizing below 60×16 preserves existing children and shows resize guidance. A fresh launch below that size is rejected.

## Safe quit and recovery

Quit Neovim normally, then request PineVim quit. If Pi is busy, PineVim asks for confirmation in tmux before requesting cancellation through Pi's public lifecycle API. No/default/expired confirmation leaves work running. Shutdown has a deadline and preserves processes on timeout. Native Pi `/quit` still quits Pi; a live editor remains available.

Terminal detachment, SIGHUP, and SIGTERM preserve child PTYs. Recover with:

```sh
node dist/cli.js --resume /path/to/workspace
```

Recovery verifies private runtime ownership, instance identity, stable tmux IDs, child PIDs, and canonical workspace. It starts a fresh controller epoch and drops outstanding control requests. It does not replay a prompt or tool action. A stale client recorded for the previous controller can be detached during recovery; an unknown attachment is refused. When no tmux server survives, `--resume` starts Pi's native session picker. It does not resurrect Neovim buffers after editor death, reboot, or tmux-server loss. Use Neovim's own swap/persistence tools in those cases.

A second live controller is refused. An interrupted lock acquisition is also refused with local recovery guidance; do not delete its lock while a controller remains alive. Pi retry is explicit and validates any cached session header before using it. Untracked tmux jobs are preserved during cleanup.

## Configuration and ownership

Optional configuration: `${XDG_CONFIG_HOME:-~/.config}/pinevim/config.json`. Nothing is created there by default.

```json
{
  "prefix": "F12",
  "agentRatio": 0.35,
  "logLevel": "off",
  "ui": {
    "enabled": true,
    "motion": "on",
    "glyphs": "unicode",
    "theme": "auto"
  }
}
```

`pi`, `nvim`, and `tmux` may be absolute executable paths. Executable shell expressions, unknown fields, and provider settings are rejected. Supported prefix forms include F1–F24, a lowercase letter, `C-letter`, `M-letter`, and `C-Space`. Invalid tmux configuration fails locally. `PINEVIM_LOG_LEVEL=debug` overrides the config's log level. No executable project config is supported. The `ui` section controls the in-pane PineVim frame: `enabled` (master switch), `motion` (`off` replaces the animated working indicator with a static glyph), `glyphs` (`ascii` forces the ASCII fallback vocabulary for all PineVim chrome), and `theme` (`auto` applies `pinevim-dark` or `pinevim-light` only while Pi is still on its built-in `dark` or `light` theme; an explicit `pinevim-*` name pins that theme; applied per-session, never persisted to Pi settings).

State and opt-in logs live under `${XDG_STATE_HOME:-~/.local/state}/pinevim/`. Runtime sockets live in a private directory under a validated `XDG_RUNTIME_DIR` or the OS temporary directory, with a short-path fallback. State files and IPC token files are private. Logs contain allowlisted controller events, rotate at 5 MiB with three archives, and are never uploaded.

PineVim launches the installed Pi with an explicit bundled extension. It does not read `auth.json`, copy credentials, source `.env`, disable user extensions, or autoapprove project resources. **Pi and its extensions still perform their normal writes**, including sessions, settings, OAuth refresh, and catalogs. PineVim does not promise immutable Pi storage.

### PineVim workspace UI (bundled extension)

The bundled extension installs the PineVim frame inside the Pi pane through Pi's public extension API: header, status deck, chip band above the composer, lifecycle working indicator, one run-ledger line per user request, `/ide` and `/pinevim` argument completion, and non-persistent themes (`pinevim-dark`, `pinevim-light`, `pinevim-mono`, `pinevim-neon`, `pinevim-forest`, `pinevim-snow`). `ui.theme: "auto"` applies `pinevim-dark` or `pinevim-light` only when Pi is still on its built-in `dark` or `light` theme. Any other theme, including one you picked, is left alone. Applying a theme passes a theme object, so PineVim does not write Pi's `settings.json`. Theme files are copied into Pi's user themes directory so `/settings` can resolve them later; that copy is outside PineVim's private state directory and is skipped when it fails. The header shows the ASCII pine — canopy in the theme's accent, trunk in a shaded tone of the same hue (darker on dark themes, lifted on light ones; per-theme overrides live in `src/piui/logo.ts`, preview with `node scripts/pine-preview.mjs [#rrggbb] [--light]`) — plus workspace and view. Lifecycle stays on the band. The terminal title reads `pinevim`. Pi keeps editing, Markdown, model dialogs, tool execution, and keybindings. There is no custom editor component.

Conflict behavior: PineVim can see a custom editor and stands down with a one-time notice so the pane runs stock Pi. Header and footer have no getter, so another extension's header can be overwritten. If the pinned Pi version lacks required hooks, the UI also disables with a notice rather than degrading the chat. The composer stays Pi's editor; `ui.enabled: false` removes all PineVim chrome (the tmux control plane and prefix keys are independent of it and keep working).

Neovim starts normally in the workspace with `PINEVIM=1`. An intentional `NVIM_APPNAME` is preserved. Inherited remote-editor markers are removed for the editor child. Your Neovim config owns LSP, completion, diagnostics, formatting, git UI, tests, and debugging. PineVim installs no plugin, statusline, or package-manager sync, and it does not use Neovim RPC. Prefix keys default to F12 so Pi's Ctrl+L and Neovim's Ctrl+H/J/K/L stay with those programs. Ctrl+C goes to the focused child.

PineVim does not add a command palette, permission cards, a third pane, or a file tree. `/pinevim review` reports paths from the last run and does not open buffers. `/pinevim learn` and `/pinevim skills` are off until you run them; learned skills are instructions under `${XDG_DATA_HOME:-~/.local/share}/pinevim/skills`, not in the repository.

Bare `/ide` must be unambiguously owned by the bundled extension. On collision, use `/pinevim ide` or the prefix, resolve the competing resource yourself, then `/reload`. A `/pinevim` collision disables slash integration; prefix controls remain available. Native Pi commands, provider settings, and session files stay Pi-owned.

## Terminals and troubleshooting

The private tmux server never reads or edits your tmux config and never targets your default server. Mouse focus and border resizing are enabled. Blanket terminal passthrough is disabled; `set-clipboard external` lets tmux use its own clipboard handling while preventing pane applications from setting tmux selection buffers. Clipboard/image behavior depends on the terminal and remains subject to the compatibility matrix. Use your terminal's modifier-selection gesture to select text around mouse-aware applications.

Inside an outer tmux, the outer server must forward F12 and modified keys. For tmux >=3.5, CSI-u requires `extended-keys on` and `extended-keys-format csi-u` in that outer server too. PineVim does not modify it. Choose another PineVim prefix if the OS or outer tmux consumes F12. SSH must forward the terminal's capabilities and have appropriate remote terminfo. TrueColor, images, clipboard, and exact theme appearance are not guaranteed for every terminal.

A disconnected bridge does not mean Pi died: prefix layout controls continue working. Reload Pi or detach and resume. Dependency errors should be resolved by explicitly installing/selecting supported tools; PineVim never auto-upgrades them. A dead Pi leaves the editor usable; prefix then `r` requests recovery. An editor crash leaves Pi usable; `/ide` starts a new editor, without claiming to restore lost unsaved buffers.

## Development

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:phase0
python3 tests/terminal/transport.py
npm run test:package
npm run benchmark
```

Tests use synthetic HOME/Pi resources and unique private tmux sockets. Clean-Neovim flags are test-only. See [Testing](Docs/Testing.md) for scenarios and external release checks. Pull requests run format, lint, typecheck, and unit tests in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). That workflow does not install Pi, tmux, or Neovim, so integration stays local. The source checkout also contains the original contract at `Docs/PineVim-Agent-Harness-Implementation-Plan.md`. No custom terminal renderer, provider manager, multi-agent framework, native-Windows port, command palette, permission cards, generated executables, or editor RPC/context upload is part of this MVP. Release is not cleared: Linux, SSH, and physical-key checks in [Compatibility](Docs/Compatibility.md) are still open.
