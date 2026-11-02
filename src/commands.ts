/**
 * PineVIM command registry.
 *
 * Single source of truth for every user-facing command: the slash-command
 * parser (`src/adapters/pi/extension.ts`), the in-session help panel, and the
 * generated shell completions (`pinevim completions <shell>`) all read from
 * here. A command therefore cannot ship in the parser and be missing from
 * completions, which is the drift omp avoids by generating from live
 * metadata.
 */
import type { Intent } from "./core/state.js";

/** One `/pinevim` subcommand and the controller intent it triggers. */
export interface SlashCommand {
  /** Subcommand path after `/pinevim`; "" is the bare command. */
  name: string;
  /** Short help text, shown verbatim in completions. */
  description: string;
  intent: Intent;
  /** Handles `/ide` too, not just `/pinevim`. */
  ide: boolean;
}

/**
 * Ordered so completions and help read top-down by frequency of use.
 * This table is the authority: `parseCommand` dispatches through it and
 * unknown input is rejected against it.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: "ide",
    description: "open Neovim in the workspace",
    intent: "ide.open",
    ide: true,
  },
  {
    name: "ide open",
    description: "open Neovim",
    intent: "ide.open",
    ide: true,
  },
  {
    name: "ide close",
    description: "hide the editor, keep it running",
    intent: "chat",
    ide: true,
  },
  {
    name: "agent hide",
    description: "show the editor full width",
    intent: "agent.hide",
    ide: false,
  },
  {
    name: "agent show",
    description: "reveal and focus the agent pane",
    intent: "agent.show",
    ide: false,
  },
  {
    name: "chat",
    description: "show the agent, keep the editor running",
    intent: "chat",
    ide: false,
  },
  {
    name: "status",
    description: "workspace and controller status",
    intent: "status",
    ide: false,
  },
  {
    name: "help",
    description: "key guide and controls",
    intent: "help",
    ide: false,
  },
  {
    name: "quit",
    description: "request the safe quit flow",
    intent: "quit",
    ide: false,
  },
  {
    name: "search",
    description: "search runs across sessions (FTS5)",
    intent: "search",
    ide: false,
  },
  {
    name: "insights",
    description: "cross-session run analytics",
    intent: "insights",
    ide: false,
  },
] as const;

/** Look up a `/pinevim` subcommand by its exact path. */
export function findSlashCommand(name: string): SlashCommand | undefined {
  return SLASH_COMMANDS.find((c) => c.name === name);
}

/** Every valid subcommand path, for help text and error copy. */
export function slashCommandNames(): string[] {
  return SLASH_COMMANDS.map((c) => c.name);
}

/** Fixed usage sentence. Generated from the registry so it cannot go stale. */
export const USAGE =
  "Use /ide [open|close], /pinevim " +
  SLASH_COMMANDS.filter((c) => !c.ide && c.name)
    .map((c) => c.name)
    .join(", ") +
  ".";

/** Alias kept for call sites that read better as `slashUsage()`. */
export const slashUsage = USAGE;
