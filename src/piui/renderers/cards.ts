/**
 * PineVIM tool card system (plan §9, §14, §15).
 *
 * Provides the unified card grammar and formatting primitives for tool calls
 * and results.
 *
 * Card anatomy (plan §9):
 *   <glyph> <tool> <primary-arg> [<secondary>] [<counts>] [<duration>]
 *
 * Single line when collapsed; expansion adds the output tail prefixed with the
 * rail glyph (`│` or `|` in ASCII).
 *
 * Responsive width bands (plan §15):
 * - >= 101 cols: full args + secondary + counts + duration
 * - 80–100 cols: full args + counts + duration
 * - 60–79 cols: truncated args, no counts
 * - < 60 cols: name + glyph only
 *
 * Pi 0.87.1 architecture boundary (documented per plan §14, §21):
 * In Pi 0.87.1, calling `pi.registerTool()` with a built-in tool name replaces
 * the entire tool definition in `AgentSession._toolRegistry`, including its
 * `execute()` implementation. Pi does not provide a presentation-only tool
 * renderer override hook (such as `registerToolRenderer`). Overriding built-ins
 * through `registerTool` would sever Pi's internal bash abort controllers,
 * trust management, file mutation queues, and session persistence. These
 * card primitives define the presentation contract and formatting engine
 * without compromising Pi's tool execution invariants.
 */
import { Container, Text, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { fit, type GlyphSet } from "../glyphs.js";
import { formatDuration } from "./turnSummary.js";

export type ToolCardState =
  | "running"
  | "success"
  | "warning"
  | "failure"
  | "interrupted"
  | "waiting";

export interface ToolCardInfo {
  tool: string;
  state: ToolCardState;
  primaryArg: string;
  secondaryArg?: string | null;
  counts?: string | null;
  durationSeconds?: number | null;
  /** Expanded preview lines (up to max visible lines per tool type). */
  previewLines?: string[];
  expanded?: boolean;
}

export type ThemeRole =
  | "accent"
  | "muted"
  | "success"
  | "warning"
  | "error"
  | "text"
  | "toolTitle"
  | "toolOutput";

/** Get the state glyph for a tool card state. */
export function toolStateGlyph(state: ToolCardState, g: GlyphSet): string {
  switch (state) {
    case "running":
      return g.running;
    case "success":
      return g.success;
    case "warning":
      return g.warning;
    case "failure":
      return g.failure;
    case "interrupted":
      return g.interrupted;
    case "waiting":
      return g.waiting;
  }
}

/** Theme role for styling the state glyph. */
export function toolStateRole(state: ToolCardState): ThemeRole {
  switch (state) {
    case "running":
      return "text";
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "failure":
      return "error";
    case "interrupted":
      return "warning";
    case "waiting":
      return "accent";
  }
}

/** Format diffstat summary: `+12 −3` or `+12 -3` (ASCII). */
export function formatDiffstat(
  added: number,
  removed: number,
  ascii = false,
): string {
  const minus = ascii ? "-" : "−";
  return `+${added} ${minus}${removed}`;
}

/**
 * Extract primary and optional secondary arguments from tool call arguments.
 */
export function extractToolArgs(
  toolName: string,
  args: Record<string, unknown> | undefined,
): { primary: string; secondary?: string | undefined } {
  if (!args || typeof args !== "object") return { primary: "" };

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  switch (toolName) {
    case "read": {
      const path = str(args.path ?? args.file_path);
      const offset = num(args.offset);
      const limit = num(args.limit);
      let secondary: string | undefined;
      if (offset !== null && limit !== null) {
        secondary = `lines ${offset}–${offset + limit - 1}`;
      } else if (offset !== null) {
        secondary = `from line ${offset}`;
      }
      return { primary: path, secondary };
    }

    case "edit": {
      const path = str(args.path ?? args.file_path);
      return { primary: path };
    }

    case "write": {
      const path = str(args.path ?? args.file_path);
      const content = typeof args.content === "string" ? args.content : "";
      const bytes = new TextEncoder().encode(content).length;
      const sizeStr = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
      return { primary: path, secondary: sizeStr };
    }

    case "bash":
    case "powershell": {
      const cmd = str(args.command ?? args.cmd);
      return { primary: cmd.replace(/\s+/g, " ") };
    }

    case "grep": {
      const pattern = str(args.pattern ?? args.query);
      const path = str(args.path);
      const quoted = pattern ? `"${pattern}"` : "";
      return { primary: path ? `${quoted} ${path}`.trim() : quoted };
    }

    case "find": {
      const query = str(args.query);
      const path = str(args.path);
      return { primary: path ? `"${query}" ${path}`.trim() : `"${query}"` };
    }

    case "ls": {
      const path = str(args.path ?? args.dir ?? ".");
      return { primary: path };
    }

    default: {
      const firstVal = Object.values(args).find(
        (v) => typeof v === "string" && v.length > 0,
      );
      return { primary: typeof firstVal === "string" ? firstVal : "" };
    }
  }
}

/**
 * Format the single-line collapsed tool card string (plan §9.1, §15).
 */
export function formatToolCardLine(
  info: ToolCardInfo,
  g: GlyphSet,
  width: number,
): string {
  const glyph = toolStateGlyph(info.state, g);
  if (width < 60) {
    // Narrow terminal: glyph and tool name only
    return `${glyph} ${info.tool}`;
  }

  const dur = formatDuration(info.durationSeconds ?? null);
  const durStr = dur ? `  ${dur}` : "";
  const countsStr = info.counts ? `  ${info.counts}` : "";

  if (width < 80) {
    // 60-79 cols: glyph, tool, truncated primary arg, duration
    const prefix = `${glyph} ${info.tool} `;
    const avail = Math.max(8, width - prefix.length - durStr.length);
    const primary = fit(info.primaryArg, avail);
    return `${prefix}${primary}${durStr}`;
  }

  if (width < 101) {
    // 80-100 cols: glyph, tool, primary arg, counts, duration
    const prefix = `${glyph} ${info.tool} `;
    const suffix = `${countsStr}${durStr}`;
    const avail = Math.max(12, width - prefix.length - suffix.length);
    const primary = fit(info.primaryArg, avail);
    return `${prefix}${primary}${suffix}`;
  }

  // >= 101 cols: full args + secondary + counts + duration
  const prefix = `${glyph} ${info.tool} `;
  const sec = info.secondaryArg ? `  ${info.secondaryArg}` : "";
  const suffix = `${sec}${countsStr}${durStr}`;
  const avail = Math.max(16, width - prefix.length - suffix.length);
  const primary = fit(info.primaryArg, avail);
  return `${prefix}${primary}${suffix}`;
}

/**
 * Visual tool card component for rendering inside Pi's TUI.
 */
export class ToolCardComponent extends Container {
  private info: ToolCardInfo;
  private headerText: Text;
  private bodyText: Text | null = null;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private g: GlyphSet,
    info: ToolCardInfo,
  ) {
    super();
    this.info = { ...info };
    this.headerText = new Text("", 0, 0);
    this.addChild(this.headerText);
    this.rebuild();
  }

  update(info: Partial<ToolCardInfo>): void {
    this.info = { ...this.info, ...info };
    this.rebuild();
    this.tui.requestRender();
  }

  setExpanded(expanded: boolean): void {
    if (this.info.expanded !== expanded) {
      this.info.expanded = expanded;
      this.rebuild();
      this.tui.requestRender();
    }
  }

  private rebuild(): void {
    const role = toolStateRole(this.info.state);
    const line = formatToolCardLine(this.info, this.g, 100);
    this.headerText.setText(this.theme.fg(role, line));

    if (this.info.expanded && this.info.previewLines && this.info.previewLines.length > 0) {
      const rail = this.g.rail;
      const formatted = this.info.previewLines
        .slice(0, 10)
        .map((l) => `${this.theme.fg("muted", rail)}   ${this.theme.fg("toolOutput", l)}`)
        .join("\n");
      if (!this.bodyText) {
        this.bodyText = new Text("", 0, 0);
        this.addChild(this.bodyText);
      }
      this.bodyText.setText(formatted);
    } else if (this.bodyText) {
      this.removeChild(this.bodyText);
      this.bodyText = null;
    }
  }

  override render(width: number): string[] {
    const role = toolStateRole(this.info.state);
    const line = formatToolCardLine(this.info, this.g, width);
    this.headerText.setText(this.theme.fg(role, line));
    return super.render(width);
  }
}
