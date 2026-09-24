import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface SkillRecord {
  name: string;
  description: string;
  body: string;
  status: "proposal" | "active" | "disabled";
}

export function skillsRoot(home = homedir()): string {
  const base = process.env.XDG_DATA_HOME;
  const root =
    base && base.startsWith("/") ? base : join(home, ".local", "share");
  return join(root, "pinevim", "skills");
}

export function validateSkill(skill: {
  name: string;
  description: string;
  body: string;
}): string | null {
  if (!/^[a-z0-9-]{1,64}$/.test(skill.name))
    return "Skill name must be lowercase letters, numbers, and hyphens.";
  if (skill.description.length === 0 || skill.description.length > 1024)
    return "Skill description must be 1–1024 characters.";
  if (skill.body.includes("```") && /```[a-z]*\n#!/.test(skill.body))
    return "Generated skills are instructions only.";
  return null;
}

export function draftFromTools(names: string[]): SkillRecord | null {
  const counts = new Map<string, number>();
  for (const name of names) {
    const key = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] < 2) return null;
  const name = `repeat-${top[0]}`.slice(0, 64);
  const description = `Repeat the ${top[0]} steps from a previous PineVim run.`;
  const body = [
    `# ${name}`,
    "",
    description,
    "",
    "Follow the same tool order the user already ran. Do not invent extra commands.",
    "",
    `Tools seen: ${names.slice(0, 12).join(", ")}`,
    "",
  ].join("\n");
  const skill: SkillRecord = {
    name,
    description,
    body,
    status: "proposal",
  };
  return validateSkill(skill) ? null : skill;
}

async function readRegistry(dir: string): Promise<SkillRecord[]> {
  try {
    const raw = await readFile(join(dir, "registry.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SkillRecord =>
        !!item &&
        typeof item === "object" &&
        typeof (item as SkillRecord).name === "string",
    );
  } catch {
    return [];
  }
}

export async function listSkills(dir = skillsRoot()): Promise<SkillRecord[]> {
  return readRegistry(dir);
}

export async function saveProposal(
  skill: SkillRecord,
  dir = skillsRoot(),
): Promise<void> {
  const problem = validateSkill(skill);
  if (problem) throw new Error(problem);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const all = await readRegistry(dir);
  const next = all.filter((item) => item.name !== skill.name);
  next.push({ ...skill, status: "proposal" });
  await writeFile(join(dir, "registry.json"), JSON.stringify(next), {
    mode: 0o600,
  });
}

export async function setSkillStatus(
  name: string,
  status: "active" | "disabled",
  dir = skillsRoot(),
): Promise<string | null> {
  const all = await readRegistry(dir);
  const skill = all.find((item) => item.name === name);
  if (!skill) return "No skill with that name.";
  skill.status = status;
  if (status === "active") {
    const problem = validateSkill(skill);
    if (problem) return problem;
    await mkdir(join(dir, name), { recursive: true, mode: 0o700 });
    const doc = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.body}\n`;
    await writeFile(join(dir, name, "SKILL.md"), doc, { mode: 0o600 });
  }
  await writeFile(join(dir, "registry.json"), JSON.stringify(all), {
    mode: 0o600,
  });
  return null;
}
