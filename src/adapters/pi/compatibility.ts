import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { PineError } from "../../diagnostics.js";
export const SUPPORTED_PI = "0.87.1";
// Pi 0.87.1 public docs/slash-commands.md; built-ins are absent from getCommands().
export const BUILT_INS = new Set([
  "settings",
  "model",
  "thinking",
  "scoped-models",
  "login",
  "logout",
  "llama",
  "new",
  "resume",
  "name",
  "session",
  "tree",
  "fork",
  "clone",
  "compact",
  "import",
  "copy",
  "export",
  "share",
  "bug",
  "trust",
  "reload",
  "hotkeys",
  "changelog",
  "quit",
]);
export function commandOwnership(
  commands: readonly SlashCommandInfo[],
  extension: string,
): { ide: boolean; pinevim: boolean } {
  const canonical = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const owns = (name: string): boolean =>
    !BUILT_INS.has(name) &&
    commands.filter((c) => c.name === name).length === 1 &&
    commands.some(
      (c) =>
        c.name === name &&
        c.source === "extension" &&
        c.sourceInfo?.path &&
        canonical(c.sourceInfo.path) === canonical(extension),
    );
  return { ide: owns("ide"), pinevim: owns("pinevim") };
}

/**
 * Public Pi API surface required for PineVIM UI integration (plan §17 Phase 1).
 */
export interface PiApiSurfaceReport {
  hasSetHeader: boolean;
  hasSetFooter: boolean;
  hasSetEditorComponent: boolean;
  hasSetWidget: boolean;
  hasSetWorkingIndicator: boolean;
  hasRegisterTool: boolean;
  hasRegisterEntryRenderer: boolean;
  hasRegisterCommand: boolean;
  hasRegisterShortcut: boolean;
  hasOn: boolean;
}

/** Probe the public API surface of Pi and its extension context. */
export function probePiApiSurface(pi: unknown, ctx: unknown): PiApiSurfaceReport {
  const p = (pi && typeof pi === "object" ? pi : {}) as Record<string, unknown>;
  const c = (ctx && typeof ctx === "object" ? ctx : {}) as Record<string, unknown>;
  const ui = (c.ui && typeof c.ui === "object" ? c.ui : {}) as Record<string, unknown>;
  return {
    hasSetHeader: typeof ui.setHeader === "function",
    hasSetFooter: typeof ui.setFooter === "function",
    hasSetEditorComponent: typeof ui.setEditorComponent === "function",
    hasSetWidget: typeof ui.setWidget === "function",
    hasSetWorkingIndicator: typeof ui.setWorkingIndicator === "function",
    hasRegisterTool: typeof p.registerTool === "function",
    hasRegisterEntryRenderer: typeof p.registerEntryRenderer === "function",
    hasRegisterCommand: typeof p.registerCommand === "function",
    hasRegisterShortcut: typeof p.registerShortcut === "function",
    hasOn: typeof p.on === "function",
  };
}

/**
 * Assert that the installed Pi version satisfies the public API requirements.
 * Throws a PineError("COMPATIBILITY") listing any missing methods.
 */
export function assertPiApiSurface(pi: unknown, ctx: unknown): void {
  const report = probePiApiSurface(pi, ctx);
  const missing: string[] = [];
  if (!report.hasSetHeader) missing.push("ctx.ui.setHeader");
  if (!report.hasSetFooter) missing.push("ctx.ui.setFooter");
  if (!report.hasSetEditorComponent) missing.push("ctx.ui.setEditorComponent");
  if (!report.hasSetWidget) missing.push("ctx.ui.setWidget");
  if (!report.hasSetWorkingIndicator) missing.push("ctx.ui.setWorkingIndicator");
  if (!report.hasRegisterTool) missing.push("pi.registerTool");
  if (!report.hasRegisterEntryRenderer) missing.push("pi.registerEntryRenderer");
  if (!report.hasRegisterCommand) missing.push("pi.registerCommand");
  if (!report.hasRegisterShortcut) missing.push("pi.registerShortcut");
  if (!report.hasOn) missing.push("pi.on");
  if (missing.length > 0) {
    throw new PineError(
      "COMPATIBILITY",
      `Incompatible Pi API surface; missing: ${missing.join(", ")}`,
    );
  }
}
