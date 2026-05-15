import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {StepResult, RunMeta, Config} from './types.js';

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

  build(): Record<string, unknown> {
    return {
      runId: this.opts.runMeta.runId,
      startedAt: this.opts.runMeta.startedAt,
      finishedAt: this.opts.runMeta.finishedAt,
      partial: this.opts.runMeta.partial === true ? true : undefined,
      sut: this.opts.runMeta.sut,
      machine: this.opts.runMeta.machine,
      config: this.opts.config,
      steps: this.steps,
    };
  }

  async write(): Promise<WrittenPaths> {
    mkdirSync(this.opts.outDir, {recursive: true});
    const json = join(this.opts.outDir, 'report.json');
    writeFileSync(json, JSON.stringify(this.build(), null, 2));
    const csv = join(this.opts.outDir, 'report.csv');
    writeFileSync(csv, this.toCsv());
    const md = join(this.opts.outDir, 'report.md');
    // MD written in later task
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
}
