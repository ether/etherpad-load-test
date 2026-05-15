// src/sim/harness.ts
import type {Config, Report, StepResult, RunMeta} from './types.js';
import type {Author} from './author.js';
import type {Scraper} from './scraper.js';
import {Reporter} from './reporter.js';
import {LatencyHistogram} from './histogram.js';
import {Author as RealAuthor} from './author.js';

export interface HarnessDeps {
  authorFactory?: (opts: {url: string; padId: string; authorName: string; editIntervalMs: number}) => Author;
  now?: () => Date;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const makeRunMeta = (cfg: Config, now: () => Date): RunMeta => ({
  runId: cfg.report.runId,
  startedAt: now().toISOString(),
  finishedAt: '', // filled at end
  sut: {url: cfg.sutUrl},
  machine: {
    cpus: 'unknown',
    totalMemMB: 0,
    node: process.version,
    os: process.platform,
  },
});

export class Harness {
  constructor(
    private readonly cfg: Config,
    private readonly scraper: Scraper,
    private readonly deps: HarnessDeps = {},
  ) {}

  async run(): Promise<Report> {
    const sweep = this.cfg.sweep;
    if (!sweep) throw new Error('Harness.run requires cfg.sweep; use runLegacy otherwise');
    const now = this.deps.now ?? (() => new Date());
    const factory = this.deps.authorFactory ?? ((o) => new RealAuthor(o));

    const meta = makeRunMeta(this.cfg, now);
    const reporter = new Reporter({outDir: this.cfg.report.outDir, runMeta: meta, config: this.cfg});

    this.scraper.start();
    const authors: Author[] = [];
    let counter = 0;

    try {
      for (let n = sweep.min; n <= sweep.max; n += sweep.step) {
        const delta = n - authors.length;
        for (let i = 0; i < delta; i++) {
          const a = factory({
            url: this.cfg.sutUrl,
            padId: this.cfg.padId ?? 'loadtest',
            authorName: `a${++counter}`,
            editIntervalMs: this.cfg.editIntervalMs,
          });
          await a.connect();
          a.start();
          authors.push(a);
        }
        // warmup
        await sleep(sweep.warmupMs);
        for (const a of authors) a.drainSamples();
        // dwell
        await sleep(sweep.dwellMs);
        const samples = authors.flatMap((a) => a.drainSamples());
        const errors = authors.reduce((acc, a) => acc + a.getErrors(), 0);
        const hist = new LatencyHistogram();
        for (const s of samples) hist.recordMs(s.latencyMs);
        const summary = hist.summary();
        const throughputCsps = summary.count / (sweep.dwellMs / 1_000);
        const snapshot = this.scraper.snapshot(`step=${n}`);
        const breakageFlags = this.flags(summary, snapshot, samples.length, errors);
        const step: StepResult = {
          step: n,
          latencyMs: summary,
          throughputCsps,
          snapshot,
          droppedAuthors: 0,
          errors,
          breakageFlags,
          samples: this.cfg.report.keepRawSamples ? samples : null,
        };
        reporter.addStep(step);
        if (breakageFlags.length > 0 && this.cfg.break.action === 'stop') break;
      }
    } finally {
      for (const a of authors) await a.stop();
      await this.scraper.stop();
    }

    meta.finishedAt = now().toISOString();
    return reporter.build();
  }

  private flags(
    summary: {p95: number},
    snap: {gauges: Record<string, number>},
    sampleCount: number,
    errors: number,
  ): string[] {
    const flags: string[] = [];
    if (summary.p95 > this.cfg.break.p95Ms) flags.push('p95');
    const el = snap.gauges['nodejs_eventloop_latency_gauge{type=p95}'];
    if (el !== undefined && el > this.cfg.break.eventLoopP95Ms) flags.push('evloop');
    const rate = sampleCount + errors > 0 ? errors / (sampleCount + errors) : 0;
    if (rate > this.cfg.break.errorRate) flags.push('errorRate');
    return flags;
  }
}
