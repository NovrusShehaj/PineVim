/**
 * Interactive preview: renders the PineVIM pine at several trunk-shade
 * factors side by side so the two-tone balance can be chosen by eye before
 * pinning PINE_TRUNK_FACTOR (or a PINE_TRUNK_FACTOR_OVERRIDES entry) in
 * src/piui/logo.ts.
 *
 * Usage:
 *   node scripts/pine-preview.mjs [accentHex] [--light]
 *   node scripts/pine-preview.mjs                    # #3dffa0 (neon)
 *   node scripts/pine-preview.mjs "#0c8f43" --light  # snow: factors above 1
 *
 * --light previews lift factors (1.1 .. 1.6) for light-background themes;
 * without it, the preview covers the default dark-theme range. If the accent
 * matches a shipped theme, that theme's resolved factor is marked "(current)".
 *
 * Imports the built dist module (and dist theme JSONs) so the preview always
 * matches the shipped art; requires a truecolor terminal (same constraint as
 * the themes).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PINE_TREE,
  PINE_CROWN_LINES,
  PINE_TRUNK_FACTOR,
  trunkFactorFor,
} from "../dist/piui/logo.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const themesDir = join(scriptDir, "../dist/piui/themes");

/** Map shipped theme name -> resolved accent hex, straight from dist JSONs. */
function themeAccents() {
  const accents = {};
  for (const file of readdirSync(themesDir).filter((f) =>
    f.endsWith(".json"),
  )) {
    const doc = JSON.parse(readFileSync(join(themesDir, file), "utf8"));
    const key = doc.colors?.accent;
    const hex = typeof key === "string" ? doc.vars?.[key] : undefined;
    if (typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex)) {
      accents[doc.name] = hex.toLowerCase().replace(/^#/, "");
    }
  }
  return accents;
}

const args = process.argv.slice(2);
const light = args.includes("--light");
const accentArg = args.find((a) => a !== "--light") ?? "#3dffa0";
const m = /^#?([0-9a-f]{6})$/i.exec(accentArg.trim());
if (!m) {
  console.error(
    `usage: node scripts/pine-preview.mjs [#rrggbb] [--light]  (got "${accentArg}")`,
  );
  process.exit(1);
}
const hex = m[1].toLowerCase();

// Current factor: the matching theme's override if the accent belongs to a
// shipped theme, otherwise the global dark-theme default.
const owner = Object.entries(themeAccents()).find(([, a]) => a === hex)?.[0];
const currentFactor = trunkFactorFor(owner);

const FACTORS = light
  ? [1.1, 1.2, 1.35, 1.5, 1.6]
  : [0.8, 0.72, 0.68, 0.6, 0.5];
const W = 21; // PINE_TREE_WIDTH
const GAP = 3;

const fg = (r, g, b, s) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
const accent = (s) => fg(...rgb, s);
const shade = (s, factor) =>
  fg(...rgb.map((v) => Math.min(255, Math.round(v * factor))), s);

for (let row = 0; row < PINE_TREE.length; row++) {
  const line = FACTORS.map((f) => {
    const cell = PINE_TREE[row].padEnd(W);
    return row < PINE_CROWN_LINES ? accent(cell) : shade(cell, f);
  });
  console.log(line.join(" ".repeat(GAP)));
}

console.log();
console.log(
  FACTORS.map((f) => `${f}${f === currentFactor ? " (current)" : ""}`)
    .map((l) => l.padEnd(W))
    .join(" ".repeat(GAP))
    .trimEnd(),
);
const where =
  currentFactor === PINE_TRUNK_FACTOR
    ? "PINE_TRUNK_FACTOR in src/piui/logo.ts"
    : `PINE_TRUNK_FACTOR_OVERRIDES["${owner}"] in src/piui/logo.ts`;
console.log(
  `\n  accent #${hex}${owner ? ` (${owner})` : ""}${light ? " — light range: trunk lifts" : ""} — pick a column, then set ${where}\n`,
);
