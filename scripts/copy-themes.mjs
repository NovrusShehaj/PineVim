/**
 * Copy PineVIM theme JSON assets next to the compiled piui/theme.js.
 * tsc emits JS only; the themes are runtime assets discovered via
 * resources_discover -> themePaths (import.meta.url relative).
 *
 * Usage: node scripts/copy-themes.mjs <destDir>
 */
import { mkdir, copyFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dest = process.argv[2];
if (!dest) {
  console.error("usage: copy-themes.mjs <destDir>");
  process.exit(1);
}
const src = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "piui",
  "themes",
);
await mkdir(dest, { recursive: true });
const files = (await readdir(src)).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.error(`no theme JSON files found in ${src}`);
  process.exit(1);
}
for (const file of files) {
  await copyFile(join(src, file), join(dest, file));
}
console.log(`copied ${files.length} theme(s) to ${dest}`);
