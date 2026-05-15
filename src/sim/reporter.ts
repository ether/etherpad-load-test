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
    const md = join(this.opts.outDir, 'report.md');
    // CSV + MD written in later tasks
    return {json, csv, md};
  }
}
