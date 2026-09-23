import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
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
