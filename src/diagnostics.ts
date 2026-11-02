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

/** Fixed next-action copy. No paths, tokens, or environment values. */
const NEXT_ACTION: Readonly<Record<string, string>> = {
  LAYOUT: "Previous view kept. Resize or prefix Tab.",
  DISCONNECTED: "Prefix still works. --resume if it persists.",
  AGENT: "Prefix r after confirmation.",
  EDITOR: "/ide starts a new editor. Unsaved buffers are not restored.",
  UI: "Stock Pi. Prefix unaffected.",
  THEME: "Session continues. /settings theme list may omit PineVim themes.",
  NODE: "Node >=22.19.0 is required.",
  COMPATIBILITY: "tmux >=3.5 is required.",
};

/** User-facing failure text. Known codes use the fixed sentence only. */
export function userFacing(error: unknown): string {
  if (error instanceof PineError) {
    const next = NEXT_ACTION[error.code];
    if (next) return next;
  }
  return safeError(error);
}

export function recoveryCopy(code: string): string {
  return NEXT_ACTION[code] ?? safeError(new Error("unknown"));
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

// --- Untrusted agent text -------------------------------------------------
//
// Agent-supplied strings (tool names, tool paths, workspace labels) reach the
// tmux control plane and the in-pane ledger. A crafted filename can carry
// C0 controls, a CSI escape, zero-width joiners, or a bidi override and
// visually rewrite a line that the user reads as PineVim chrome. `plain()`
// above is the ASCII-collapse used for tmux format strings; it is the wrong
// tool here because it also destroys legitimate non-ASCII paths.
//
// The sets below mirror Hermes' title sanitization (hermes_state_titles.py):
// strip what can lie about layout, keep what is merely non-ASCII.

/** C0/C1 controls, including ESC (0x1b) and DEL. */
// Matching control characters is the entire purpose here, so this rule is
// disabled for these two patterns only.
const UNTRUSTED_CONTROL =
  // eslint-disable-next-line no-control-regex
  /[\x00-\x1f\x7f-\x9f]/;
/** Zero-width, bidi embedding/override/isolate, and interlinear marks. */
const UNTRUSTED_INVISIBLE =
  /[\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff\ufffc\ufff9-\ufffb]/;

/**
 * Reduce agent-supplied text to something safe to render: printable
 * characters only, single-line, bounded. Visible non-ASCII is preserved so
 * real Unicode paths still read correctly.
 *
 * Newline, carriage return, and tab become a space before control stripping
 * so "a\nb" reads as "a b" rather than silently joining two words into "ab".
 * Every other control is dropped, since none of them can be represented in a
 * status line without altering its layout.
 */
export function sanitizeUntrusted(value: string, limit = 160): string {
  if (!value) return "";
  let out = "";
  for (const ch of value) {
    if (ch === "\n" || ch === "\r" || ch === "\t") {
      out += " ";
      continue;
    }
    if (UNTRUSTED_CONTROL.test(ch) || UNTRUSTED_INVISIBLE.test(ch)) continue;
    out += ch;
    if (out.length >= limit * 2) break;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, limit);
}

/**
 * Sanitize a list of agent strings, dropping empties and duplicates while
 * preserving order. Bound the count so a hostile run cannot grow the payload
 * the protocol has to carry.
 */
export function sanitizeUntrustedList(
  values: readonly string[],
  limit = 20,
  each = 180,
): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.size >= limit) break;
    const clean = sanitizeUntrusted(value, each);
    if (clean && !seen.has(clean)) seen.add(clean);
  }
  return [...seen];
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
