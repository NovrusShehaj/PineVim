import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { executable } from "./config.js";
import { NVIM_THEME_LUA } from "./editor/theme-script.js";
import { SPLASH_LUA } from "./editor/splash-lua.js";
import { WORDMARK_LUA } from "./editor/wordmark-lua.js";
import { PINEVIM_API_LUA } from "./editor/pinevim-api-lua.js";

/** Private runtime tree that holds the editor theme module. */
export function editorRuntimePath(runtime: string): string {
  return join(runtime, "nvim");
}

/** Vim `set runtimepath` fragment. Spaces and commas are escaped. */
export function editorVimCommand(root: string): string {
  const escaped = root.replace(/[\\ ,]/g, (ch) => `\\${ch}`);
  return `set runtimepath^=${escaped}`;
}

/**
 * Write the bundled PineVim Lua modules to the runtime path so Neovim
 * can `require()` them. Single bundle per launch — content-checked for
 * cheap idempotency.
 */
async function writeLuaModules(root: string): Promise<void> {
  const luaDir = join(root, "lua", "pinevim");
  await mkdir(luaDir, { recursive: true, mode: 0o700 });
  const files: Array<[string, string]> = [
    ["init.lua", NVIM_THEME_LUA],
    ["splash.lua", SPLASH_LUA],
    ["wordmark.lua", WORDMARK_LUA],
    ["api.lua", PINEVIM_API_LUA],
  ];
  for (const [name, body] of files) {
    const path = join(luaDir, name);
    let existing: Buffer | null = null;
    try {
      existing = await readFile(path);
    } catch {
      /* missing on first launch */
    }
    if (existing && existing.toString("utf8") === body) continue;
    await writeFile(path, body, { mode: 0o644 });
  }
}

export async function editorCommand(
  path: string,
  runtime: string,
): Promise<string[]> {
  const root = editorRuntimePath(runtime);
  await writeLuaModules(root);
  // Unset remote-editor markers only for this child, preserving intentional NVIM_APPNAME.
  // The trailing `.` opens the current working directory (set by tmux
  // `split-window -c <workspace>` in createEditor) instead of the nvim
  // homescreen — see cli.ts workspacePath() = args.positionals[0] ?? cwd.
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
    ".",
  ];
}
