/**
 * PineComposer activity band.
 *
 * The band is the small "now" surface directly above Pi's editor. It stays
 * intentionally quiet: the lifecycle and the next thing that needs attention
 * come first, while environment facts live in the deck below. A leading rail
 * gives the frame a consistent edge without drawing a heavy box around Pi's
 * native composer.
 */
import { Container, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { fit, type GlyphSet } from "../glyphs.js";
import { style, strong } from "../style.js";
import { type LifecycleState, lifecycleLabel } from "../lifecycle.js";
import { type RunState } from "../runs.js";
import { queueChip, styledChipLine, type Chip } from "../chips.js";

export interface BandInfo {
  mode: "CHAT" | "IDE";
  focus?: "agent" | "editor";
  lifecycle: LifecycleState;
  /** Pi only exposes a boolean for queued messages, but tests/tools may provide a count. */
  queued: number | boolean;
  ascii: boolean;
  ctxPercent: number | null;
  model: string | null;
  thinking: string | null;
  prefix: string;
  /** Current user run, when Pi has started one. */
  run?: RunState | null;
}

function elapsed(
  run: RunState | null | undefined,
  now = Date.now(),
): string | null {
  if (!run?.active || run.startedAt === null) return null;
  const seconds = Math.max(0, (now - run.startedAt) / 1000);
  if (seconds < 1) return null;
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}

function activityChip(info: BandInfo, g: GlyphSet, width: number): Chip {
  const state = info.lifecycle;
  const separator = info.ascii ? "-" : "·";
  const ellipsis = info.ascii ? "..." : "…";
  let text = lifecycleLabel(state, g);
  const run = info.run;
  const toolCount = Math.max(state.toolsRun, run?.tools ?? 0);
  if (state.lifecycle === "tooling") {
    const lastTool = state.lastTool
      ? ` ${separator} ${fit(state.lastTool, 16, ellipsis)}`
      : "";
    text = `${g.running} tools ${toolCount}${lastTool}`;
  } else if (state.lifecycle === "idle" && run?.active) {
    text = `${g.running} run ${run.index}`;
  }
  const duration = elapsed(run);
  if (duration) text += ` ${separator} ${duration}`;

  const role: Chip["role"] =
    state.lifecycle === "error"
      ? "error"
      : state.lifecycle === "waiting"
        ? "accent"
        : state.lifecycle === "interrupted"
          ? "warning"
          : state.lifecycle === "idle"
            ? "success"
            : "text";
  return { text: fit(text, width, ellipsis), role };
}

export class PineBand extends Container {
  private info: BandInfo;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private g: GlyphSet,
    info: BandInfo,
  ) {
    super();
    this.info = info;
  }

  update(info: BandInfo): void {
    this.info = info;
    this.tui.requestRender();
  }

  override render(width: number): string[] {
    // The deck remains the single source for environment facts. Below the
    // minimum frame width, leave the row to Pi's own editor chrome.
    if (width < 60) return [];
    const i = this.info;
    const budget = Math.max(20, width - 2);
    const separator = i.ascii ? "-" : "·";
    const chips: (Chip | null)[] = [];

    if (width >= 80) {
      const view =
        i.mode === "IDE" && i.focus ? `${i.mode} ${i.focus}` : i.mode;
      chips.push({ text: view, role: "accent" });
    }
    chips.push(activityChip(i, this.g, budget));

    // A failure is useful after the run, but the lifecycle chip remains the
    // primary message. Do not turn a normal tool error into permanent noise.
    if (i.lifecycle.lifecycle !== "error" && (i.run?.failed ?? 0) > 0)
      chips.push({
        text: `${this.g.warning} ${i.run!.failed} failed`,
        role: "warning",
      });
    chips.push(queueChip(i.queued, this.g));
    if (width >= 100) chips.push({ text: `${i.prefix} ? keys`, role: "muted" });

    const line = styledChipLine(
      chips,
      budget,
      (role, text) => {
        if (role === "accent" && text === i.mode)
          return strong(this.theme, "accent", text);
        return style(this.theme, role, text);
      },
      `  ${separator}  `,
      (separatorText) => style(this.theme, "dim", separatorText),
      i.ascii,
    );
    return [`${style(this.theme, "accent", this.g.rail)} ${line}`.trimEnd()];
  }
}

export function bandFactory(
  tui: TUI,
  theme: Theme,
  g: GlyphSet,
  info: BandInfo,
): PineBand {
  return new PineBand(tui, theme, g, info);
}
