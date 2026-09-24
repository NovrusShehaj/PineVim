# Copilot instructions for PineVim

## Project overview

PineVim is a Node.js/TypeScript CLI that runs Pi and normal Neovim in a private tmux server. Pi remains the owner of chat, models, authentication, extensions, sessions, and the engine inside its UI: editing semantics, Markdown, tool execution, pickers, keybindings. Neovim remains the owner of editor state and terminal jobs. PineVim owns the workspace lifecycle, tmux layout, recovery, the bridge between Pi and the controller, and — through the bundled extension's `src/piui/` layer — the frame chrome of the Pi pane (header, status deck, chip band, working indicator, turn summaries, themes) installed exclusively via Pi's public extension API. Amended contract: PineVim may install its own header/footer/editor-frame components, but must stand down when another extension has installed a conflicting custom editor, must keep Pi's editing semantics intact, and must degrade to stock Pi when the pinned Pi version lacks required hooks. The tmux control plane never depends on the in-pane UI.

The implementation is intentionally an adapter/controller design:

- `src/cli.ts` validates the platform, terminal geometry, workspace, configuration, and dependency versions, acquires the workspace lock, creates or resumes metadata, and attaches to the private tmux session.
- `src/core/controller.ts` is the serialized operation coordinator. It reconciles observed tmux panes into persisted state, dispatches intents, applies layouts, persists metadata, handles safe quit/retry, and reports status.
- `src/core/state.ts` is the state machine for modes/focus and child-death reconciliation; `src/core/layout.ts` contains compact-terminal thresholds and pane-width calculations.
- `src/adapters/tmux/` is the only tmux integration. It creates/configures a private server, binds prefix/helper actions, inventories panes, and converges layout from observed pane state.
- `src/adapters/pi/` loads the bundled Pi extension and validates the supported Pi executable/version. `extension.ts` registers `/ide` and `/pinevim`, reports Pi status (including additive lifecycle telemetry), and reconnects to the controller without replaying lost actions.
- `src/piui/` is the in-pane UI layer: `lifecycle.ts` is the single authoritative lifecycle reducer over Pi extension events; `glyphs.ts`/`chips.ts` are the shared visual vocabulary (Unicode + ASCII fallback); `components/` renders the header, status deck, and chip band; `renderers/` renders turn summaries; `themes/` ships PineVIM theme JSONs applied non-persistently via `setTheme(instance)`. All of it must use Pi's public extension API only.
- `src/control/` implements authenticated Unix-socket IPC. `protocol.ts` owns record schemas, framing, size/queue limits, request acknowledgements, epochs, and generations; `server.ts` authenticates bridge/helper clients.
- `src/persistence.ts` owns private state/runtime directories, exclusive workspace locking, atomic metadata writes, runtime identity/token validation, and conservative recovery checks. `src/config.ts`, `src/editor.ts`, and `src/process.ts` enforce configuration and child-process boundaries.

When changing behavior, trace the full path: Pi command or tmux helper → control protocol → controller queue/state transition → tmux inventory/layout → persisted metadata. Do not update only an optimistic in-memory state; controller operations reconcile actual pane identity and persist only after the operation converges.

## Build, test, and lint

Requirements are Node `>=22.19.0`, Pi `0.87.1`, tmux `>=3.5`, and an available Neovim for IDE/integration scenarios.

```sh
npm ci
npm run build                 # compile src/ to dist/
npm run typecheck             # strict source and test type-check
npm run lint                  # ESLint src and tests, warnings are errors
npm run format:check          # Prettier verification
npm test                      # build, compile tests, unit + integration tests serially
```

Targeted checks:

```sh
npm run test:unit
npm run test:integration

# One unit file
tsc -p tsconfig.test.json && node --test build/tests/unit/core.test.js

# One integration file; keep integration tests serial
npm run build && tsc -p tsconfig.test.json &&
  node --test --test-concurrency=1 build/tests/integration/lifecycle.test.js

# One named Node test after compiling
tsc -p tsconfig.test.json &&
  node --test --test-name-pattern="pattern" build/tests/unit/core.test.js
```

Additional repository checks:

```sh
npm run test:phase0            # installed Pi public-contract and geometry checks
python3 tests/terminal/transport.py
python3 scripts/user-config-smoke.py
npm run test:package           # disposable npm pack/install smoke test
npm run benchmark
```

Integration and terminal tests use fabricated HOME/XDG/Pi resources and unique private tmux sockets. Never use the default tmux server or an unscoped `tmux kill-server`; cleanup must be limited to the test's verified private runtime. `Docs/Testing.md` is the source for the external macOS/Linux/SSH and physical-terminal release matrix.

## Repository-specific conventions and invariants

- Use strict TypeScript conventions from `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, no unused locals/parameters, and no explicit `any` (`eslint.config.js`).
- Keep production process execution argument-based (`shell: false`). Dynamic paths, tmux formats, status text, helper commands, and IPC payloads must remain bounded and validated; do not introduce shell interpolation or terminal-output scraping.
- Preserve ownership boundaries: do not read/copy Pi credentials, source project config, replace Pi's UI, install Neovim plugins, add Neovim RPC, or change the user's global tmux configuration. PineVim launches Pi with the bundled extension and launches Neovim normally in the workspace.
- Preserve recovery conservatism. A missing transport does not prove children are dead; recorded child PIDs, runtime identity, canonical workspace, private tmux instance identity, stable pane IDs, and lock ownership must be checked before adoption or cleanup. Unknown process state is treated as live.
- Treat tmux as the source of truth for pane/process/layout observations. Operations are serialized through the controller queue, bounded by deadlines, reconciled after failures, and persisted atomically. Failed or disconnected requests are discarded, not replayed.
- Keep IPC compatibility rules centralized in `src/control/protocol.ts`: exact schemas/enums, Unix-socket token authentication, 16 KiB records, bounded queues, acknowledgement/result deadlines, and epoch/generation checks are part of the safety contract.
- Preserve child processes during normal view changes and failures. Hiding the editor changes the view, not the Neovim process; a dead Pi requires explicit prefix-`r` recovery; editor replacement occurs only through an explicit `/ide` open after reconciliation.
- Use the reducer in `src/core/state.ts` for mode/focus transitions and the layout helpers for the 101×24 compact threshold and 60×16 launch minimum. Layout changes must validate final pane geometry and retain the last viable view if convergence fails.
- Configuration is strict and isolated to `${XDG_CONFIG_HOME:-~/.config}/pinevim/config.json`; only documented fields are accepted, executable overrides must be absolute paths, and `PINEVIM_LOG_LEVEL` is the only supported environment override.
- Keep diagnostics actionable but privacy-preserving. Logs are opt-in debug logs with bounded allowlisted events; do not include prompts, transcripts, credentials, arbitrary environment values, or secret contents.
- Update `README.md`, `Docs/Testing.md`, or compatibility/evidence documentation when a change alters a documented command, dependency contract, recovery behavior, or release gate.
