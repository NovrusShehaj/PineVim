import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { connect, identity } from "../../src/control/client.js";
import { harness, until } from "./harness.js";

test(
  "concurrent intents and 200 resize notices converge without duplicate children",
  { timeout: 60000 },
  async () => {
    const h = await harness();
    let peer;
    try {
      const pid = h.controller.state.agent!.pid;
      await Promise.all(
        Array.from({ length: 24 }, () => h.controller.intent("ide.open")),
      );
      const editor = h.controller.state.editor!.pid;
      assert.equal((await h.tmux.inventory()).length, 2);
      peer = await connect(h.metadata.runtime);
      const hello = await peer.request("hello", {
        ...(await identity(h.metadata.runtime)),
        role: "helper",
        pid: process.pid,
      });
      for (let batch = 0; batch < 10; batch++)
        await Promise.all(
          Array.from({ length: 20 }, () =>
            peer!.request("event", { event: "resize" }, 0, String(hello.epoch)),
          ),
        );
      await Promise.all(
        Array.from({ length: 24 }, (_, i) =>
          h.controller.intent(i % 2 ? "agent.show" : "agent.hide"),
        ),
      );
      await h.controller.intent("ide.open");
      assert.equal(h.controller.state.agent!.pid, pid);
      assert.equal(h.controller.state.editor!.pid, editor);
      assert.equal(h.controller.state.mode, "IDE_WITH_AGENT");
      // Mouse-equivalent focus and border changes are observed, not overwritten.
      await h.tmux.command("select-pane", "-t", h.controller.state.agent!.pane);
      await h.tmux.command(
        "resize-pane",
        "-t",
        h.controller.state.agent!.pane,
        "-x",
        "50",
      );
      await h.controller.intent("reconcile");
      assert.equal(h.controller.state.focus, "agent");
      assert.equal(Math.round(h.controller.state.ratio! * 119), 50);
    } finally {
      peer?.close();
      await h.close();
    }
  },
);
test(
  "missed death hook is recovered and a missing editor executable preserves Pi",
  { timeout: 40000 },
  async () => {
    const h = await harness();
    try {
      const pi = h.controller.state.agent!.pid;
      h.controller.config.nvim = join(h.root, "missing");
      await assert.rejects(h.controller.intent("ide.open"));
      assert.equal(h.controller.state.mode, "CHAT_ONLY");
      assert.equal(h.controller.state.agent!.pid, pi);
      h.controller.config.nvim = join(h.root, "nvim-test");
      await h.controller.intent("ide.open");
      await h.tmux.command("set-hook", "-gu", "pane-died");
      process.kill(h.controller.state.editor!.pid, "SIGKILL");
      await until(() => h.controller.state.mode === "CHAT_ONLY", 6000);
      assert.equal(h.controller.state.agent!.pid, pi);
    } finally {
      await h.close();
    }
  },
);
test(
  "stale epoch, bridge generation and foreign workspace are rejected",
  { timeout: 40000 },
  async () => {
    const h = await harness();
    let peer;
    try {
      peer = await connect(h.metadata.runtime);
      await assert.rejects(
        peer.request(
          "hello",
          {
            ...(await identity(h.metadata.runtime)),
            role: "bridge",
            pid: h.controller.state.agent!.pid,
            cwd: "/foreign",
            ide: true,
            pinevim: true,
            busy: false,
            sessionId: null,
            sessionFile: null,
          },
          h.controller.state.generation + 1,
        ),
      );
      peer.close();
      peer = await connect(h.metadata.runtime);
      await assert.rejects(
        peer.request(
          "hello",
          {
            ...(await identity(h.metadata.runtime)),
            role: "bridge",
            pid: h.controller.state.agent!.pid,
            cwd: h.workspace,
            ide: true,
            pinevim: true,
            busy: false,
            sessionId: null,
            sessionFile: null,
          },
          h.controller.state.generation - 1,
        ),
      );
      peer.close();
      assert.ok(h.controller.state.bridge);
      assert.equal(h.controller.state.mode, "CHAT_ONLY");
    } finally {
      peer?.close();
      await h.close();
    }
  },
);

test("lost editor creation result never creates a second untracked editor", async () => {
  const h = await harness();
  try {
    const create = h.tmux.createEditor.bind(h.tmux);
    h.tmux.createEditor = async (...args) => {
      await create(...args);
      throw new Error("Synthetic result loss after successful creation");
    };
    const agentPid = h.controller.state.agent!.pid;
    await assert.rejects(h.controller.intent("ide.open"));
    h.tmux.createEditor = create;
    const before = await h.tmux.inventory();
    assert.equal(before.length, 2);
    await assert.rejects(h.controller.intent("ide.open"), /untracked pane/);
    const after = await h.tmux.inventory();
    assert.deepEqual(
      after.map((p) => p.pid),
      before.map((p) => p.pid),
    );
    assert.ok(after.find((p) => p.pid === agentPid)?.alive);
  } finally {
    await h.close();
  }
});

test(
  "expired queued intent cannot create an editor after its client deadline",
  { timeout: 30000 },
  async () => {
    const h = await harness();
    const inventory = h.tmux.inventory.bind(h.tmux);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let first = true;
    h.tmux.inventory = async () => {
      if (first) {
        first = false;
        entered();
        await gate;
      }
      return inventory();
    };
    try {
      const blocked = h.controller.intent("status");
      const blockedResult = assert.rejects(blocked);
      await ready;
      const expired = assert.rejects(
        h.controller.intent("ide.open"),
        /expired before execution/,
      );
      await new Promise((resolve) => setTimeout(resolve, 10100));
      release();
      await Promise.all([blockedResult, expired]);
      assert.equal((await inventory()).length, 1);
      assert.equal(h.controller.state.editor, null);
    } finally {
      release();
      h.tmux.inventory = inventory;
      await h.close();
    }
  },
);
