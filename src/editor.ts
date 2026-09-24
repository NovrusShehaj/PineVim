import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { executable } from "./config.js";
import { NVIM_THEME_LUA } from "./editor/theme-script.js";

/** Private runtime tree that holds the editor theme module. */
export function editorRuntimePath(runtime: string): string {
  return join(runtime, "nvim");
}

/** Vim `set runtimepath` fragment. Spaces and commas are escaped. */
export function editorVimCommand(root: string): string {
  const escaped = root.replace(/[\\ ,]/g, (ch) => `\\${ch}`);
  return `set runtimepath^=${escaped}`;
}

export async function editorCommand(
  path: string,
  runtime: string,
): Promise<string[]> {
  const root = editorRuntimePath(runtime);
  await mkdir(join(root, "lua", "pinevim"), { recursive: true, mode: 0o700 });
  await writeFile(join(root, "lua", "pinevim", "init.lua"), NVIM_THEME_LUA, {
    mode: 0o644,
  });
  // Unset remote-editor markers only for this child, preserving intentional NVIM_APPNAME.
  return [
    "/usr/bin/env",
    "-u",
    "NVIM",
    "-u",
    "NVIM_LISTEN_ADDRESS",
    await executable(path),
    "--cmd",
    editorVimCommand(root),
    "--cmd",
    "lua require('pinevim').arm()",
  ];
}
