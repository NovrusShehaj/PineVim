# Testing and release gates

## Automated checks

Run from the checkout:

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:phase0
python3 tests/terminal/transport.py
npm run test:package
npm run benchmark
```

`npm test` compiles strict TypeScript and runs Node's test runner. Integration tests launch real Pi 0.87.1 and Neovim in fabricated HOME/XDG/Pi directories. A deterministic public provider fixture supplies responses without network/authentication. Tests do not copy personal resources. Normal Neovim production arguments remain unchanged; `--clean -i NONE` appears only in isolated buffer tests. Tests use private unique tmux sockets and clean up only their own fixtures.

`test:phase0` independently tests the installed Pi found on PATH. The attached PTY runner tests the compiled CLI, prefix byte routing, literal prefix, bracketed paste, CSI-u, resizing, process identity and controller crash/resume. The outer tmux in its nested case is an isolated fixture configured for extended keys. This does not certify physical keys, terminal fonts, or clipboard behavior.

The package smoke packs a tarball, audits its allowlist, installs into a disposable prefix, and exercises help/version and bundled asset availability. It does not publish or install globally.

The benchmark samples 20 fresh CLI processes with warm filesystem caches before Pi launch, 40 live-pane transitions at 120×30, and 60 seconds of controller idle CPU. It records launch-to-bridge readiness separately from controller prelaunch overhead. Measurements exclude child redraw and distinguish controller-process CPU from tmux/Pi/Neovim CPU. Performance targets are <250 ms startup p95, <100 ms view transition p95, and <1% controller idle CPU. Results must be recorded, not inferred from passing correctness tests.

The normal personal-configuration semantic smoke is separate and can write normal Pi/Neovim runtime state:

```sh
python3 scripts/user-config-smoke.py
```

It submits no model prompt and checks the actual Ctrl+L picker, normal editor, view continuity and native quit. It cannot certify fonts, physical input or clipboard. If interrupted, it preserves children and prints the exact recovery environment/command.

## Required real-environment record

On each supported macOS/Linux emulator and SSH path, record OS, terminal/version, locale/font, Node/Pi/tmux/Neovim versions, outer tmux configuration, and result for each step. Use a disposable workspace. Normal Pi/Neovim can write their own settings, caches and sessions; the harness must not edit their config.

1. Start `node dist/cli.js /path/to/disposable-workspace` with normal personal configuration. Verify Signal UI, existing commands, model picker Ctrl+L, Ctrl+B tree filtering and regular/fullscreen Pi.
2. Test F12 then i/c/a/Tab/arrows/q/?/r, literal F12, Shift+Enter, Alt+Enter, Escape, Ctrl+C/D/Z, bracketed multiline paste, and custom picker at wide and narrow sizes.
3. Open IDE, create an unsaved scratch buffer, move its cursor and make an undoable edit. Hide/show Pi and close/reopen IDE. Check the same Pi session/model, Neovim PID, text, cursor and undo.
4. Test LazyVim Ctrl+H/J/K/L, its terminal jobs and navigation. Try startup from a Neovim terminal with inherited remote-editor markers. Verify a separate normal editor starts.
5. Drag a border, click pane focus, cross 120×30, 101×24, 100×24, 80×24 and 60×16, and shrink below minimum. Widening must restore the desired mode and ratio.
6. Test Unicode wide/combining text, ASCII locale fallback, 256-color and real TrueColor appearance. Test text clipboard and OSC52 separately from images. Mark unsupported image paths explicitly.
7. Repeat native-terminal scenarios through nested tmux and SSH. With a default outer tmux, modified Enter may collapse; configure CSI-u explicitly in your own outer setup and repeat. Do not label a failed path as passed.
8. Request quit with a modified editor; verify no automatic editor input/destruction. Quit Neovim normally, then confirm or decline busy Pi cancellation. Check terminal modes after detachment/exit.
9. Kill only the controller PID, then `node dist/cli.js --resume /same/workspace`. Check same children and no new provider/tool action. Kill Pi in a fixture and explicitly confirm prefix-r recovery; never do destructive crash testing on unsaved personal work.

No live credentialed provider test is required for ordinary CI. If separately performed, record provider identity and outcome without credentials or transcript contents. Stored authentication is never proof of live connectivity.

## Safety and cleanup

Production paths use argument-array process execution. IPC framing, schema, authentication, epoch/generation checks, queue limits and record bounds have dedicated tests. Tests use synthetic canaries for secret-leak checks. Hostile paths include spaces, quotes, dollar signs, semicolons, tmux format markers, brackets and newlines. tmux renders newlines in reported paths as underscores; tests verify the child's actual cwd independently.

Do not use the default tmux server for testing. A test crash can leave its private server under its reported temporary directory; verify its instance and pane inventory before removing it. Never run an unscoped `tmux kill-server` to clean tests.

See [Implementation Evidence](Implementation-Evidence.md) for requirement-by-requirement results. Missing physical-terminal/platform evidence prevents a production-ready claim.
