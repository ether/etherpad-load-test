import {describe, it, expect} from 'vitest';
import {LatencyHistogram} from '../../src/sim/histogram.js';

describe('LatencyHistogram', () => {
  it('records values and returns ordered percentiles', () => {
    const h = new LatencyHistogram();
    for (let i = 1; i <= 1000; i++) h.recordMs(i);
    const s = h.summary();
    expect(s.count).toBe(1000);
    expect(s.p50).toBeGreaterThanOrEqual(500);
    expect(s.p50).toBeLessThanOrEqual(510);
    expect(s.p95).toBeGreaterThanOrEqual(950);
    expect(s.p99).toBeGreaterThanOrEqual(990);
    expect(s.max).toBeGreaterThanOrEqual(1000);
    expect(s.p50).toBeLessThanOrEqual(s.p95);
    expect(s.p95).toBeLessThanOrEqual(s.p99);
    expect(s.p99).toBeLessThanOrEqual(s.max);
  });

  it('zero-sample summary returns zeros', () => {
    const h = new LatencyHistogram();
    const s = h.summary();
    expect(s).toEqual({p50: 0, p95: 0, p99: 0, max: 0, count: 0});
  });

  it('reset clears recorded data', () => {
    const h = new LatencyHistogram();
    h.recordMs(100);
    h.reset();
    expect(h.summary().count).toBe(0);
  });
});
