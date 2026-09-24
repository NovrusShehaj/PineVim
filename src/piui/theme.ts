/**
 * PineVIM theme registration and application support.
 *
 * Themes are standard Pi theme JSON documents discovered via the
 * resources_discover event (themePaths). Application is non-persistent:
 * setTheme(themeInstance) affects only the running session (verified in
 * Pi 0.87.1 interactive-mode.js — a Theme *object* is not written to
 * settings.json, whereas a *name* is). The user's persistent choice wins
 * unless ui.theme is configured.
 */
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";

export const PINEVIM_THEMES = [
  "pinevim-dark",
  "pinevim-light",
  "pinevim-mono",
  "pinevim-neon",
  "pinevim-cyberpunk",
  "pinevim-forest",
  "pinevim-snow",
] as const;

export type PinevimThemeName = (typeof PINEVIM_THEMES)[number];

export function themeDirectory(): string {
  // dist/piui/theme.js -> dist/piui/themes/
  return join(fileURLToPath(new URL("./themes/", import.meta.url)));
}

export function themePaths(): string[] {
  return PINEVIM_THEMES.map((name) => join(themeDirectory(), `${name}.json`));
}

export function isPinevimThemeName(value: string): value is PinevimThemeName {
  return (PINEVIM_THEMES as readonly string[]).includes(value);
}

/**
 * Config-resolved theme name (plan §12, §30):
 * - ui.theme "auto" (default): follow the detected terminal scheme; the color
 *   variants (neon, forest) and mono are opt-in only — they are deliberate
 *   choices, not defaults.
 * - explicit pinevim-* name: apply exactly that.
 * - anything else falls back to auto (config validation rejects other values,
 *   so this branch guards hand-edited files and future-proofness).
 */
/**
 * Theme to apply when config is `auto`.
 * Null when the active theme is not Pi's built-in dark or light default.
 */
export function autoPinevimTheme(
  currentName: string | undefined,
): PinevimThemeName | null {
  if (currentName === "light") return "pinevim-light";
  if (currentName === undefined || currentName === "" || currentName === "dark")
    return "pinevim-dark";
  return null;
}

export function preferredThemeName(
  themeConfig: string | undefined,
  colorScheme: string | undefined,
): PinevimThemeName {
  if (themeConfig && isPinevimThemeName(themeConfig)) return themeConfig;
  return colorScheme === "light" ? "pinevim-light" : "pinevim-dark";
}

/**
 * Apply the PineVIM theme non-persistently. Never writes settings.json:
 * - resolves via ui.getTheme(name) (registered through resources_discover);
 * - prefers the user's already-active PineVIM theme if they picked one;
 * - passes the Theme object (not the name) to setTheme.
 * Returns false when the theme is unavailable — callers degrade silently.
 */
export function applyTheme(
  ui: {
    theme: Theme;
    getTheme: (name: string) => Theme | undefined;
    setTheme: (theme: string | Theme) => { success: boolean; error?: string };
  },
  name: PinevimThemeName,
): boolean {
  const current = ui.theme;
  if (current.name === name) return true; // user already chose it (or sticky)
  const instance = ui.getTheme(name);
  if (!instance) return false;
  return ui.setTheme(instance).success === true;
}
