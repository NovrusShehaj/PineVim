import { test } from "node:test";
import assert from "node:assert/strict";
import {
  realpath,
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initialState,
  transition,
  reconcileChildren,
  intents,
} from "../../src/core/state.js";
import { agentWidth, compact, tooSmall } from "../../src/core/layout.js";
import { validateConfig, workspacePath } from "../../src/config.js";
import { literal, safeError } from "../../src/diagnostics.js";
import { Framer, parseRecord, MAX_RECORD } from "../../src/control/protocol.js";
import { parseCommand } from "../../src/adapters/pi/extension.js";
import {
  commandOwnership,
  probePiApiSurface,
  assertPiApiSurface,
} from "../../src/adapters/pi/compatibility.js";
import { Tmux } from "../../src/adapters/tmux/client.js";
import {
  shellQuote,
  helperCommand,
  tmuxConfig,
} from "../../src/adapters/tmux/config.js";
import {
  Store,
  atomicWrite,
  privateRead,
  validateMetadata,
} from "../../src/persistence.js";
import { defaults } from "../../src/config.js";
import { newMetadata } from "../../src/core/controller.js";
import { piAgentDir } from "../../src/core/theme-install.js";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
const living = (pane: string, pid: number) => ({
  pane,
  pid,
  alive: true,
  ready: true,
  exitCode: null,
  signal: null,
});
for (const [columns, rows, isCompact] of [
  [120, 30, false],
  [101, 24, false],
  [100, 24, true],
  [80, 24, true],
  [60, 16, true],
  [59, 15, true],
] as const)
  test(`geometry ${columns}x${rows}`, () => {
    assert.equal(compact({ columns, rows }), isCompact);
    assert.equal(tooSmall({ columns, rows }), columns < 60 || rows < 16);
    if (!isCompact) {
      assert.ok(agentWidth(columns, null) >= 40);
      assert.ok(columns - agentWidth(columns, null) - 1 >= 60);
    }
  });
test("default formula and ratio clamping", () => {
  assert.equal(agentWidth(120, null), 42);
  assert.equal(agentWidth(101, null), 40);
  assert.equal(agentWidth(400, null), 64);
  assert.equal(agentWidth(120, 0.9), 59);
});
test("idempotent view changes preserve child identities", () => {
  let s = {
    ...initialState({ columns: 120, rows: 30 }, "epoch", null),
    agent: living("%0", 12),
    editor: living("%1", 13),
  };
  for (let i = 0; i < 50; i++) {
    const opened = transition(s, "ide.open");
    assert.deepEqual(transition(opened, "ide.open"), opened);
    const hidden = transition(opened, "agent.hide");
    assert.deepEqual(transition(hidden, "agent.hide"), hidden);
    s = transition(transition(hidden, "agent.show"), "chat") as typeof s;
    assert.equal(s.agent.pid, 12);
    assert.equal(s.editor.pid, 13);
    assert.equal(s.mode, "CHAT_ONLY");
  }
});
test("never hide the sole live agent", () => {
  const s = {
    ...initialState({ columns: 80, rows: 24 }, "epoch", null),
    agent: living("%0", 12),
  };
  assert.throws(() => transition(s, "agent.hide"));
  assert.equal(transition(s, "agent.show").mode, "CHAT_ONLY");
});
test("all intent/state combinations keep pure reducer independent of effects", () => {
  for (const mode of ["CHAT_ONLY", "IDE_WITH_AGENT", "IDE_FOCUS"] as const)
    for (const intent of intents) {
      const s = {
        ...initialState({ columns: 80, rows: 24 }, "epoch", null),
        agent: living("%0", 12),
        editor: living("%1", 13),
        mode,
      };
      const snapshot = JSON.stringify(s);
      try {
        const result = transition(s, intent);
        assert.equal(result.agent, s.agent);
        assert.equal(result.editor, s.editor);
      } catch {
        assert.ok(intent === "agent.hide" || intent === "agent.toggle");
        assert.equal(mode, "CHAT_ONLY");
      }
      assert.equal(JSON.stringify(s), snapshot);
    }
});
test("child failure isolation", () => {
  const s = {
    ...initialState({ columns: 120, rows: 30 }, "epoch", null),
    agent: living("%0", 12),
    editor: living("%1", 13),
  };
  assert.equal(
    reconcileChildren({ ...s, agent: { ...s.agent, alive: false } }).mode,
    "IDE_FOCUS",
  );
  assert.equal(
    reconcileChildren({ ...s, editor: { ...s.editor, alive: false } }).mode,
    "CHAT_ONLY",
  );
});
test("strict command arguments never become prompts", () => {
  assert.equal(parseCommand("ide", ""), "ide.open");
  assert.equal(parseCommand("ide", "close"), "chat");
  assert.equal(parseCommand("pinevim", "agent show"), "agent.show");
  assert.throws(() => parseCommand("pinevim", "unknown"));
});
test("collision ownership uses exact invocation and source", () => {
  const command = (name: string, path: string, source = "extension") =>
    ({ name, source, sourceInfo: { path } }) as SlashCommandInfo;
  assert.deepEqual(
    commandOwnership(
      [command("ide", "/bundle"), command("pinevim", "/bundle")],
      "/bundle",
    ),
    { ide: true, pinevim: true },
  );
  assert.deepEqual(
    commandOwnership(
      [
        command("ide:1", "/bundle"),
        command("ide:2", "/other"),
        command("pinevim", "/bundle"),
      ],
      "/bundle",
    ),
    { ide: false, pinevim: true },
  );
  assert.equal(
    commandOwnership([command("ide", "/bundle", "prompt")], "/bundle").ide,
    false,
  );
});
test("ui.confirm policy defaults, parses and rejects without echoing", () => {
  const parsed = validateConfig({ ui: { confirm: { retry: "never" } } });
  assert.equal(parsed.ui.confirm.quit, "ask");
  assert.equal(parsed.ui.confirm.retry, "never");
  assert.deepEqual(validateConfig({}).ui.confirm, {
    quit: "ask",
    retry: "ask",
  });
  for (const bad of [
    { ui: { confirm: { cancel: "never" } } },
    { ui: { confirm: { quit: "CANARY" } } },
    { ui: { confirm: "always" } },
    { ui: { confirm: null } },
  ])
    assert.throws(
      () => validateConfig(bad),
      (e) => e instanceof Error && !String(e).includes("CANARY"),
    );
});
test("pi agent-dir resolution matches Pi's getAgentDir", async () => {
  // The controller avoids importing Pi's library (module-graph cost); this
  // pin fails if Pi changes its resolution and PineVim would write themes
  // to the wrong directory.
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  process.env.PI_CODING_AGENT_DIR = join("~", "pin-agent");
  assert.equal(await piAgentDir(), getAgentDir());
  process.env.PI_CODING_AGENT_DIR = "/abs/pin-agent";
  assert.equal(await piAgentDir(), getAgentDir());
  delete process.env.PI_CODING_AGENT_DIR;
  const { homedir } = await import("node:os");
  assert.equal(join(homedir(), ".pi", "agent"), getAgentDir());
});
test("timeline payload validates, parses and drops malformed entries", () => {
  const record = (timeline: unknown) =>
    JSON.stringify({
      version: 1,
      requestId: "id",
      generation: 1,
      epoch: "epoch",
      type: "status",
      payload: {
        cwd: "/w",
        busy: false,
        ide: false,
        pinevim: true,
        sessionId: null,
        sessionFile: null,
        timeline,
      },
    }) + "\n";
  // Well-formed payload passes the protocol validator.
  const parsed = parseRecord(record("1|5|2|0|0|read bash;2|12|3|1|1|edit"));
  assert.equal(parsed.type, "status");
  // Uppercase is outside the bounded vocabulary -> whole payload rejected.
  assert.throws(() => parseRecord(record("1|5|2|0|0|READ")));
  // Oversized payload is rejected.
  assert.throws(() => parseRecord(record("1|".repeat(4096))));
});
test("config rejects secret fields, shell commands, invalid enums without echo", () => {
  for (const input of [
    { token: "CANARY" },
    { pi: "pi;echo CANARY" },
    { prefix: "F12;kill-server" },
    { agentRatio: NaN },
    { logLevel: "CANARY" },
    [],
  ])
    assert.throws(
      () => validateConfig(input),
      (e) => e instanceof Error && !e.message.includes("CANARY"),
    );
});
test("diagnostic control and tmux format injection filtered", () => {
  assert.equal(literal("a\n#{evil}\x1b"), "a?##{evil}?");
  assert.ok(!safeError(new Error("CANARY")).includes("CANARY"));
});
const record = {
  version: 1,
  requestId: "id",
  generation: 1,
  epoch: "epoch",
  type: "intent",
  payload: { intent: "ide.open" },
};
test("protocol validates frames, chunk splits, bounds and enums", () => {
  const bytes = Buffer.from(JSON.stringify(record) + "\n");
  const f = new Framer();
  assert.equal(f.feed(bytes.subarray(0, 20)).length, 0);
  assert.equal(f.feed(bytes.subarray(20))[0]?.type, "intent");
  for (const bad of [
    { ...record, version: 2 },
    { ...record, generation: -1 },
    { ...record, type: "run-shell" },
    { ...record, payload: { intent: "kill" } },
    { ...record, payload: { intent: "ide.open", token: "secret" } },
  ])
    assert.throws(() => parseRecord(JSON.stringify(bad)));
  assert.throws(() => new Framer().feed(Buffer.alloc(MAX_RECORD + 1, 65)));
  assert.throws(() => parseRecord("{bad"));
});
test("fixed helper shell quoting and enum boundary", () => {
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
  assert.ok(
    helperCommand(
      "/node",
      "/x #{evil}/helper",
      "/tmp/a'$;",
      "ide.open",
    ).includes("##{evil}"),
  );
  assert.throws(() =>
    helperCommand("/node", "/helper", "/tmp", "x; touch pwn"),
  );
  assert.ok(tmuxConfig("F12", "tmux-256color").includes("unbind -a -T prefix"));
});
test("canonical workspace, exclusive locks, atomic private metadata and symlink rejection", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pv-unit-")));
  try {
    const real = join(root, "workspace");
    await mkdir(real);
    await symlink(real, join(root, "alias"));
    assert.equal(
      (await workspacePath(join(root, "alias"))).canonical,
      (await workspacePath(real)).canonical,
    );
    await writeFile(join(root, "file"), "x");
    await assert.rejects(workspacePath(join(root, "file")));
    await assert.rejects(workspacePath(join(root, "missing")));
    const base = join(root, "state");
    const a = new Store(real, base),
      b = new Store(real, base);
    await a.acquire();
    await assert.rejects(b.acquire());
    await atomicWrite(join(a.directory, "sample"), { hello: true });
    assert.equal(
      JSON.parse(await privateRead(join(a.directory, "sample"))).hello,
      true,
    );
    await symlink(join(a.directory, "sample"), join(a.directory, "link"));
    await assert.rejects(privateRead(join(a.directory, "link")));
    await a.release();
    await b.acquire();
    await b.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("recovery rejects foreign workspace and malformed identities", () => {
  const m = newMetadata(
    "/workspace",
    "/workspace",
    "/tmp/test",
    "a".repeat(32),
    defaults,
    { columns: 120, rows: 30 },
    { pi: "0.87.1", tmux: "3.7c", node: "26" },
  );
  assert.equal(validateMetadata(m, "/workspace"), m);
  assert.throws(() => validateMetadata(m, "/other"));
  assert.throws(() =>
    validateMetadata({ ...m, session: ";kill-server" }, "/workspace"),
  );
});

test("diagnostic log refuses symlinks and rotates private allowlisted records", async () => {
  const { Logger } = await import("../../src/diagnostics.js");
  const { stat } = await import("node:fs/promises");
  const root = await realpath(await mkdtemp(join(tmpdir(), "pv-log-")));
  try {
    const target = join(root, "target");
    await writeFile(target, "CANARY", { mode: 0o600 });
    await symlink(target, join(root, "controller.log"));
    await assert.rejects(
      new Logger(root, true).write({ event: "failure", code: "SECRET=value" }),
    );
    assert.equal(await privateRead(target), "CANARY");
    await rm(join(root, "controller.log"));
    await writeFile(join(root, "controller.log"), "x".repeat(5 * 1024 * 1024), {
      mode: 0o600,
    });
    await new Logger(root, true).write({
      event: "failure",
      code: "SECRET=value",
    });
    assert.equal(
      (await stat(join(root, "controller.log"))).mode & 0o777,
      0o600,
    );
    assert.ok(
      !(await privateRead(join(root, "controller.log"))).includes("value"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("metadata rejects unknown fields and malformed lifecycle state", () => {
  const m = newMetadata(
    "/workspace",
    "/workspace",
    "/tmp/test",
    "a".repeat(32),
    defaults,
    { columns: 120, rows: 30 },
    { pi: "0.87.1", tmux: "3.7c", node: "26" },
  );
  assert.throws(() =>
    validateMetadata({ ...m, token: "CANARY" }, "/workspace"),
  );
  assert.throws(() =>
    validateMetadata(
      { ...m, state: { ...m.state, lifecycle: "unknown" } },
      "/workspace",
    ),
  );
  assert.throws(() =>
    validateMetadata(
      {
        ...m,
        state: {
          ...m.state,
          geometry: { columns: 120, rows: 30, secret: "CANARY" },
        },
      },
      "/workspace",
    ),
  );
});

test("lost transport cannot authorize a second writer while a recorded PID lives", async () => {
  const { processAlive, requireDeadChildren } =
    await import("../../src/persistence.js");
  const m = newMetadata(
    "/workspace",
    "/workspace",
    "/tmp/test",
    "a".repeat(32),
    defaults,
    { columns: 120, rows: 30 },
    { pi: "0.87.1", tmux: "3.7c", node: "26" },
  );
  assert.equal(await processAlive(process.pid), true);
  m.state.agent = {
    pane: "%0",
    pid: process.pid,
    alive: false,
    ready: false,
    exitCode: null,
    signal: null,
  };
  await assert.rejects(requireDeadChildren(m), /recorded child PID/);
  m.state.agent = null;
  await requireDeadChildren(m);
});

test("prototype field names cannot bypass config schema", () => {
  for (const key of ["constructor", "toString", "__proto__"])
    assert.throws(
      () => validateConfig(JSON.parse(`{"${key}":"CANARY"}`)),
      /Unknown field/,
    );
});

test("prototype command names return usage, never inherited functions", () => {
  for (const command of ["ide", "pinevim"] as const)
    for (const name of ["constructor", "__proto__", "toString"])
      assert.throws(() => parseCommand(command, name), /Use \/ide/);
});

test("terminfo selects screen fallback and reports when neither entry exists", async () => {
  const { execFileSync } = await import("node:child_process");
  const root = await realpath(await mkdtemp(join(tmpdir(), "pv-terminfo-")));
  const module = new URL("../../src/adapters/tmux/config.js", import.meta.url)
    .href;
  const program = `import {terminfo} from ${JSON.stringify(module)}; console.log(await terminfo());`;
  try {
    await writeFile(
      join(root, "infocmp"),
      '#!/bin/sh\n[ "$1" = "screen-256color" ]\n',
      { mode: 0o700 },
    );
    assert.equal(
      execFileSync(process.execPath, ["--input-type=module", "-e", program], {
        env: { PATH: root },
        encoding: "utf8",
      }).trim(),
      "screen-256color",
    );
    await writeFile(join(root, "infocmp"), "#!/bin/sh\nexit 1\n", {
      mode: 0o700,
    });
    assert.throws(
      () =>
        execFileSync(process.execPath, ["--input-type=module", "-e", program], {
          env: { PATH: root },
          stdio: "pipe",
        }),
      /Install tmux-256color or screen-256color/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("probePiApiSurface detects available public API hooks", () => {
  const pi = {
    registerTool: () => {},
    registerEntryRenderer: () => {},
    registerCommand: () => {},
    registerShortcut: () => {},
    on: () => {},
  };
  const ctx = {
    ui: {
      setHeader: () => {},
      setFooter: () => {},
      setEditorComponent: () => {},
      setWidget: () => {},
      setWorkingIndicator: () => {},
    },
  };
  const report = probePiApiSurface(pi, ctx);
  assert.equal(report.hasSetHeader, true);
  assert.equal(report.hasSetFooter, true);
  assert.equal(report.hasSetEditorComponent, true);
  assert.equal(report.hasSetWidget, true);
  assert.equal(report.hasSetWorkingIndicator, true);
  assert.equal(report.hasRegisterTool, true);
  assert.equal(report.hasRegisterEntryRenderer, true);
  assert.equal(report.hasRegisterCommand, true);
  assert.equal(report.hasRegisterShortcut, true);
  assert.equal(report.hasOn, true);
  assert.doesNotThrow(() => assertPiApiSurface(pi, ctx));
});

test("assertPiApiSurface throws PineError when hooks are missing", () => {
  assert.throws(
    () => assertPiApiSurface({}, {}),
    /Incompatible Pi API surface; missing: ctx\.ui\.setHeader/,
  );
});

test("TmuxClient notify adds severity prefixes and respects existing prefix", async () => {
  class TestTmux extends Tmux {
    readonly calls: string[][] = [];
    override async command(...args: string[]): Promise<string> {
      this.calls.push(args);
      return "";
    }
  }
  const client = new TestTmux("tmux", "/fake/runtime");

  await client.notify("something went wrong", "error");
  assert.equal(client.calls[0]?.[3], "pinevim error: something went wrong");

  await client.notify("caution advised", "warning");
  assert.equal(client.calls[1]?.[3], "pinevim warning: caution advised");

  await client.notify("status update", "info");
  assert.equal(client.calls[2]?.[3], "pinevim: status update");

  await client.notify("pinevim: already prefixed");
  assert.equal(client.calls[3]?.[3], "pinevim: already prefixed");
});
