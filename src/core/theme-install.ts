/**
 * Installs the PineVIM theme JSON assets into Pi's native user theme
 * directory (<agentDir>/themes/).
 *
 * Why this exists: Pi resolves the persisted theme name from settings during
 * startup, BEFORE extension resources_discover runs, so a theme picked via
 * /settings → Theme would fail with "Theme not found" on the next launch if
 * the file only existed in the extension's discovery payload. Pi's native
 * themes directory is loaded unconditionally at startup, so installing there
 * makes every PineVIM theme resolvable in every Pi mode and launch path.
 * resources_discover stays wired (it covers fresh checkouts before the
 * controller's first launch pass and non-controller extension usage).
 *
 * Idempotent and content-checked: files are (re)written only when missing or
 * stale, so concurrent controllers and repeated starts are cheap no-ops.
 *
 * The agent directory is resolved locally instead of importing Pi's library:
 * the import alone cost ~320 ms of module-graph time on every launch
 * (measured 2026-09-25), which dominated the launch-to-bridge budget. The
 * resolution mirrors Pi 0.87.1's getAgentDir() exactly — PI_CODING_AGENT_DIR
 * (tilde-expanded) wins, else <homedir>/<configDir>/agent where configDir
 * comes from Pi's package.json piConfig block (default ".pi") — and
 * tests/unit/core.test.ts pins both implementations to agreement so a Pi
 * change fails CI instead of silently writing themes to the wrong directory.
 */
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { themeDirectory } from "../piui/theme.js";

const PI_PACKAGE = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../node_modules/@earendil-works/pi-coding-agent/package.json",
);

/**
 * Mirror of Pi 0.87.1's getAgentDir(). Deliberately uncached: it runs once
 * per launch, and the parity test in tests/unit/core.test.ts mutates the
 * environment, which a cache would silently ignore.
 */
export async function piAgentDir(): Promise<string> {
  const env = process.env.PI_CODING_AGENT_DIR;
  if (env) {
    return env.startsWith("~/")
      ? join(homedir(), env.slice(2))
      : env === "~"
        ? homedir()
        : env;
  }
  let configDir = ".pi";
  try {
    const pkg = JSON.parse(await readFile(PI_PACKAGE, "utf8")) as {
      piConfig?: { configDir?: string };
    };
    if (pkg.piConfig?.configDir) configDir = pkg.piConfig.configDir;
  } catch {
    // Unreadable package metadata falls back to Pi's documented default.
  }
  return join(homedir(), configDir, "agent");
}

/**
 * Copy every bundled PineVIM theme into Pi's user themes dir.
 * Returns the destination directory (for logging/diagnostics).
 * Failures are swallowed: theme installation is an optimization — the
 * resources_discover path still works, and the controller must not refuse to
 * start over a themes-dir permission problem.
 */
export async function installThemesToPi(): Promise<string | null> {
  try {
    const destDir = join(await piAgentDir(), "themes");
    await mkdir(destDir, { recursive: true });
    const srcDir = themeDirectory();
    if (!isAbsolute(srcDir)) return null;
    const files = (await readdir(srcDir)).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const src = join(srcDir, file);
      const dest = join(destDir, file);
      // Content check keeps this a no-op on repeat starts and heals stale
      // copies from older PineVIM versions.
      const [a, b] = await Promise.all([
        readFile(src),
        readFile(dest).catch(() => null),
      ]);
      if (b && a.equals(b)) continue;
      await copyFile(src, dest);
    }
    return destDir;
  } catch {
    return null; // degraded gracefully; discovery still covers the session
  }
}
