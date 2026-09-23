import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { harness, until } from "./harness.js";
test(
  "real Pi fixture provider, busy continuity, custom picker, reload and no replay",
  { timeout: 60000 },
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
      await h.command("A synthetic fixture prompt");
      await until(() => h.controller.state.busy);
      const pid = h.controller.state.agent!.pid;
      await h.command("/ide");
      await until(() => h.controller.state.editor?.alive === true);
      await h.controller.intent("agent.hide");
      await h.controller.intent("agent.show");
      assert.equal(h.controller.state.agent!.pid, pid);
      await until(() => !h.controller.state.busy);
      assert.equal(
        (await records()).filter((r) => r.event === "abort").length,
        0,
      );
      await h.tmux.command(
        "send-keys",
        "-t",
        h.controller.state.agent!.pane,
        "C-l",
      );
      await until(async () =>
        (await records()).some((r) => r.event === "picker-open"),
      );
      await h.tmux.command(
        "send-keys",
        "-t",
        h.controller.state.agent!.pane,
        "Enter",
      );
      await until(async () =>
        (await records()).some((r) => r.event === "model" && r.model === "two"),
      );
      await h.controller.intent("chat");
      await h.controller.intent("ide.open");
      await h.command("/fixture-status");
      await until(async () =>
        (await records()).some(
          (r) => r.event === "status" && r.model === "two",
        ),
      );
      const modeBeforeError = h.controller.state.mode;
      await h.command("/fixture-error");
      await until(async () =>
        (await records()).some((r) => r.event === "error-armed"),
      );
      await h.command("synthetic provider failure");
      await until(async () =>
        (await records()).some((r) => r.event === "provider-error"),
      );
      assert.equal(h.controller.state.mode, modeBeforeError);
      assert.ok(h.controller.state.editor?.alive);
      await until(() => !h.controller.state.busy);
      const generation = h.controller.state.generation;
      await h.command("/reload");
      await until(
        () =>
          h.controller.state.generation > generation &&
          h.controller.state.bridge,
      );
      assert.equal(h.controller.state.agent!.pid, pid);
      const requests = (await records()).filter(
        (r) => r.event === "request",
      ).length;
      await h.resume();
      assert.equal(
        (await records()).filter((r) => r.event === "request").length,
        requests,
      );
      const originalSession = h.controller.state.sessionId;
      const originalFile = h.controller.state.sessionFile!;
      const beforeForkGeneration = h.controller.state.generation;
      await h.command("/fixture-fork");
      await until(
        async () =>
          h.controller.state.sessionId !== originalSession &&
          h.controller.state.generation > beforeForkGeneration &&
          h.controller.state.bridge &&
          (await records()).some((r) => r.event === "fork-done"),
      );
      await h.command("/fixture-resume " + originalFile);
      await until(
        async () =>
          h.controller.state.sessionId === originalSession &&
          h.controller.state.bridge &&
          (await records()).some((r) => r.event === "resume-done"),
      );
      assert.equal(h.controller.state.agent!.pid, pid);
      const resumedStatusCount = (await records()).filter(
        (r) => r.event === "status",
      ).length;
      await h.command("/fixture-status");
      await until(
        async () =>
          (await records()).filter((r) => r.event === "status").length >
          resumedStatusCount,
      );
      assert.equal(
        (await records()).filter((r) => r.event === "status").at(-1)!.model,
        "two",
      );
      assert.equal(
        (await records()).filter((r) => r.event === "request").length,
        requests,
      );
      const oldSession = h.controller.state.sessionId;
      await h.command("/new");
      await until(
        () =>
          h.controller.state.sessionId !== oldSession &&
          h.controller.state.bridge,
      );
      for (const name of await readdir(h.store.directory)) {
        if (name.endsWith(".json") || name.endsWith(".log"))
          assert.ok(
            !(await readFile(join(h.store.directory, name), "utf8")).includes(
              "PINEVIM_TEST_CANARY",
            ),
          );
      }
    } finally {
      await h.close();
    }
  },
);

test(
  "bundled extension detects collisions on reload and preserves prefix recovery",
  { timeout: 40000 },
  async () => {
    const { writeFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const h = await harness();
    try {
      const settings = join(h.env.PI_CODING_AGENT_DIR!, "settings.json");
      let generation = h.controller.state.generation;
      await writeFile(
        settings,
        JSON.stringify({
          quietStartup: true,
          extensions: [resolve("tests/fixtures/collision.ts")],
        }),
      );
      await h.command("/reload");
      await until(
        () =>
          h.controller.state.generation > generation &&
          h.controller.state.bridge,
      );
      assert.match(
        String((await h.controller.intent("status")).message),
        /ide collision/,
      );
      await until(async () =>
        (
          await h.tmux.command(
            "capture-pane",
            "-p",
            "-t",
            h.controller.state.agent!.pane,
          )
        ).includes("Reloaded keybindings"),
      );
      await h.command("/pinevim ide");
      await until(() => h.controller.state.editor?.alive === true);
      generation = h.controller.state.generation;
      await writeFile(
        settings,
        JSON.stringify({
          quietStartup: true,
          extensions: [resolve("tests/fixtures/namespace-collision.ts")],
        }),
      );
      await h.command("/reload");
      await until(
        () =>
          h.controller.state.generation > generation &&
          h.controller.state.bridge,
      );
      assert.match(
        String((await h.controller.intent("status")).message),
        /pinevim collision/,
      );
      await h.controller.intent("chat");
      await h.controller.intent("ide.open");
      assert.equal(h.controller.state.mode, "IDE_WITH_AGENT");
    } finally {
      await h.close();
    }
  },
);
