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
});
