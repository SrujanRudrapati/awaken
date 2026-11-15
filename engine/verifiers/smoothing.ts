const DEFAULT_WINDOW = 3;

/** Sliding-window median: removes single-sample sensor glitches without blurring edges. */
export class MedianFilter {
  private window: number[] = [];

  constructor(private readonly size: number = DEFAULT_WINDOW) {}

  /** Adds a sample and returns the median of the last `size` samples. */
  push(value: number): number {
    this.window = [...this.window, value].slice(-this.size);
    const sorted = [...this.window].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  reset(): void {
    this.window = [];
  }
}
