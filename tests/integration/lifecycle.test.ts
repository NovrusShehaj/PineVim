import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { harness, until } from "./harness.js";

test(
  "real Pi slash integration, normal editor continuity, resize, failures and controller recovery",
  { timeout: 120000 },
  async () => {
    const h = await harness();
    try {
      const piPid = h.controller.state.agent!.pid,
        piPane = h.controller.state.agent!.pane,
        session = h.controller.state.sessionId;
      assert.equal(h.controller.state.editor, null);
      await h.command("/ide");
      await until(() => h.controller.state.mode === "IDE_WITH_AGENT");
      const editor = h.controller.state.editor!;
      assert.ok(editor.alive);
      let panes = await h.tmux.inventory();
      assert.equal(panes.find((p) => p.pane === piPane)!.width, 42);
      assert.equal(panes.find((p) => p.pane === editor.pane)!.left, 0);
      await h.controller.intent("ide.open");
      assert.equal(h.controller.state.editor!.pid, editor.pid);
      await h.tmux.command(
        "send-keys",
        "-t",
        editor.pane,
        "-l",
        "iUNSAVED PINEVIM",
      );
      await h.tmux.command("send-keys", "-t", editor.pane, "Escape");
      const editorSnapshot = async (name: string) => {
        const path = join(h.workspace, name);
        await h.tmux.command(
          "send-keys",
          "-t",
          editor.pane,
          "-l",
          `:call writefile([json_encode({'text': getline(1,'$'), 'cursor': getcurpos(), 'undo': undotree()})], '${path}')`,
        );
        await h.tmux.command("send-keys", "-t", editor.pane, "Enter");
        await until(async () =>
          readFile(path, "utf8").then(
            () => true,
            () => false,
          ),
        );
        return JSON.parse(await readFile(path, "utf8")) as Record<
          string,
          unknown
        >;
      };
      const beforeEditor = await editorSnapshot("before.json");
      for (const intent of [
        "agent.hide",
        "agent.show",
        "chat",
        "ide.open",
        "agent.hide",
        "focus.other",
      ] as const) {
        await h.controller.intent(intent);
        assert.equal(h.controller.state.agent!.pid, piPid);
        assert.equal(h.controller.state.editor!.pid, editor.pid);
        assert.equal(h.controller.state.sessionId, session);
      }
      const afterEditor = await editorSnapshot("after.json");
      assert.deepEqual(
        afterEditor,
        beforeEditor,
        "buffer, cursor and undo tree survive view transitions",
      );
      await h.controller.intent("quit");
      assert.equal(h.controller.state.editor!.alive, true);
      assert.equal(h.controller.state.lifecycle, "running");
      for (const [columns, rows] of [
        [80, 24],
        [60, 16],
        [40, 10],
        [101, 24],
        [100, 24],
        [120, 30],
      ]) {
        h.controller.state.geometry = { columns: columns!, rows: rows! };
        await h.controller.intent("reconcile");
        assert.equal(h.controller.state.agent!.pid, piPid);
        assert.equal(h.controller.state.editor!.pid, editor.pid);
        assert.equal(h.controller.state.compact, columns! < 101 || rows! < 24);
      }
      await h.controller.intent("ide.open");
      await h.tmux.command("send-keys", "-t", editor.pane, "-l", ":qa");
      await h.tmux.command("send-keys", "-t", editor.pane, "Enter");
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(
        (await h.tmux.inventory()).find((p) => p.pane === editor.pane)!.alive,
        true,
      );
      await h.resume();
      assert.equal(h.controller.state.agent!.pid, piPid);
      assert.equal(h.controller.state.editor!.pid, editor.pid);
      // Write the synthetic buffer only, proving retained contents without adding production RPC.
      await h.tmux.command("send-keys", "-t", editor.pane, "Escape");
      await h.tmux.command(
        "send-keys",
        "-t",
        editor.pane,
        "-l",
        ":w! " + join(h.workspace, "saved.txt"),
      );
      await h.tmux.command("send-keys", "-t", editor.pane, "Enter");
      await until(async () =>
        readFile(join(h.workspace, "saved.txt"), "utf8").then(
          (s) => s.includes("UNSAVED PINEVIM"),
          () => false,
        ),
      );
      await h.tmux.command("send-keys", "-t", editor.pane, "-l", ":qa");
      await h.tmux.command("send-keys", "-t", editor.pane, "Enter");
      await until(async () => {
        await h.controller.intent("reconcile");
        return h.controller.state.mode === "CHAT_ONLY";
      });
      await h.controller.intent("ide.open");
      assert.notEqual(h.controller.state.editor!.pid, editor.pid);
      process.kill(h.controller.state.editor!.pid, "SIGKILL");
      await until(async () => {
        await h.controller.intent("reconcile");
        return h.controller.state.mode === "CHAT_ONLY";
      });
      assert.equal(h.controller.state.agent!.pid, piPid);
      await h.controller.intent("ide.open");
      const replacement = h.controller.state.editor!.pid;
      process.kill(piPid, "SIGKILL");
      await until(async () => {
        await h.controller.intent("reconcile");
        return !h.controller.state.agent!.alive;
      });
      assert.equal(h.controller.state.editor!.pid, replacement);
      assert.equal(h.controller.state.mode, "IDE_FOCUS");
      panes = await h.tmux.inventory();
      assert.ok(panes.find((p) => p.pid === replacement)!.alive);
    } finally {
      await h.close();
    }
  },
);
for (const [columns, rows] of [
  [80, 24],
  [60, 16],
] as const)
  test(
    `first IDE creation at ${columns}x${rows}`,
    { timeout: 40000 },
    async () => {
      const h = await harness(columns, rows);
      try {
        const pid = h.controller.state.agent!.pid;
        await h.controller.intent("ide.open");
        assert.equal(h.controller.state.mode, "IDE_WITH_AGENT");
        assert.equal(h.controller.state.compact, true);
        assert.equal(h.controller.state.agent!.pid, pid);
        assert.ok(
          (await h.tmux.inventory()).every((p) => p.width > 0 && p.height > 0),
        );
        await h.controller.intent("focus.other");
        assert.equal(h.controller.state.focus, "agent");
      } finally {
        await h.close();
      }
    },
  );
test(
  "safe shutdown retains foreign tmux jobs",
  { timeout: 40000 },
  async () => {
    const h = await harness();
    try {
      await h.tmux.command(
        "new-session",
        "-d",
        "-s",
        "foreign",
        "/bin/sleep",
        "120",
      );
      await h.controller.intent("quit");
      await until(() => h.controller.state.lifecycle === "stopped");
      const panes = await h.tmux.inventory();
      assert.equal(panes.length, 1);
      assert.ok(panes[0]!.alive);
    } finally {
      await h.close();
    }
  },
);

test(
  "clean final-pane shutdown removes runtime and duplicate quit/detach is safe",
  { timeout: 30000 },
  async () => {
    const { stat } = await import("node:fs/promises");
    const h = await harness();
    try {
      await Promise.all([
        h.controller.intent("quit"),
        h.controller.intent("quit"),
      ]);
      await until(() => h.controller.state.lifecycle === "stopped");
      assert.equal(await h.store.load(), null);
      assert.equal(await h.tmux.reachable(), false);
      await Promise.all([h.controller.detach(), h.controller.detach()]);
      await assert.rejects(stat(h.metadata.runtime), { code: "ENOENT" });
    } finally {
      await h.close();
    }
  },
);
