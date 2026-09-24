import { randomUUID } from "node:crypto";
import { open, unlink, rmdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Tmux, type Pane } from "../adapters/tmux/client.js";
import { Coalescer } from "../adapters/tmux/events.js";
import {
  statusOptionValue,
  type AgentTelemetry,
} from "../adapters/tmux/statusline.js";
import { helpPanelLines, statusPanelLines } from "../adapters/tmux/panels.js";
import { parseTelemetryLine } from "../piui/lifecycle.js";
import { installThemesToPi } from "./theme-install.js";
import { piCommand } from "../adapters/pi/adapter.js";
import { ControlServer, type ClientIdentity } from "../control/server.js";
import {
  type Peer,
  type RecordMessage,
  MAX_QUEUE,
  OP_MS,
} from "../control/protocol.js";
import { Store, type Metadata } from "../persistence.js";
import { type Config } from "../config.js";
import { editorCommand } from "../editor.js";
import {
  Logger,
  PineError,
  userFacing,
  recoveryCopy,
  plain,
} from "../diagnostics.js";
import { agentWidth, tooSmall } from "./layout.js";
import {
  initialState,
  reconcileChildren,
  transition,
  type State,
  type Intent,
  type Child,
} from "./state.js";
const helper = fileURLToPath(new URL("../control/helper.js", import.meta.url));
function child(p: Pane): Child {
  return {
    pane: p.pane,
    pid: p.pid,
    alive: p.alive,
    ready: p.ready,
    exitCode: p.exitCode,
    signal: p.signal,
  };
}
export class AppController {
  state: State;
  private server: ControlServer;
  private bridge: Peer | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private operation = 0;
  private timer: NodeJS.Timeout | null = null;
  private shutdownTimer: NodeJS.Timeout | null = null;
  private confirmPending: {
    nonce: string;
    action: "quit" | "retry";
    expires: number;
  } | null = null;
  private coalescer: Coalescer;
  private logger: Logger;
  private cleanupRuntime = false;
  private lastLayout = "";
  private lastPolicy = "";
  private quitPending = false;
  private lastStatus = "";
  private stopped = false;
  private slash = { ide: false, pinevim: false };
  /** Decoded bridge telemetry; null when the bridge is down. */
  private telemetry: AgentTelemetry | null = null;
  private themesCopied = false;
  private welcome = false;
  onStop: (message: string) => void = () => {};
  constructor(
    readonly config: Config,
    readonly store: Store,
    readonly tmux: Tmux,
    readonly metadata: Metadata,
    readonly piPath: string,
  ) {
    this.state = metadata.state;
    this.server = new ControlServer(
      metadata.runtime,
      this.state.epoch,
      (peer, identity, m) =>
        this.enqueue(() => this.control(peer, identity, m)),
    );
    this.coalescer = new Coalescer(() => {
      void this.intent("reconcile").catch(() => {});
    });
    this.logger = new Logger(store.directory, config.logLevel === "debug");
  }
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    if (this.queued >= MAX_QUEUE)
      return Promise.reject(
        new PineError(
          "QUEUE",
          "Controller queue full; retry after reconciliation.",
        ),
      );
    this.queued++;
    const expires = performance.now() + OP_MS;
    const result = this.queue.then(() => {
      if (performance.now() >= expires)
        throw new PineError(
          "TIMEOUT",
          "Queued control operation expired before execution; no action was started. Reconcile before trying again.",
        );
      return job();
    });
    this.queue = result
      .catch(() => {})
      .finally(() => {
        this.queued--;
      });
    return result;
  }
  async start(resume = false, picker = false): Promise<void> {
    await this.enqueue(async () => {
      await this.server.listen();
      // Install bundled themes into Pi's native themes dir BEFORE the agent
      // pane spawns: Pi resolves a persisted theme name at startup, before
      // extension discovery runs, so an extension-only registration would
      // fail with "Theme not found" on the launch after a /settings pick.
      this.themesCopied = (await installThemesToPi()) !== null;
      if (!this.themesCopied)
        await this.logger.write({ event: "failure", code: "THEME" });
      this.welcome = !resume && (await this.store.claimWelcome());
      if (!resume) {
        await this.tmux.configure(this.config.prefix);
        // Publish runtime identity before a child can exist. If the controller dies
        // during creation, recovery finds this server and refuses a duplicate writer.
        await this.persist();
        await this.logger.write({
          event: "startup",
          duration: process.uptime() * 1000,
        });
        const pane = await this.tmux.start(
          this.metadata.workspace,
          this.state.geometry.columns,
          this.state.geometry.rows,
          piCommand(this.piPath, picker ? "picker" : undefined),
          this.metadata.instance,
          this.uiEnvironment(),
        );
        this.metadata.session = pane.session;
        this.metadata.window = pane.window;
        this.state.agent = child(pane);
        await this.persist();
      } else {
        await this.tmux.verify(this.metadata.instance);
        const panes = await this.tmux.inventory();
        if (!this.state.agent && panes.length)
          throw new PineError(
            "IDENTITY",
            "Startup was interrupted before pane identity was recorded. Private processes are preserved; inspect the private server before recovery.",
          );
        this.adopt(panes, true);
        this.state.lifecycle = "running";
        this.state.bridge = false;
        this.state.pending = null;
        await this.tmux.notify(
          "Resumed workspace. Unfinished tool calls were not replayed.",
          "info",
        );
      }
      await this.tmux.bindings(process.execPath, helper, this.config.prefix);
      await this.apply(this.state);
      await this.persist();
    });
    this.timer = setInterval(() => this.coalescer.schedule(), 2000);
    this.timer.unref();
  }
  private adopt(panes: Pane[], strict = false): void {
    for (const key of ["agent", "editor"] as const) {
      const old = this.state[key];
      if (!old) continue;
      const p = panes.find(
        (p) =>
          p.pane === old.pane &&
          p.session === this.metadata.session &&
          p.window === this.metadata.window,
      );
      if (p && p.pid !== old.pid)
        throw new PineError(
          "IDENTITY",
          "Pane process identity changed; refusing automatic adoption.",
        );
      if (!p && strict && old.alive)
        throw new PineError(
          "IDENTITY",
          "Recorded pane is missing; inspect recovery metadata before adopting the workspace.",
        );
      this.state[key] = p
        ? {
            ...child(p),
            ready: key === "agent" ? old.ready && p.alive : p.alive,
          }
        : { ...old, alive: false, ready: false };
    }
    this.state = reconcileChildren(this.state);
  }
  private async control(
    peer: Peer,
    who: ClientIdentity,
    m: RecordMessage,
  ): Promise<Record<string, unknown>> {
    if (m.type === "hello") {
      if (who.role === "bridge") {
        if (m.payload.cwd !== this.metadata.workspace)
          throw new PineError(
            "WORKSPACE",
            "Pi workspace differs from PineVim. Reopen at the intended workspace; paired mode is disabled.",
          );
        await this.reconcile(false);
        if (
          !this.state.agent?.alive ||
          who.pid !== this.state.agent.pid ||
          who.generation <= this.state.generation
        )
          throw new PineError(
            "STALE",
            "Pi process or generation does not match the managed pane.",
          );
        const old = this.bridge;
        this.bridge = peer;
        old?.close();
        this.state.generation = who.generation;
        this.state.bridge = false;
        this.state.agent.ready = false;
        peer.on("closed", () => {
          void this.enqueue(async () => {
            if (this.bridge === peer && !this.stopped) {
              this.bridge = null;
              this.state.bridge = false;
              if (this.state.agent) this.state.agent.ready = false;
              await this.persist();
              await this.renderStatus();
            }
          }).catch(() => {});
        });
        this.bridgeStatus(m.payload);
        await this.persist();
        await this.renderStatus();
      }
      return {};
    }
    if (
      who.role === "bridge" &&
      (peer !== this.bridge || who.generation !== this.state.generation)
    )
      throw new PineError("STALE", "Stale Pi bridge; reconnect.");
    if (m.type === "status" && who.role === "bridge") {
      this.state.bridge = true;
      if (this.state.agent) this.state.agent.ready = true;
      this.bridgeStatus(m.payload);
      await this.persist();
      await this.renderStatus();
      return {};
    }
    if (m.type === "intent") {
      if (who.role === "bridge" && !this.slash.pinevim)
        throw new PineError(
          "COLLISION",
          "Slash command ownership is ambiguous; use prefix controls.",
        );
      return await this.dispatch(m.payload.intent as Intent);
    }
    if (m.type === "event" && who.role === "helper") {
      this.coalescer.schedule();
      return {};
    }
    if (m.type === "confirm" && who.role === "helper") {
      const c = this.confirmPending;
      this.confirmPending = null;
      if (
        !c ||
        c.nonce !== m.payload.nonce ||
        c.action !== m.payload.action ||
        c.expires < Date.now()
      )
        throw new PineError(
          "STALE",
          "Confirmation expired; request the action again.",
        );
      if (c.action === "retry") await this.retry();
      else await this.quit(true);
      return {};
    }
    throw new PineError(
      "PROTOCOL",
      "Request is not allowed for this connection.",
    );
  }
  private bridgeStatus(p: Record<string, unknown>): void {
    if (p.cwd !== this.metadata.workspace)
      throw new PineError(
        "WORKSPACE",
        "Pi workspace changed; reopen PineVim in the intended workspace.",
      );
    this.state.sessionId = typeof p.sessionId === "string" ? p.sessionId : null;
    this.state.sessionFile =
      typeof p.sessionFile === "string" ? p.sessionFile : null;
    this.state.busy = Boolean(p.busy);
    this.slash = { ide: p.ide === true, pinevim: p.pinevim === true };
    // Additive telemetry (v1.1): a malformed line simply means "no telemetry";
    // the controller falls back to the busy bit for the status line.
    this.telemetry =
      typeof p.telemetry === "string" ? parseTelemetryLine(p.telemetry) : null;
  }
  intent(intent: Intent): Promise<Record<string, unknown>> {
    return this.enqueue(() => this.dispatch(intent));
  }
  private async dispatch(intent: Intent): Promise<Record<string, unknown>> {
    if (this.stopped)
      throw new PineError("STOPPED", "Controller stopped; use --resume.");
    const started = performance.now();
    const op = ++this.operation;
    this.state.pending = op;
    this.tmux.deadline = performance.now() + 10000;
    try {
      await this.reconcile(intent === "reconcile");
      if (this.stopped) return {};
      if (intent === "status" || intent === "help") {
        // Panels replace the legacy one-line help/status toasts.
        // The intent still returns the legacy message so slash replies keep
        // carrying collision/recovery text that tests and users rely on.
        await this.showPanel(intent === "help" ? "help" : "status");
        return {
          message:
            intent === "help"
              ? "PineVim keys shown in a popup."
              : this.status(),
        };
      }
      if (intent === "quit") {
        await this.quit(false);
        return {
          message: "Quit request received. Follow the PineVim status/prompt.",
        };
      }
      if (intent === "retry") {
        if (!this.state.agent?.alive) await this.confirm("retry");
        return {};
      }
      if (this.state.lifecycle === "stopping" && intent !== "reconcile")
        throw new PineError(
          "STOPPING",
          "Pi shutdown is pending; wait for exit or the recovery timeout.",
        );
      let next = this.state;
      if (intent === "ide.open" && !this.state.editor?.alive) {
        const known = new Set([
          this.state.agent?.pane,
          this.state.editor?.pane,
        ]);
        if (
          (await this.tmux.inventory()).some(
            (p) => p.window === this.metadata.window && !known.has(p.pane),
          )
        )
          throw new PineError(
            "IDENTITY",
            "An untracked pane exists in the workspace window, possibly from an interrupted editor creation. Inspect it before opening another editor; existing processes are preserved.",
          );
        const argv = await editorCommand(this.config.nvim);
        const target = this.state.agent?.pane;
        if (!target)
          throw new PineError("AGENT", "No agent pane; retry Pi first.");
        // If a prior editor exited, remove its dead pane before creating a replacement.
        if (this.state.editor)
          await this.tmux.removeDead(this.state.editor.pane);
        this.state.editor = null;
        await this.persist();
        const pane = await this.tmux.createEditor(
          target,
          this.metadata.workspace,
          argv,
        );
        this.state.editor = child(pane);
        await this.persist();
      }
      next = transition(this.state, intent);
      if (
        (intent === "width.less" || intent === "width.more") &&
        next.mode === "IDE_WITH_AGENT" &&
        !next.compact
      ) {
        const width =
          agentWidth(next.geometry.columns, next.ratio) +
          (intent === "width.more" ? 5 : -5);
        next = {
          ...next,
          ratio:
            Math.max(40, Math.min(width, next.geometry.columns - 61)) /
            (next.geometry.columns - 1),
        };
      }
      await this.apply(next);
      this.state.pending = null;
      await this.persist();
      await this.renderStatus();
      await this.pushView();
      await this.logger.write({
        event: "intent",
        operation: op,
        duration: performance.now() - started,
      });
      return {};
    } catch (e) {
      this.tmux.deadline = Infinity;
      this.state.pending = null;
      await this.reconcile(false).catch(() => {});
      await this.apply(this.state).catch(() => {});
      await this.persist().catch(() => {});
      await this.tmux.notify(userFacing(e), "error").catch(() => {});
      await this.logger
        .write({
          event: "failure",
          operation: op,
          code: e instanceof PineError ? e.code : "OPERATION",
        })
        .catch(() => {});
      throw e;
    } finally {
      this.tmux.deadline = Infinity;
      this.state.pending = null;
    }
  }
  private async reconcile(observe: boolean): Promise<void> {
    const before = JSON.stringify(this.state);
    const panes = await this.tmux.inventory();
    const wasEditorAlive = this.state.editor?.alive;
    this.adopt(panes);
    if (
      wasEditorAlive &&
      this.state.editor &&
      !this.state.editor.alive &&
      (this.state.editor.signal || this.state.editor.exitCode)
    )
      await this.tmux.notify(recoveryCopy("EDITOR"), "warning");
    const geometry = await this.tmux.dimensions();
    const resized =
      geometry &&
      (geometry.columns !== this.state.geometry.columns ||
        geometry.rows !== this.state.geometry.rows);
    if (geometry) this.state.geometry = geometry;
    if (observe && !resized) {
      const active = panes.find(
        (p) => p.active && p.window === this.metadata.window,
      );
      if (active?.pane === this.state.editor?.pane && this.state.editor?.alive)
        this.state.focus = "editor";
      if (active?.pane === this.state.agent?.pane && this.state.agent?.alive)
        this.state.focus = "agent";
      if (
        this.state.mode === "IDE_WITH_AGENT" &&
        !this.state.compact &&
        this.state.agent?.alive &&
        this.state.editor?.alive
      ) {
        const a = panes.find((p) => p.pane === this.state.agent!.pane);
        if (
          a &&
          !a.zoomed &&
          a.width !== agentWidth(this.state.geometry.columns, this.state.ratio)
        )
          this.state.ratio = Math.max(
            0.1,
            Math.min(0.9, a.width / (this.state.geometry.columns - 1)),
          );
      }
    }
    this.state = reconcileChildren(this.state);
    if (
      this.state.editor &&
      !this.state.editor.alive &&
      this.state.agent?.alive
    ) {
      await this.tmux.removeDead(
        this.state.editor.pane,
      ); /* retain bounded exit metadata until next open */
    }
    if (
      !this.state.agent?.alive &&
      !this.state.editor?.alive &&
      (this.state.lifecycle === "stopping" || this.state.agent?.exitCode === 0)
    ) {
      await this.finish();
      return;
    }
    if (before !== JSON.stringify(this.state)) {
      this.lastLayout = "";
      await this.persist();
    }
  }
  private async apply(next: State): Promise<void> {
    const key = JSON.stringify({
      mode: next.mode,
      focus: next.focus,
      geometry: next.geometry,
      ratio: next.ratio,
      agent: next.agent?.alive,
      editor: next.editor?.alive,
    });
    if (key !== this.lastLayout) {
      const policy = JSON.stringify({
        mode: next.mode,
        geometry: next.geometry,
        ratio: next.ratio,
        agent: next.agent?.alive,
        editor: next.editor?.alive,
      });
      await this.tmux.layout(
        next,
        this.metadata.window,
        policy !== this.lastPolicy,
      );
      this.lastPolicy = policy;
      this.lastLayout = key;
    }
    this.state = next;
  }
  private status(): string {
    const agent = !this.state.agent?.alive
      ? "agent unavailable; prefix r retry"
      : !this.state.bridge
        ? "bridge disconnected; --resume"
        : this.state.busy
          ? "agent running"
          : "agent waiting";
    const hidden =
      this.state.mode === "CHAT_ONLY" && this.state.editor?.alive
        ? " | editor running, hidden"
        : "";
    const warning = tooSmall(this.state.geometry)
      ? " | resize to 60x16"
      : this.state.compact && this.state.mode === "IDE_WITH_AGENT"
        ? " | compact: prefix Tab switches"
        : "";
    const collision =
      this.state.bridge && !this.slash.pinevim
        ? " | /pinevim collision"
        : this.state.bridge && !this.slash.ide
          ? " | /ide collision"
          : "";
    const editor = this.state.editor?.alive
      ? "editor alive"
      : `editor exited ${this.state.editor?.signal ?? this.state.editor?.exitCode ?? "not started"}`;
    return plain(
      `${this.metadata.display.slice(0, 100)} | ${this.state.mode} | ${this.state.focus} | ${agent}${hidden}${warning}${collision} | ${editor} | PineVim 0.1.0; Pi ${this.metadata.versions.pi}; ${this.metadata.versions.tmux}; Node ${this.metadata.versions.node} | ${this.config.prefix} ? help`,
      500,
    );
  }
  private async renderStatus(): Promise<void> {
    const s = this.state;
    const styled = statusOptionValue({
      state: s,
      workspace: this.metadata.display,
      prefix: this.config.prefix,
      telemetry: s.bridge ? this.telemetry : null,
      ascii: process.env.PINEVIM_UI_GLYPHS === "ascii",
    });
    if (styled !== this.lastStatus) {
      await this.tmux.status(styled);
      this.lastStatus = styled;
    }
  }

  /** Environment flags for the Pi child: UI config + IDE view marker. */
  private uiEnvironment(): Record<string, string> {
    const env: Record<string, string> = {
      PINEVIM_UI_PREFIX: this.config.prefix,
      PINEVIM_UI: this.config.ui.enabled ? "1" : "0",
      PINEVIM_UI_MOTION: this.config.ui.motion,
      PINEVIM_UI_GLYPHS: this.config.ui.glyphs,
      PINEVIM_UI_THEME: this.config.ui.theme,
      ...(this.welcome ? { PINEVIM_WELCOME: "1" } : {}),
      // Spawn-time view snapshot for the in-pane header (resumed workspaces
      // start in their persisted mode); live updates arrive via intents.
      PINEVIM_IDE: this.state.mode === "CHAT_ONLY" ? "0" : "1",
    };
    return env;
  }

  /** Tell the Pi frame which view is showing. The header must not guess. */
  private async pushView(): Promise<void> {
    const bridge = this.bridge;
    if (!bridge || bridge.closed) return;
    const mode = this.state.mode === "CHAT_ONLY" ? "CHAT" : "IDE";
    try {
      await bridge.request(
        "view",
        { mode, focus: this.state.focus },
        this.state.generation,
        this.state.epoch,
      );
    } catch {
      /* the next status report still carries layout through the strip */
    }
  }

  /** Show a help/status popup; falls back to a plain toast on failure. */
  private async showPanel(kind: "help" | "status"): Promise<void> {
    try {
      if (kind === "help") {
        await this.tmux.popup(
          helpPanelLines(this.config.prefix),
          70,
          process.execPath,
          helper,
        );
      } else {
        const facts = {
          workspace: this.metadata.display,
          session: this.state.sessionId,
          bridge: this.state.bridge,
          slash: this.slash,
          versions: this.metadata.versions,
          editorNote:
            this.state.editor && !this.state.editor.alive
              ? recoveryCopy("EDITOR")
              : null,
          prefix: this.config.prefix,
          telemetry: this.state.bridge ? this.telemetry : null,
          themes: (this.themesCopied ? "copied" : "not copied") as
            "copied" | "not copied",
        };
        await this.tmux.popup(
          statusPanelLines(this.state, facts),
          70,
          process.execPath,
          helper,
        );
      }
    } catch {
      // Popup unavailable (older tmux, no client): keep the legacy toast path.
      const legacy =
        kind === "help"
          ? `${this.config.prefix} then i IDE, c chat, a hide/show, Tab focus, arrows width, r retry, q quit, ? help`
          : this.status();
      await this.tmux.notify(legacy, "info");
    }
  }
  private async persist(): Promise<void> {
    this.metadata.state = this.state;
    this.metadata.updated = Date.now();
    await this.store.save(this.metadata);
  }
  private async confirm(action: "quit" | "retry"): Promise<void> {
    const nonce = randomUUID();
    this.confirmPending = { nonce, action, expires: Date.now() + 30000 };
    await this.tmux.confirm(
      action === "quit"
        ? "Cancel active Pi work and quit?"
        : "Start a replacement Pi with the last known session?",
      process.execPath,
      helper,
      action,
      nonce,
    );
  }
  private async quit(cancel: boolean): Promise<void> {
    await this.reconcile(false);
    if (this.stopped) return;
    if (this.state.editor?.alive) {
      await this.apply({ ...this.state, mode: "IDE_FOCUS", focus: "editor" });
      await this.persist();
      await this.renderStatus();
      await this.tmux.notify(
        "Quit Neovim with :qa or :wqa, then repeat PineVim quit. Modified buffers remain protected.",
        "warning",
      );
      return;
    }
    if (!this.state.agent?.alive) {
      await this.finish();
      return;
    }
    if (this.state.lifecycle === "stopping" || this.quitPending) return;
    if (!this.bridge || this.bridge.closed)
      throw new PineError(
        "DISCONNECTED",
        "Pi bridge unavailable. Quit Pi normally or detach and use --resume; PineVim will not kill it.",
      );
    if (this.state.busy && !cancel) {
      await this.confirm("quit");
      return;
    }
    this.quitPending = true;
    const bridge = this.bridge,
      generation = this.state.generation;
    // Complete slash reply before asking Pi to drain. The out-of-band turn has its own deadline.
    setImmediate(() => {
      void this.enqueue(async () => {
        if (
          this.bridge !== bridge ||
          this.state.generation !== generation ||
          this.state.editor?.alive
        )
          return;
        await bridge.request(
          "shutdown",
          { cancel },
          generation,
          this.state.epoch,
        );
        this.state.lifecycle = "stopping";
        await this.persist();
        this.shutdownTimer = setTimeout(() => {
          void this.enqueue(async () => {
            if (this.state.lifecycle === "stopping") {
              this.state.lifecycle = "running";
              await this.persist();
              await this.tmux.notify(
                "Pi shutdown timed out; processes preserved. Wait for Pi to settle or quit it normally.",
                "warning",
              );
            }
          }).catch(() => {});
        }, 10000);
      })
        .catch((e) => {
          void this.tmux.notify(userFacing(e), "error").catch(() => {});
        })
        .finally(() => {
          this.quitPending = false;
        });
    });
  }
  private async retry(): Promise<void> {
    await this.reconcile(false);
    if (this.state.agent?.alive) return;
    let session: string | undefined;
    if (this.state.sessionFile) {
      const fd = await open(
        this.state.sessionFile,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await fd.stat();
        if (!stat.isFile() || stat.uid !== process.getuid?.())
          throw new Error();
        const buffer = Buffer.alloc(8192);
        const { bytesRead } = await fd.read(buffer, 0, 8192, 0);
        const header = JSON.parse(
          buffer.subarray(0, bytesRead).toString().split("\n")[0]!,
        ) as { type: string; cwd: string; id: string };
        if (
          header.type !== "session" ||
          header.cwd !== this.metadata.workspace ||
          header.id !== this.state.sessionId
        )
          throw new Error();
        session = this.state.sessionFile;
      } catch {
        throw new PineError(
          "SESSION",
          "Last Pi session reference could not be validated; use Pi native resume after resolving the reference.",
        );
      } finally {
        await fd.close();
      }
    }
    if (!this.state.agent)
      throw new PineError(
        "AGENT",
        "No recorded agent pane. Relaunch PineVim after preserving the editor.",
      );
    const old = this.state.agent;
    await this.tmux.command(
      "respawn-pane",
      "-t",
      old.pane,
      "-c",
      this.metadata.workspace.replace(/#/g, "##"),
      ...piCommand(this.piPath, session),
    );
    const pane = (await this.tmux.inventory()).find((p) => p.pane === old.pane);
    if (!pane) throw new PineError("TMUX", "Replacement Pi pane is missing.");
    this.state.agent = { ...child(pane), ready: false };
    this.state.generation = 0;
    this.state.bridge = false;
    this.state.mode = this.state.editor?.alive ? "IDE_WITH_AGENT" : "CHAT_ONLY";
    this.state.focus = "agent";
    this.lastLayout = "";
    await this.apply(this.state);
    await this.persist();
    await this.renderStatus();
  }
  private async finish(): Promise<void> {
    await this.tmux.verify(this.metadata.instance);
    const inventory = await this.tmux.inventory();
    const owned = new Set([this.state.agent?.pane, this.state.editor?.pane]);
    if (inventory.some((p) => owned.has(p.pane) && p.alive))
      throw new PineError("ALIVE", "Live children prevent cleanup.");
    let unrelated = inventory.some((p) => !owned.has(p.pane));
    this.state.lifecycle = "stopping";
    await this.persist();
    for (const p of inventory)
      if (owned.has(p.pane)) await this.tmux.removeDead(p.pane);
    try {
      if (await this.tmux.reachable()) {
        await this.tmux.verify(this.metadata.instance);
        const remaining = await this.tmux.inventory();
        unrelated = remaining.length > 0;
        if (remaining.some((p) => owned.has(p.pane)))
          throw new PineError(
            "ALIVE",
            "A managed pane changed during cleanup; preserve and reconcile it.",
          );
      }
    } catch (error) {
      // The last pane can close the server between connect and inventory.
      // Only an OS-confirmed closed socket permits cleanup after that race.
      if (await this.tmux.reachable()) throw error;
      unrelated = false;
    }
    this.state.lifecycle = "stopped";
    if (!unrelated) {
      await unlink(this.store.metadataPath);
      this.cleanupRuntime = true;
    } else await this.persist();
    this.stopped = true;
    this.stopTimers();
    this.onStop(
      unrelated
        ? "PineVim children exited; private server retained for untracked jobs."
        : "PineVim exited safely.",
    );
  }
  private stopTimers(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.shutdownTimer) clearTimeout(this.shutdownTimer);
    this.coalescer.close();
  }
  private detachTask: Promise<void> | null = null;
  detach(): Promise<void> {
    return (this.detachTask ??= this.detachOnce());
  }
  private async detachOnce(): Promise<void> {
    this.stopTimers();
    let persistenceError: unknown;
    await this.enqueue(async () => {
      try {
        if (!this.stopped) {
          this.state.lifecycle = "detached";
          await this.persist();
        }
      } catch (error) {
        persistenceError = error;
      } finally {
        this.stopped = true;
        this.bridge = null;
      }
    });
    await this.server.close();
    if (this.cleanupRuntime) {
      await this.store.validateRuntime(this.metadata);
      for (const file of [
        "token",
        "identity.json",
        "tmux.conf",
        "control.sock",
        "tmux.sock",
      ])
        await unlink(join(this.metadata.runtime, file)).catch((e) => {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        });
      await rmdir(this.metadata.runtime);
    }
    await this.store.release();
    if (persistenceError) throw persistenceError;
  }
}
export function newMetadata(
  workspace: string,
  display: string,
  runtime: string,
  instance: string,
  config: Config,
  geometry: { columns: number; rows: number },
  versions: Metadata["versions"],
): Metadata {
  return {
    version: 1,
    workspace,
    display,
    runtime,
    instance,
    session: "$0",
    window: "@0",
    state: initialState(geometry, randomUUID(), config.agentRatio),
    versions,
    updated: Date.now(),
    clientPid: null,
  };
}
