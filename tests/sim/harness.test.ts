// tests/sim/harness.test.ts
import {describe, it, expect, vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Harness} from '../../src/sim/harness.js';
import {makeConfig} from '../../src/sim/config.js';
import type {Sample} from '../../src/sim/types.js';

class StubAuthor extends EventEmitter {
  static instances: StubAuthor[] = [];
  private samples: Sample[] = [];
  private errs = 0;
  constructor() { super(); StubAuthor.instances.push(this); }
  async connect(): Promise<void> {}
  start(): void {}
  async stop(): Promise<void> {}
  drainSamples(): Sample[] { const o = this.samples; this.samples = []; return o; }
  getErrors(): number { return this.errs; }
  /** Test helper: push synthetic samples. */
  inject(ms: number, n = 1): void {
    for (let i = 0; i < n; i++) {
      this.samples.push({authorId: 't', sentAtNs: 0n, ackedAtNs: 0n, latencyMs: ms});
    }
  }
}

class StubScraper {
  start(): void {}
  async stop(): Promise<void> {}
  snapshot(label: string): {label: string; scrapedAt: string; gauges: Record<string, number>} {
    return {label, scrapedAt: '2026-05-15T00:00:00.000Z', gauges: {}};
  }
}

describe('Harness.run sweep', () => {
  it('produces one StepResult per swept step, with percentiles from drained samples', async () => {
    StubAuthor.instances = [];
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'h-'));
    try {
      const cfg = makeConfig({
        outDir: dir,
        sweep: {axis: 'authors', min: 1, max: 2, step: 1, warmupMs: 10, dwellMs: 20},
      });
      const h = new Harness(cfg, new StubScraper() as never,
                            { authorFactory: () => new StubAuthor() as never });
      const runPromise = h.run();
      // Step 1: 1 author. Drain warmup, then inject samples in dwell window.
      await vi.advanceTimersByTimeAsync(11);
      StubAuthor.instances.forEach((a) => a.inject(50, 10));
      await vi.advanceTimersByTimeAsync(20);
      // Step 2: now 2 authors. Drain warmup, inject samples.
      await vi.advanceTimersByTimeAsync(11);
      StubAuthor.instances.forEach((a) => a.inject(100, 10));
      await vi.advanceTimersByTimeAsync(20);
      const report = await runPromise;
      expect(report.steps).toHaveLength(2);
      expect(report.steps[0]!.step).toBe(1);
      expect(report.steps[0]!.latencyMs.count).toBeGreaterThan(0);
      expect(report.steps[1]!.step).toBe(2);
      expect(report.steps[1]!.latencyMs.p50).toBeGreaterThan(report.steps[0]!.latencyMs.p50);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
