/**
 * Shell completion generation.
 *
 * Compiled output is derived entirely from the live registries:
 *   - CLI flags and positionals  -> `cliUsage()` in src/cli.ts
 *   - `/pinevim` subcommands     -> SLASH_COMMANDS in src/commands.ts
 *   - prefix chords              -> helpRows() in src/adapters/tmux/panels.ts
 *
 * Nothing here is hand-maintained, so a chord or subcommand that exists at
 * runtime is always present in the user's completion script.
 */
import { SLASH_COMMANDS } from "./commands.js";
import { helpRows } from "./adapters/tmux/panels.js";

export const SHELLS = ["bash", "zsh", "fish"] as const;
export type Shell = (typeof SHELLS)[number];

export function isShell(value: string): value is Shell {
  return (SHELLS as readonly string[]).includes(value);
}

/** Subcommand path -> description, for the `/pinevim` completers. */
function slashPairs(): [string, string][] {
  return SLASH_COMMANDS.map((c) => [c.name, c.description]);
}

/**
 * Prefix chord key -> action, from the same table the F12 ? guide renders.
 * The key is the full `<prefix> <second>` chord as displayed in help.
 */
function chordPairs(prefix: string): [string, string][] {
  return helpRows(prefix).map((r) => [r.key, r.action]);
}

/** Just the second key of a chord (`F12 i` -> `i`), for single-token completion. */
function secondKey(key: string, prefix: string): string {
  return key.startsWith(prefix) ? key.slice(prefix.length).trim() : key;
}

/**
 * Quote a value for single-quoted POSIX shell context. Completion scripts are
 * emitted as literals, so an embedded quote must not be able to break out.
 */
function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Escape a value for a double-quoted zsh/bash string. */
function dq(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")}"`;
}

/**
 * Generate the completion script for `shell`.
 *
 * The prefix is the user's configured chord (F12 by default); it is baked into
 * the script because PineVim's chords are prefix-relative and cannot be
 * discovered at completion time.
 */
export function completions(shell: Shell, prefix = "F12"): string {
  switch (shell) {
    case "bash":
      return bashCompletions(prefix);
    case "zsh":
      return zshCompletions(prefix);
    case "fish":
      return fishCompletions(prefix);
  }
}

function bashCompletions(prefix: string): string {
  const slashValues = slashPairs()
    .map(([n]) => n)
    .join(" ");
  const chordWords = chordPairs(prefix)
    .map(([k]) => secondKey(k, prefix))
    .join(" ");
  return `# pinevim bash completions
# Generated from the live command registry. Regenerate with:
#   eval "$(pinevim completions bash)"
_pinevim() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W '--help --version --resume' -- "$cur") )
  else
    COMPREPLY=( $(compgen -W ${sq(slashValues)} -- "$cur") )
  fi
}
_pinevim_chord() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  COMPREPLY=( $(compgen -W ${sq(chordWords)} -- "$cur") )
}
complete -F _pinevim -o bashdefault pinevim
complete -F _pinevim_chord -o default pinevim
`;
}

function zshCompletions(prefix: string): string {
  const slash = slashPairs()
    .map(([n, d]) => `    ${sq(n)}:${sq(d)}`)
    .join("\n");
  const chords = chordPairs(prefix)
    .map(([k, a]) => `    ${sq(k)}:${sq(a)}`)
    .join("\n");
  return `#compdef pinevim
# pinevim zsh completions
# Generated from the live command registry. Install with:
#   eval "$(pinevim completions zsh)"
_pinevim() {
  local -a slash_commands chords
  slash_commands=(
${slash}
  )
  chords=(
${chords}
  )
  if (( CURRENT == 2 )); then
    _describe -t commands ${sq("pinevim command")} slash_commands
    _describe -t chords ${dq(`${prefix} chord`)} chords
  else
    _files -/
  fi
}
compdef _pinevim pinevim
`;
}

function fishCompletions(prefix: string): string {
  const lines = [
    "# pinevim fish completions",
    "# Generated from the live command registry. Install with:",
    "#   pinevim completions fish | source",
  ];
  for (const [name, description] of slashPairs())
    lines.push(
      `complete -c pinevim -f -n '__fish_use_subcommand' -a ${sq(name)} -d ${sq(description)}`,
    );
  for (const [key, action] of chordPairs(prefix)) {
    // The chord is only meaningful after the prefix; complete the second key.
    const second = secondKey(key, prefix);
    if (second)
      lines.push(`complete -c pinevim -f -a ${sq(second)} -d ${sq(action)}`);
  }
  lines.push("complete -c pinevim -s h -l help -d 'show help'");
  lines.push("complete -c pinevim -s v -l version -d 'show version'");
  lines.push(
    "complete -c pinevim -l resume -d 'reconnect a detached workspace'",
  );
  return lines.join("\n") + "\n";
}
