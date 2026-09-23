import { execFile } from "node:child_process";
import { PineError } from "./diagnostics.js";
export async function run(
  file: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        shell: false,
        encoding: "utf8",
        timeout: options.timeout ?? 5000,
        maxBuffer: 1024 * 1024,
        ...(options.env ? { env: options.env } : {}),
      },
      (error, stdout) => {
        if (error)
          reject(
            new PineError(
              "PROCESS",
              "Dependency command failed or timed out; children are preserved. Check the installed versions and use --resume.",
            ),
          );
        else resolve(stdout.trim());
      },
    );
  });
}
export function serverEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const clean = { ...env };
  delete clean.TMUX;
  delete clean.TMUX_PANE;
  return clean;
}
