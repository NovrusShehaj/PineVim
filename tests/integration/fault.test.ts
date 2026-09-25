import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { AppController } from "../../src/core/controller.js";
import { connect, identity } from "../../src/control/client.js";
import { harness, until } from "./harness.js";

test(
  "Pi killed while streaming is detected and leaves state and session record intact",
  { timeout: 90000 },
  async () => {
    const h = await harness(120, 30, true);
    const records = async () =>
      readFile(join(h.root, "provider-events"), "utf8").then(
        (s) =>
          s
            .trim()
            .split("\n")
            .map((l) => JSON.parse(l) as Record<string, unknown>),
        () => [],
      );
    try {
      await h.command("a streaming prompt");
      await until(() => h.controller.state.busy);
      process.kill(h.controller.state.agent!.pid, "SIGKILL");
      // Death propagates through the pane-died hook and the periodic
      // reconcile; dispatching intents here would race a dead focused pane.
      await until(() => !h.controller.state.agent!.alive, 10000);
      // The stream lived inside Pi, so exactly one request was recorded
      // before the kill; the record must stay untouched afterwards.
      assert.equal(
        (await records()).filter((r) => r.event === "request").length,
        1,
      );
      assert.equal(
        (await records()).filter((r) => r.event === "abort").length,
        0,
      );
      assert.equal(h.controller.state.mode, "CHAT_ONLY");
      assert.equal(h.controller.state.editor, null);
    } finally {
      await h.close();
    }
  },
);

test(
  "Pi killed mid-run: resume reclaims the workspace and preserves the live editor",
  { timeout: 90000 },
  async () => {
    const h = await harness(120, 30, true);
    try {
      await h.controller.intent("ide.open");
      if (h.controller.state.focus === "agent")
        await h.controller.intent("focus.other");
      assert.equal(h.controller.state.focus, "editor");
      await h.command("a tooling prompt");
      await until(() => h.controller.state.busy);
      const pid = h.controller.state.agent!.pid;
      const editorPid = h.controller.state.editor!.pid;
      process.kill(pid, "SIGKILL");
      await until(() => !h.controller.state.agent!.alive, 10000);
      assert.equal(h.controller.state.mode, "IDE_FOCUS");
      // Recovery is the documented --resume path. It must adopt the dead
      // agent without disturbing the live editor and stay dispatchable.
      await h.controller.detach();
      await h.store.acquire();
      const metadata = (await h.store.load())!;
      metadata.state.epoch = randomUUID();
      metadata.state.generation = 0;
      const controller = new AppController(
        h.config,
        h.store,
        h.tmux,
        metadata,
        h.piPath,
      );
      try {
        await controller.start(true);
        assert.ok(controller.state.editor!.alive);
        assert.equal(controller.state.editor!.pid, editorPid);
        assert.equal(controller.state.agent!.pid, pid);
        assert.equal(controller.state.agent!.alive, false);
        assert.equal(controller.state.mode, "IDE_FOCUS");
        await controller.intent("status");
      } finally {
        await controller.detach().catch(() => {});
      }
    } finally {
      await h.close();
    }
  },
);

test(
  "editor killed mid-switch between views keeps Pi alive and reopens a replacement",
  { timeout: 60000 },
  async () => {
    const h = await harness();
    try {
      const pid = h.controller.state.agent!.pid;
      await h.controller.intent("ide.open");
      const editor = h.controller.state.editor!;
      const layout = h.tmux.layout.bind(h.tmux);
      let fired = false;
      h.tmux.layout = async (...args) => {
        const result = await layout(...args);
        if (!fired) {
          fired = true;
          process.kill(editor.pid, "SIGKILL");
        }
        return result;
      };
      try {
        await h.controller.intent("agent.hide");
      } finally {
        h.tmux.layout = layout;
      }
      await until(async () => {
        await h.controller.intent("reconcile");
        return h.controller.state.mode === "CHAT_ONLY";
      });
      assert.equal(h.controller.state.agent!.pid, pid);
      await h.controller.intent("ide.open");
      assert.ok(h.controller.state.editor!.alive);
      assert.notEqual(h.controller.state.editor!.pid, editor.pid);
    } finally {
      await h.close();
    }
  },
);

test(
  "control IPC flood of 500 resize events is absorbed without wedging intents",
  { timeout: 60000 },
  async () => {
    const h = await harness();
    let peer;
    try {
      peer = await connect(h.metadata.runtime);
      const hello = await peer.request("hello", {
        ...(await identity(h.metadata.runtime)),
        role: "helper",
        pid: process.pid,
      });
      for (let batch = 0; batch < 25; batch++)
        await Promise.all(
          Array.from({ length: 20 }, () =>
            peer!.request("event", { event: "resize" }, 0, String(hello.epoch)),
          ),
        );
      const pid = h.controller.state.agent!.pid;
      await h.controller.intent("ide.open");
      assert.equal(h.controller.state.agent!.pid, pid);
      assert.equal(h.controller.state.editor!.alive, true);
    } finally {
      peer?.close();
      await h.close();
    }
  },
);

test(
  "interrupted controller leaves a dead-owner lock; resume reclaims it and recovers Pi",
  { timeout: 90000 },
  async () => {
    const h = await harness(120, 30);
    try {
      const piPid = h.controller.state.agent!.pid;
      await h.controller.intent("ide.open");
      const editorPid = h.controller.state.editor!.pid;

      // Hand the lock to a separate controller process, then let it die hard:
      // no release, no cleanup, lock left behind with a dead owner pid.
      await h.controller.detach();
      const holder = spawn(
        process.execPath,
        [
          "-e",
          `const { Store } = require(process.argv[1]);
           const s = new Store(process.argv[2], process.argv[3]);
           s.acquire().then(() => {
             console.log("LOCKED");
             setInterval(() => {}, 1 << 30);
           });`,
          join(process.cwd(), "build", "src", "persistence.js"),
          h.workspace,
          h.store.directory,
        ],
        { stdio: ["ignore", "pipe", "inherit"], cwd: process.cwd() },
      );
      let holderOutput = "";
      holder.stdout.setEncoding("utf8");
      holder.stdout.on("data", (chunk: string) => {
        holderOutput += chunk;
      });
      await until(() => holderOutput.includes("LOCKED"), 15000);
      // Pi dies while the lock holder lives, then the holder itself dies.
      process.kill(piPid, "SIGKILL");
      holder.kill("SIGKILL");
      await until(
        () => holder.exitCode !== null || holder.signalCode !== null,
        15000,
      );

      // Reclaim must succeed despite the stale lock; the live editor survives.
      await h.store.acquire();
      const metadata = (await h.store.load())!;
      metadata.state.epoch = randomUUID();
      metadata.state.generation = 0;
      const controller = new AppController(
        h.config,
        h.store,
        h.tmux,
        metadata,
        h.piPath,
      );
      try {
        await controller.start(true);
        assert.ok(controller.state.editor!.alive);
        assert.equal(controller.state.editor!.pid, editorPid);
        assert.equal(controller.state.agent!.pid, piPid);
        assert.equal(controller.state.agent!.alive, false);
        assert.equal(controller.state.mode, "IDE_FOCUS");
      } finally {
        await controller.detach().catch(() => {});
      }
    } finally {
      await h.close();
    }
  },
);
