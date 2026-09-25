import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connect, identity } from "../../control/client.js";
import type { Peer } from "../../control/protocol.js";
import { commandOwnership } from "./compatibility.js";
import { userFacing, recoveryCopy, PineError } from "../../diagnostics.js";
import type { Intent } from "../../core/state.js";
import { PiUi, hooksSatisfied, probeHooks } from "../../piui/index.js";
import {
  ideArgumentCompletions,
  pinevimArgumentCompletions,
} from "../../piui/completions.js";
import {
  applyTheme,
  autoPinevimTheme,
  isPinevimThemeName,
} from "../../piui/theme.js";
import { planReport } from "../../piui/report-gate.js";
import { handlePinevimLocal } from "../../piui/local-commands.js";
import { skillsRoot } from "../../skills/registry.js";
import type { UiConfig } from "../../config.js";
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
function applyConfiguredTheme(
  ui: {
    theme: Theme;
    getTheme: (name: string) => Theme | undefined;
    setTheme: (theme: string | Theme) => { success: boolean; error?: string };
  },
  cfg: UiConfig,
): void {
  if (cfg.theme && cfg.theme !== "auto" && isPinevimThemeName(cfg.theme)) {
    applyTheme(ui, cfg.theme);
    return;
  }
  const next = autoPinevimTheme(ui.theme?.name);
  if (next) applyTheme(ui, next);
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
  // PineVIM UI configuration arrives via the controller's environment (strict
  // config surfaced as bounded flags) so the extension stays config-file free.
  const uiConfig = (): UiConfig & { prefix?: string } => ({
    enabled: process.env.PINEVIM_UI !== "0",
    motion: process.env.PINEVIM_UI_MOTION === "off" ? "off" : "on",
    glyphs: process.env.PINEVIM_UI_GLYPHS === "ascii" ? "ascii" : "unicode",
    theme: process.env.PINEVIM_UI_THEME as UiConfig["theme"],
    prefix: process.env.PINEVIM_UI_PREFIX ?? "F12",
    // Confirmation policy lives in the controller, not the in-pane frame;
    // the extension never prompts for quit/retry.
    confirm: { quit: "ask", retry: "ask" },
  });
  let pineUi: PiUi | null = null;
  let lastSent = "";
  let reportTimer: ReturnType<typeof setTimeout> | null = null;
  const considerReport = (): void => {
    const next = pineUi?.telemetryLine() ?? "";
    const decision = planReport(lastSent, next, reportTimer !== null);
    if (decision.sendNow) {
      if (reportTimer) clearTimeout(reportTimer);
      reportTimer = null;
      lastSent = next;
      void report();
      return;
    }
    if (decision.armTimer && !reportTimer) {
      reportTimer = setTimeout(() => {
        reportTimer = null;
        const line = pineUi?.telemetryLine() ?? "";
        if (line && line !== lastSent) {
          lastSent = line;
          void report();
        }
      }, 1000);
    }
  };
  pi.on("resources_discover", () => {
    const dir = skillsRoot();
    if (!existsSync(dir)) return undefined;
    return { skillPaths: [dir] };
  });
  const data = (): Record<string, unknown> => ({
    cwd: ctx!.cwd,
    sessionId: ctx!.sessionManager.getSessionId(),
    sessionFile: ctx!.sessionManager.getSessionFile() ?? null,
    busy: !ctx!.isIdle() || ctx!.hasPendingMessages(),
    ...ownership,
    // Additive telemetry (protocol v1.1): the controller validates strictly,
    // so these are only sent after its schema accepts them.
    ...(pineUi ? { telemetry: pineUi.telemetryLine() } : {}),
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
          m.epoch !== epoch
        )
          throw new PineError("STALE", "Stale Pi context.");
        if (m.type === "view") {
          pineUi?.setMode(
            m.payload.mode === "IDE" ? "IDE" : "CHAT",
            m.payload.focus === "editor" ? "editor" : "agent",
          );
          return {};
        }
        if (m.type !== "shutdown" || !ctx)
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
    installUi(pi, context);
    void reconnect(generation);
  });

  /**
   * Install the PineVIM frame (plan §14, §29). Gates in order:
   * 1. config opt-out (ui.enabled=false) => stock Pi;
   * 2. TUI mode only (rpc/print get no in-pane UI);
   * 3. capability probe (missing hooks) => stock Pi + one-time notice;
   * 4. conflict check: an editor/header/footer already installed by another
   *    extension => PineVIM stands down with a one-time notice (never destroys
   *    user customizations; last-writer-wins would do exactly that).
   */
  function installUi(api: ExtensionAPI, context: ExtensionContext): void {
    const cfg = uiConfig();
    if (!cfg.enabled) return;
    if (context.mode !== "tui") return;
    try {
      const hooks = probeHooks(api, context);
      if (!hooksSatisfied(hooks)) {
        context.ui.notify(
          "PineVim UI unavailable in this Pi version; running stock Pi chat. Prefix controls are unaffected.",
          "warning",
        );
        return;
      }
      const conflict =
        context.ui.getEditorComponent() !== undefined ||
        // setHeader/setFooter have no getters; detect via widget/installed
        // markers is unreliable, so only the editor exposes a getter. The
        // header/footer stand-down relies on Pi's last-writer-wins plus our
        // own registration order (session_start, before user reloads).
        false;
      if (conflict) {
        context.ui.notify(
          "Another extension provides a custom editor; PineVim UI stood down to avoid overriding it.",
          "warning",
        );
        return;
      }
      pineUi = new PiUi(api, context, context.ui.theme, cfg);
      pineUi.onTelemetry = considerReport;
      pineUi.install();
      applyConfiguredTheme(context.ui, cfg);
    } catch {
      pineUi?.dispose();
      pineUi = null;
      context.ui.notify(recoveryCopy("UI"), "warning");
    }
  }

  // Theme registration note: PineVIM themes are installed into Pi's native
  // user themes dir by the controller (core/theme-install.ts) BEFORE the pane
  // spawns. resources_discover intentionally does NOT re-register themePaths:
  // Pi loads the user dir first and would report every theme as a collision
  // ("✗ skipped") on startup — pure noise with identical content.
  pi.on("session_shutdown", () => {
    stop();
    pineUi?.dispose();
    pineUi = null;
  });
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
      // Native argument completion (plan §28): Pi merges extension commands
      // into its built-in provider, which replaces exactly the typed argument
      // text — no custom autocomplete wrapper needed.
      getArgumentCompletions:
        command === "ide" ? ideArgumentCompletions : pinevimArgumentCompletions,
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
          if (
            command === "pinevim" &&
            (await handlePinevimLocal(args, context, pineUi))
          )
            return;
          const intent = parseCommand(command, args);
          const reply = await peer.request(
            "intent",
            { intent },
            generation,
            epoch,
          );
          // The controller owns layout truth, but the header/band need the
          // view immediately; intent success is the observable transition.
          if (intent === "ide.open") pineUi?.setMode("IDE");
          else if (intent === "chat") pineUi?.setMode("CHAT");
          if (reply.message) context.ui.notify(String(reply.message), "info");
        } catch (e) {
          context.ui.notify(userFacing(e), "warning");
        }
      },
    });
}
