#!/usr/bin/env node
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { executable, loadConfig, workspacePath } from "./config.js";
import { userFacing, PineError } from "./diagnostics.js";
import { Store, requireDeadChildren } from "./persistence.js";
import { piExecutable } from "./adapters/pi/adapter.js";
import { Tmux } from "./adapters/tmux/client.js";
import { AppController, newMetadata } from "./core/controller.js";
import { tooSmall } from "./core/layout.js";
import { run } from "./process.js";
export const HELP = `PineVim — interactive Pi with your normal Neovim in private tmux
Usage: pinevim [directory] | pinevim --resume [directory]
       pinevim --help | pinevim --version

/ide opens/reveals Neovim; /ide close hides it while it keeps running.
/pinevim agent hide|show, chat, status, help, quit
F12 then i IDE, c chat, a agent, Tab focus, Left/Right width, r retry,
q safe quit, ? help. F12 twice sends literal F12. Letters are lowercase.
Quit Neovim normally before PineVim quit. Unsaved buffers are never force-quit.
Detach/terminal loss preserves children; --resume reconnects that workspace.
Requires Node >=22.19.0, Pi 0.87.1, tmux >=3.5; Neovim for IDE mode.
Pi and Neovim retain their normal settings and may write their own runtime data.
PineVim never reads provider credentials or edits global tool configuration.`;
async function main(): Promise<void> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs({
      options: {
        help: { type: "boolean" },
        version: { type: "boolean" },
        resume: { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch {
    throw new PineError("USAGE", HELP);
  }
  if (args.values.help) {
    console.log(HELP);
    return;
  }
  if (args.values.version) {
    const p = JSON.parse(
      await readFile(
        fileURLToPath(new URL("../package.json", import.meta.url)),
        "utf8",
      ),
    ) as { version: string };
    console.log(`pinevim ${p.version}`);
    return;
  }
  if (args.positionals.length > 1) throw new PineError("USAGE", HELP);
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw new PineError("PLATFORM", "PineVim MVP supports macOS and Linux.");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (!major || major < 22 || (major === 22 && (minor ?? 0) < 19))
    throw new PineError("NODE", "Node >=22.19.0 is required.");
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    !process.env.TERM ||
    process.env.TERM === "dumb"
  )
    throw new PineError(
      "TERMINAL",
      "Start PineVim in an interactive terminal with TERM set (not dumb).",
    );
  const geometry = {
    columns: process.stdout.columns,
    rows: process.stdout.rows,
  };
  if (tooSmall(geometry))
    throw new PineError(
      "SIZE",
      "Resize terminal to at least 60 columns x 16 rows before starting PineVim.",
    );
  const workspace = await workspacePath(args.positionals[0] ?? process.cwd());
  const config = await loadConfig();
  const tmuxPath = await executable(config.tmux);
  const tmuxVersion = await run(tmuxPath, ["-V"]);
  const match = /tmux (\d+)\.(\d+)/.exec(tmuxVersion);
  if (
    !match ||
    Number(match[1]) < 3 ||
    (Number(match[1]) === 3 && Number(match[2]) < 5)
  )
    throw new PineError(
      "COMPATIBILITY",
      "tmux >=3.5 is required for CSI-u key forwarding.",
    );
  const pi = await piExecutable(config.pi);
  const store = new Store(workspace.canonical);
  await store.acquire();
  let controller: AppController | null = null;
  try {
    let metadata = await store.load();
    let resume = false;
    if (metadata) {
      // Only an absent runtime or a refused/absent Unix socket proves transport
      // loss. A failed tmux command must never authorize another Pi writer.
      const runtimeExists = await lstat(metadata.runtime)
        .then(() => true)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        });
      const probe = new Tmux(tmuxPath, metadata.runtime);
      if (runtimeExists) await store.validateRuntime(metadata);
      const live = runtimeExists && (await probe.reachable());
      if (!live) await requireDeadChildren(metadata);
      if (live) {
        await probe.inventory();
        await probe.verify(metadata.instance);
        if (!args.values.resume)
          throw new PineError(
            "RECOVERY",
            "A surviving workspace exists. Run pinevim --resume in this directory.",
          );
        const clients = await probe.command(
          "list-clients",
          "-F",
          "#{client_pid}|#{client_name}",
        );
        for (const line of clients.split("\n").filter(Boolean)) {
          const [pid, name] = line.split("|");
          if (Number(pid) !== metadata.clientPid || !name)
            throw new PineError(
              "ATTACHED",
              "An unrecognized client is attached. Detach it before --resume.",
            );
          await probe.command("detach-client", "-t", name);
        }
        metadata.state.epoch = randomUUID();
        metadata.state.bridge = false;
        metadata.state.generation = 0;
        metadata.state.geometry = geometry;
        resume = true;
      }
    }
    if (!resume) {
      const runtime = await store.runtime();
      metadata = newMetadata(
        workspace.canonical,
        workspace.display,
        runtime.runtime,
        runtime.instance,
        config,
        geometry,
        { pi: pi.version, tmux: tmuxVersion, node: process.versions.node },
      );
    }
    if (!metadata) throw new Error("metadata unavailable");
    const tmux = new Tmux(tmuxPath, metadata.runtime, {
      ...process.env,
      PINEVIM: "1",
      PINEVIM_RUNTIME: metadata.runtime,
      PINEVIM_WORKSPACE: workspace.canonical,
    });
    controller = new AppController(config, store, tmux, metadata, pi.path);
    await controller.start(resume, !!args.values.resume && !resume);
    const attached = tmux.attach(metadata.session);
    // Subscribe before any asynchronous metadata write: attach may exit immediately.
    const attachment = new Promise<Error | null>((resolve) => {
      attached.once("exit", () => resolve(null));
      attached.once("error", resolve);
    });
    metadata.clientPid = attached.pid ?? null;
    let exitMessage: string | null = null;
    let stopping = false;
    const detach = (): void => {
      if (stopping) return;
      stopping = true;
      attached.kill("SIGHUP");
    };
    controller.onStop = (message) => {
      exitMessage = message;
      detach();
    };
    process.on("SIGTERM", detach);
    process.on("SIGHUP", detach);
    const quit = (): void => {
      void controller!.intent("quit").catch(() => {});
    };
    process.on("SIGINT", quit);
    let attachError: Error | null;
    try {
      await store.save(metadata);
      attachError = await attachment;
    } finally {
      detach();
      await attachment;
      process.off("SIGTERM", detach);
      process.off("SIGHUP", detach);
      process.off("SIGINT", quit);
    }
    await controller.detach();
    controller = null;
    if (attachError) throw attachError;
    console.log(
      exitMessage ??
        "PineVim terminal detached. If children remain, use pinevim --resume in this workspace.",
    );
  } finally {
    if (controller) await controller.detach().catch(() => {});
    else await store.release();
  }
}
main().catch((error) => {
  console.error(userFacing(error));
  process.exitCode = 1;
});
