import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { connect, identity } from "../../control/client.js";
import type { Peer } from "../../control/protocol.js";
import { commandOwnership } from "./compatibility.js";
import { safeError, PineError } from "../../diagnostics.js";
import type { Intent } from "../../core/state.js";
export function parseCommand(command: "ide" | "pinevim", args: string): Intent {
  const input = args.trim().split(/\s+/).filter(Boolean).join(" ");
  const commands: Record<string, Intent> =
    command === "ide"
      ? { "": "ide.open", open: "ide.open", close: "chat" }
      : {
          ide: "ide.open",
          "ide open": "ide.open",
          "ide close": "chat",
          "agent hide": "agent.hide",
          "agent show": "agent.show",
          chat: "chat",
          quit: "quit",
          status: "status",
          help: "help",
        };
  const intent = Object.hasOwn(commands, input) ? commands[input] : undefined;
  if (!intent)
    throw new PineError(
      "USAGE",
      "Use /ide [open|close], /pinevim ide [open|close], agent hide|show, chat, status, help, or quit.",
    );
  return intent;
}
export default function pinevim(pi: ExtensionAPI): void {
  const runtime = process.env.PINEVIM_RUNTIME;
  if (!runtime) return;
  let ctx: ExtensionContext | null = null,
    peer: Peer | null = null,
    timer: NodeJS.Timeout | null = null;
  let generation = 0,
    epoch = "",
    backoff = 250,
    stopped = true,
    draining = false;
  let ownership = { ide: false, pinevim: false };
  const data = (): Record<string, unknown> => ({
    cwd: ctx!.cwd,
    sessionId: ctx!.sessionManager.getSessionId(),
    sessionFile: ctx!.sessionManager.getSessionFile() ?? null,
    busy: !ctx!.isIdle() || ctx!.hasPendingMessages(),
    ...ownership,
  });
  const report = async (): Promise<void> => {
    if (peer && !peer.closed && ctx) {
      try {
        await peer.request("status", data(), generation, epoch);
      } catch {
        /* reconnect handles transport loss; never replay an action */
      }
    }
  };
  const shutdownIfIdle = (): void => {
    if (draining && ctx && ctx.isIdle() && !ctx.hasPendingMessages()) {
      draining = false;
      ctx.shutdown();
    }
  };
  const stop = (): void => {
    stopped = true;
    ctx = null;
    draining = false;
    if (timer) clearTimeout(timer);
    timer = null;
    peer?.close();
    peer = null;
  };
  const reconnect = async (activeGeneration: number): Promise<void> => {
    if (stopped || activeGeneration !== generation) return;
    let candidate: Peer | null = null;
    try {
      candidate = await connect(runtime);
      if (stopped || generation !== activeGeneration) {
        candidate.close();
        return;
      }
      const current = candidate;
      current.handler = async (m) => {
        if (
          current !== peer ||
          m.generation !== generation ||
          m.epoch !== epoch ||
          m.type !== "shutdown" ||
          !ctx
        )
          throw new PineError("STALE", "Stale Pi context.");
        if ((!ctx.isIdle() || ctx.hasPendingMessages()) && !m.payload.cancel)
          throw new PineError(
            "BUSY",
            "Pi became busy; confirm cancellation before quitting.",
          );
        // Reply before abort/drain. Never hold a slash handler waiting on its own shutdown.
        setImmediate(() => {
          if (current !== peer || !ctx) return;
          draining = true;
          if (m.payload.cancel) ctx.abort();
          shutdownIfIdle();
        });
        return {};
      };
      const hello = await current.request(
        "hello",
        {
          ...(await identity(runtime)),
          role: "bridge",
          pid: process.pid,
          ...data(),
        },
        generation,
      );
      if (stopped || generation !== activeGeneration) {
        current.close();
        return;
      }
      peer = current;
      epoch = String(hello.epoch);
      backoff = 250;
      current.on("closed", () => {
        if (peer === current) {
          peer = null;
          schedule();
        }
      });
      await report();
      if (!ownership.pinevim)
        ctx?.ui.notify(
          "PineVim slash integration is ambiguous. Resolve the /pinevim resource collision and /reload. Prefix controls remain available.",
          "warning",
        );
      else if (!ownership.ide)
        ctx?.ui.notify(
          "Bare /ide is unavailable due to a command collision. Use /pinevim ide or prefix then i; resolve the collision and /reload.",
          "warning",
        );
    } catch {
      candidate?.close();
      schedule();
    }
  };
  const schedule = (): void => {
    if (stopped || timer) return;
    const delay = backoff;
    backoff = Math.min(5000, backoff * 2);
    timer = setTimeout(() => {
      timer = null;
      generation = Math.max(
        generation + 1,
        Date.now() * 1024 + Math.floor(Math.random() * 1024),
      );
      void reconnect(generation);
    }, delay);
    timer.unref();
  };
  pi.on("session_start", (_event, context) => {
    stop();
    ctx = context;
    stopped = false;
    generation = Math.max(
      generation + 1,
      Date.now() * 1024 + Math.floor(Math.random() * 1024),
    );
    ownership = commandOwnership(
      pi.getCommands(),
      fileURLToPath(import.meta.url),
    );
    void reconnect(generation);
  });
  pi.on("session_shutdown", () => stop());
  const update = (_event: unknown, context: ExtensionContext): void => {
    ctx = context;
    void report();
  };
  pi.on("agent_start", update);
  pi.on("model_select", update);
  pi.on("session_info_changed", update);
  pi.on("agent_settled", (_event, context) => {
    update(_event, context);
    setImmediate(shutdownIfIdle);
  });
  for (const command of ["ide", "pinevim"] as const)
    pi.registerCommand(command, {
      description:
        command === "ide"
          ? "Open/close the live editor view"
          : "PineVim workspace controls",
      handler: async (args, context) => {
        try {
          if (!ownership.pinevim || (command === "ide" && !ownership.ide))
            throw new PineError(
              "COLLISION",
              "Ambiguous PineVim slash command; resolve resource collisions and /reload. Prefix controls remain available.",
            );
          if (!peer || peer.closed)
            throw new PineError(
              "DISCONNECTED",
              "PineVim controller disconnected. Use pinevim --resume from the workspace.",
            );
          const reply = await peer.request(
            "intent",
            { intent: parseCommand(command, args) },
            generation,
            epoch,
          );
          if (reply.message) context.ui.notify(String(reply.message), "info");
        } catch (e) {
          context.ui.notify(safeError(e), "warning");
        }
      },
    });
}
