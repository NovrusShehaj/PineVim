import { createConnection } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { run, serverEnvironment } from "../../process.js";
import { literal, PineError } from "../../diagnostics.js";
import { helperCommand, tmuxQuote, tmuxConfig, terminfo } from "./config.js";
import { menuDisplayArgv } from "./panels.js";
import { agentWidth } from "../../core/layout.js";
import { sgr } from "./styled.js";
import type { State, Child } from "../../core/state.js";
export interface Pane extends Child {
  session: string;
  window: string;
  width: number;
  height: number;
  left: number;
  active: boolean;
  zoomed: boolean;
  windowWidth: number;
  windowHeight: number;
}
const paneFormat =
  "#{session_id}|#{window_id}|#{pane_id}|#{pane_pid}|#{pane_dead}|#{pane_dead_status}|#{pane_dead_signal}|#{pane_width}|#{pane_height}|#{pane_left}|#{pane_active}|#{window_zoomed_flag}|#{window_width}|#{window_height}";
export class Tmux {
  readonly socket: string;
  readonly config: string;
  readonly env: NodeJS.ProcessEnv;
  deadline = Infinity;
  constructor(
    readonly executable: string,
    readonly runtime: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.socket = join(runtime, "tmux.sock");
    this.config = join(runtime, "tmux.conf");
    this.env = serverEnvironment(env);
  }
  async command(...args: string[]): Promise<string> {
    const remaining = this.deadline - performance.now();
    if (remaining <= 0)
      throw new PineError(
        "TIMEOUT",
        "Layout operation deadline exceeded; reconcile before retrying.",
      );
    return await run(
      this.executable,
      ["-S", this.socket, "-f", this.config, ...args],
      { env: this.env, timeout: Math.min(5000, remaining) },
    );
  }
  async configure(prefix: string): Promise<void> {
    await writeFile(this.config, tmuxConfig(prefix, await terminfo()), {
      mode: 0o600,
    });
  }
  async start(
    workspace: string,
    columns: number,
    rows: number,
    argv: string[],
    instance: string,
    childEnv: Record<string, string> = {},
  ): Promise<Pane> {
    const pane = await this.command(
      "new-session",
      "-d",
      "-s",
      "pinevim",
      "-x",
      String(columns),
      "-y",
      String(rows),
      "-c",
      workspace.replace(/#/g, "##"),
      "-P",
      "-F",
      "#{pane_id}",
      ...argv,
    );
    // Child-facing UI flags ride the server-global environment; every value is
    // a bounded PineVIM-authored token, not user input. Chained into one
    // tmux round trip with the instance option (subprocess overhead per
    // invocation dominated start latency).
    const envCommands = Object.entries(childEnv).map(([key, value]) => [
      "set-environment",
      "-g",
      key,
      value,
    ]);
    await this.command(
      ...[
        ["set-option", "-g", "@pinevim-instance", instance],
        ...envCommands,
      ].flatMap((c, i) => (i ? [";", ...c] : c)),
    );
    const found = (await this.inventory()).find((p) => p.pane === pane);
    if (!found)
      throw new PineError("TMUX", "Pi pane creation could not be reconciled.");
    return found;
  }
  async inventory(): Promise<Pane[]> {
    const lines = await this.command("list-panes", "-a", "-F", paneFormat);
    return this.parsePanes(lines);
  }
  private parsePanes(lines: string): Pane[] {
    return lines
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [
          session,
          window,
          pane,
          pid,
          dead,
          exit,
          signal,
          width,
          height,
          left,
          active,
          zoomed,
          ww,
          wh,
        ] = line.split("|");
        if (
          !session ||
          !/^\$\d+$/.test(session) ||
          !window ||
          !/^@\d+$/.test(window) ||
          !pane ||
          !/^%\d+$/.test(pane)
        )
          throw new PineError("TMUX", "Invalid tmux inventory.");
        return {
          session,
          window,
          pane,
          pid: Number(pid),
          alive: dead === "0",
          ready: dead === "0",
          exitCode: exit ? Number(exit) : null,
          signal: signal ? signal.toUpperCase() : null,
          width: Number(width),
          height: Number(height),
          left: Number(left),
          active: active === "1",
          zoomed: zoomed === "1",
          windowWidth: Number(ww),
          windowHeight: Number(wh),
        };
      });
  }
  async verify(instance: string): Promise<void> {
    if (
      (await this.command("show-option", "-gqv", "@pinevim-instance")) !==
      instance
    )
      throw new PineError(
        "IDENTITY",
        "Private tmux identity mismatch; refusing adoption or cleanup.",
      );
  }
  async bindings(
    node: string,
    helper: string,
    prefix: string,
    ascii = false,
  ): Promise<void> {
    // One tmux round trip: 16 separate bind-key/set-hook invocations cost
    // ~9-20 ms of subprocess overhead each and dominate controller start.
    const commands: string[][] = [];
    for (const [key, intent] of Object.entries({
      i: "ide.open",
      c: "chat",
      a: "agent.toggle",
      Tab: "focus.other",
      Left: "width.less",
      Right: "width.more",
      q: "quit",
      r: "retry",
      s: "status",
      t: "timeline",
      "?": "help",
    }))
      commands.push([
        "bind-key",
        "-T",
        "prefix",
        key,
        "run-shell",
        "-b",
        helperCommand(node, helper, this.runtime, intent),
      ]);
    commands.push(["bind-key", "-T", "prefix", prefix, "send-prefix"]);
    commands.push([
      "bind-key",
      "-T",
      "prefix",
      "m",
      ...menuDisplayArgv(node, helper, this.runtime, prefix, ascii),
    ]);
    for (const [hook, event] of Object.entries({
      "client-resized": "resize",
      "window-layout-changed": "layout",
      "pane-focus-in": "focus",
      "pane-died": "death",
      "client-detached": "detach",
    }))
      commands.push([
        "set-hook",
        "-g",
        hook,
        `run-shell -b ${tmuxQuote(helperCommand(node, helper, this.runtime, event))}`,
      ]);
    await this.command(...commands.flatMap((c, i) => (i ? [";", ...c] : c)));
  }
  async createEditor(
    target: string,
    workspace: string,
    argv: string[],
  ): Promise<Pane> {
    const before = (await this.inventory()).find((p) => p.pane === target);
    if (!before) throw new PineError("TMUX", "Agent pane is missing.");
    if (before.zoomed) await this.command("resize-pane", "-Z", "-t", target);
    // Establish a viable backing split first. Immediately restore outer cells after zoom.
    await this.command(
      "resize-window",
      "-t",
      before.window,
      "-x",
      String(Math.max(101, before.windowWidth)),
      "-y",
      String(Math.max(23, before.windowHeight)),
    );
    const id = await this.command(
      "split-window",
      "-h",
      "-b",
      "-t",
      target,
      "-c",
      workspace.replace(/#/g, "##"),
      "-P",
      "-F",
      "#{pane_id}",
      ...argv,
    );
    const found = (await this.inventory()).find((p) => p.pane === id);
    if (!found)
      throw new PineError("TMUX", "Editor creation could not be reconciled.");
    return found;
  }
  async layout(s: State, window: string, resizePolicy = true): Promise<Pane[]> {
    const panes = await this.inventory();
    const target = (s.focus === "editor" ? s.editor : s.agent)?.pane;
    if (!target || !panes.some((p) => p.pane === target)) return panes;
    const paired = !!s.editor?.alive && !!s.agent?.alive;
    const zoom = paired && (s.mode !== "IDE_WITH_AGENT" || s.compact);
    const observed = panes.find((p) => p.pane === target)!;
    const commands: string[][] = [];
    if (observed.zoomed && !zoom)
      commands.push(["resize-pane", "-Z", "-t", target]);
    if (!observed.active || observed.zoomed !== zoom)
      commands.push(["select-pane", ...(zoom ? ["-Z"] : []), "-t", target]);
    if (zoom && !observed.zoomed)
      commands.push(["resize-pane", "-Z", "-t", target]);
    const width = Math.max(2, s.geometry.columns),
      height = Math.max(2, s.geometry.rows - 1);
    if (observed.windowWidth !== width || observed.windowHeight !== height) {
      commands.push([
        "resize-window",
        "-t",
        window,
        "-x",
        String(width),
        "-y",
        String(height),
      ]);
      commands.push([
        "set-window-option",
        "-t",
        window,
        "window-size",
        "latest",
      ]);
    }
    if (paired && !zoom && (resizePolicy || observed.zoomed))
      commands.push([
        "resize-pane",
        "-t",
        s.agent!.pane,
        "-x",
        String(agentWidth(s.geometry.columns, s.ratio)),
      ]);
    // One tmux command queue, followed by inventory in that same queue. Semicolons
    // here are fixed argv delimiters, never interpolated user strings or shell code.
    commands.push(["list-panes", "-a", "-F", paneFormat]);
    const actual = this.parsePanes(
      await this.command(...commands.flatMap((c, i) => (i ? [";", ...c] : c))),
    );
    const focused = actual.find((p) => p.pane === target);
    if (!focused?.alive || !focused.active || focused.zoomed !== zoom)
      throw new PineError(
        "LAYOUT",
        "Layout did not converge; previous viable view retained.",
      );
    if (paired && !zoom) {
      const a = actual.find((p) => p.pane === s.agent!.pane)!;
      const e = actual.find((p) => p.pane === s.editor!.pane)!;
      if (e.left >= a.left || a.width < 40 || e.width < 60)
        throw new PineError("LAYOUT", "Split geometry failed validation.");
    }
    return actual;
  }
  async status(message: string): Promise<void> {
    if (
      [...message].some((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code < 32 || code === 127;
      })
    )
      throw new PineError("STATUS", "Status format rejected.");
    await this.command("set-option", "-g", "status-left", message);
  }
  /**
   * Show a notification toast (PineVim-authored, safe path).
   *
   * D2: there are now two paths. `notify()` keeps the safe contract:
   * any text that has touched external input or a process spawn flows
   * through `literal()` which strips ANSI and non-ASCII. Use
   * `notifyBranded()` for PineVim-authored strings that should carry
   * the brand glyph and color (e.g. "Pi started", "Editor exited").
   */
  async notify(
    message: string,
    severity?: "info" | "warning" | "error",
  ): Promise<void> {
    const prefix =
      severity === "error"
        ? "pinevim error: "
        : severity === "warning"
          ? "pinevim warning: "
          : message.startsWith("pinevim")
            ? ""
            : "pinevim: ";
    await this.command(
      "display-message",
      "-d",
      "8000",
      literal(`${prefix}${message}`, 500),
    );
  }

  /**
   * D2: branded toast for PineVim-authored messages. Adds a glyph
   * (`✓` / `▲` / `✗` / `·`) and an SGR color role. Strips any control
   * characters and doubles `#` for tmux format safety. The text must
   * be trusted (no external input). For untrusted text, use `notify()`
   * instead. SGR is passed through (tmux `display-message` honors
   * inline ANSI).
   */
  async notifyBranded(
    message: string,
    severity: "info" | "warning" | "error" | "success" = "info",
  ): Promise<void> {
    const glyph: Record<typeof severity, string> = {
      info: "\u00b7", // ·
      warning: "\u25b2", // ▲
      error: "\u2717", // ✗
      success: "\u2713", // ✓
    };
    const role: Record<typeof severity, "muted" | "warning" | "error" | "success"> = {
      info: "muted",
      warning: "warning",
      error: "error",
      success: "success",
    };
    // Strip control characters; preserve printable Unicode and SGR.
    const safe = message.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
    // Doubling `#` is required because tmux treats `#` as a format
    // introducer in `display-message` arguments.
    const payload = sgr(role[severity], `${glyph[severity]} pinevim: ${safe}`).replace(
      /#/g,
      "##",
    );
    if ([...payload].length > 500) return; // bounded; do not block on overflow
    await this.command("display-message", "-d", "8000", payload);
  }

  /**
   * Show a popup panel (plan §24). Lines are pre-escaped PineVIM-authored
   * strings. The payload is delivered through `tmux run-shell` quoting into a
   * printf command: argv stays bounded (<= 900 chars payload) and no shell
   * interpolation of user data occurs (payload has no single quotes after
   * escaping, since content is PineVIM-authored with plain() applied).
   */
  async popup(
    lines: string[],
    maxWidth: number,
    node: string,
    helperPath: string,
  ): Promise<void> {
    const width = Math.min(maxWidth, 80);
    const bodyLines = lines.slice(0, 24);
    if (lines.length > 24) bodyLines.push("truncated");
    const file = join(this.runtime, "popup.txt");
    await mkdir(this.runtime, { recursive: true });
    await writeFile(file, bodyLines.join("\n"), { mode: 0o600 });
    const height = bodyLines.length + 3;
    await this.command(
      "display-popup",
      "-E",
      "-w",
      String(width),
      "-h",
      String(height),
      "-x",
      "50%",
      "-y",
      "40%",
      helperCommand(node, helperPath, this.runtime, "popup"),
    );
  }
  async confirm(
    message: string,
    node: string,
    helper: string,
    action: "quit" | "retry",
    nonce: string,
  ): Promise<void> {
    await this.command(
      "confirm-before",
      "-p",
      literal(message + " (y/n)", 160),
      `run-shell -b ${tmuxQuote(helperCommand(node, helper, this.runtime, `confirm-${action}`, nonce))}`,
    );
  }
  async dimensions(): Promise<{ columns: number; rows: number } | null> {
    const line = await this.command(
      "list-clients",
      "-F",
      "#{client_width}|#{client_height}",
    );
    if (!line) return null;
    const [columns, rows] = line.split("\n")[0]!.split("|").map(Number);
    return columns && rows ? { columns, rows } : null;
  }
  attach(session: string): ChildProcess {
    return spawn(
      this.executable,
      ["-S", this.socket, "-f", this.config, "attach-session", "-t", session],
      { shell: false, stdio: "inherit", env: this.env },
    );
  }
  async reachable(): Promise<boolean> {
    return await new Promise((resolve, reject) => {
      const socket = createConnection(this.socket);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(
          new PineError(
            "TMUX",
            "Cannot establish whether the private server is still alive; preserving runtime.",
          ),
        );
      }, 2000);
      socket.once("connect", () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      });
      socket.once("error", (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        socket.destroy();
        if (error.code === "ENOENT" || error.code === "ECONNREFUSED")
          resolve(false);
        else
          reject(
            new PineError(
              "TMUX",
              "Cannot verify private server liveness; preserving runtime.",
            ),
          );
      });
    });
  }
  async removeDead(pane: string): Promise<void> {
    const p = (await this.inventory()).find((p) => p.pane === pane);
    if (p && !p.alive)
      await this.command(
        "if-shell",
        "-F",
        "-t",
        pane,
        `#{&&:#{pane_dead},#{==:#{pane_pid},${p.pid}}}`,
        `kill-pane -t ${pane}`,
      );
  }
}
