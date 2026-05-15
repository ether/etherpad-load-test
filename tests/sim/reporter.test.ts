import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Reporter} from '../../src/sim/reporter.js';
import type {StepResult, RunMeta, Config} from '../../src/sim/types.js';
import {makeConfig} from '../../src/sim/config.js';

const meta = (): RunMeta => ({
  runId: 'test-run',
  startedAt: '2026-05-15T00:00:00.000Z',
  finishedAt: '2026-05-15T00:01:00.000Z',
  sut: {url: 'http://x:9001', gitSha: 'abc', version: '1.0.0'},
  machine: {cpus: 'TestCPU', totalMemMB: 1024, node: 'v22', os: 'linux'},
});

const stepResult = (step: number, latency: number): StepResult => ({
  step,
  latencyMs: {p50: latency, p95: latency * 2, p99: latency * 3, max: latency * 4, count: 100},
  throughputCsps: step * 5,
  snapshot: {label: `step=${step}`, scrapedAt: '2026-05-15T00:00:30.000Z',
             gauges: {'nodejs_cpu_gauge{type=user}': 20, 'etherpad_total_users': step}},
  droppedAuthors: 0,
  errors: 0,
  breakageFlags: [],
  samples: null,
});

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rep-')); });
afterEach(() => rmSync(dir, {recursive: true, force: true}));

describe('Reporter JSON output', () => {
  it('writes a report.json with meta + config + steps', async () => {
    const cfg: Config = makeConfig({outDir: dir, runId: 'test-run'});
    const r = new Reporter({outDir: dir, runMeta: meta(), config: cfg});
    r.addStep(stepResult(10, 20));
    r.addStep(stepResult(20, 40));
    const paths = await r.write();
    expect(existsSync(paths.json)).toBe(true);
    const j = JSON.parse(readFileSync(paths.json, 'utf8'));
    expect(j.runId).toBe('test-run');
    expect(j.steps).toHaveLength(2);
    expect(j.steps[0].step).toBe(10);
    expect(j.steps[0].latencyMs.p50).toBe(20);
    expect(j.steps[1].latencyMs.p50).toBe(40);
  });

  it('marks the report partial when partial=true on meta', async () => {
    const cfg = makeConfig({outDir: dir});
    const m = {...meta(), partial: true};
    const r = new Reporter({outDir: dir, runMeta: m, config: cfg});
    r.addStep(stepResult(10, 20));
    const paths = await r.write();
    const j = JSON.parse(readFileSync(paths.json, 'utf8'));
    expect(j.partial).toBe(true);
  });
});

describe('Reporter CSV output', () => {
  it('writes one row per step with curated columns', async () => {
    const cfg = makeConfig({outDir: dir});
    const r = new Reporter({outDir: dir, runMeta: meta(), config: cfg});
    r.addStep(stepResult(10, 20));
    r.addStep(stepResult(20, 40));
    const paths = await r.write();
    const csv = readFileSync(paths.csv, 'utf8');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('step,p50,p95,p99,max,throughput_csps,cpu_user,evloop_p95_ms,rss_mb,users,errors,break');
    expect(lines[1]!.split(',')[0]).toBe('10');
    expect(lines[1]!.split(',')[1]).toBe('20');
    expect(lines[2]!.split(',')[0]).toBe('20');
  });

  it('emits empty cells when a metric is missing', async () => {
    const cfg = makeConfig({outDir: dir});
    const r = new Reporter({outDir: dir, runMeta: meta(), config: cfg});
    const s = stepResult(10, 20);
    s.snapshot.gauges = {}; // strip all gauges
    r.addStep(s);
    const paths = await r.write();
    const csv = readFileSync(paths.csv, 'utf8');
    const cols = csv.trim().split('\n')[1]!.split(',');
    // step,p50,p95,p99,max,throughput_csps,<cpu_user>,<evloop_p95_ms>,<rss_mb>,<users>,errors,break
    expect(cols[6]).toBe(''); // cpu_user missing
    expect(cols[7]).toBe(''); // evloop missing
    expect(cols[8]).toBe(''); // rss missing
    expect(cols[9]).toBe(''); // users missing
  });
});

describe('Reporter MD output', () => {
  it('writes a markdown summary with table + sparkline', async () => {
    const cfg = makeConfig({outDir: dir});
    const r = new Reporter({outDir: dir, runMeta: meta(), config: cfg});
    r.addStep(stepResult(10, 20));
    r.addStep(stepResult(20, 40));
    const paths = await r.write();
    const md = readFileSync(paths.md, 'utf8');
    expect(md).toContain('# Etherpad scaling sweep');
    expect(md).toContain('test-run');
    expect(md).toContain('| Step | p50 | p95 |');
    expect(md).toContain('| 10 ');
    expect(md).toContain('| 20 ');
    expect(md).toContain('p95 latency (ms) vs concurrency');
  });

  it('jsonOnly skips csv and md', async () => {
    const cfg = makeConfig({outDir: dir, jsonOnly: true});
    const r = new Reporter({outDir: dir, runMeta: meta(), config: cfg});
    r.addStep(stepResult(10, 20));
    const paths = await r.write();
    expect(existsSync(paths.json)).toBe(true);
    expect(existsSync(paths.csv)).toBe(false);
    expect(existsSync(paths.md)).toBe(false);
  });
});
