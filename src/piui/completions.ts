/**
 * Slash-command argument completion for PineVIM commands (plan §28).
 *
 * Implementation uses Pi's native completion path: registerCommand accepts a
 * getArgumentCompletions callback, and extension commands are merged into the
 * built-in CombinedAutocompleteProvider (interactive-mode.js), which applies
 * items with prefix = the typed argument text. Wrapping the provider instead
 * proved unsafe: for a bare "/ide" (empty prefix) the editor inserts the item
 * at the cursor rather than replacing a token, corrupting input.
 *
 * Pure data + helpers; testable without a TUI.
 */
import type { AutocompleteItem } from "@earendil-works/pi-tui";

/** Static, PineVIM-authored suggestions (no user input is reflected). */
export const PINEVIM_COMPLETIONS: Record<string, AutocompleteItem[]> = {
  ide: [
    { value: "open", label: "open", description: "Open the editor view" },
    { value: "close", label: "close", description: "Return to chat view" },
  ],
  pinevim: [
    { value: "ide", label: "ide", description: "Open/close the editor view" },
    {
      value: "ide open",
      label: "ide open",
      description: "Open the editor view",
    },
    {
      value: "ide close",
      label: "ide close",
      description: "Return to chat view",
    },
    {
      value: "agent hide",
      label: "agent hide",
      description: "Hide the agent pane",
    },
    {
      value: "agent show",
      label: "agent show",
      description: "Show the agent pane",
    },
    { value: "chat", label: "chat", description: "Chat-only view" },
    { value: "status", label: "status", description: "Show workspace status" },
    { value: "help", label: "help", description: "Show PineVim keys" },
    { value: "quit", label: "quit", description: "Safe quit" },
    {
      value: "review",
      label: "review",
      description: "Show files from the last run",
    },
    {
      value: "learn",
      label: "learn",
      description: "Propose a skill from the last run",
    },
    { value: "skills", label: "skills", description: "List learned skills" },
  ],
};

/**
 * getArgumentCompletions callback for /ide: Pi passes the text after the
 * command's space; returned items replace exactly that argument text.
 *
 * Popup/submit contract (verified in pi-tui editor.js): while the popup is
 * open, Enter accepts the highlighted item and submits ONLY for command-name
 * completions (prefix starting with "/"); argument completions always swallow
 * the first Enter. Therefore completions are offered while the user is still
 * typing (discoverability) but suppressed once the argument is an exact,
 * complete subcommand — the popup closes and Enter submits directly. An empty
 * prefix is likewise inert (typing "/ide" + Enter must never be intercepted).
 */
export function ideArgumentCompletions(
  prefix: string,
): AutocompleteItem[] | null {
  return argumentCompletions(PINEVIM_COMPLETIONS.ide!, prefix);
}

/** getArgumentCompletions callback for /pinevim. */
export function pinevimArgumentCompletions(
  prefix: string,
): AutocompleteItem[] | null {
  return argumentCompletions(PINEVIM_COMPLETIONS.pinevim!, prefix);
}

function argumentCompletions(
  table: readonly AutocompleteItem[],
  prefix: string,
): AutocompleteItem[] | null {
  const t = prefix.trim().toLowerCase();
  if (t === "") return null;
  // Exact complete subcommand: yield the editor back so Enter submits.
  if (table.some((item) => item.value === t)) return null;
  const items = table.filter((item) => item.value.startsWith(t));
  return items.length > 0 ? items : null;
}
