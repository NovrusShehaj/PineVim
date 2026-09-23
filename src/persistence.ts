import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { PineError } from "./diagnostics.js";
import { run } from "./process.js";
import { xdg } from "./config.js";
import type { State } from "./core/state.js";
export interface Metadata {
  version: 1;
  workspace: string;
  display: string;
  instance: string;
  runtime: string;
  session: string;
  window: string;
  state: State;
  versions: { pi: string; tmux: string; node: string };
  updated: number;
  clientPid: number | null;
}
export async function privatePath(
  path: string,
  kind: "file" | "directory",
): Promise<void> {
  const s = await lstat(path);
  if (
    s.isSymbolicLink() ||
    s.uid !== process.getuid?.() ||
    (s.mode & 0o077) !== 0 ||
    (kind === "file" ? !s.isFile() : !s.isDirectory())
  )
    throw new PineError(
      "PERMISSIONS",
      "Unsafe PineVim runtime/state ownership or permissions; expected user-owned 0700 directories and 0600 files without symlinks.",
    );
}
export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await privatePath(path, "directory");
  if ((await realpath(path)) !== path)
    throw new PineError(
      "PERMISSIONS",
      "PineVim state directories must not traverse symlinks.",
    );
}
export async function privateRead(path: string): Promise<string> {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await fd.stat();
    if (
      !s.isFile() ||
      s.uid !== process.getuid?.() ||
      s.mode & 0o077 ||
      s.size > 65536
    )
      throw new PineError(
        "METADATA",
        "Unsafe or oversized PineVim state file.",
      );
    return await fd.readFile("utf8");
  } finally {
    await fd.close();
  }
}
export async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = join(dirname(path), `.write-${randomUUID()}`);
  const fd = await open(temporary, "wx", 0o600);
  try {
    await fd.writeFile(JSON.stringify(value));
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(temporary, path);
}
export function validateMetadata(raw: unknown, workspace: string): Metadata {
  const fail = (): never => {
    throw new PineError(
      "METADATA",
      "Invalid recovery metadata; refusing to adopt or destroy processes.",
    );
  };
  if (!raw || typeof raw !== "object") return fail();
  const keys = (value: object, allowed: string[]): boolean =>
    Object.keys(value).every((key) => allowed.includes(key));
  if (
    !keys(raw, [
      "version",
      "workspace",
      "display",
      "instance",
      "runtime",
      "session",
      "window",
      "state",
      "versions",
      "updated",
      "clientPid",
    ])
  )
    return fail();
  const m = raw as Metadata;
  if (
    m.version !== 1 ||
    m.workspace !== workspace ||
    typeof m.display !== "string" ||
    typeof m.instance !== "string" ||
    !/^[a-f0-9]{32}$/.test(m.instance) ||
    typeof m.runtime !== "string" ||
    !isAbsolute(m.runtime) ||
    m.runtime.length > 90 ||
    !/^\$\d+$/.test(m.session) ||
    !/^@\d+$/.test(m.window)
  )
    return fail();
  const s = m.state;
  if (
    !s ||
    !keys(s, [
      "mode",
      "focus",
      "agent",
      "editor",
      "geometry",
      "ratio",
      "compact",
      "generation",
      "epoch",
      "bridge",
      "busy",
      "pending",
      "lifecycle",
      "sessionId",
      "sessionFile",
      "previousMode",
    ])
  )
    return fail();
  if (
    !s.geometry ||
    !keys(s.geometry, ["columns", "rows"]) ||
    !["running", "stopping", "detached", "stopped"].includes(s.lifecycle) ||
    !["CHAT_ONLY", "IDE_WITH_AGENT", "IDE_FOCUS"].includes(s.previousMode) ||
    typeof s.compact !== "boolean" ||
    typeof s.bridge !== "boolean" ||
    typeof s.busy !== "boolean" ||
    (s.pending !== null &&
      (!Number.isSafeInteger(s.pending) || s.pending < 0)) ||
    !Number.isSafeInteger(m.updated)
  )
    return fail();
  if (
    !s ||
    !["CHAT_ONLY", "IDE_WITH_AGENT", "IDE_FOCUS"].includes(s.mode) ||
    !["agent", "editor"].includes(s.focus) ||
    !s.geometry ||
    !Number.isSafeInteger(s.geometry.columns) ||
    s.geometry.columns < 1 ||
    s.geometry.columns > 10000 ||
    !Number.isSafeInteger(s.geometry.rows) ||
    s.geometry.rows < 1 ||
    s.geometry.rows > 10000 ||
    (s.ratio !== null &&
      (typeof s.ratio !== "number" || s.ratio < 0.1 || s.ratio > 0.9)) ||
    typeof s.epoch !== "string" ||
    !Number.isSafeInteger(s.generation) ||
    s.generation < 0
  )
    return fail();
  for (const c of [s.agent, s.editor])
    if (
      c !== null &&
      (!c ||
        !keys(c, ["pane", "pid", "alive", "ready", "exitCode", "signal"]) ||
        (c.exitCode !== null &&
          (!Number.isSafeInteger(c.exitCode) ||
            c.exitCode < 0 ||
            c.exitCode > 255)) ||
        (c.signal !== null &&
          (typeof c.signal !== "string" ||
            !/^[A-Z0-9]{1,16}$/.test(c.signal))) ||
        !/^%\d+$/.test(c.pane) ||
        !Number.isSafeInteger(c.pid) ||
        c.pid <= 0 ||
        typeof c.alive !== "boolean" ||
        typeof c.ready !== "boolean")
    )
      return fail();
  if (
    s.sessionId !== null &&
    (typeof s.sessionId !== "string" || s.sessionId.length > 256)
  )
    return fail();
  if (
    s.sessionFile !== null &&
    (typeof s.sessionFile !== "string" ||
      !isAbsolute(s.sessionFile) ||
      s.sessionFile.length > 4096)
  )
    return fail();
  if (
    m.clientPid !== null &&
    (!Number.isSafeInteger(m.clientPid) || m.clientPid <= 0)
  )
    return fail();
  if (
    !m.versions ||
    !keys(m.versions, ["pi", "tmux", "node"]) ||
    typeof m.versions.pi !== "string" ||
    typeof m.versions.tmux !== "string" ||
    typeof m.versions.node !== "string" ||
    Object.values(m.versions).some(
      (v) => v.length > 40 || !/^[a-zA-Z0-9. -]+$/.test(v),
    )
  )
    return fail();
  return m;
}
// Unknown OS state is treated as live. PID reuse may require manual recovery,
// but cannot authorize a second transcript writer or destruction of a process.
export async function processAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    return true;
  }
  const state = await run("/bin/ps", ["-p", String(pid), "-o", "stat="]).catch(
    () => "",
  );
  return !(
    /^Z/.test(state) ||
    (process.platform === "darwin" && state.includes("E"))
  );
}
export async function requireDeadChildren(metadata: Metadata): Promise<void> {
  for (const child of [metadata.state.agent, metadata.state.editor]) {
    if (child && (await processAlive(child.pid)))
      throw new PineError(
        "RECOVERY",
        "The private tmux transport is unavailable but a recorded child PID still exists. Restore the transport or inspect the surviving process before starting another Pi session.",
      );
  }
}
export class Store {
  readonly key: string;
  readonly directory: string;
  private lockNonce = randomUUID();
  private locked = false;
  constructor(
    readonly workspace: string,
    base = join(xdg("XDG_STATE_HOME", ".local/state"), "pinevim"),
  ) {
    this.key = createHash("sha256")
      .update(workspace)
      .digest("hex")
      .slice(0, 24);
    this.directory = join(base, this.key);
  }
  get metadataPath(): string {
    return join(this.directory, "state.json");
  }
  async acquire(): Promise<void> {
    await privateDirectory(dirname(this.directory));
    await privateDirectory(this.directory);
    const lock = join(this.directory, "lock");
    // Serialize recovery too. A crash while reclaiming is refused, never guessed away.
    const guard = join(this.directory, "acquire");
    try {
      await mkdir(guard, { mode: 0o700 });
    } catch {
      throw new PineError(
        "LOCK",
        "Workspace acquisition is in progress or was interrupted. Verify no PineVim controller remains before removing its acquire directory.",
      );
    }
    try {
      try {
        await mkdir(lock, { mode: 0o700 });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        await privatePath(lock, "directory");
        let owner: { pid: number; nonce: string };
        try {
          owner = JSON.parse(
            await privateRead(join(lock, "owner.json")),
          ) as typeof owner;
        } catch {
          throw new PineError(
            "LOCK",
            "Incomplete workspace lock. Verify no live controller before manual recovery.",
          );
        }
        if (
          !Number.isSafeInteger(owner.pid) ||
          owner.pid <= 0 ||
          typeof owner.nonce !== "string"
        )
          throw new PineError(
            "LOCK",
            "Invalid workspace lock; manual inspection required.",
          );
        if (await processAlive(owner.pid))
          throw new PineError(
            "LOCK",
            "A controller already owns this workspace. Return to its terminal; after it exits, use pinevim --resume.",
          );
        // OS-confirmed dead PID plus exclusive reclaim guard; pane identity still validated on resume.
        await unlink(join(lock, "owner.json"));
        const { rmdir } = await import("node:fs/promises");
        await rmdir(lock);
        await mkdir(lock, { mode: 0o700 });
      }
      await atomicWrite(join(lock, "owner.json"), {
        pid: process.pid,
        nonce: this.lockNonce,
      });
      this.locked = true;
    } finally {
      const { rmdir } = await import("node:fs/promises");
      await rmdir(guard);
    }
  }
  async release(): Promise<void> {
    if (!this.locked) return;
    const lock = join(this.directory, "lock");
    const owner = JSON.parse(await privateRead(join(lock, "owner.json"))) as {
      nonce: string;
    };
    if (owner.nonce !== this.lockNonce)
      throw new PineError("LOCK", "Lock ownership changed; refusing cleanup.");
    await unlink(join(lock, "owner.json"));
    const { rmdir } = await import("node:fs/promises");
    await rmdir(lock);
    this.locked = false;
  }
  async load(): Promise<Metadata | null> {
    try {
      return validateMetadata(
        JSON.parse(await privateRead(this.metadataPath)),
        this.workspace,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async save(m: Metadata): Promise<void> {
    validateMetadata(m, this.workspace);
    await atomicWrite(this.metadataPath, m);
  }
  async runtime(): Promise<{ runtime: string; instance: string }> {
    let base = await realpath(tmpdir());
    if (process.env.XDG_RUNTIME_DIR) {
      await privatePath(process.env.XDG_RUNTIME_DIR, "directory");
      base = await realpath(process.env.XDG_RUNTIME_DIR);
    }
    // macOS temp paths can be long; verified /tmp parent is not itself used for secrets.
    if (base.length > 55) base = await realpath("/tmp");
    const runtime = await mkdtemp(join(base, "pv-"));
    await privatePath(runtime, "directory");
    const instance = randomBytes(16).toString("hex");
    await atomicWrite(join(runtime, "identity.json"), {
      instance,
      workspace: this.workspace,
    });
    const token = await open(join(runtime, "token"), "wx", 0o600);
    try {
      await token.writeFile(randomBytes(32).toString("hex"));
    } finally {
      await token.close();
    }
    return { runtime, instance };
  }
  async validateRuntime(m: Metadata): Promise<void> {
    await privatePath(m.runtime, "directory");
    if ((await realpath(m.runtime)) !== m.runtime)
      throw new PineError("IDENTITY", "Recovery runtime traverses a symlink.");
    const identity = JSON.parse(
      await privateRead(join(m.runtime, "identity.json")),
    ) as { instance: string; workspace: string };
    if (
      identity.instance !== m.instance ||
      identity.workspace !== this.workspace
    )
      throw new PineError("IDENTITY", "Recovery instance/workspace mismatch.");
  }
}
