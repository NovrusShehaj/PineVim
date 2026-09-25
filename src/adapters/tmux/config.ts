import { PineError } from "../../diagnostics.js";
import { run } from "../../process.js";
export function shellQuote(value: string): string {
  if (value.includes("\0")) throw new Error("NUL in path");
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
export function tmuxQuote(value: string): string {
  return (
    '"' +
    value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\$/g, "\\$")
      .replace(/\n/g, "\\n") +
    '"'
  );
}
export function helperCommand(
  node: string,
  helper: string,
  runtime: string,
  action: string,
  nonce?: string,
): string {
  if (
    !/^(ide.open|chat|agent.toggle|focus.other|width.less|width.more|quit|retry|help|status|timeline|resize|layout|focus|death|detach|confirm-quit|confirm-retry|popup)$/.test(
      action,
    ) ||
    (nonce !== undefined && !/^[a-f0-9-]{36}$/.test(nonce))
  )
    throw new Error("Invalid helper action");
  // run-shell expands tmux formats before passing this fixed argv to /bin/sh.
  return [node, helper, runtime, action, ...(nonce ? [nonce] : [])]
    .map(shellQuote)
    .join(" ")
    .replace(/#/g, "##");
}
export async function terminfo(): Promise<string> {
  for (const term of ["tmux-256color", "screen-256color"]) {
    try {
      await run("infocmp", [term]);
      return term;
    } catch {
      /* try supported fallback */
    }
  }
  throw new PineError(
    "TERMINFO",
    "Install tmux-256color or screen-256color terminfo before starting PineVim.",
  );
}
export function tmuxConfig(prefix: string, terminal: string): string {
  return `set -g default-terminal ${terminal}\nset -g extended-keys on\nset -g extended-keys-format csi-u\nset -g remain-on-exit on\nset -g mouse on\nset -g allow-passthrough off\nset -g set-clipboard external\nset -g history-limit 10000\nset -g status on\nset -g status-position bottom\nset -g status-interval 0\nset -g status-left-length 250\nset -g status-right ''\nset -g status-format[0] '#{status-left}'\nset -g automatic-rename off\nset -g allow-rename off\nset -g set-titles off\nset -g exit-empty on\nset -g prefix ${prefix}\nset -g prefix2 None\nunbind -a -T prefix\n`;
}
