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
