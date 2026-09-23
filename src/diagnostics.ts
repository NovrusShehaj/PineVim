import { open, rename, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
export class PineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PineError";
  }
}
export function safeError(error: unknown): string {
  return error instanceof PineError
    ? error.message
    : "Operation failed; processes are preserved. Use --resume or inspect dependency availability.";
}
/** Single-line, bounded literal for tmux format strings. */
export function plain(value: string, limit = 160): string {
  return [...value]
    .map((c) => {
      const code = c.codePointAt(0)!;
      return code < 32 || code > 126 ? "?" : c;
    })
    .join("")
    .slice(0, limit);
}
export function literal(value: string, limit = 160): string {
  return plain(value, limit).replace(/#/g, "##");
}
export interface LogEvent {
  event: "startup" | "intent" | "failure" | "detach" | "handshake";
  operation?: number;
  duration?: number;
  code?: string;
}
export class Logger {
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private directory: string,
    private enabled: boolean,
  ) {}
  write(value: LogEvent): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        const file = join(this.directory, "controller.log");
        for (const candidate of [file, file + ".1", file + ".2", file + ".3"]) {
          const info = await lstat(candidate).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return null;
              throw error;
            },
          );
          if (
            info &&
            (!info.isFile() ||
              info.isSymbolicLink() ||
              info.uid !== process.getuid?.() ||
              (info.mode & 0o077) !== 0)
          )
            throw new PineError(
              "LOG",
              "Unsafe diagnostic file; refusing to write.",
            );
        }
        if (
          await lstat(file).then(
            (s) => s.size >= 5 * 1024 * 1024,
            () => false,
          )
        ) {
          await rename(file + ".2", file + ".3").catch(() => {});
          await rename(file + ".1", file + ".2").catch(() => {});
          await rename(file, file + ".1");
        }
        // Deliberately reconstruct the record: callers cannot smuggle exception/env fields.
        const handle = await open(
          file,
          constants.O_CREAT |
            constants.O_WRONLY |
            constants.O_APPEND |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await handle.writeFile(
            JSON.stringify({
              event: [
                "startup",
                "intent",
                "failure",
                "detach",
                "handshake",
              ].includes(value.event)
                ? value.event
                : "failure",
              operation: Number.isSafeInteger(value.operation)
                ? value.operation
                : undefined,
              duration: Number.isFinite(value.duration)
                ? value.duration
                : undefined,
              code: value.code?.match(/^[A-Z_]{1,40}$/)?.[0],
            }) + "\n",
          );
        } finally {
          await handle.close();
        }
      });
    return this.queue;
  }
}
