export class StageTimer {
  private marks: [string, number][] = [];
  private start = performance.now();

  mark(stage: string): void {
    this.marks.push([stage, performance.now()]);
  }

  /** Per-stage durations plus total, in ms (rounded). */
  report(): Record<string, number> {
    const out: Record<string, number> = {};
    let prev = this.start;
    for (const [stage, t] of this.marks) {
      out[stage] = Math.round(t - prev);
      prev = t;
    }
    out.total = Math.round(prev - this.start);
    return out;
  }
}
