import {describe, it, expect} from 'vitest';
import {parseCliArgs, CliError} from '../../src/cli.js';

describe('parseCliArgs', () => {
  it('returns legacy-mode config when no --sweep is given', () => {
    const r = parseCliArgs(['-d', '25', '-a', '50']);
    expect(r.mode).toBe('legacy');
    if (r.mode !== 'legacy') throw new Error('not legacy');
    expect(r.legacy.authors).toBe(50);
    expect(r.legacy.durationS).toBe(25);
  });

  it('returns sweep-mode config when --sweep is given', () => {
    const r = parseCliArgs(['--sweep', 'authors=10..50:step=10:dwell=2s:warmup=500ms',
                            '--report', '/tmp/out', '--scrape-interval', '500ms']);
    expect(r.mode).toBe('sweep');
    if (r.mode !== 'sweep') throw new Error('not sweep');
    expect(r.config.sweep!.min).toBe(10);
    expect(r.config.sweep!.max).toBe(50);
    expect(r.config.sweep!.dwellMs).toBe(2000);
    expect(r.config.scrape.intervalMs).toBe(500);
    expect(r.config.report.outDir).toBe('/tmp/out');
  });

  it('threads positional URL through to legacy mode', () => {
    const r = parseCliArgs(['http://10.0.0.5:9001/p/x', '-d', '5']);
    expect(r.mode).toBe('legacy');
    if (r.mode !== 'legacy') throw new Error('not legacy');
    expect(r.legacy.host).toBe('http://10.0.0.5:9001/p/x');
  });

  it('rejects unknown flags with CliError', () => {
    expect(() => parseCliArgs(['--bogus'])).toThrow(CliError);
  });
});
