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
  static failNext = 0; // next N connect() calls will reject
  started = false;
  stopped = false;
  authorName: string;
  private samples: Sample[] = [];
  private errs = 0;
  constructor(authorName = 't') {
    super();
    this.authorName = authorName;
    StubAuthor.instances.push(this);
  }
  async connect(): Promise<void> {
    if (StubAuthor.failNext > 0) {
      StubAuthor.failNext--;
      throw new Error('stub connect failure');
    }
  }
  start(): void { this.started = true; }
  async stop(): Promise<void> { this.stopped = true; }
  drainSamples(): Sample[] { const o = this.samples; this.samples = []; return o; }
  getErrors(): number { return this.errs; }
  /** Test helper: push synthetic samples. */
  inject(ms: number, n = 1): void {
    for (let i = 0; i < n; i++) {
      this.samples.push({authorId: this.authorName, sentAtNs: 0n, ackedAtNs: 0n, latencyMs: ms});
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

const resetStubs = (): void => { StubAuthor.instances = []; StubAuthor.failNext = 0; };

describe('Harness.run sweep', () => {
  it('produces one StepResult per swept step, with percentiles from drained samples', async () => {
    resetStubs();
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'h-'));
    try {
      const cfg = makeConfig({
        outDir: dir,
        sweep: {axis: 'authors', min: 1, max: 2, step: 1, warmupMs: 10, dwellMs: 20},
      });
      const h = new Harness(cfg, new StubScraper() as never,
                            { authorFactory: (o) => new StubAuthor(o.authorName) as never });
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

describe('Harness breakage thresholds', () => {
  it('flags a step when p95 exceeds break.p95Ms', async () => {
    resetStubs();
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'h-'));
    try {
      const cfg = makeConfig({
        outDir: dir,
        sweep: {axis: 'authors', min: 1, max: 1, step: 1, warmupMs: 1, dwellMs: 10},
        breakP95Ms: 50,
      });
      const h = new Harness(cfg, new StubScraper() as never,
                            { authorFactory: (o) => new StubAuthor(o.authorName) as never });
      const p = h.run();
      await vi.advanceTimersByTimeAsync(2);
      StubAuthor.instances.forEach((a) => a.inject(100, 10));
      await vi.advanceTimersByTimeAsync(20);
      const report = await p;
      expect(report.steps[0]!.breakageFlags).toContain('p95');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('continues past breakage by default (action=continue)', async () => {
    resetStubs();
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'h-'));
    try {
      const cfg = makeConfig({
        outDir: dir,
        sweep: {axis: 'authors', min: 1, max: 2, step: 1, warmupMs: 1, dwellMs: 10},
        breakP95Ms: 50,
      });
      const h = new Harness(cfg, new StubScraper() as never,
                            { authorFactory: (o) => new StubAuthor(o.authorName) as never });
      const p = h.run();
      for (let i = 0; i < 2; i++) {
        await vi.advanceTimersByTimeAsync(2);
        StubAuthor.instances.forEach((a) => a.inject(100, 10));
        await vi.advanceTimersByTimeAsync(20);
      }
      const report = await p;
      expect(report.steps).toHaveLength(2);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

describe('Harness lurkers', () => {
  it('spawns cfg.lurkers connected-but-idle authors at run start', async () => {
    resetStubs();
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'h-'));
    try {
      const cfg = makeConfig({
        outDir: dir,
        lurkers: 3,
        sweep: {axis: 'authors', min: 1, max: 1, step: 1, warmupMs: 1, dwellMs: 10},
      });
      const h = new Harness(cfg, new StubScraper() as never,
                            { authorFactory: (o) => new StubAuthor(o.authorName) as never });
      const p = h.run();
      await vi.advanceTimersByTimeAsync(15);
      await p;
      // 3 lurkers + 1 author
      expect(StubAuthor.instances.length).toBe(4);
      const lurkers = StubAuthor.instances.filter((a) => a.authorName.startsWith('l'));
      const authors = StubAuthor.instances.filter((a) => a.authorName.startsWith('a'));
      expect(lurkers).toHaveLength(3);
      expect(authors).toHaveLength(1);
      // Lurkers connect but never start() — they only hold sockets
      lurkers.forEach((l) => expect(l.started).toBe(false));
      authors.forEach((a) => expect(a.started).toBe(true));
      // All stopped at cleanup
      [...lurkers, ...authors].forEach((a) => expect(a.stopped).toBe(true));
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

describe('Harness allSettled spawn', () => {
  it('records failed author connects as droppedAuthors and keeps sweeping', async () => {
    resetStubs();
    StubAuthor.failNext = 1; // first author of step 1 fails to connect
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'h-'));
    try {
      const cfg = makeConfig({
        outDir: dir,
        sweep: {axis: 'authors', min: 2, max: 2, step: 2, warmupMs: 1, dwellMs: 10},
      });
      const h = new Harness(cfg, new StubScraper() as never,
                            { authorFactory: (o) => new StubAuthor(o.authorName) as never });
      const p = h.run();
      await vi.advanceTimersByTimeAsync(15);
      const report = await p;
      expect(report.steps).toHaveLength(1);
      expect(report.steps[0]!.droppedAuthors).toBe(1);
      // The author that DID connect was the only one that contributed
      const live = StubAuthor.instances.filter((a) => a.started);
      expect(live).toHaveLength(1);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
