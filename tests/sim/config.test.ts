import {describe, it, expect} from 'vitest';
import {makeConfig, parseSweep, ConfigError} from '../../src/sim/config.js';

describe('makeConfig defaults', () => {
  it('returns sane defaults when given empty input', () => {
    const c = makeConfig({});
    expect(c.sutUrl).toBe('http://127.0.0.1:9001');
    expect(c.editIntervalMs).toBe(200);
    expect(c.connectTimeoutMs).toBe(10_000);
    expect(c.respawnDrops).toBe(false);
    expect(c.break.p95Ms).toBe(2000);
    expect(c.break.eventLoopP95Ms).toBe(500);
    expect(c.break.errorRate).toBe(0.05);
    expect(c.break.action).toBe('continue');
    expect(c.scrape.intervalMs).toBe(1000);
    expect(c.scrape.url).toBe('http://127.0.0.1:9001/stats/prometheus');
    expect(c.scrape.keep).toContain('nodejs_eventloop_lag');
  });

  it('derives scrape url from sutUrl when not overridden', () => {
    const c = makeConfig({sutUrl: 'http://10.0.0.5:9001'});
    expect(c.scrape.url).toBe('http://10.0.0.5:9001/stats/prometheus');
  });

  it('rejects authors < 0', () => {
    expect(() => makeConfig({authors: -1})).toThrow(ConfigError);
  });
});

describe('parseSweep', () => {
  it('parses range with all options', () => {
    const s = parseSweep('authors=10..200:step=10:dwell=30s:warmup=5s');
    expect(s).toEqual({
      axis: 'authors', min: 10, max: 200, step: 10,
      warmupMs: 5_000, dwellMs: 30_000,
    });
  });

  it('applies defaults for omitted parts', () => {
    const s = parseSweep('authors=10..50');
    expect(s.step).toBe(10);
    expect(s.dwellMs).toBe(30_000);
    expect(s.warmupMs).toBe(5_000);
  });

  it('accepts pads axis', () => {
    expect(parseSweep('pads=1..10:step=1').axis).toBe('pads');
  });

  it('rejects bad axis', () => {
    expect(() => parseSweep('foo=1..10')).toThrow(ConfigError);
  });

  it('rejects min > max', () => {
    expect(() => parseSweep('authors=50..10')).toThrow(ConfigError);
  });

  it('rejects step <= 0', () => {
    expect(() => parseSweep('authors=10..50:step=0')).toThrow(ConfigError);
  });
});
