import hdr from 'hdr-histogram-js';

export interface LatencySummary {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  count: number;
}

export class LatencyHistogram {
  private h = hdr.build({
    bitBucketSize: 32,
    highestTrackableValue: 60 * 60 * 1000, // 1 hour in ms
    numberOfSignificantValueDigits: 3,
  });

  recordMs(v: number): void {
    if (!Number.isFinite(v) || v < 0) return;
    this.h.recordValue(Math.floor(v));
  }

  summary(): LatencySummary {
    if (this.h.totalCount === 0) {
      return {p50: 0, p95: 0, p99: 0, max: 0, count: 0};
    }
    return {
      p50: this.h.getValueAtPercentile(50),
      p95: this.h.getValueAtPercentile(95),
      p99: this.h.getValueAtPercentile(99),
      max: this.h.maxValue,
      count: this.h.totalCount,
    };
  }

  reset(): void { this.h.reset(); }
}
