// src/cli.ts
import {parseArgs} from 'node:util';
import {makeConfig, parseSweep, ConfigError} from './sim/config.js';
import {parseDuration} from './sim/duration.js';
import type {Config} from './sim/types.js';
import type {LegacyConfig} from './sim/legacy.js';

export class CliError extends Error {
  constructor(msg: string) { super(msg); this.name = 'CliError'; }
}

export type CliResult =
  | {mode: 'legacy'; legacy: LegacyConfig}
  | {mode: 'sweep'; config: Config};

const OPTIONS = {
  lurkers: {type: 'string', short: 'l'},
  authors: {type: 'string', short: 'a'},
  duration: {type: 'string', short: 'd'},
  padcount: {type: 'string', short: 'p'},
  sweep: {type: 'string'},
  report: {type: 'string'},
  'scrape-url': {type: 'string'},
  'scrape-interval': {type: 'string'},
  'scrape-keep': {type: 'string'},
  'edit-interval': {type: 'string'},
  'break-p95': {type: 'string'},
  'break-evloop-p95': {type: 'string'},
  'break-error-rate': {type: 'string'},
  'break-action': {type: 'string'},
  'keep-raw-samples': {type: 'boolean'},
  'run-id': {type: 'string'},
  'json-only': {type: 'boolean'},
  'connect-timeout': {type: 'string'},
  force: {type: 'boolean'},
  'respawn-drops': {type: 'boolean'},
  multi: {type: 'boolean'},
} as const;

const toNum = (v: string | boolean | undefined): number | undefined =>
  typeof v === 'string' ? Number(v) : undefined;

export const parseCliArgs = (argv: string[]): CliResult => {
  let parsed;
  try {
    parsed = parseArgs({args: argv, options: OPTIONS, allowPositionals: true, strict: true});
  } catch (e) {
    throw new CliError((e as Error).message);
  }
  const v = parsed.values;
  const host = parsed.positionals.find((p) => p.includes('http'));

  if (!v.sweep) {
    const legacy: LegacyConfig = {
      host,
      authors: toNum(v.authors as string | undefined),
      lurkers: toNum(v.lurkers as string | undefined),
      durationS: toNum(v.duration as string | undefined),
    };
    return {mode: 'legacy', legacy};
  }

  try {
    const sweep = parseSweep(v.sweep as string);
    const config = makeConfig({
      sutUrl: host ?? undefined,
      authors: toNum(v.authors as string | undefined),
      lurkers: toNum(v.lurkers as string | undefined),
      durationS: toNum(v.duration as string | undefined),
      sweep,
      outDir: v.report as string | undefined,
      runId: v['run-id'] as string | undefined,
      scrapeUrl: v['scrape-url'] as string | undefined,
      scrapeIntervalMs: v['scrape-interval'] ? parseDuration(v['scrape-interval'] as string) : undefined,
      scrapeKeep: v['scrape-keep']
        ? (v['scrape-keep'] as string).split(',').map((s) => s.trim()).filter(Boolean)
        : undefined,
      editIntervalMs: v['edit-interval'] ? parseDuration(v['edit-interval'] as string) : undefined,
      breakP95Ms: toNum(v['break-p95'] as string | undefined),
      breakEventLoopP95Ms: toNum(v['break-evloop-p95'] as string | undefined),
      breakErrorRate: toNum(v['break-error-rate'] as string | undefined),
      breakAction: v['break-action'] === 'stop' ? 'stop' : 'continue',
      jsonOnly: v['json-only'] === true,
      keepRawSamples: v['keep-raw-samples'] === true,
      connectTimeoutMs: v['connect-timeout'] ? parseDuration(v['connect-timeout'] as string) : undefined,
      force: v.force === true,
      respawnDrops: v['respawn-drops'] === true,
    });
    return {mode: 'sweep', config};
  } catch (e) {
    if (e instanceof ConfigError) throw new CliError(e.message);
    throw e;
  }
};

export const main = async (argv: string[] = process.argv.slice(2)): Promise<number> => {
  let r: CliResult;
  try { r = parseCliArgs(argv); }
  catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  if (r.mode === 'legacy') {
    const {runLegacy} = await import('./sim/legacy.js');
    return runLegacy(r.legacy);
  }
  const {Harness} = await import('./sim/harness.js');
  const {Scraper} = await import('./sim/scraper.js');
  const scraper = new Scraper(r.config.scrape);
  const harness = new Harness(r.config, scraper);
  await harness.run();
  console.log(`report written to ${r.config.report.outDir}`);
  return 0;
};
