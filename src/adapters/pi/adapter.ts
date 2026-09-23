import { readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executable } from "../../config.js";
import { PineError } from "../../diagnostics.js";
import { SUPPORTED_PI } from "./compatibility.js";
export const extensionPath = fileURLToPath(
  new URL("./extension.js", import.meta.url),
);
export async function piExecutable(
  path: string,
): Promise<{ path: string; version: string }> {
  const resolved = await executable(path);
  let dir = dirname(await realpath(resolved));
  for (let i = 0; i < 6; i++) {
    try {
      const p = JSON.parse(
        await readFile(join(dir, "package.json"), "utf8"),
      ) as { name?: string; version?: string };
      if (p.name === "@earendil-works/pi-coding-agent") {
        if (p.version !== SUPPORTED_PI)
          throw new PineError(
            "COMPATIBILITY",
            `Unsupported Pi version. PineVim currently validates Pi ${SUPPORTED_PI}; install/select that version explicitly or validate the new release before expanding compatibility.`,
          );
        return { path: resolved, version: p.version };
      }
    } catch (e) {
      if (e instanceof PineError) throw e;
    }
    dir = dirname(dir);
  }
  throw new PineError(
    "COMPATIBILITY",
    "Cannot identify the configured Pi executable from package metadata. Select the installed @earendil-works/pi-coding-agent CLI.",
  );
}
export function piCommand(path: string, session?: string | "picker"): string[] {
  return [
    path,
    "--extension",
    extensionPath,
    ...(session === "picker"
      ? ["--resume"]
      : session
        ? ["--session", session]
        : []),
  ];
}
