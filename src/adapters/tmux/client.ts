import { createConnection } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { run, serverEnvironment } from "../../process.js";
import { literal, PineError } from "../../diagnostics.js";
import { helperCommand, tmuxQuote, tmuxConfig, terminfo } from "./config.js";
import { agentWidth } from "../../core/layout.js";
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
    await this.command("set-option", "-g", "@pinevim-instance", instance);
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
  async bindings(node: string, helper: string, prefix: string): Promise<void> {
    for (const [key, intent] of Object.entries({
      i: "ide.open",
      c: "chat",
      a: "agent.toggle",
      Tab: "focus.other",
      Left: "width.less",
      Right: "width.more",
      q: "quit",
      r: "retry",
      "?": "help",
    }))
      await this.command(
        "bind-key",
        "-T",
        "prefix",
        key,
        "run-shell",
        "-b",
        helperCommand(node, helper, this.runtime, intent),
      );
    await this.command("bind-key", "-T", "prefix", prefix, "send-prefix");
    for (const [hook, event] of Object.entries({
      "client-resized": "resize",
      "window-layout-changed": "layout",
      "pane-focus-in": "focus",
      "pane-died": "death",
      "client-detached": "detach",
    }))
      await this.command(
        "set-hook",
        "-g",
        hook,
        `run-shell -b ${tmuxQuote(helperCommand(node, helper, this.runtime, event))}`,
      );
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
    await this.command(
      "set-option",
      "-g",
      "status-left",
      literal(message, 500),
    );
  }
  async notify(message: string): Promise<void> {
    await this.command("display-message", "-d", "8000", literal(message, 500));
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
