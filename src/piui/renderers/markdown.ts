/**
 * Markdown integration (plan §22, divergence documented).
 *
 * The plan proposed normalizing assistant `---` horizontal rules via
 * registerMarkdownTransformer. That transformer runs on message content
 * before Pi's renderer, so even "presentation-only" edits mutate the text
 * that flows into Pi's Markdown engine - including inside fenced code blocks
 * where a leading `---` line can appear verbatim in shell/config output the
 * assistant echoes. Guardrail §7.1 (do not duplicate/patch Pi systems) and
 * the plan's own rule "do not mutate semantic content" win: PineVIM's
 * markdown identity is carried entirely by the theme (mdHr, mdQuoteBorder,
 * mdCodeBlockBorder all restyled to the muted structure color), which achieves
 * the same visual grammar with zero content mutation.
 *
 * This module intentionally registers no transformer. Kept as the documented
 * seam should a future Pi version expose a purely presentational hook.
 */
export const MARKDOWN_TRANSFORMER_NOTE =
  "Skipped by design: content-mutating transformer rejected (see src/piui/renderers/markdown.ts).";
