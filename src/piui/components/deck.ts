/**
 * PineVIM status deck (plan §16): the in-pane observability footer.
 * Registered through ctx.ui.setFooter; the factory receives a
 * ReadonlyFooterDataProvider for git branch data not otherwise exposed.
 *
 * One environment line at width >= 60. Below that, lifecycle and the gauge
 * share a single line. Collapse is by width, not rows.
 */
import { Container, type TUI } from "@earendil-works/pi-tui";
import type {
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { fit } from "../glyphs.js";
import { type GlyphSet } from "../glyphs.js";
import { type LifecycleState } from "../lifecycle.js";
import {
  contextGauge,
  lifecycleChip,
  modelChip,
  styledChipLine,
  thinkingChip,
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

export interface DeckInfo {
  lifecycle: LifecycleState;
  ctxPercent: number | null;
  model: string | null;
  thinking: string | null;
  /** Configured prefix, for the help hint. */
  prefix: string;
  ascii: boolean;
}

export class PineDeck extends Container {
  private info: DeckInfo;
  private branch: string | null | undefined = undefined;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private g: GlyphSet,
    private footerData: ReadonlyFooterDataProvider,
    info: DeckInfo,
  ) {
    super();
    this.info = info;
  }

  update(info: DeckInfo): void {
    this.info = info;
    this.tui.requestRender();
  }

  private line2(width: number): string {
    const i = this.info;
    const gauge = contextGauge(i.ctxPercent, width >= 100 ? 10 : 6, i.ascii);
    const model = modelChip(i.model);
    const think = thinkingChip(i.thinking);
    const branch =
      typeof this.branch === "string" && this.branch
        ? { text: fit(this.branch, 20), role: "muted" as const }
        : null;
    const hint =
      width >= 80
        ? { text: `${i.prefix} ? keys`, role: "muted" as const }
        : null;
    return styledChipLine(
      [gauge, model, think, branch, hint],
      width,
      (role, text) => {
        const fn = ROLE[role] ?? ROLE.muted;
        return fn(this.theme, text);
      },
    );
  }

  override render(width: number): string[] {
    const t = this.theme;
    const style = (role: string, s: string): string => {
      const fn = ROLE[role] ?? ROLE.muted;
      return fn(t, s);
    };
    // Subscribe once; branch changes arrive via callback, not polling.
    if (this.branch === undefined) {
      this.branch = this.footerData.getGitBranch();
      this.footerData.onBranchChange(() => {
        const next = this.footerData.getGitBranch();
        if (next !== this.branch) {
          this.branch = next;
          this.tui.requestRender();
        }
      });
    }
    // Width, not rows: a short wide terminal still has a footer.
    if (width < 60) {
      return [
        styledChipLine(
          [
            lifecycleChip(
              this.info.lifecycle,
              this.g,
              Math.max(12, width - 20),
            ),
            contextGauge(this.info.ctxPercent, 6, this.info.ascii),
          ],
          width,
          style,
        ),
      ];
    }
    return [this.line2(width)];
  }
}

/** Factory signature compatible with ctx.ui.setFooter. */
export function deckFactory(
  tui: TUI,
  theme: Theme,
  footerData: ReadonlyFooterDataProvider,
  g: GlyphSet,
  info: DeckInfo,
): PineDeck {
  return new PineDeck(tui, theme, g, footerData, info);
}
