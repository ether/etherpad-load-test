import type {Config, SweepConfig, ScrapeConfig, BreakConfig, ReportConfig} from './types.js';
import {parseDuration} from './duration.js';

export class ConfigError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ConfigError'; }
}

export interface ConfigInput {
  sutUrl?: string;
  padId?: string;
  lurkers?: number;
  authors?: number;
  durationS?: number;
  editIntervalMs?: number;
  connectTimeoutMs?: number;
  respawnDrops?: boolean;
  sweep?: SweepConfig;
  scrapeUrl?: string;
  scrapeIntervalMs?: number;
  scrapeKeep?: string[];
  breakP95Ms?: number;
  breakEventLoopP95Ms?: number;
  breakErrorRate?: number;
  breakAction?: 'stop' | 'continue';
  outDir?: string;
  runId?: string;
  jsonOnly?: boolean;
  keepRawSamples?: boolean;
  force?: boolean;
}

// Default allowlist. Names come from what etherpad core's /stats/prometheus
// actually emits: a few etherpad_-prefixed custom rows plus the prom-client
// default metrics (process_cpu_*, process_resident_memory_bytes,
// nodejs_eventloop_lag_*). Names are matched as prefixes against the base
// metric name (before `{labels}`).
const DEFAULT_KEEP = [
  // etherpad custom (active + planned via ether/etherpad#7762)
  'etherpad_',
  // prom-client defaults
  'process_cpu_',                  // process_cpu_user_seconds_total, _system_seconds_total
  'process_resident_memory_bytes', // RSS
  'process_heap_bytes',
  'nodejs_eventloop_lag',          // nodejs_eventloop_lag_seconds + _p50/_p95/_p99/_max
  'nodejs_heap_size',
  'nodejs_active_handles',
  'nodejs_gc_duration_seconds',
  // ueberdb
  'ueberdb_stats',
];

const requireNonNeg = (name: string, v: number | undefined): void => {
  if (v !== undefined && v < 0) throw new ConfigError(`${name} must be >= 0`);
};

export const parseSweep = (raw: string): SweepConfig => {
  const m = /^(authors|pads)=(\d+)\.\.(\d+)(?::(.+))?$/.exec(raw);
  if (!m) throw new ConfigError(`bad --sweep value: ${raw}`);
  const axis = m[1] as 'authors' | 'pads';
  const min = Number(m[2]);
  const max = Number(m[3]);
  if (min > max) throw new ConfigError(`sweep min ${min} > max ${max}`);

  let step = 10;
  let dwellMs = 30_000;
  let warmupMs = 5_000;
  if (m[4]) {
    for (const part of m[4].split(':')) {
      const [k, v] = part.split('=');
      if (k === 'step') {
        step = Number(v);
        if (!Number.isFinite(step) || step <= 0) throw new ConfigError(`sweep step must be > 0`);
      } else if (k === 'dwell') {
        dwellMs = parseDuration(v ?? '');
      } else if (k === 'warmup') {
        warmupMs = parseDuration(v ?? '');
      } else {
        throw new ConfigError(`unknown sweep field: ${k}`);
      }
    }
  }
  return {axis, min, max, step, warmupMs, dwellMs};
};

export const makeConfig = (input: ConfigInput): Config => {
  requireNonNeg('authors', input.authors);
  requireNonNeg('lurkers', input.lurkers);
  requireNonNeg('durationS', input.durationS);

  const sutUrl = input.sutUrl ?? 'http://127.0.0.1:9001';

  const scrape: ScrapeConfig = {
    url: input.scrapeUrl ?? `${sutUrl.replace(/\/$/, '')}/stats/prometheus`,
    intervalMs: input.scrapeIntervalMs ?? 1_000,
    keep: input.scrapeKeep ?? DEFAULT_KEEP,
  };

  const brk: BreakConfig = {
    p95Ms: input.breakP95Ms ?? 2000,
    eventLoopP95Ms: input.breakEventLoopP95Ms ?? 500,
    errorRate: input.breakErrorRate ?? 0.05,
    action: input.breakAction ?? 'continue',
  };

  const runId = input.runId ?? new Date().toISOString().replace(/[:.]/g, '-');

  const report: ReportConfig = {
    outDir: input.outDir ?? `./loadtest-out/${runId}`,
    runId,
    jsonOnly: input.jsonOnly ?? false,
    keepRawSamples: input.keepRawSamples ?? false,
    force: input.force ?? false,
  };

  return {
    sutUrl,
    padId: input.padId,
    lurkers: input.lurkers ?? 0,
    authors: input.authors ?? 0,
    durationS: input.durationS,
    editIntervalMs: input.editIntervalMs ?? 200,
    connectTimeoutMs: input.connectTimeoutMs ?? 10_000,
    respawnDrops: input.respawnDrops ?? false,
    sweep: input.sweep,
    scrape,
    break: brk,
    report,
  };
};
