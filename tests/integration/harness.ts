import { realpath, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PineError } from "../../src/diagnostics.js";
import { Store } from "../../src/persistence.js";
import { defaults, executable } from "../../src/config.js";
import { shellQuote } from "../../src/adapters/tmux/config.js";
import { Tmux } from "../../src/adapters/tmux/client.js";
import { AppController, newMetadata } from "../../src/core/controller.js";
import { randomUUID } from "node:crypto";

/**
 * The harness spawns the real Pi CLI with PineVim's compiled extension.
 * When the suites run under tsx (or any TS-on-the-fly loader), the adapter's
 * `import.meta.url`-relative extension path resolves next to the TypeScript
 * source, where no extension.js exists: Pi then dies at spawn and every test
 * fails with a misleading `LAYOUT did not converge`. Fail fast with the
 * actual remedy instead (audit finding F-07).
 */
async function assertRunnableLoader(): Promise<void> {
  const extension = fileURLToPath(
    new URL("../../src/adapters/pi/extension.js", import.meta.url),
  );
  const missing = await access(extension).then(
    () => false,
    () => true,
  );
  if (!missing) return;
  const compiled = resolve("build/tests/integration/fault.test.js");
  throw new PineError(
    "LOADER",
    `PineVim's compiled Pi extension is missing at ${extension}. ` +
      `The integration suites are running under a TypeScript loader, so Pi ` +
      `would die at spawn and every test would fail with misleading ` +
      `LAYOUT errors. Compile first, then run the compiled output: ` +
      `npm test, npm run test:integration, or ` +
      `npx tsc -p tsconfig.test.json && node --test ${compiled}. ` +
      `Never point Pi's --extension at TypeScript sources.`,
  );
}
export async function until(
  check: () => boolean | Promise<boolean>,
  timeout = 15000,
): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("Test condition deadline exceeded");
}
export async function harness(columns = 120, rows = 30, provider = false) {
  await assertRunnableLoader();
  const root = await realpath(await mkdtemp(join(tmpdir(), "pv-test-")));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    LANG: "en_US.UTF-8",
    HOME: root,
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_SKIP_VERSION_CHECK: "1",
    TERM: "xterm-256color",
    PINEVIM: "1",
  };
  await mkdir(env.PI_CODING_AGENT_DIR!);
  await writeFile(
    join(env.PI_CODING_AGENT_DIR!, "settings.json"),
    JSON.stringify({
      quietStartup: true,
      packages: [],
      skills: [],
      ...(provider
        ? {
            extensions: [resolve("tests/fixtures/provider.ts")],
            defaultProvider: "pine-fixture",
            defaultModel: "one",
          }
        : {}),
    }),
  );
  if (provider) {
    env.PINEVIM_FIXTURE_RECORD = join(root, "provider-events");
    await writeFile(
      join(env.PI_CODING_AGENT_DIR!, "keybindings.json"),
      JSON.stringify({ "app.model.select": [] }),
    );
  }
  const wrapper = join(root, "nvim-test");
  await writeFile(
    wrapper,
    "#!/bin/sh\nexec " +
      shellQuote(await executable("nvim")) +
      ' --clean -i NONE "$@"\n',
    { mode: 0o700 },
  );
  // Deep-copy the ui section: tests mutate per-controller policies and must
  // never write through to the shared defaults object.
  const config = {
    ...defaults,
    nvim: wrapper,
    ui: { ...defaults.ui, confirm: { ...defaults.ui.confirm } },
  };
  const store = new Store(workspace, join(root, "pine-state"));
  await store.acquire();
  const runtime = await store.runtime();
  env.PINEVIM_RUNTIME = runtime.runtime;
  const tmux = new Tmux(await executable("tmux"), runtime.runtime, env);
  const pi = resolve(
    "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
  );
  const metadata = newMetadata(
    workspace,
    workspace,
    runtime.runtime,
    runtime.instance,
    config,
    { columns, rows },
    { pi: "0.87.1", tmux: "3.7c", node: process.versions.node },
  );
  let controller = new AppController(config, store, tmux, metadata, pi);
  try {
    await controller.start();
    await until(() => controller.state.bridge);
  } catch (e) {
    await controller.detach().catch(() => {});
    await tmux.command("kill-server").catch(() => {});
    await rm(root, { recursive: true, force: true });
    throw e;
  }
  return {
    root,
    workspace,
    env,
    store,
    tmux,
    metadata,
    config,
    piPath: pi,
    get controller() {
      return controller;
    },
    async resume() {
      await controller.detach();
      await store.acquire();
      const m = (await store.load())!;
      m.state.epoch = randomUUID();
      m.state.generation = 0;
      controller = new AppController(config, store, tmux, m, pi);
      await controller.start(true);
      await until(() => controller.state.bridge);
      return controller;
    },
    async command(text: string) {
      await tmux.command(
        "send-keys",
        "-t",
        controller.state.agent!.pane,
        "-l",
        text,
      );
      await tmux.command(
        "send-keys",
        "-t",
        controller.state.agent!.pane,
        "Enter",
      );
    },
    async close() {
      await controller.detach().catch(() => {});
      await tmux.command("kill-server").catch(() => {});
      await rm(runtime.runtime, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    },
  };
}
