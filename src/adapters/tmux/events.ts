/** Coalesce bursts without postponing policy indefinitely. tmux still resizes PTYs immediately. */
export class Coalescer {
  private timer: NodeJS.Timeout | null = null;
  private first = 0;
  constructor(private callback: () => void) {}
  schedule(): void {
    const now = Date.now();
    if (!this.timer) this.first = now;
    else clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.callback();
      },
      Math.max(0, Math.min(50, 150 - (now - this.first))),
    );
  }
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
