import {describe, it, expect, vi, afterEach} from 'vitest';
import {Scraper} from '../../src/sim/scraper.js';

const FIXTURE_A = `
nodejs_cpu_gauge{type="user"} 10
etherpad_total_users 5
`.trim();

const FIXTURE_B = `
nodejs_cpu_gauge{type="user"} 20
etherpad_total_users 7
`.trim();

const stubFetch = (responses: string[]) => {
  let i = 0;
  return vi.fn(async () => {
    const body = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return new Response(body, {status: 200, headers: {'content-type': 'text/plain'}});
  });
};

afterEach(() => vi.useRealTimers());

describe('Scraper', () => {
  it('snapshot returns latest gauges, filtered by keep', async () => {
    vi.useFakeTimers();
    const fetch = stubFetch([FIXTURE_A, FIXTURE_B]);
    const s = new Scraper({
      url: 'http://x/stats/prometheus',
      intervalMs: 100,
      keep: ['nodejs_cpu_gauge', 'etherpad_total_users'],
    }, fetch);
    s.start();
    await vi.advanceTimersByTimeAsync(50);
    let snap = s.snapshot('first');
    expect(snap.gauges['nodejs_cpu_gauge{type=user}']).toBe(10);
    expect(snap.gauges['etherpad_total_users']).toBe(5);

    await vi.advanceTimersByTimeAsync(100);
    snap = s.snapshot('second');
    expect(snap.gauges['nodejs_cpu_gauge{type=user}']).toBe(20);
    expect(snap.gauges['etherpad_total_users']).toBe(7);
    expect(snap.label).toBe('second');

    await s.stop();
  });

  it('snapshot returns empty gauges before first successful poll', () => {
    const fetch = vi.fn(async () => new Response('', {status: 500}));
    const s = new Scraper({url: 'http://x', intervalMs: 100, keep: ['x']}, fetch);
    const snap = s.snapshot('initial');
    expect(snap.gauges).toEqual({});
    expect(snap.label).toBe('initial');
  });

  it('stop halts further polls', async () => {
    vi.useFakeTimers();
    const fetch = stubFetch([FIXTURE_A]);
    const s = new Scraper({url: 'http://x', intervalMs: 50, keep: ['nodejs_cpu_gauge']}, fetch);
    s.start();
    await vi.advanceTimersByTimeAsync(30);
    await s.stop();
    const before = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch.mock.calls.length).toBe(before);
  });
});
