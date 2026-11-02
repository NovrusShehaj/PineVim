import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PINE_TREE } from "../../src/piui/logo.js";
import { harness, until } from "./harness.js";

/**
 * Deterministic key entry for a headless nvim pane.
 *
 * Flake root cause (pane-dump proven): the original "file loaded" condition
 * — netrw's `scratch.txt 0,0-1` line disappearing — fires while nvim has
 * only *displayed* the typed `:e scratch.txt` in its command line and has
 * not executed it yet. Everything typed afterwards (`i…`, `Escape`, the
 * writefile Ex command) is then consumed by that still-open command line:
 * the buffer ends up with literal `iUNSAVED PINEVIM^[` text, the writefile
 * never runs, and the awaited JSON file never appears — the historical
 * "Test condition deadline exceeded" flake.
 *
 * The fix is a handshake at each stage, not a sleep:
 * - `ready()`: wait until the statusline positively shows the PineVim
 *   segment pair (`scratch.txt` … `pinevim`, absent from netrw's own line)
 *   with no open `:e` command line.
 * - `ex()`: Ex text is delivered atomically via tmux set-buffer +
 *   paste-buffer (long `send-keys -l` races nvim's input handling under
 *   csi-u key format), and each command is verified with an idempotent
 *   `effect` probe and retried behind a fresh Escape, so one swallowed
 *   keystroke can no longer poison the whole run.
 */
function makeEditorKeys(
  tmux: { command: (...argv: string[]) => Promise<string> },
  pane: string,
): {
  ready: () => Promise<void>;
  type: (text: string) => Promise<void>;
  key: (key: string) => Promise<void>;
  ex: (command: string, effect: () => Promise<boolean>) => Promise<void>;
} {
  const capture = (): Promise<string> =>
    tmux.command("capture-pane", "-p", "-t", pane);
  const type = (text: string): Promise<void> =>
    tmux.command("send-keys", "-t", pane, "-l", text).then(() => undefined);
  const key = (name: string): Promise<void> =>
    tmux.command("send-keys", "-t", pane, name).then(() => undefined);
  /**
   * True when scratch.txt is the active buffer and no command line is open.
   *
   * IMPORTANT: nvim's themed statusline renders `scratch.txt 0,0-1 …` for
   * the loaded (empty) file, so the netrw-era marker `scratch.txt 0,0-1`
   * can never distinguish buffers — the old `!includes(...)` condition was
   * unsatisfiable once the file loaded and always timed out. Detection is
   * positive instead: the statusline must show the PineVim segment pair
   * (`scratch.txt` + `pinevim`, absent from netrw's own line), and no open
   * command line (`:e scratch.txt` rendered alone) may remain.
   */
  const bufferShown = async (): Promise<boolean> =>
    capture().then(
      (f) =>
        /scratch\.txt[^\n]*pinevim/.test(f) &&
        !/(^|\n):e scratch\.txt(\n|$)/.test(f),
      () => false,
    );
  const ready = (): Promise<void> =>
    until(bufferShown, 10000).then(() => undefined);
  /**
   * Run one Ex command and wait for `effect`. Delivery is atomic (buffer
   * paste), retried up to five times behind a fresh Escape so one swallowed
   * keystroke cannot derail the run. `effect` must be idempotent —
   * writefile, `:w`, and `:qa` all are.
   */
  const ex = async (
    command: string,
    effect: () => Promise<boolean>,
  ): Promise<void> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await key("Escape");
      await tmux.command("set-buffer", "--", command).then(
        () => undefined,
        () => undefined,
      );
      await type(":");
      await tmux.command("paste-buffer", "-t", pane).then(
        () => undefined,
        () => undefined,
      );
      await key("Enter");
      if (await effect()) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    await until(effect);
  };
  return { ready, type, key, ex };
}

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
      // Since /ide opens `nvim .` (workspace file tree), open a real file
      // buffer before typing: netrw directory buffers are read-only, and the
      // continuity assertions below need a writable file buffer.
      await writeFile(join(h.workspace, "scratch.txt"), "");
      const keys = makeEditorKeys(h.tmux, editor.pane);
      await keys.type(":e scratch.txt");
      await keys.key("Enter");
      await keys.ready();
      await keys.type("iUNSAVED PINEVIM");
      await keys.key("Escape");
      const editorSnapshot = async (name: string) => {
        const path = join(h.workspace, name);
        await keys.ex(
          `call writefile([json_encode({'text': getline(1,'$'), 'cursor': getcurpos(), 'undo': undotree()})], '${path}')`,
          () =>
            readFile(path, "utf8").then(
              (content) => {
                JSON.parse(content);
                return true;
              },
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
      await h.resume();
      assert.equal(h.controller.state.agent!.pid, piPid);
      assert.equal(h.controller.state.editor!.pid, editor.pid);
      // Write the synthetic buffer only, proving retained contents without adding production RPC.
      const savedPath = join(h.workspace, "saved.txt");
      await keys.ex("w! " + savedPath, () =>
        readFile(savedPath, "utf8").then(
          (s) => s.includes("UNSAVED PINEVIM"),
          () => false,
        ),
      );
      // `:w! saved.txt` only writes a copy: a named buffer keeps its modified
      // flag (the old unnamed homescreen buffer got renamed instead), so
      // plain :qa would raise E37. Save scratch.txt before quitting.
      await keys.ex("w", () =>
        readFile(join(h.workspace, "scratch.txt"), "utf8").then(
          (s) => s.includes("UNSAVED PINEVIM"),
          () => false,
        ),
      );
      // `:qa` closes the editor; the controller reconciles to CHAT_ONLY when
      // the editor child dies.
      await keys.type(":qa");
      await keys.key("Enter");
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
        await until(async () => {
          const frame = await h.tmux.command(
            "capture-pane",
            "-p",
            "-S",
            "-",
            "-t",
            h.controller.state.agent!.pane,
          );
          return frame.includes("pinevim") && frame.includes("workspace");
        });
        const frame = await h.tmux.command(
          "capture-pane",
          "-p",
          "-S",
          "-",
          "-t",
          h.controller.state.agent!.pane,
        );
        const lines = frame.split("\n");
        const wordmark = lines.find((line) => line.includes("pinevim"))!;
        const workspace = lines.find((line) => line.includes("workspace"))!;
        assert.ok(wordmark.length <= columns);
        assert.ok(workspace.length <= columns);
        assert.match(wordmark.trimStart(), /^\/\\\s+pinevim/);
        if (columns === 60) {
          assert.equal(wordmark, workspace);
        } else {
          assert.ok(workspace.trimStart().startsWith("/||\\"));
        }

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
  "live pane resize switches between compact and full splash headers",
  { timeout: 40000 },
  async () => {
    const h = await harness(80, 24);
    try {
      const pane = h.controller.state.agent!.pane;
      const pid = h.controller.state.agent!.pid;
      const capture = async (): Promise<string[]> => {
        const frame = await h.tmux.command("capture-pane", "-p", "-t", pane);
        const first = frame.split("\n").findIndex((line) => line.trim());
        return first < 0 ? [] : frame.split("\n").slice(first);
      };
      const waitForGeometry = async (columns: number, rows: number) => {
        h.controller.state.geometry = { columns, rows };
        await h.controller.intent("reconcile");
        await until(async () => {
          const agent = (await h.tmux.inventory()).find((p) => p.pane === pane);
          return agent?.width === columns && agent.height === rows - 1;
        });
      };
      const waitForCompact = async () => {
        await until(async () => {
          const lines = await capture();
          return (
            lines[0]?.includes("pinevim") === true &&
            lines[1]?.trimStart().startsWith("/||\\") === true &&
            lines[2]?.trimStart().startsWith("/_/\\_\\") === true &&
            lines[3]?.trimStart().startsWith("||") === true
          );
        });
        const lines = await capture();
        assert.match(lines[0]!.trimStart(), /^\/\\\s+pinevim/);
        assert.ok(lines[1]!.trimStart().startsWith("/||\\"));
        assert.ok(lines[2]!.trimStart().startsWith("/_/\\_\\"));
        assert.ok(lines[3]!.trimStart().startsWith("||"));
        assert.match(lines[1]!, /workspace/);
      };
      const waitForFull = async () => {
        await until(async () => {
          const lines = await capture();
          return PINE_TREE.every((source, index) =>
            lines[index]?.trimStart().startsWith(source.trim()),
          );
        });
        const lines = await capture();
        assert.ok(
          PINE_TREE.every((source, index) =>
            lines[index]!.trimStart().startsWith(source.trim()),
          ),
          "full splash is not intact after resize",
        );
        assert.match(lines[1]!, /pinevim/);
        assert.match(lines[0]!, /view CHAT/);
      };

      assert.equal(h.controller.state.compact, true);
      await waitForCompact();

      await waitForGeometry(120, 30);
      assert.equal(h.controller.state.compact, false);
      await waitForFull();

      await waitForGeometry(80, 24);
      assert.equal(h.controller.state.compact, true);
      await waitForCompact();

      assert.equal(h.controller.state.agent!.pid, pid);
      assert.equal(h.controller.state.bridge, true);
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
      // A queued follower (death-hook/coalescer reconcile) that observes the
      // stopped controller must fail without persisting: the shutdown path
      // already unlinked the metadata, and the old dispatch catch block
      // resurrected it behind a dead workspace (rare full-suite flake).
      await assert.rejects(
        h.controller.intent("status"),
        /Controller stopped; use --resume/,
      );
      assert.equal(await h.store.load(), null);
      assert.equal(await h.tmux.reachable(), false);
      await Promise.all([h.controller.detach(), h.controller.detach()]);
      await assert.rejects(stat(h.metadata.runtime), { code: "ENOENT" });
    } finally {
      await h.close();
    }
  },
);
