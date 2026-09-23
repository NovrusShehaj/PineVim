export interface Geometry {
  columns: number;
  rows: number;
}
export function compact(g: Geometry): boolean {
  return g.columns < 101 || g.rows < 24;
}
export function tooSmall(g: Geometry): boolean {
  return g.columns < 60 || g.rows < 16;
}
export function agentWidth(columns: number, ratio: number | null): number {
  const available = Math.max(1, columns - 1);
  const desired =
    ratio === null
      ? Math.min(64, Math.round(0.35 * available))
      : Math.round(ratio * available);
  return Math.max(40, Math.min(desired, available - 60));
}
