# PineVim User Guide

> Conventions used throughout:
> - **[verified]** — confirmed by automated tests at HEAD.
> - **[manual]** — works as described; the test harness cannot exercise the full terminal surface.
> - **[risky]** — see the design plan's risk section before adopting.

## 1. First launch

The bundled PineVim frame installs in the Pi pane at first launch. You will see a
welcome entry on the transcript that points to `F12 ?` (key list) and `/pinevim
help`. On a first-ever launch the welcome includes the full ASCII pine motif;
subsequent launches show a single-line chip. Set `PINEVIM_WELCOME=0` in the
environment to silence the welcome entirely.

When you run `/ide` (or `F12 i`), Neovim is launched as `nvim .` in the
**workspace cwd** — the directory PineVim was invoked from (or the first
positional argument to `pinevim`). This opens the project's file tree
instead of the nvim homescreen, so you land in the project you're
already in. To open a different directory instead, launch PineVim with
the directory as its first argument: `pinevim ~/code/myproject`.

The tmux status line (bottom of the terminal) starts with `▲ pinevim ·` (or
`^ pinevim ·` in ASCII mode), then your workspace name, the active view (CHAT /
IDE editor / IDE agent), and the agent lifecycle. The status line is themed by
the active PineVim palette — the brand mark changes color across themes.

The Neovim IDE pane (when paired via `/ide`) shows the PineVim splash for
~800 ms after `VimEnter`. The splash is themed by the active palette and
suppressed at < 16 lines.

## 2. Prefix keys

The private prefix defaults to **F12**, followed by a second key. Letters are
lowercase. See `:help pinevim` from any Neovim instance PineVim has launched.

| Second key  | Action |
| ----------- | ------ |
| `i`         | IDE view (open the editor) |
| `c`         | Chat view (return to Pi only) |
| `a`         | Hide or show the agent pane |
| `Tab`       | Switch focus between panes |
| `Left`      | Reduce agent pane width by five columns |
| `Right`     | Increase agent pane width by five columns |
| `r`         | Retry Pi (if dead) |
| `q`         | Safe quit |
| `s`         | Workspace status popup |
| `t`         | Session timeline popup |
| `m`         | Command menu |
| `?`         | This help popup |
| `F12`       | Forward literal F12 to the application |

## 3. Slash commands

```
/ide [open|close]      Open the editor view, or return to chat view
/pinevim ide open      Same as /ide open
/pinevim ide close     Same as /ide close
/pinevim agent hide    Show the editor at full width; keep Pi running
/pinevim agent show    Reveal and focus Pi without restarting either child
/pinevim status        Show workspace/controller information and controls
/pinevim help          Show this key list (popup preferred in TUI)
/pinevim quit          Request the safe application quit flow
/pinevim review        Show files from the last run
/pinevim learn         Propose a skill from the last run
/pinevim skills        List learned skills
```

## 4. Themes

PineVim ships **11 themes**:

| Name | Mood |
| ---- | ---- |
| `pinevim-dark` | Default dark; pine green on slate |
| `pinevim-light` | Default light; pine green on bone |
| `pinevim-mono` | Monochrome; works on every terminal |
| `pinevim-neon` | Neon variants of the dark palette |
| `pinevim-cyberpunk` | Adapted from Theo's Cyberpunk Neon |
| `pinevim-forest` | High-saturation pine, dense green background |
| `pinevim-snow` | Light cousin of forest with desaturated accents |
| `pinevim-dusk` | Muted blues + amber accents (late-night work) |
| `pinevim-sunrise` | Warm oranges + sage (morning work) |
| `pinevim-aurora` | Magenta + cyan gradients (truecolor) |
| `pinevim-paper` | High-contrast paper-like light mode |

Switch via Pi's native `/settings → Theme`, or set `"ui.theme"` in
`~/.config/pinevim/config.json`. The theme is applied non-persistently for the
session and does not write to Pi's `settings.json`.

The tmux status line uses the theme's accent for the brand mark; a `snow`-
themed session reads differently from a `cyberpunk`-themed one at first
glance. **[verified]**

The Neovim pane applies the same palette via the bundled Lua module. Both
panes share the same 8-role mapping. **[verified]**

## 5. ENV vocabulary (X2)

The PineVim ENV is the canonical five-segment row shared by both panes:

```
model · think · ctx · branch · agent
```

In the **Pi pane**, the deck (`ENV` row) carries these values. In the **Neovim
pane**, they are exposed as `vim.g.*` augmentations for users who want to embed
them in their own statusline:

| `vim.g.*` | Meaning |
| --------- | ------- |
| `pinevim_wordmark`   | Brand text (default `"pinevim"`) |
| `pinevim_accent`     | Accent color hex (e.g. `#7fd0a0`) |
| `pinevim_muted`      | Muted color hex |
| `pinevim_trunk_factor` | Trunk factor for the active theme |
| `pinevim_agent_lifecycle` | `idle` / `thinking` / `tooling` / `waiting` / `compacting` / `error` / `interrupted` / `offline` |
| `pinevim_agent_tools`    | Recent tool count (string) |
| `pinevim_agent_ctx`      | Recent context percent (string) |
| `pinevim_agent_model`    | Short model name (string) |

Override the brand text via `vim.g.pinevim_wordmark = "my-co"` before
`require('pinevim').setup()`.

## 6. Toggles

PineVim honors the following `vim.g.*` opt-outs (set in `init.lua` before
`require('pinevim').arm()`):

| Opt-out | Default | Effect |
| ------- | ------- | ------ |
| `vim.g.pinevim_chrome`     | `true`  | Skip all chrome (statusline + wordmark + splash) |
| `vim.g.pinevim_splash`     | `true`  | Skip the startup splash |
| `vim.g.pinevim_footer`     | `false` | Enable the optional IDE footer (opt-in) |
| `vim.g.pinevim_chrome_lsp` | `true`  | Skip the focused-pane gutter chrome |

## 7. Recovery

Quit Neovim normally, then request PineVim quit. If Pi is busy, PineVim follows
the `ui.confirm.quit` policy before requesting cancellation through Pi's
public lifecycle API: `ask` (default) prompts in tmux when a client is
attached and refuses with guidance headless, `always` confirms when you
repeat the quit within 30 seconds, and `never` cancels without prompting. The
same policy governs prefix-r recovery of a dead agent via `ui.confirm.retry`.

Recover a detached session with:

```sh
node dist/cli.js --resume /path/to/workspace
```

A second live controller is refused. Pi retry is explicit and validates any
cached session header before using it.

## 8. Configuration file

`~/.config/pinevim/config.json`:

```json
{
  "prefix": "F12",
  "agentRatio": 0.35,
  "logLevel": "off",
  "ui": {
    "enabled": true,
    "motion": "on",
    "glyphs": "unicode",
    "theme": "auto",
    "confirm": { "quit": "ask", "retry": "ask" }
  }
}
```

All PineVim-authored settings are validated against a strict schema. Unknown
fields, executable shell expressions, and provider settings are rejected.

## 9. Testing PineVim visually

The frame chrome cannot be visually inspected by the automated test harness
(the harness is non-interactive). The snapshot matrix at
`tests/fixtures/header-*.txt` pins the rendered output at 60/80/120 cols ×
16/24/30 rows × unicode/ascii × IDE/CHAT. After intentional frame changes,
run:

```sh
npm run snapshots:update
```

Review the fixture diff manually, then run the normal checks
(`npm run typecheck`, `npm run lint`, `npm run test:unit`).
