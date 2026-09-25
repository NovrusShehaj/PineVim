import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  editorCommand,
  editorRuntimePath,
  editorVimCommand,
} from "../../src/editor.js";
import { NVIM_THEME_LUA } from "../../src/editor/theme-script.js";
import { SPLASH_LUA } from "../../src/editor/splash-lua.js";
import { WORDMARK_LUA } from "../../src/editor/wordmark-lua.js";
import { PINEVIM_API_LUA } from "../../src/editor/pinevim-api-lua.js";

describe("editor theme", () => {
  it("escapes spaces in the runtime path", () => {
    assert.equal(
      editorVimCommand("/tmp/my dir"),
      String.raw`set runtimepath^=/tmp/my\ dir`,
    );
  });

  it("launches nvim with the PineVim palette module and no listen address", async () => {
    const runtime = await mkdtemp(join(tmpdir(), "pv-editor-"));
    try {
      const argv = await editorCommand(process.execPath, runtime);
      assert.deepEqual(argv.slice(0, 5), [
        "/usr/bin/env",
        "-u",
        "NVIM",
        "-u",
        "NVIM_LISTEN_ADDRESS",
      ]);
      assert.equal(argv.at(-1), "lua require('pinevim').arm()");
      assert.equal(argv.includes("--listen"), false);
      const lua = await readFile(
        join(editorRuntimePath(runtime), "lua", "pinevim", "init.lua"),
        "utf8",
      );
      assert.equal(lua, NVIM_THEME_LUA);
      assert.match(lua, /syntaxKeyword/);
      assert.match(lua, /pinevim-dark/);
      assert.match(lua, /component_separators/);
      assert.match(lua, /PmenuMatch/);
      assert.match(lua, /MsgArea/);
      assert.equal(lua.includes(":edit"), false);
    } finally {
      await rm(runtime, { recursive: true, force: true });
    }
  });

  it("E1+E2: writes splash, wordmark, and api Lua modules (D1)", async () => {
    const runtime = await mkdtemp(join(tmpdir(), "pv-editor-"));
    try {
      await editorCommand(process.execPath, runtime);
      const luaDir = join(editorRuntimePath(runtime), "lua", "pinevim");
      const splash = await readFile(join(luaDir, "splash.lua"), "utf8");
      const wordmark = await readFile(join(luaDir, "wordmark.lua"), "utf8");
      const api = await readFile(join(luaDir, "api.lua"), "utf8");
      // Splash module: pine motif + 800ms defer.
      assert.match(splash, /PinevimSplashAccent/);
      assert.match(splash, /SPLASH_DURATION_MS\s*=\s*800/);
      assert.match(splash, /pinevim -- a forest/);
      // Wordmark module: brand + tabline + empty header.
      assert.match(wordmark, /DEFAULT_WORDMARK\s*=\s*"pinevim"/);
      assert.match(wordmark, /PinevimTablineBrand/);
      assert.match(wordmark, /empty_header/);
      // API module: statusline + trunk_factor + setup.
      assert.match(api, /function M\.setup/);
      assert.match(api, /function M\.statusline/);
      assert.match(api, /function M\.trunk_factor/);
      // Match the on-disk content exactly to the source.
      assert.equal(splash, SPLASH_LUA);
      assert.equal(wordmark, WORDMARK_LUA);
      assert.equal(api, PINEVIM_API_LUA);
    } finally {
      await rm(runtime, { recursive: true, force: true });
    }
  });
});
