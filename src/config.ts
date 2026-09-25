import { access, readFile, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { PineError } from "./diagnostics.js";
export interface Config {
  prefix: string;
  agentRatio: number | null;
  pi: string;
  nvim: string;
  tmux: string;
  logLevel: "off" | "debug";
  /** PineVIM in-pane UI controls (plan §30). Absent fields keep defaults. */
  ui: UiConfig;
}
export type ConfirmPolicy = "ask" | "always" | "never";
export interface UiConfig {
  /** Master switch for the PineVIM frame inside the Pi pane. */
  enabled: boolean;
  /** Terminal-safe motion: animated working indicator vs static glyph. */
  motion: "on" | "off";
  /** Glyph vocabulary: Unicode with ASCII fallback per glyph. */
  glyphs: "unicode" | "ascii";
  /**
   * PineVIM theme (plan §12): "auto" follows the terminal color mode;
   * explicit pinevim-* names pin that theme. Applied non-persistently;
   * the user's Pi theme choice is only overridden while PineVIM runs.
   */
  theme:
    | "auto"
    | "pinevim-dark"
    | "pinevim-light"
    | "pinevim-mono"
    | "pinevim-neon"
    | "pinevim-cyberpunk"
    | "pinevim-forest"
    | "pinevim-snow";
  /**
   * Per-action confirmation policy for destructive or recovery actions
   * (plan H-04): "ask" prompts via tmux when a client is attached and
   * refuses with guidance headless; "always" refuses until the user
   * repeats the action; "never" proceeds without prompting, enabling
   * headless and scripted recovery.
   */
  confirm: { quit: ConfirmPolicy; retry: ConfirmPolicy };
}
export const defaults: Config = {
  prefix: "F12",
  agentRatio: null,
  pi: "pi",
  nvim: "nvim",
  tmux: "tmux",
  logLevel: "off",
  ui: {
    enabled: true,
    motion: "on",
    glyphs: "unicode",
    theme: "auto",
    confirm: { quit: "ask", retry: "ask" },
  },
};
export function xdg(name: string, fallback: string): string {
  const value = process.env[name];
  if (value && !isAbsolute(value))
    throw new PineError("CONFIG", `${name} must be an absolute directory.`);
  return value || join(homedir(), fallback);
}
export function validateConfig(input: unknown): Config {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new PineError("CONFIG", "PineVim config must be a JSON object.");
  const c = { ...defaults };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(defaults, key))
      throw new PineError(
        "CONFIG",
        "Unknown field in PineVim config; allowed: prefix, agentRatio, pi, nvim, tmux, logLevel, ui.",
      );
    switch (key) {
      case "prefix":
        if (
          typeof value !== "string" ||
          !/^(F(?:[1-9]|1[0-9]|2[0-4])|(?:C-|M-)?[a-z]|C-Space)$/.test(value)
        )
          throw new PineError(
            "CONFIG",
            "Invalid prefix; use F1–F24, a letter, C-letter, M-letter or C-Space.",
          );
        c.prefix = value;
        break;
      case "agentRatio":
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0.1 ||
          value > 0.9
        )
          throw new PineError(
            "CONFIG",
            "agentRatio must be between 0.1 and 0.9.",
          );
        c.agentRatio = value;
        break;
      case "pi":
      case "nvim":
      case "tmux":
        if (
          typeof value !== "string" ||
          !isAbsolute(value) ||
          /[\0\r\n]/.test(value)
        )
          throw new PineError(
            "CONFIG",
            `Field ${key} must be an absolute executable path.`,
          );
        c[key] = value;
        break;
      case "logLevel":
        if (value !== "off" && value !== "debug")
          throw new PineError("CONFIG", "logLevel must be off or debug.");
        c.logLevel = value;
        break;
      case "ui": {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new PineError("CONFIG", "ui must be an object.");
        const ui: UiConfig = {
          ...defaults.ui,
          confirm: { ...defaults.ui.confirm },
        };
        // defaults.ui is shared; give each parse its own copy so a partial
        // ui section cannot mutate the defaults object.
        ui.theme = "auto";
        for (const [key, item] of Object.entries(value)) {
          if (
            key !== "enabled" &&
            key !== "motion" &&
            key !== "glyphs" &&
            key !== "theme" &&
            key !== "confirm"
          )
            throw new PineError(
              "CONFIG",
              "Unknown field in ui config; allowed: enabled, motion, glyphs, theme.",
            );
          if (key === "enabled") {
            if (typeof item !== "boolean")
              throw new PineError("CONFIG", "ui.enabled must be a boolean.");
            ui.enabled = item;
          }
          if (key === "motion") {
            if (item !== "on" && item !== "off")
              throw new PineError("CONFIG", "ui.motion must be on or off.");
            ui.motion = item;
          }
          if (key === "glyphs") {
            if (item !== "unicode" && item !== "ascii")
              throw new PineError(
                "CONFIG",
                "ui.glyphs must be unicode or ascii.",
              );
            ui.glyphs = item;
          }
          if (key === "theme") {
            if (
              item !== "auto" &&
              item !== "pinevim-dark" &&
              item !== "pinevim-light" &&
              item !== "pinevim-mono" &&
              item !== "pinevim-neon" &&
              item !== "pinevim-cyberpunk" &&
              item !== "pinevim-forest" &&
              item !== "pinevim-snow"
            )
              throw new PineError(
                "CONFIG",
                "ui.theme must be auto or a pinevim theme (dark, light, mono, neon, cyberpunk, forest, snow).",
              );
            ui.theme = item;
          }
          if (key === "confirm") {
            if (!item || typeof item !== "object" || Array.isArray(item))
              throw new PineError("CONFIG", "ui.confirm must be an object.");
            for (const [action, policy] of Object.entries(item)) {
              if (action !== "quit" && action !== "retry")
                throw new PineError(
                  "CONFIG",
                  "Unknown field in ui.confirm; allowed: quit, retry.",
                );
              if (policy !== "ask" && policy !== "always" && policy !== "never")
                throw new PineError(
                  "CONFIG",
                  `ui.confirm.${action} must be ask, always or never.`,
                );
              ui.confirm[action] = policy;
            }
          }
        }
        c.ui = ui;
      }
    }
  }
  return c;
}
export async function loadConfig(): Promise<Config> {
  const file = join(
    xdg("XDG_CONFIG_HOME", ".config"),
    "pinevim",
    "config.json",
  );
  const raw = await readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return "{}";
    throw new PineError("CONFIG", "Cannot read PineVim config.json.");
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PineError(
      "CONFIG",
      "Invalid JSON in PineVim config.json; correct the syntax. Values are omitted for privacy.",
    );
  }
  const c = validateConfig(parsed);
  if (process.env.PINEVIM_LOG_LEVEL !== undefined)
    c.logLevel = validateConfig({
      logLevel: process.env.PINEVIM_LOG_LEVEL,
    }).logLevel;
  return c;
}
export async function workspacePath(
  input: string,
): Promise<{ canonical: string; display: string }> {
  const expanded =
    input === "~"
      ? homedir()
      : input.startsWith("~/")
        ? join(homedir(), input.slice(2))
        : input;
  try {
    const canonical = await realpath(resolve(expanded));
    if (!(await stat(canonical)).isDirectory()) throw new Error();
    await access(canonical, constants.R_OK | constants.X_OK);
    return { canonical, display: resolve(expanded) };
  } catch {
    throw new PineError(
      "WORKSPACE",
      "Workspace must be an existing accessible directory. PineVim does not create it or select the Git root.",
    );
  }
}
export async function executable(name: string): Promise<string> {
  const candidates = isAbsolute(name)
    ? [name]
    : (process.env.PATH ?? "")
        .split(":")
        .filter(Boolean)
        .map((p) => join(p, name));
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      if ((await stat(path)).isFile()) return await realpath(path);
    } catch {
      /* try next PATH entry */
    }
  }
  throw new PineError(
    "DEPENDENCY",
    `Required ${["pi", "nvim", "tmux"].includes(name) ? name : "configured executable"} is unavailable; install it or correct its absolute path in PineVim config.`,
  );
}
