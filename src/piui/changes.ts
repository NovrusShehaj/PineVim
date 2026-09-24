import { spawn } from "node:child_process";

/** Bounded `git diff --numstat` summary. This is the worktree, not an agent claim. */
export interface WorktreeStat {
  files: number;
  plus: number;
  minus: number;
}

export function parseNumstat(text: string, limit = 20): WorktreeStat {
  let files = 0;
  let plus = 0;
  let minus = 0;
  for (const line of text.split("\n")) {
    if (files >= limit) break;
    const match = /^(\d+|-)\t(\d+|-)\t/.exec(line);
    if (!match) continue;
    files++;
    if (match[1] !== "-") plus += Number(match[1]);
    if (match[2] !== "-") minus += Number(match[2]);
  }
  return { files, plus, minus };
}

export function formatChangeSummary(
  toolFiles: number,
  worktree: WorktreeStat | null,
): string | null {
  const parts: string[] = [];
  if (toolFiles > 0) parts.push(`tools ${toolFiles} files`);
  if (worktree && worktree.files > 0)
    parts.push(
      `worktree ${worktree.files} files +${worktree.plus} -${worktree.minus}`,
    );
  return parts.length ? parts.join(" · ") : null;
}

/** Best-effort worktree stat. Failure returns null; the tool-path count still renders. */
export function worktreeNumstat(cwd: string): Promise<WorktreeStat | null> {
  return new Promise((resolve) => {
    const child = spawn("git", ["diff", "--numstat"], {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 2000);
    child.stdout.on("data", (buf: Buffer) => {
      if (out.length < 8192) out += buf.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(parseNumstat(out));
    });
  });
}
