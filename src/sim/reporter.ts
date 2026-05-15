import {mkdirSync, writeFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import type {StepResult, RunMeta, Config, Report} from './types.js';

export interface ReporterOpts {
  outDir: string;
  runMeta: RunMeta;
  config: Config;
}

export interface WrittenPaths {
  json: string;
  csv: string;
  md: string;
}

export class Reporter {
  private readonly steps: StepResult[] = [];

  constructor(private readonly opts: ReporterOpts) {}

  addStep(s: StepResult): void { this.steps.push(s); }

  build(): Report {
    const r: Report = {
      runId: this.opts.runMeta.runId,
      startedAt: this.opts.runMeta.startedAt,
      finishedAt: this.opts.runMeta.finishedAt,
      sut: this.opts.runMeta.sut,
      machine: this.opts.runMeta.machine,
      config: this.opts.config,
      steps: this.steps,
    };
    if (this.opts.runMeta.partial === true) r.partial = true;
    return r;
  }

  async write(): Promise<WrittenPaths> {
    let existing: string[] = [];
    try {
      existing = readdirSync(this.opts.outDir);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') throw err;
    }
    if (existing.length > 0 && !this.opts.config.report.force) {
      throw new Error(`report outDir is non-empty and --force was not set: ${this.opts.outDir}`);
    }

    mkdirSync(this.opts.outDir, {recursive: true});
    const json = join(this.opts.outDir, 'report.json');
    writeFileSync(json, JSON.stringify(this.build(), null, 2));
    const csv = join(this.opts.outDir, 'report.csv');
    const md = join(this.opts.outDir, 'report.md');
    if (!this.opts.config.report.jsonOnly) {
      writeFileSync(csv, this.toCsv());
      writeFileSync(md, this.toMd());
    }
    return {json, csv, md};
  }

  private toCsv(): string {
    const header = 'step,p50,p95,p99,max,throughput_csps,cpu_user,evloop_p95_ms,rss_mb,users,errors,break';
    const fmt = (n: number | undefined): string =>
      n === undefined || !Number.isFinite(n) ? '' : String(n);
    const cell = (g: Record<string, number>, key: string): string => {
      const v = g[key];
      return v === undefined ? '' : String(v);
    };
    const rows = this.steps.map((s) => {
      const g = s.snapshot.gauges;
      const rssBytes = g['nodejs_memory_process_gauge{type=rss}'];
      const rssMb = rssBytes !== undefined ? Math.round(rssBytes / 1_048_576) : undefined;
      return [
        s.step,
        fmt(s.latencyMs.p50),
        fmt(s.latencyMs.p95),
        fmt(s.latencyMs.p99),
        fmt(s.latencyMs.max),
        fmt(s.throughputCsps),
        cell(g, 'nodejs_cpu_gauge{type=user}'),
        cell(g, 'nodejs_eventloop_latency_gauge{type=p95}'),
        fmt(rssMb),
        cell(g, 'etherpad_total_users'),
        s.errors,
        s.breakageFlags.join('|'),
      ].join(',');
    });
    return [header, ...rows].join('\n') + '\n';
  }

  private toMd(): string {
    const m = this.opts.runMeta;
    const header = [
      `# Etherpad scaling sweep — ${m.startedAt}`,
      `Run: ${m.runId}`,
      `SUT: ${m.sut.gitSha ?? '?'} (${m.sut.version ?? '?'}) on ${m.machine.cpus} · ${m.machine.totalMemMB} MB · node ${m.machine.node}`,
      '',
      '| Step | p50 | p95 | p99 | EL p95 | CPU% | Errors | Break |',
      '|---:|---:|---:|---:|---:|---:|---:|:---|',
    ];
    const rows = this.steps.map((s) => {
      const g = s.snapshot.gauges;
      const el = g['nodejs_eventloop_latency_gauge{type=p95}'] ?? '';
      const cpu = g['nodejs_cpu_gauge{type=user}'] ?? '';
      return `| ${s.step} | ${s.latencyMs.p50} | ${s.latencyMs.p95} | ${s.latencyMs.p99} | ${el} | ${cpu} | ${s.errors} | ${s.breakageFlags.join('|')} |`;
    });

    // Sparkline of p95
    const maxP95 = Math.max(1, ...this.steps.map((s) => s.latencyMs.p95));
    const spark = this.steps.map((s) => {
      const bars = Math.max(1, Math.round((s.latencyMs.p95 / maxP95) * 30));
      return `  ${String(s.step).padStart(4)} ${'▏'.repeat(bars)} ${s.latencyMs.p95}`;
    });

    return [
      ...header,
      ...rows,
      '',
      'p95 latency (ms) vs concurrency:',
      ...spark,
      '',
    ].join('\n');
  }
}
