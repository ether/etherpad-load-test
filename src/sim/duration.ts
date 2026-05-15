export class DurationError extends Error {
  constructor(input: string) {
    super(`invalid duration ${JSON.stringify(input)}; expected e.g. 200ms, 30s, 5m`);
    this.name = 'DurationError';
  }
}

const UNITS: Record<string, number> = {ms: 1, s: 1_000, m: 60_000};

export const parseDuration = (input: string): number => {
  const m = /^(\d+)(ms|s|m)$/.exec(input);
  if (!m) throw new DurationError(input);
  return Number(m[1]) * UNITS[m[2]!]!;
};
