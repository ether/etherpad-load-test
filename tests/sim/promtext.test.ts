import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {parsePromText, filterByPrefix} from '../../src/sim/promtext.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, '../fixtures/prometheus-sample.txt'), 'utf8');

describe('parsePromText', () => {
  it('returns labelled gauge values as flat keys', () => {
    const g = parsePromText(FIXTURE);
    expect(g['nodejs_cpu_gauge{type=user}']).toBe(22.4);
    expect(g['nodejs_cpu_gauge{type=system}']).toBe(3.1);
    expect(g['etherpad_total_users']).toBe(60);
  });

  it('omits comment lines', () => {
    const g = parsePromText(FIXTURE);
    expect(Object.keys(g).some((k) => k.startsWith('#'))).toBe(false);
  });

  it('handles a summary the same as a labelled gauge (each line is one row)', () => {
    const g = parsePromText(FIXTURE);
    expect(g['http_duration{url=/p/x,quantile=0.5}']).toBe(12);
    expect(g['http_duration_count{url=/p/x}']).toBe(100);
  });
});

describe('filterByPrefix', () => {
  it('keeps only keys whose base name (before `{`) starts with an allowlisted prefix', () => {
    const all = {
      'nodejs_cpu_gauge{type=user}': 22.4,
      'nodejs_cpu_gauge{type=system}': 3.1,
      'etherpad_total_users': 60,
      'http_duration{url=/p/x,quantile=0.5}': 12,
    };
    const out = filterByPrefix(all, ['nodejs_cpu_gauge', 'etherpad_total_users']);
    expect(out).toEqual({
      'nodejs_cpu_gauge{type=user}': 22.4,
      'nodejs_cpu_gauge{type=system}': 3.1,
      'etherpad_total_users': 60,
    });
  });
});
