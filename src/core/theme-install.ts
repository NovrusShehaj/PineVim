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
 */
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { themeDirectory } from "../piui/theme.js";

/**
 * Copy every bundled PineVIM theme into Pi's user themes dir.
 * Returns the destination directory (for logging/diagnostics).
 * Failures are swallowed: theme installation is an optimization — the
 * resources_discover path still works, and the controller must not refuse to
 * start over a themes-dir permission problem.
 */
export async function installThemesToPi(): Promise<string | null> {
  try {
    const destDir = join(getAgentDir(), "themes");
    await mkdir(destDir, { recursive: true });
    const srcDir = themeDirectory();
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
