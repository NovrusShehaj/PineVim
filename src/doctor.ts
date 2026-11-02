/**
 * `pinevim doctor` — layered readiness report.
 *
 * Diagnoses the environment PineVim depends on without starting a workspace:
 * platform and Node, config validity, dependency versions and their required
 * minimums, terminfo, XDG directory writability, and any stale state or lock
 * for the requested workspace.
 *
 * Every check returns a finding rather than throwing. A doctor that crashes on
 * the first missing dependency would be useless precisely when it is needed
 * most, so failures are collected and reported together.
 */
import {
  access,
  constants,
  readFile,
  realpath,
  stat,
  writeFile,
  unlink,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { PineError } from "./diagnostics.js";
import { xdg, loadConfig, executable } from "./config.js";
import { SUPPORTED_PI } from "./adapters/pi/compatibility.js";
import { run } from "./process.js";

export type Severity = "ok" | "warn" | "fail";

/** One diagnostic line: a label, a verdict, and what to do about it. */
export interface Finding {
  /** Short label, e.g. "tmux version". */
  label: string;
  status: Severity;
  /** What was found, or why the check could not run. */
  detail: string;
  /** Actionable next step. Present for warn/fail. */
  remedy?: string;
}

/** A named group of related checks. */
export interface Check {
  name: string;
  findings: Finding[];
}

export interface DoctorReport {
  checks: Check[];
  /** Counts across every finding, for the summary line. */
  totals: { ok: number; warn: number; fail: number };
}

function ok(label: string, detail: string): Finding {
  return { label, status: "ok", detail };
}
function warn(label: string, detail: string, remedy: string): Finding {
  return { label, status: "warn", detail, remedy };
}
function fail(label: string, detail: string, remedy: string): Finding {
  return { label, status: "fail", detail, remedy };
}

/** Compare a dotted version against a minimum. Returns true when >= minimum. */
export function satisfiesVersion(actual: string, minimum: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^[^0-9]*/, "")
      .split(".")
      .map((n) => Number.parseInt(n, 10))
      .map((n) => (Number.isFinite(n) ? n : 0));
  const a = parse(actual);
  const b = parse(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

/** Run a check, converting a throw into a failing finding. */
async function attempt(
  label: string,
  remedy: string,
  fn: () => Promise<Finding>,
): Promise<Finding> {
  try {
    return await fn();
  } catch (error) {
    const detail =
      error instanceof PineError ? error.message : String(error).slice(0, 160);
    return fail(label, detail, remedy);
  }
}

// --- Individual check groups ---------------------------------------------

/** Platform and Node runtime. */
export function environmentChecks(): Check {
  const findings: Finding[] = [];
  const platform = process.platform;
  findings.push(
    platform === "darwin" || platform === "linux"
      ? ok("platform", platform)
      : fail(
          "platform",
          platform,
          "PineVim supports macOS and Linux; native Windows is out of MVP scope.",
        ),
  );
  const node = process.versions.node;
  findings.push(
    satisfiesVersion(node, "22.19.0")
      ? ok("node", node)
      : fail(
          "node",
          node,
          "PineVim requires Node >=22.19.0. Upgrade Node and reinstall.",
        ),
  );
  const term = process.env.TERM;
  findings.push(
    !term || term === "dumb"
      ? warn(
          "terminal",
          term || "TERM is unset",
          "Set TERM to an interactive value; PineVim refuses to start on a dumb terminal.",
        )
      : ok("terminal", term),
  );
  return { name: "environment", findings };
}

/** Configuration file: presence, parse result, and the effective settings. */
export function configChecks(config: {
  prefix: string;
  logLevel: string;
  ui: { theme: string; glyphs: string; enabled: boolean };
}): Check {
  return {
    name: "configuration",
    findings: [
      ok("prefix", config.prefix),
      ok("log level", config.logLevel),
      ok("ui theme", config.ui.theme),
      ok("glyphs", config.ui.glyphs),
      ok("in-pane ui", config.ui.enabled ? "enabled" : "disabled"),
    ],
  };
}

/** Dependency binaries: on PATH, and at a supported version. */
export async function dependencyChecks(config: {
  pi: string;
  nvim: string;
  tmux: string;
}): Promise<Check> {
  const findings: Finding[] = [];

  findings.push(
    await attempt(
      "pi",
      "Install the Pi CLI or set an absolute path in config.",
      async () => {
        // Resolve through the shared resolver so a missing binary produces the
        // same user-facing copy as startup, not a raw fs error.
        const resolved = await executable(config.pi);
        const version = await packageVersionNear(resolved, "pi");
        if (!version)
          return warn(
            "pi",
            "installed, but its version could not be read",
            "Select the @earendil-works/pi-coding-agent CLI; PineVim reads the version from its package.json.",
          );
        return version === SUPPORTED_PI
          ? ok("pi", version)
          : fail(
              "pi",
              version,
              `PineVim validates Pi ${SUPPORTED_PI}. Install or select that version explicitly.`,
            );
      },
    ),
  );

  findings.push(
    await attempt(
      "nvim",
      "Install Neovim or set an absolute path in config.",
      async () => {
        const resolved = await executable(config.nvim);
        const out = await run(resolved, ["--version"], { timeout: 5000 });
        const first = out.split("\n")[0] ?? "";
        return first
          ? ok("nvim", first.replace(/^NVIM\s+/, "").slice(0, 40))
          : warn(
              "nvim",
              "version unreadable",
              "Check that the nvim path is correct.",
            );
      },
    ),
  );

  findings.push(
    await attempt(
      "tmux",
      "Install tmux >=3.5 or set an absolute path in config.",
      async () => {
        const resolved = await executable(config.tmux);
        const out = await run(resolved, ["-V"], { timeout: 5000 });
        const version = out.trim();
        return satisfiesVersion(version, "3.5")
          ? ok("tmux", version)
          : fail(
              "tmux",
              version,
              "PineVim requires tmux >=3.5 for CSI-u key forwarding.",
            );
      },
    ),
  );

  return { name: "dependencies", findings };
}

/**
 * Read the version from a package.json within a few directories above an
 * executable, the same discovery `piExecutable` uses.
 */
async function packageVersionNear(
  binary: string,
  name: string,
): Promise<string | null> {
  let dir = dirname(await realpath(binary));
  for (let i = 0; i < 6; i++) {
    try {
      const parsed = JSON.parse(
        await readFile(join(dir, "package.json"), "utf8"),
      ) as { name?: string; bin?: Record<string, string>; version?: string };
      if (parsed.name === name && parsed.version) return parsed.version;
    } catch {
      /* keep walking up */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Terminal capability: terminfo entries PineVim's themes depend on. */
export function terminfoChecks(): Check {
  const findings: Finding[] = [];
  for (const entry of ["tmux-256color", "screen-256color"]) {
    findings.push(
      hasTerminfo(entry)
        ? ok(`terminfo ${entry}`, "available")
        : warn(
            `terminfo ${entry}`,
            "not found",
            "Install ncurses-terminfo for truecolor terminal support.",
          ),
    );
  }
  const colorterm = process.env.COLORTERM ?? "";
  findings.push(
    colorterm === "truecolor" || colorterm === "24bit"
      ? ok("COLORTERM", colorterm)
      : warn(
          "COLORTERM",
          colorterm || "unset",
          "Set COLORTERM=truecolor for full PineVim theme fidelity.",
        ),
  );
  return { name: "terminal", findings };
}

/** Synchronous terminfo presence check via `infocmp`, if available. */
function hasTerminfo(name: string): boolean {
  try {
    execFileSync("infocmp", ["-1", name], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 2000,
    });
    return true;
  } catch {
    return false;
  }
}

/** XDG directories PineVim reads or writes, and whether they are usable. */
export async function directoryChecks(): Promise<Check> {
  const findings: Finding[] = [];
  const dirs: [string, string][] = [
    ["XDG_CONFIG_HOME", ".config"],
    ["XDG_STATE_HOME", ".local/state"],
  ];
  for (const [name, fallback] of dirs) {
    const dir = xdg(name, fallback);
    const writable = await isWritable(dir);
    findings.push(
      writable
        ? ok(name, dir)
        : fail(
            name,
            `${dir} is not writable`,
            `Create ${dir} or unset ${name} to use the default location.`,
          ),
    );
  }
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (runtime) {
    const usable = await isWritable(runtime);
    findings.push(
      usable
        ? ok("XDG_RUNTIME_DIR", runtime)
        : warn(
            "XDG_RUNTIME_DIR",
            `${runtime} is not writable`,
            "PineVim falls back to the OS temporary directory.",
          ),
    );
  } else {
    findings.push(
      warn(
        "XDG_RUNTIME_DIR",
        "unset",
        "Set XDG_RUNTIME_DIR to keep PineVim sockets out of the shared temp directory.",
      ),
    );
  }
  return { name: "directories", findings };
}

/** Probe writability by creating and removing a uniquely named file. */
async function isWritable(dir: string): Promise<boolean> {
  const probe = join(dir, `.pinevim-doctor-${process.pid}-${Date.now()}`);
  try {
    await access(dir, constants.R_OK | constants.W_OK | constants.X_OK);
    await writeFile(probe, "", { flag: "wx", mode: 0o600 });
    await unlink(probe);
    return true;
  } catch {
    await unlink(probe).catch(() => {});
    return false;
  }
}

/**
 * Workspace state: whether the directory is usable and whether a previous run
 * left state or a lock behind. A stale lock is reported, never removed —
 * deleting it while a controller may still be alive is exactly the failure the
 * lock protocol guards against.
 */
export async function workspaceChecks(
  workspace: string,
  stateDir: string,
): Promise<Check> {
  const findings: Finding[] = [];
  findings.push(
    (await stat(workspace)
      .then((s) => s.isDirectory())
      .catch(() => false))
      ? ok("workspace", workspace)
      : fail(
          "workspace",
          `${workspace} is not a readable directory`,
          "Pass an existing directory; PineVim does not create one.",
        ),
  );

  const writable = await isWritable(workspace);
  findings.push(
    writable
      ? ok("workspace writable", "yes")
      : fail(
          "workspace writable",
          "no",
          "PineVim writes session state in the workspace; check permissions.",
        ),
  );

  const lock = join(stateDir, "lock");
  const lockPresent = await stat(lock)
    .then(() => true)
    .catch(() => false);
  if (lockPresent)
    findings.push(
      warn(
        "workspace lock",
        "held",
        "Another controller may own this workspace. Use --resume in the same directory, or verify no PineVim is running before removing the lock by hand.",
      ),
    );
  else findings.push(ok("workspace lock", "clear"));

  const state = join(stateDir, "state.json");
  const statePresent = await stat(state)
    .then(() => true)
    .catch(() => false);
  findings.push(
    statePresent
      ? warn(
          "prior state",
          "state.json present",
          "A previous session exists. --resume reconnects it; deleting state.json discards recovery metadata.",
        )
      : ok("prior state", "none"),
  );

  return { name: "workspace", findings };
}

/**
 * Resolve the state directory a Store would use for `workspace`.
 * Mirrors `Store`'s key derivation so the doctor reports the exact directory
 * the controller will contend over.
 */
export function stateDirectoryFor(workspace: string): string {
  const base = join(xdg("XDG_STATE_HOME", ".local/state"), "pinevim");
  const key = createHash("sha256").update(workspace).digest("hex").slice(0, 24);
  return join(base, key);
}

/** Assemble a full report from already-collected checks. */
export function buildReport(checks: Check[]): DoctorReport {
  const totals = { ok: 0, warn: 0, fail: 0 };
  for (const check of checks)
    for (const f of check.findings) totals[f.status]++;
  return { checks, totals };
}

/**
 * Run every check group and return the assembled report.
 *
 * Never throws: a dependency that cannot be executed is reported as a failing
 * finding, which is the case a doctor most needs to explain.
 */
export async function runDoctor(workspace: string): Promise<DoctorReport> {
  const checks: Check[] = [environmentChecks(), terminfoChecks()];

  // Config is optional; a broken config must not abort the report, since
  // diagnosing the broken config is the reason the user is here.
  try {
    const config = await loadConfig();
    checks.push(configChecks(config));
    checks.push(await dependencyChecks(config));
  } catch (error) {
    const detail =
      error instanceof PineError ? error.message : String(error).slice(0, 200);
    checks.push({
      name: "configuration",
      findings: [
        fail(
          "config.json",
          detail,
          "Fix ${XDG_CONFIG_HOME:-~/.config}/pinevim/config.json; PineVim accepts only prefix, agentRatio, pi, nvim, tmux, logLevel, and ui.",
        ),
      ],
    });
  }

  checks.push(await directoryChecks());

  try {
    const canonical = await realpath(workspace);
    checks.push(await workspaceChecks(canonical, stateDirectoryFor(canonical)));
  } catch {
    checks.push(await workspaceChecks(workspace, stateDirectoryFor(workspace)));
  }

  return buildReport(checks);
}

/** ANSI-free plain-text rendering, so the report pipes cleanly. */
export function renderReport(report: DoctorReport): string {
  const lines: string[] = ["pinevim doctor", ""];
  for (const check of report.checks) {
    lines.push(check.name.toUpperCase());
    for (const f of check.findings) {
      const mark =
        f.status === "ok"
          ? "  ok  "
          : f.status === "warn"
            ? " warn "
            : " FAIL ";
      lines.push(`${mark} ${f.label.padEnd(20)} ${f.detail}`);
      if (f.remedy && f.status !== "ok") lines.push(`        -> ${f.remedy}`);
    }
    lines.push("");
  }
  const { ok: o, warn: w, fail: f } = report.totals;
  lines.push(
    `${o} ok, ${w} warning${w === 1 ? "" : "s"}, ${f} failure${f === 1 ? "" : "s"}`,
  );
  if (f > 0)
    lines.push("PineVim cannot start until the failures above are resolved.");
  else if (w > 0)
    lines.push("PineVim can start; review the warnings for degraded behavior.");
  else lines.push("PineVim is ready to start.");
  return lines.join("\n");
}

/** Process exit code: non-zero when any check failed. */
export function exitCode(report: DoctorReport): number {
  return report.totals.fail > 0 ? 1 : 0;
}
