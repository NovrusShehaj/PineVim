/**
 * PineVIM environment deck.
 *
 * The deck is intentionally separate from the activity band: the band answers
 * "what is happening now?", while this row answers "what environment am I in?".
 * Keeping the distinction visible makes the frame easier to scan and prevents
 * lifecycle, model, and context from competing for the same row.
 */
import { Container, type TUI } from "@earendil-works/pi-tui";
import type {
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { type GlyphSet } from "../glyphs.js";
import { style, strong, surface } from "../style.js";
import { type LifecycleState } from "../lifecycle.js";
import {
  branchChip,
  contextGauge,
  contextSparkline,
  modelChip,
  styledChipLine,
  thinkingChip,
  type Chip,
} from "../chips.js";

export interface DeckInfo {
  /** Kept in the data shape for status/focus updates; the deck does not render it. */
  lifecycle: LifecycleState;
  ctxPercent: number | null;
  /** D4: bounded ring buffer of recent ctx% values for the sparkline. */
  ctxHistory?: number[];
  model: string | null;
  thinking: string | null;
  prefix: string;
  ascii: boolean;
}

export class PineDeck extends Container {
  private info: DeckInfo;
  private branch: string | null | undefined = undefined;

  constructor(
    private tui: TUI,
    private theme: Theme,
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

  private renderEnvironment(width: number): string[] {
    const i = this.info;
    const hintText = width >= 80 ? `${i.prefix} ? keys` : `${i.prefix} ?`;
    const separator = i.ascii ? "-" : "·";
    // D4: sparkline at width >= 80; gauge below that.
    const ctxChip =
      width >= 80
        ? contextSparkline(i.ctxHistory, i.ctxPercent, width, i.ascii).chip
        : contextGauge(i.ctxPercent, width >= 100 ? 10 : 6, i.ascii);
    const chips: (Chip | null)[] = [
      ctxChip,
      modelChip(i.model, i.ascii),
      thinkingChip(i.thinking, i.ascii),
      branchChip(this.branch, i.ascii),
      { text: hintText, role: "muted" },
    ];
    const budget = Math.max(12, width - (width >= 60 ? 5 : 0));
    const line = styledChipLine(
      chips,
      budget,
      (role, text) => {
        if (role === "muted" && text === hintText)
          return surface(this.theme, "muted", text);
        return style(this.theme, role, text);
      },
      `  ${separator}  `,
      (separatorText) => style(this.theme, "dim", separatorText),
      i.ascii,
    );
    if (width < 60) return [line];
    return [`${strong(this.theme, "muted", "ENV")}  ${line}`.trimEnd()];
  }

  override render(width: number): string[] {
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
    // Width, not rows: a short wide terminal still has a useful deck. At the
    // smallest width, context and the discoverability hint are all that fit.
    return this.renderEnvironment(width);
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
  void g;
  return new PineDeck(tui, theme, footerData, info);
}
