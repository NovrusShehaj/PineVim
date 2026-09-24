/**
 * PineComposer chip band (plan §10, §17): a PineVIM widget band rendered
 * directly above the editor via ctx.ui.setWidget("pinevim", ..., {placement:
 * "aboveEditor"}).
 *
 * Divergence from the plan documented: Pi 0.87.1's CustomEditor draws its
 * borders inside private pi-tui internals (renderTopBorder is not virtual -
 * it is a private method), so a subclass cannot restyle borders without
 * patching dependency internals, which the guardrails forbid. The supported
 * equivalent for "PineVIM owns the composer frame" is the widget band above
 * the stock editor: identical information, full keybinding safety, and the
 * stock editor remains fully intact underneath.
 */
import { Container, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type GlyphSet } from "../glyphs.js";
import { type LifecycleState } from "../lifecycle.js";
import {
  chipLine,
  contextGauge,
  lifecycleChip,
  modeChip,
  queueChip,
  thinkingChip,
  modelChip,
} from "../chips.js";

type RoleStyle = (t: Theme, s: string) => string;
const ROLE: {
  [k: string]: RoleStyle | undefined;
  accent: RoleStyle;
  muted: RoleStyle;
  success: RoleStyle;
  warning: RoleStyle;
  error: RoleStyle;
  text: RoleStyle;
} = {
  accent: (t, s) => t.fg("accent", s),
  muted: (t, s) => t.fg("muted", s),
  success: (t, s) => t.fg("success", s),
  warning: (t, s) => t.fg("warning", s),
  error: (t, s) => t.fg("error", s),
  text: (t, s) => t.fg("text", s),
};

export interface BandInfo {
  mode: "CHAT" | "IDE";
  lifecycle: LifecycleState;
  queued: number;
  ctxPercent: number | null;
  model: string | null;
  thinking: string | null;
  prefix: string;
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
    if (width < 40) return []; // stock editor alone below 40 cols
    const t = this.theme;
    const i = this.info;
    const style = (role: string, s: string): string => {
      const fn = ROLE[role] ?? ROLE.muted;
      return fn(t, s);
    };
    const chips =
      width >= 80
        ? [
            modeChip(i.mode),
            lifecycleChip(i.lifecycle, this.g, Math.max(14, width - 48)),
            queueChip(i.queued, this.g),
            contextGauge(i.ctxPercent, 8),
            modelChip(i.model),
            thinkingChip(i.thinking),
          ]
        : [
            modeChip(i.mode),
            lifecycleChip(i.lifecycle, this.g, Math.max(10, width - 12)),
            contextGauge(i.ctxPercent, 6),
          ];
    return [style("muted", chipLine(chips, width))];
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
