/**
 * Regenerate the checked-in ANSI-free PineVIM header snapshots.
 *
 * This is intentionally explicit: normal tests only compare fixtures and
 * never rewrite them. Tests and this updater share header-snapshots.json; the
 * updater rejects missing, duplicate, or unmanifested header fixtures before
 * writing anything. Run `npm run snapshots:update` after reviewing a header
 * layout change, then inspect the fixture diff before keeping it.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { headerFactory } from "../dist/piui/components/header.js";
import { glyphs } from "../dist/piui/glyphs.js";
import { initialLifecycle } from "../dist/piui/lifecycle.js";

const ACCENT = "\x1b[38;2;61;255;160m";
const fixtureDir = fileURLToPath(
  new URL("../tests/fixtures/", import.meta.url),
);
const snapshotFields = new Set([
  "name",
  "file",
  "width",
  "rows",
  "mode",
  "workspace",
  "sessionName",
  "view",
  "focus",
]);

async function loadSnapshots() {
  const parsed = JSON.parse(
    await readFile(join(fixtureDir, "header-snapshots.json"), "utf8"),
  );
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Header snapshot manifest must be a non-empty array.");
  }
  const files = new Set();
  for (const [index, snapshot] of parsed.entries()) {
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error(`Header snapshot ${index} must be an object.`);
    }
    const unknownField = Object.keys(snapshot).find(
      (field) => !snapshotFields.has(field),
    );
    if (unknownField) {
      throw new Error(
        `Header snapshot ${index} has unknown field ${unknownField}.`,
      );
    }
    const {
      name,
      file,
      width,
      rows,
      mode,
      workspace,
      sessionName,
      view,
      focus,
    } = snapshot;
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      typeof file !== "string" ||
      !/^header-[a-z0-9-]+\.txt$/.test(file) ||
      !Number.isSafeInteger(width) ||
      width < 1 ||
      !Number.isSafeInteger(rows) ||
      rows < 1 ||
      !["unicode", "ascii"].includes(mode) ||
      typeof workspace !== "string" ||
      (sessionName !== null && typeof sessionName !== "string") ||
      (view !== undefined && !["CHAT", "IDE"].includes(view)) ||
      (focus !== undefined &&
        focus !== null &&
        !["agent", "editor"].includes(focus)) ||
      (focus !== undefined && focus !== null && view !== "IDE")
    ) {
      throw new Error(`Header snapshot ${index} has an invalid shape.`);
    }
    if (files.has(file)) {
      throw new Error(`Header snapshot manifest repeats ${file}.`);
    }
    files.add(file);
  }

  const expected = [...files].sort();
  const actual = (await readdir(fixtureDir))
    .filter((file) => /^header-.*\.txt$/.test(file))
    .sort();
  const missing = expected.filter((file) => !actual.includes(file));
  const extra = actual.filter((file) => !expected.includes(file));
  if (missing.length || extra.length) {
    throw new Error(
      `Header snapshot fixture list drift: missing [${missing.join(", ")}]; extra [${extra.join(", ")}].`,
    );
  }
  return parsed;
}

const snapshots = await loadSnapshots();

function render({
  width,
  rows,
  mode,
  workspace = "~/proj",
  sessionName = null,
  view = "CHAT",
  focus = null,
}) {
  const tui = { requestRender: () => {}, terminal: { rows } };
  const theme = {
    name: "pinevim-dark",
    fg: (role, value) =>
      role === "accent" ? `${ACCENT}${value}\x1b[0m` : value,
    bold: (value) => value,
    getFgAnsi: () => ACCENT,
  };
  const header = headerFactory(tui, theme, glyphs(mode), {
    workspace,
    sessionName,
    mode: view,
    ...(focus ? { focus } : {}),
    lifecycle: initialLifecycle(),
  });
  return `${header
    .render(width)
    .map((line) => stripTerminalSequences(line).trimEnd())
    .join("\n")}\n`;
}

for (const snapshot of snapshots) {
  const path = fileURLToPath(
    new URL(`../tests/fixtures/${snapshot.file}`, import.meta.url),
  );
  await writeFile(path, render(snapshot), "utf8");
  console.log(`updated ${relative(process.cwd(), path)}`);
}
