# Compatibility record

Release status: **not yet release-verified**. Automated fixture results do not establish physical keyboard, display, clipboard, SSH, Linux, or full personal-configuration rendering/key compatibility. A semantic personal-configuration smoke passed.

## Observed dependencies

| Dependency | Local version                  | Evidence                                                                         |
| ---------- | ------------------------------ | -------------------------------------------------------------------------------- |
| Node       | 22.19.0 and 26.9.0             | Local runtime, TypeScript and process tests                                      |
| Pi         | 0.87.1                         | Package metadata; pinned public API typecheck and real interactive fixture tests |
| tmux       | 3.7c                           | Private-server and attached-PTY tests                                            |
| Neovim     | 0.12.4                         | Real process tests and clean buffer-preservation test                            |
| terminfo   | tmux-256color, screen-256color | Local infocmp checks                                                             |

Node 22.19.0 is the declared minimum and was exercised alongside 26.9.0. tmux >=3.5 is required for the selected CSI-u configuration. Other Pi versions are rejected. No lower Neovim minimum is claimed. Linux and SSH are pending environment gates.

## Phase 0 and terminal transport

- PASS: real Pi explicit-extension loading, public command ownership metadata, suffixed duplicate command detection, custom input editor, Ctrl+L dialog, and `/reload`, all with fabricated resources.
- PASS: real Pi/Neovim process IDs across 18 geometry/zoom transitions, including 80×24, 60×16, and below the fresh-launch minimum.
- PASS: automated attached PTY routes F12 controls, literal F12, bracketed paste and CSI-u Shift+Enter; a real physical keyboard remains a separate test.
- PASS: attached controller SIGKILL/resume with the same child PIDs. Zombie/exiting controller processes require OS-state checking because `kill(pid, 0)` alone still succeeds for them.
- Nested tmux initially collapsed CSI-u when the synthetic outer server used default extended-key settings. The configured-outer-server rerun passed F12, paste, CSI-u, resize, retry and safe quit. Production does not change outer tmux.
- PASS: normal installed personal Pi handshake, actual Ctrl+L model-picker semantic rendering at 120/80/60 columns and in the wide split agent pane, normal Neovim startup, PID continuity and native quit; no Neovim configuration file hash changed. No provider completion was invoked.
- PASS: attached regular and fullscreen Pi fixture scenarios.
- Full personal Signal/model-picker visual rendering, physical LazyVim navigation, actual clipboard, Unicode glyph widths, SSH and terminal color appearance remain externally unverified.

ADR-001 is retained: interactive Pi inside private tmux. No custom compositor, RPC-only chat UI, or alternate architecture has been introduced.

## Color, clipboard and input policy

Terminfo is probed before selecting tmux-256color; screen-256color is the fallback. PineVim does not advertise unsupported RGB features. Its status strip uses ASCII-safe text. Applications render their own Unicode and color. Images have no blanket passthrough guarantee.

Mouse support is enabled. `allow-passthrough off` and `set-clipboard external` are explicit baseline choices; clipboard compatibility must be checked on each actual emulator and SSH path. The outer tmux must forward the chosen prefix and extended keys. Synthetic input tests certify byte routing, not OS function-key interception or physical key mapping.

The public extension lifecycle and explicit loading contract were cross-checked against [Pi's documentation](https://pi.dev/docs/latest/extensions); implementation is pinned to the installed 0.87.1 exported types. Terminal commands were checked against the installed manual and [tmux's manual](https://man.openbsd.org/tmux).
