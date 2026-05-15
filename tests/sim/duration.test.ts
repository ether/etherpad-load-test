import {describe, it, expect} from 'vitest';
import {parseDuration, DurationError} from '../../src/sim/duration.js';

describe('parseDuration', () => {
  it('parses milliseconds', () => {
    expect(parseDuration('200ms')).toBe(200);
    expect(parseDuration('1ms')).toBe(1);
  });
  it('parses seconds', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('0s')).toBe(0);
  });
  it('parses minutes', () => {
    expect(parseDuration('5m')).toBe(300_000);
  });
  it('rejects unitless numbers', () => {
    expect(() => parseDuration('30')).toThrow(DurationError);
  });
  it('rejects empty/garbage', () => {
    expect(() => parseDuration('')).toThrow(DurationError);
    expect(() => parseDuration('abc')).toThrow(DurationError);
    expect(() => parseDuration('30x')).toThrow(DurationError);
  });
  it('rejects negative', () => {
    expect(() => parseDuration('-1s')).toThrow(DurationError);
  });
});
