# Release checklist

Work through every section top to bottom before tagging a release. A release
may not be declared production-ready while any box in
[Required environments](#required-environments) or
[Release-blocking decisions](#release-blocking-decisions) is unchecked. See
[Compatibility](Compatibility.md) for the dependency evidence behind this
checklist and [Testing](Testing.md) for the procedures it references.

## Version support

| Dependency | Declared support                                                   | Verification gate                                                   |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Node       | 22.19+ (declared minimum, exercised in CI); 26.x exercised locally | `setup-node 22` unit + integration jobs                             |
| Pi         | exactly 0.87.1 (lockfile-pinned; other versions rejected)          | `npm ci` in both workflows; phase 0 audit                           |
| tmux       | >= 3.5 (CSI-u requirement); 3.7c exercised locally                 | 3.5 built from source on Linux CI; brew + version check on macOS CI |
| Neovim     | >= 0.12.4 (no lower minimum claimed)                               | Pinned tarball on Linux CI; brew on macOS CI                        |
| terminfo   | tmux-256color, screen-256color fallback                            | `infocmp` probe at startup; phase 0                                 |

## Automated gates

- [ ] `npm ci && npm run format:check && npm run lint && npm run typecheck`
- [ ] `npm test` (unit + integration; launches real Pi 0.87.1 + tmux + Neovim
      in fabricated HOME/XDG directories)
- [ ] `npm run test:phase0` (independent audit of the installed Pi on PATH)
- [ ] `python3 tests/terminal/transport.py` (attached PTY runner: prefix
      routing, bracketed paste, CSI-u, resize, crash/resume)
- [ ] `npm run test:package` (tarball pack, allowlist audit, disposable-prefix
      install, help/version smoke)
- [ ] `npm run benchmark` and record startup/transition/idle results against
      targets (<250 ms startup p95, <100 ms transition p95, <1% idle CPU)
- [ ] GitHub `Integration` workflow green on linux and macos
      (`workflow_dispatch` or `integration` label; installs tmux 3.5 from
      source, Neovim 0.12.4, runs integration + phase 0 + SSH smoke)

## Fault-injection evidence

- [ ] `tests/integration/fault.test.ts` green in CI: Pi killed mid-stream,
      Pi killed mid-run with resume recovery, editor killed mid-view-switch,
      500-event control IPC flood, interrupted controller with dead-owner
      lock reclaim
- [ ] 200-resize stress convergence (`tests/integration/stress.test.ts`)
      green alongside the fault suite

## Required environments

On each supported macOS/Linux emulator and SSH path, record OS, terminal and
version, locale/font, Node/Pi/tmux/Neovim versions, outer tmux configuration,
and per-step results. Use a disposable workspace; the harness never edits
normal Pi/Neovim configuration. Full steps 1–9 live in
[Testing](Testing.md#required-real-environment-record); tick here only with a
recorded result.

- [ ] macOS native terminal (steps 1–9)
- [ ] Linux native terminal (steps 1–9)
- [ ] SSH path (steps 1–9)
- [ ] Nested tmux with a default outer server (expected CSI-u collapse
      documented, not labelled a pass)
- [ ] Outer tmux configured for CSI-u (repeat steps 1–9)
- [ ] Physical keyboard: F12 prefix, literal F12, Shift+Enter, Alt+Enter,
      Escape, Ctrl+C/D/Z, bracketed multiline paste (step 2)
- [ ] Unicode wide/combining text, ASCII fallback, 256-color and TrueColor
      appearance (step 6)
- [ ] Clipboard text and OSC52 verified per emulator; image paths explicitly
      marked unsupported (step 6)
- [ ] Personal-configuration semantic smoke (`scripts/user-config-smoke.py`)
      on one representative real setup

## Release-blocking decisions

- [ ] Clean-install path verified: fresh clone, `npm ci`, launch, IDE pair,
      resume (no stale state, lock or runtime reuse)
- [ ] Upgrade path verified: prior version's workspace opened by the new
      version; metadata/lock migration or explicit refusal documented
- [ ] Compatibility record updated with observed dependency versions and
      evidence links
- [ ] Implementation Evidence updated for every requirement
- [ ] No unchecked environment row above, and no gate below marked passed on
      partial evidence ("Do not label a failed path as passed")

## Known open gates at time of writing

Carried from [Compatibility](Compatibility.md) — these remain unverified
until a release record closes them:

- Linux and SSH remain pending environment gates.
- Physical keyboard, terminal fonts, clipboard behavior on real emulators.
- Full personal Signal/model-picker visual rendering, physical LazyVim
  navigation, actual clipboard, Unicode glyph widths on real terminals.
- Tool-card parity against Pi's built-in renderer (run ledger is the scan
  surface; `registerTool` is not used for built-in tools).
