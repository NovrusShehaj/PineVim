/**
 * PineVIM composer component (plan §10, §14, §15, Phase 4b).
 *
 * `PineComposer extends CustomEditor`
 *
 * Implements the PineVIM custom composer frame by extending Pi's exported
 * CustomEditor base class:
 * - Preserves all native Pi editing semantics, keybindings (super.handleInput),
 *   kill-ring, bracketed paste, autocomplete, and external editor flow.
 * - Embeds working status indicators via `embedWorkingStatus: true`.
 * - Customizes `renderTopBorder`:
 *   - Displays mode chip (CHAT/IDE) + lifecycle chip.
 *   - Displays keybinding help pointer (`<prefix> ? keys`) when >= 80 cols.
 *   - Delegates to `CustomEditor.renderTopBorder` when the working/compaction
 *     status indicator is active.
 *   - Preserves `↑ N more` scroll indicator if hidden lines exist above.
 * - Customizes `renderBottomBorder`:
 *   - Displays context gauge + active model + thinking level chips.
 *   - Displays `⏎ send` hint when >= 80 cols.
 *   - Preserves `↓ N more` scroll indicator if hidden lines exist below.
 *
 * Safety & Extension Contract:
 * When installed via `ctx.ui.setEditorComponent()`, PineVIM verifies that
 * no other extension has installed a custom editor (`getEditorComponent()`).
 * If another extension's editor is present, PineVIM stands down to avoid
 * breaking the user's setup.
 */
import {
  CustomEditor,
  type CustomEditorOptions,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type EditorTheme,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { GlyphSet } from "../glyphs.js";
import type { LifecycleState } from "../lifecycle.js";
import {
  contextGauge,
  lifecycleChip,
  modelChip,
  modeChip,
  thinkingChip,
  type Chip,
} from "../chips.js";

export interface ComposerInfo {
  mode: "CHAT" | "IDE";
  lifecycle: LifecycleState;
  ctxPercent: number | null;
  model: string | null;
  thinking: string | null;
  prefix: string;
}

export class PineComposer extends CustomEditor {
  private g: GlyphSet;
  private info: ComposerInfo;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    g: GlyphSet,
    info: ComposerInfo,
    options?: CustomEditorOptions,
  ) {
    super(tui, theme, keybindings, {
      embedWorkingStatus: true,
      ...options,
    });
    this.g = g;
    this.info = { ...info };
  }

  update(info: Partial<ComposerInfo>): void {
    this.info = { ...this.info, ...info };
    this.tui.requestRender();
  }

  setGlyphs(g: GlyphSet): void {
    this.g = g;
    this.tui.requestRender();
  }

  protected override renderTopBorder(
    width: number,
    hiddenLineCount: number,
  ): string {
    const holder = this as unknown as {
      workingStatusIndicator?: { renderInBorder(w: number): string };
    };
    if (this.embedWorkingStatus && holder.workingStatusIndicator && width > 0) {
      const status = holder.workingStatusIndicator.renderInBorder(
        Math.max(1, width - 5),
      );
      if (visibleWidth(status) > 0) {
        return super.renderTopBorder(width, hiddenLineCount);
      }
    }

    if (width <= 0) return "";
    if (width < 30) {
      return this.borderColor("─".repeat(width));
    }

    const mode = modeChip(this.info.mode);
    const life = lifecycleChip(
      this.info.lifecycle,
      this.g,
      width >= 80 ? 24 : 14,
    );
    const leftText = ` ${mode.text} · ${life.text} `;
    const leftVis = visibleWidth(leftText);

    const rightText = width >= 80 ? ` ${this.info.prefix} ? keys ` : "";
    const rightVis = visibleWidth(rightText);

    const overflowLabel =
      hiddenLineCount > 0 ? ` ↑ ${hiddenLineCount} more ` : "";
    const overflowVis = visibleWidth(overflowLabel);

    if (leftVis + rightVis + overflowVis + 2 > width) {
      const shortLeft = ` ${mode.text} `;
      const shortVis = visibleWidth(shortLeft);
      if (shortVis + 2 <= width) {
        return (
          this.borderColor("──") +
          shortLeft +
          this.borderColor("─".repeat(Math.max(0, width - shortVis - 2)))
        );
      }
      return this.borderColor("─".repeat(width));
    }

    const availableFill = width - leftVis - rightVis - overflowVis - 2;
    if (overflowVis > 0) {
      const leftPad = Math.floor(availableFill / 2);
      const rightPad = availableFill - leftPad;
      return (
        this.borderColor("─") +
        leftText +
        this.borderColor("─".repeat(leftPad)) +
        overflowLabel +
        this.borderColor("─".repeat(rightPad)) +
        rightText +
        this.borderColor("─")
      );
    }

    return (
      this.borderColor("─") +
      leftText +
      this.borderColor("─".repeat(Math.max(0, availableFill))) +
      rightText +
      this.borderColor("─")
    );
  }

  protected override renderBottomBorder(
    width: number,
    hiddenLineCount: number,
  ): string {
    if (width <= 0) return "";
    if (width < 30) {
      const scroll = hiddenLineCount > 0 ? ` ↓ ${hiddenLineCount} ` : "";
      const scrollVis = visibleWidth(scroll);
      if (scrollVis + 2 <= width) {
        return (
          this.borderColor("─") +
          scroll +
          this.borderColor("─".repeat(Math.max(0, width - scrollVis - 1)))
        );
      }
      return this.borderColor("─".repeat(width));
    }

    const gauge = contextGauge(this.info.ctxPercent, width >= 80 ? 8 : 6);
    const model = modelChip(this.info.model);
    const think = width >= 80 ? thinkingChip(this.info.thinking) : null;

    const chips = [gauge, model, think].filter((c): c is Chip => c !== null);
    const chipsText = chips.map((c) => c.text).join("  ·  ");
    const leftText = chipsText.length > 0 ? ` ${chipsText} ` : "";
    const leftVis = visibleWidth(leftText);

    const rightText = width >= 80 ? " ⏎ send " : "";
    const rightVis = visibleWidth(rightText);

    const overflowLabel =
      hiddenLineCount > 0 ? ` ↓ ${hiddenLineCount} more ` : "";
    const overflowVis = visibleWidth(overflowLabel);

    if (leftVis + rightVis + overflowVis + 2 > width) {
      const gaugeOnly = gauge ? ` ${gauge.text} ` : "";
      const gaugeVis = visibleWidth(gaugeOnly);
      if (gaugeVis + overflowVis + 2 <= width) {
        const fill = width - gaugeVis - overflowVis - 2;
        return (
          this.borderColor("─") +
          gaugeOnly +
          this.borderColor("─".repeat(Math.max(0, fill))) +
          overflowLabel +
          this.borderColor("─")
        );
      }
      return this.borderColor("─".repeat(width));
    }

    const availableFill = width - leftVis - rightVis - overflowVis - 2;
    if (overflowVis > 0) {
      const leftPad = Math.floor(availableFill / 2);
      const rightPad = availableFill - leftPad;
      return (
        this.borderColor("─") +
        leftText +
        this.borderColor("─".repeat(leftPad)) +
        overflowLabel +
        this.borderColor("─".repeat(rightPad)) +
        rightText +
        this.borderColor("─")
      );
    }

    return (
      this.borderColor("─") +
      leftText +
      this.borderColor("─".repeat(Math.max(0, availableFill))) +
      rightText +
      this.borderColor("─")
    );
  }
}
