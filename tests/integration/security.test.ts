import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  mkdir,
  rm,
  writeFile,
  readFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store, privateRead } from "../../src/persistence.js";
import { ControlServer } from "../../src/control/server.js";
import { connect, identity } from "../../src/control/client.js";
import { Tmux } from "../../src/adapters/tmux/client.js";
import { executable } from "../../src/config.js";
import { helperCommand } from "../../src/adapters/tmux/config.js";
import { until } from "./harness.js";

test(
  "authenticated IPC enforces capability, epoch, roles, size and queue bounds",
  { timeout: 20000 },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pv-ipc-")));
    const store = new Store(root, join(root, "state"));
    await store.acquire();
    const r = await store.runtime();
    const epoch = randomUUID();
    let calls = 0;
    const server = new ControlServer(
      r.runtime,
      epoch,
      async (_peer, _who, m) => {
        if (m.type !== "hello") calls++;
        return {};
      },
    );
    await server.listen();
    try {
      assert.equal(
        (await stat(join(r.runtime, "control.sock"))).mode & 0o777,
        0o600,
      );
      const bad = await connect(r.runtime);
      await assert.rejects(
        bad.request("hello", {
          ...(await identity(r.runtime)),
          token: "0".repeat(64),
          role: "helper",
          pid: process.pid,
        }),
      );
      bad.close();
      const peer = await connect(r.runtime);
      const hello = await peer.request("hello", {
        ...(await identity(r.runtime)),
        role: "helper",
        pid: process.pid,
      });
      assert.equal(hello.epoch, epoch);
      await assert.rejects(
        peer.request("intent", { intent: "ide.open" }, 0, "stale"),
      );
      assert.equal(calls, 0);
      await peer.request("intent", { intent: "status" }, 0, epoch);
      assert.equal(calls, 1);
      peer.socket.write("x".repeat(16385));
      await until(() => peer.closed);
      const p = await connect(r.runtime);
      const requests = Array.from({ length: 65 }, () =>
        p
          .request("hello", {
            ...{},
            token: "0".repeat(64),
            instance: r.instance,
            role: "helper",
            pid: process.pid,
          })
          .catch(() => null),
      );
      assert.equal(await requests[64], null);
      p.close();
      await Promise.all(requests);
      assert.equal((await privateRead(join(r.runtime, "token"))).length, 64);
    } finally {
      await server.close();
      await store.release();
      await rm(r.runtime, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "tmux argv and hook boundaries preserve hostile filenames without execution",
  { timeout: 30000 },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pv-inject-")));
    const store = new Store(root, join(root, "state"));
    await store.acquire();
    const r = await store.runtime();
    const tmux = new Tmux(await executable("tmux"), r.runtime, {
      PATH: process.env.PATH,
      HOME: root,
      TERM: "xterm-256color",
    });
    try {
      const workspace = join(root, "a ' \" $ ; # % { } [ ] #{pid}\nend");
      await mkdir(workspace);
      await tmux.configure("F12");
      await tmux.start(
        workspace,
        120,
        30,
        [
          process.execPath,
          "-e",
          "require('node:fs').writeFileSync(process.argv[1],JSON.stringify(process.cwd()));setInterval(()=>{},1000)",
          join(root, "cwd.json"),
        ],
        r.instance,
      );
      await until(async () =>
        readFile(join(root, "cwd.json"), "utf8").then(
          () => true,
          () => false,
        ),
      );
      assert.equal(
        JSON.parse(await readFile(join(root, "cwd.json"), "utf8")),
        workspace,
      );
      const output = join(root, "marker");
      const script = join(root, "helper ' \" $ ; # % { } [ ].mjs");
      await writeFile(
        script,
        "import {writeFileSync} from 'node:fs';writeFileSync(" +
          JSON.stringify(output) +
          ",JSON.stringify(process.argv.slice(2)));\n",
      );
      await tmux.command(
        "run-shell",
        "-b",
        helperCommand(process.execPath, script, r.runtime, "ide.open"),
      );
      await until(async () =>
        readFile(output, "utf8").then(
          () => true,
          () => false,
        ),
      );
      assert.deepEqual(JSON.parse(await readFile(output, "utf8")), [
        r.runtime,
        "ide.open",
      ]);
      assert.equal(
        await tmux.command("show-option", "-gv", "extended-keys"),
        "on",
      );
      assert.equal(
        await tmux.command("show-option", "-gv", "extended-keys-format"),
        "csi-u",
      );
      assert.equal(
        await tmux.command("show-option", "-gv", "allow-passthrough"),
        "off",
      );
      await tmux.bindings(process.execPath, script, "F12");
      assert.ok(
        (await tmux.command("list-keys", "-T", "prefix")).includes(
          "send-prefix",
        ),
      );
    } finally {
      await tmux.command("kill-server").catch(() => {});
      await store.release();
      await rm(r.runtime, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  },
);
