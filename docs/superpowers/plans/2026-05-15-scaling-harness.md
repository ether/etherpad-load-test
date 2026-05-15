# Scaling Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `etherpad-load-test` into a measurement instrument: a `sim/` library + thin CLI that produces concurrency-vs-latency curves with prom-scraped server metrics, while preserving today's `etherpad-loadtest -d N -a M` invocation byte-for-byte so `ether/etherpad`'s `load-test.yml` workflow cannot regress.

**Architecture:** Two-layer split — `src/sim/` (pure library: Author, Harness, Scraper, Reporter, Config, types) + `src/cli.ts` (argv → Config → dispatch to `runLegacy` or `harness.run`). Legacy code path is isolated in `src/sim/legacy.ts` (port of today's `app.ts`); new measurement plumbing never executes on the legacy path. Output: `report.{json,csv,md}` per run. Server metrics scraped from `/stats/prometheus`.

**Tech Stack:** TypeScript (ES2022, ESM, strict), Vitest for tests, `hdr-histogram-js` for percentiles, `etherpad-cli-client` for socket transport (unchanged from today), `node:util.parseArgs` for CLI parsing, hand-rolled minimal prom-text parser.

**Spec:** `docs/superpowers/specs/2026-05-15-scaling-dive-design.md`. This plan covers Phase 1 only (the harness); Phase 2 is manual research described in the spec.

---

## File map

**Created:**
- `vitest.config.ts` — test runner config
- `tsconfig.test.json` — extends `tsconfig.json`, adds `tests/` for type-checking
- `src/sim/types.ts` — shared types: `Sample`, `Snapshot`, `StepResult`, `RunMeta`, `Report`, `Config`, `SweepConfig`, `ScrapeConfig`, `BreakConfig`
- `src/sim/duration.ts` — duration string parser (`200ms`, `30s`, `5m`)
- `src/sim/config.ts` — `parseConfig`, `validateConfig`, defaults
- `src/sim/promtext.ts` — minimal prom-text format parser
- `src/sim/scraper.ts` — `Scraper` class: poll + snapshot
- `src/sim/histogram.ts` — wraps `hdr-histogram-js` to the percentile API Reporter wants
- `src/sim/reporter.ts` — `Reporter` class: accumulate steps, write JSON+CSV+MD
- `src/sim/author.ts` — `Author` class: one simulated participant
- `src/sim/harness.ts` — `Harness` class: sweep orchestration
- `src/sim/legacy.ts` — `runLegacy(config)` — port of today's `app.ts` run loop
- `src/cli.ts` — argv parsing + dispatch
- `tests/fixtures/prometheus-sample.txt` — captured `/stats/prometheus` output for parser tests
- `tests/sim/duration.test.ts`
- `tests/sim/config.test.ts`
- `tests/sim/promtext.test.ts`
- `tests/sim/scraper.test.ts`
- `tests/sim/histogram.test.ts`
- `tests/sim/reporter.test.ts`
- `tests/sim/author.test.ts`
- `tests/sim/harness.test.ts`
- `tests/sim/cli.test.ts`
- `tests/sim/integration.test.ts` (gated by `LOADTEST_INTEGRATION_URL` env var)
- `tests/sim/legacy-contract.test.ts` (gated by `LOADTEST_INTEGRATION_URL` env var)

**Modified:**
- `package.json` — add `vitest`, `hdr-histogram-js`; add `test` and `test:integration` scripts
- `tsconfig.json` — explicit `exclude: ["node_modules", "dist", "tests"]` so `tsc` build skips tests
- `src/app.ts` — replace with thin shim that imports `cli.ts` (preserves `bin` entry)
- `src/multi.ts` — replace with thin shim that injects `--multi` and forwards
- `README.md` — document new flags + sweep mode
- `.github/workflows/backend-tests.yml` — add `pnpm test` step before the live load test

---

### Task 1: Add Vitest, hdr-histogram-js, and test scripts

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tsconfig.test.json`
- Create: `tests/.gitkeep`

- [ ] **Step 1: Install dev dependencies**

Run from repo root:
```bash
pnpm add -D vitest@^2 @types/node@^20
pnpm add hdr-histogram-js@^3
```
Expected: `pnpm-lock.yaml` updates, no errors.

- [ ] **Step 2: Add test scripts to `package.json`**

Add to `"scripts"`:
```json
"test": "vitest run --exclude '**/integration.test.ts' --exclude '**/legacy-contract.test.ts'",
"test:integration": "vitest run tests/sim/integration.test.ts tests/sim/legacy-contract.test.ts",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['tests/**/*.test.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
```

- [ ] **Step 4: Create `tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 5: Update `tsconfig.json` to exclude tests from build**

Change the `exclude` line to:
```json
"exclude": ["node_modules", "dist", "tests", "vitest.config.ts"]
```

- [ ] **Step 6: Create empty `tests/` dir tracked by git**

```bash
mkdir -p tests/sim tests/fixtures
touch tests/.gitkeep
```

- [ ] **Step 7: Verify tooling**

```bash
pnpm run build
pnpm test
```
Expected: build succeeds (no source changes yet); `pnpm test` reports "No test files found" and exits 0 (vitest treats this as success when `passWithNoTests` is default; if it fails, add `passWithNoTests: true` to the config).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts tsconfig.test.json tsconfig.json tests/.gitkeep
git commit -m "chore(harness): add vitest + hdr-histogram-js tooling"
```

---

### Task 2: Shared types module

**Files:**
- Create: `src/sim/types.ts`

- [ ] **Step 1: Create the types module**

```ts
// src/sim/types.ts

export interface Sample {
  authorId: string;
  sentAtNs: bigint;
  ackedAtNs: bigint;
  latencyMs: number;
}

export interface Snapshot {
  label: string;
  scrapedAt: string; // ISO timestamp
  gauges: Record<string, number>;
}

export interface StepResult {
  step: number;
  latencyMs: {p50: number; p95: number; p99: number; max: number; count: number};
  throughputCsps: number;
  snapshot: Snapshot;
  droppedAuthors: number;
  errors: number;
  breakageFlags: string[];
  samples: Sample[] | null;
}

export interface MachineInfo {
  cpus: string;
  totalMemMB: number;
  node: string;
  os: string;
}

export interface RunMeta {
  runId: string;
  startedAt: string;
  finishedAt: string;
  sut: {url: string; gitSha?: string; version?: string};
  machine: MachineInfo;
  partial?: boolean;
}

export interface SweepConfig {
  axis: 'authors' | 'pads';
  min: number;
  max: number;
  step: number;
  warmupMs: number;
  dwellMs: number;
}

export interface ScrapeConfig {
  url: string;
  intervalMs: number;
  keep: string[]; // base-name prefixes
}

export interface BreakConfig {
  p95Ms: number;
  eventLoopP95Ms: number;
  errorRate: number;
  action: 'stop' | 'continue';
}

export interface ReportConfig {
  outDir: string;
  runId: string;
  jsonOnly: boolean;
  keepRawSamples: boolean;
  force: boolean;
}

export interface Config {
  sutUrl: string;
  padId?: string;
  lurkers: number;
  authors: number;
  durationS?: number;
  editIntervalMs: number;
  connectTimeoutMs: number;
  respawnDrops: boolean;
  sweep?: SweepConfig;
  scrape: ScrapeConfig;
  break: BreakConfig;
  report: ReportConfig;
}

export interface Report {
  meta: RunMeta;
  config: Config;
  steps: StepResult[];
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
pnpm exec tsc -p tsconfig.test.json
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/sim/types.ts
git commit -m "feat(sim): add shared types for harness data shapes"
```

---

### Task 3: Duration parser

**Files:**
- Create: `src/sim/duration.ts`
- Create: `tests/sim/duration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/sim/duration.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/sim/duration.test.ts
```
Expected: FAIL with "Cannot find module" for `../../src/sim/duration.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/sim/duration.ts
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
```

- [ ] **Step 4: Run tests, verify pass**

```bash
pnpm test tests/sim/duration.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/duration.ts tests/sim/duration.test.ts
git commit -m "feat(sim): add duration parser"
```

---

### Task 4: Config defaults + validator

**Files:**
- Create: `src/sim/config.ts`
- Create: `tests/sim/config.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/sim/config.test.ts
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
    expect(c.scrape.keep).toContain('nodejs_eventloop_latency_gauge');
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
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/sim/config.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/sim/config.ts
import type {Config, SweepConfig, ScrapeConfig, BreakConfig, ReportConfig} from './types.js';
import {parseDuration} from './duration.js';

export class ConfigError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ConfigError'; }
}

export interface ConfigInput {
  sutUrl?: string;
  padId?: string;
  lurkers?: number;
  authors?: number;
  durationS?: number;
  editIntervalMs?: number;
  connectTimeoutMs?: number;
  respawnDrops?: boolean;
  sweep?: SweepConfig;
  scrapeUrl?: string;
  scrapeIntervalMs?: number;
  scrapeKeep?: string[];
  breakP95Ms?: number;
  breakEventLoopP95Ms?: number;
  breakErrorRate?: number;
  breakAction?: 'stop' | 'continue';
  outDir?: string;
  runId?: string;
  jsonOnly?: boolean;
  keepRawSamples?: boolean;
  force?: boolean;
}

const DEFAULT_KEEP = [
  'nodejs_cpu_gauge',
  'nodejs_eventloop_latency_gauge',
  'nodejs_memory_process_gauge',
  'nodejs_gc_gauge',
  'etherpad_total_users',
  'etherpad_active_pads',
  'etherpad_pad_users',
  'etherpad_changeset_apply_duration_seconds',
  'etherpad_socket_emits_total',
];

const requireNonNeg = (name: string, v: number | undefined): void => {
  if (v !== undefined && v < 0) throw new ConfigError(`${name} must be >= 0`);
};

export const parseSweep = (raw: string): SweepConfig => {
  const m = /^(authors|pads)=(\d+)\.\.(\d+)(?::(.+))?$/.exec(raw);
  if (!m) throw new ConfigError(`bad --sweep value: ${raw}`);
  const axis = m[1] as 'authors' | 'pads';
  const min = Number(m[2]);
  const max = Number(m[3]);
  if (min > max) throw new ConfigError(`sweep min ${min} > max ${max}`);

  let step = 10;
  let dwellMs = 30_000;
  let warmupMs = 5_000;
  if (m[4]) {
    for (const part of m[4].split(':')) {
      const [k, v] = part.split('=');
      if (k === 'step') {
        step = Number(v);
        if (!Number.isFinite(step) || step <= 0) throw new ConfigError(`sweep step must be > 0`);
      } else if (k === 'dwell') {
        dwellMs = parseDuration(v ?? '');
      } else if (k === 'warmup') {
        warmupMs = parseDuration(v ?? '');
      } else {
        throw new ConfigError(`unknown sweep field: ${k}`);
      }
    }
  }
  return {axis, min, max, step, warmupMs, dwellMs};
};

export const makeConfig = (input: ConfigInput): Config => {
  requireNonNeg('authors', input.authors);
  requireNonNeg('lurkers', input.lurkers);
  requireNonNeg('durationS', input.durationS);

  const sutUrl = input.sutUrl ?? 'http://127.0.0.1:9001';

  const scrape: ScrapeConfig = {
    url: input.scrapeUrl ?? `${sutUrl.replace(/\/$/, '')}/stats/prometheus`,
    intervalMs: input.scrapeIntervalMs ?? 1_000,
    keep: input.scrapeKeep ?? DEFAULT_KEEP,
  };

  const brk: BreakConfig = {
    p95Ms: input.breakP95Ms ?? 2000,
    eventLoopP95Ms: input.breakEventLoopP95Ms ?? 500,
    errorRate: input.breakErrorRate ?? 0.05,
    action: input.breakAction ?? 'continue',
  };

  const runId = input.runId ?? new Date().toISOString().replace(/[:.]/g, '-');

  const report: ReportConfig = {
    outDir: input.outDir ?? `./loadtest-out/${runId}`,
    runId,
    jsonOnly: input.jsonOnly ?? false,
    keepRawSamples: input.keepRawSamples ?? false,
    force: input.force ?? false,
  };

  return {
    sutUrl,
    padId: input.padId,
    lurkers: input.lurkers ?? 0,
    authors: input.authors ?? 0,
    durationS: input.durationS,
    editIntervalMs: input.editIntervalMs ?? 200,
    connectTimeoutMs: input.connectTimeoutMs ?? 10_000,
    respawnDrops: input.respawnDrops ?? false,
    sweep: input.sweep,
    scrape,
    break: brk,
    report,
  };
};
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/sim/config.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/config.ts tests/sim/config.test.ts
git commit -m "feat(sim): add config defaults and sweep parser"
```

---

### Task 5: Prometheus-text parser

**Files:**
- Create: `src/sim/promtext.ts`
- Create: `tests/sim/promtext.test.ts`
- Create: `tests/fixtures/prometheus-sample.txt`

- [ ] **Step 1: Capture a real `/stats/prometheus` fixture**

Create `tests/fixtures/prometheus-sample.txt` with this hand-curated minimal fixture (matches the format `prom-client` produces):

```
# HELP nodejs_cpu_gauge gauge for nodejs cpu
# TYPE nodejs_cpu_gauge gauge
nodejs_cpu_gauge{type="user"} 22.4
nodejs_cpu_gauge{type="system"} 3.1

# HELP nodejs_eventloop_latency_gauge gauge for nodejs_eventloop_latency
# TYPE nodejs_eventloop_latency_gauge gauge
nodejs_eventloop_latency_gauge{type="p50"} 0.8
nodejs_eventloop_latency_gauge{type="p95"} 3.1

# HELP etherpad_total_users Total number of users
# TYPE etherpad_total_users gauge
etherpad_total_users 60

# HELP http_duration summary for http_duration
# TYPE http_duration summary
http_duration{url="/p/x",quantile="0.5"} 12
http_duration_count{url="/p/x"} 100
http_duration_sum{url="/p/x"} 1500
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/sim/promtext.test.ts
import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parsePromText, filterByPrefix} from '../../src/sim/promtext.js';

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
```

- [ ] **Step 3: Run, verify fail**

```bash
pnpm test tests/sim/promtext.test.ts
```
Expected: FAIL with module not found.

- [ ] **Step 4: Implement**

```ts
// src/sim/promtext.ts

// Matches: name{l1="v1",l2="v2"} 12.3   OR   name 12.3
const LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(-?[0-9.eE+-]+|\+Inf|-Inf|NaN)\s*$/;

const flattenLabels = (raw: string | undefined): string => {
  if (!raw) return '';
  // Strip outer braces and quotes from values: {a="1",b="2"} -> {a=1,b=2}
  const inner = raw.slice(1, -1);
  if (!inner) return '';
  const parts = inner.split(',').map((p) => p.trim().replace(/="([^"]*)"/, '=$1'));
  return `{${parts.join(',')}}`;
};

export const parsePromText = (text: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = LINE.exec(t);
    if (!m) continue;
    const [, name, labels, value] = m;
    if (value === undefined) continue;
    let n: number;
    if (value === '+Inf') n = Infinity;
    else if (value === '-Inf') n = -Infinity;
    else if (value === 'NaN') n = NaN;
    else n = Number(value);
    out[`${name}${flattenLabels(labels)}`] = n;
  }
  return out;
};

export const filterByPrefix = (
  gauges: Record<string, number>,
  prefixes: string[],
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(gauges)) {
    const base = k.split('{', 1)[0]!;
    if (prefixes.some((p) => base === p || base.startsWith(p + '_') || base === p)) {
      out[k] = v;
    } else if (prefixes.some((p) => base.startsWith(p))) {
      // Allow strict prefix match too (e.g., 'etherpad_total_users' starts with itself)
      out[k] = v;
    }
  }
  return out;
};
```

- [ ] **Step 5: Run, verify pass**

```bash
pnpm test tests/sim/promtext.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/sim/promtext.ts tests/sim/promtext.test.ts tests/fixtures/prometheus-sample.txt
git commit -m "feat(sim): add minimal prom-text parser"
```

---

### Task 6: Scraper (polling + snapshot)

**Files:**
- Create: `src/sim/scraper.ts`
- Create: `tests/sim/scraper.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/sim/scraper.test.ts
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
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/sim/scraper.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/sim/scraper.ts
import {parsePromText, filterByPrefix} from './promtext.js';
import type {Snapshot, ScrapeConfig} from './types.js';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class Scraper {
  private timer?: NodeJS.Timeout;
  private latest: Record<string, number> = {};
  private latestAt = '1970-01-01T00:00:00.000Z';
  private readonly fetchFn: FetchLike;

  constructor(private readonly cfg: ScrapeConfig, fetchFn?: FetchLike) {
    this.fetchFn = fetchFn ?? ((u, init) => fetch(u, init));
  }

  start(): void {
    if (this.timer) return;
    const poll = async (): Promise<void> => {
      try {
        const resp = await this.fetchFn(this.cfg.url);
        if (!resp.ok) return;
        const text = await resp.text();
        const all = parsePromText(text);
        this.latest = filterByPrefix(all, this.cfg.keep);
        this.latestAt = new Date().toISOString();
      } catch {
        // swallow; harness keeps running, snapshot will show stale values
      }
    };
    // fire-and-forget immediately, then on interval
    void poll();
    this.timer = setInterval(() => { void poll(); }, this.cfg.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  snapshot(label: string): Snapshot {
    return {label, scrapedAt: this.latestAt, gauges: {...this.latest}};
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/sim/scraper.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/scraper.ts tests/sim/scraper.test.ts
git commit -m "feat(sim): add Scraper for /stats/prometheus polling"
```

---

### Task 7: Histogram wrapper

**Files:**
- Create: `src/sim/histogram.ts`
- Create: `tests/sim/histogram.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/sim/histogram.test.ts
import {describe, it, expect} from 'vitest';
import {LatencyHistogram} from '../../src/sim/histogram.js';

describe('LatencyHistogram', () => {
  it('records values and returns ordered percentiles', () => {
    const h = new LatencyHistogram();
    for (let i = 1; i <= 1000; i++) h.recordMs(i);
    const s = h.summary();
    expect(s.count).toBe(1000);
    expect(s.p50).toBeGreaterThanOrEqual(500);
    expect(s.p50).toBeLessThanOrEqual(510);
    expect(s.p95).toBeGreaterThanOrEqual(950);
    expect(s.p99).toBeGreaterThanOrEqual(990);
    expect(s.max).toBeGreaterThanOrEqual(1000);
    expect(s.p50).toBeLessThanOrEqual(s.p95);
    expect(s.p95).toBeLessThanOrEqual(s.p99);
    expect(s.p99).toBeLessThanOrEqual(s.max);
  });

  it('zero-sample summary returns zeros', () => {
    const h = new LatencyHistogram();
    const s = h.summary();
    expect(s).toEqual({p50: 0, p95: 0, p99: 0, max: 0, count: 0});
  });

  it('reset clears recorded data', () => {
    const h = new LatencyHistogram();
    h.recordMs(100);
    h.reset();
    expect(h.summary().count).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/sim/histogram.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/sim/histogram.ts
import hdr from 'hdr-histogram-js';

export interface LatencySummary {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  count: number;
}

export class LatencyHistogram {
  private h = hdr.build({
    bitBucketSize: 32,
    highestTrackableValue: 60 * 60 * 1000, // 1 hour in ms
    numberOfSignificantValueDigits: 3,
  });

  recordMs(v: number): void {
    if (!Number.isFinite(v) || v < 0) return;
    this.h.recordValue(Math.floor(v));
  }

  summary(): LatencySummary {
    if (this.h.totalCount === 0) {
      return {p50: 0, p95: 0, p99: 0, max: 0, count: 0};
    }
    return {
      p50: this.h.getValueAtPercentile(50),
      p95: this.h.getValueAtPercentile(95),
      p99: this.h.getValueAtPercentile(99),
      max: this.h.maxValue,
      count: this.h.totalCount,
    };
  }

  reset(): void { this.h.reset(); }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/sim/histogram.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/histogram.ts tests/sim/histogram.test.ts
git commit -m "feat(sim): add LatencyHistogram wrapper around hdr-histogram-js"
```

---

### Task 8: Reporter — JSON output

**Files:**
- Create: `src/sim/reporter.ts`
- Create: `tests/sim/reporter.test.ts`

- [ ] **Step 1: Write the failing test for JSON output**

```ts
// tests/sim/reporter.test.ts
import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Reporter} from '../../src/sim/reporter.js';
import type {StepResult, RunMeta, Config} from '../../src/sim/types.js';
import {makeConfig} from '../../src/sim/config.js';

const meta = (): RunMeta => ({
  runId: 'test-run',
  startedAt: '2026-05-15T00:00:00.000Z',
  finishedAt: '2026-05-15T00:01:00.000Z',
  sut: {url: 'http://x:9001', gitSha: 'abc', version: '1.0.0'},
  machine: {cpus: 'TestCPU', totalMemMB: 1024, node: 'v22', os: 'linux'},
});

const stepResult = (step: number, latency: number): StepResult => ({
  step,
  latencyMs: {p50: latency, p95: latency * 2, p99: latency * 3, max: latency * 4, count: 100},
  throughputCsps: step * 5,
  snapshot: {label: `step=${step}`, scrapedAt: '2026-05-15T00:00:30.000Z',
             gauges: {'nodejs_cpu_gauge{type=user}': 20, 'etherpad_total_users': step}},
  droppedAuthors: 0,
  errors: 0,
  breakageFlags: [],
  samples: null,
});

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rep-')); });
afterEach(() => rmSync(dir, {recursive: true, force: true}));

describe('Reporter JSON output', () => {
  it('writes a report.json with meta + config + steps', async () => {
    const cfg: Config = makeConfig({outDir: dir, runId: 'test-run'});
    const r = new Reporter({outDir: dir, runMeta: meta(), config: cfg});
    r.addStep(stepResult(10, 20));
    r.addStep(stepResult(20, 40));
    const paths = await r.write();
    expect(existsSync(paths.json)).toBe(true);
    const j = JSON.parse(readFileSync(paths.json, 'utf8'));
    expect(j.runId).toBe('test-run');
    expect(j.steps).toHaveLength(2);
    expect(j.steps[0].step).toBe(10);
    expect(j.steps[0].latencyMs.p50).toBe(20);
    expect(j.steps[1].latencyMs.p50).toBe(40);
  });

  it('marks the report partial when partial=true on meta', async () => {
    const cfg = makeConfig({outDir: dir});
    const m = {...meta(), partial: true};
    const r = new Reporter({outDir: dir, runMeta: m, config: cfg});
    r.addStep(stepResult(10, 20));
    const paths = await r.write();
    const j = JSON.parse(readFileSync(paths.json, 'utf8'));
    expect(j.partial).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/sim/reporter.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement Reporter with JSON only**

```ts
// src/sim/reporter.ts
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
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/sim/reporter.test.ts
```
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/reporter.ts tests/sim/reporter.test.ts
git commit -m "feat(sim): Reporter writes report.json"
```

---

### Task 9: Reporter — CSV output

**Files:**
- Modify: `src/sim/reporter.ts`
- Modify: `tests/sim/reporter.test.ts`

- [ ] **Step 1: Append a failing CSV test**

Append to `tests/sim/reporter.test.ts`:

```ts
describe('Reporter CSV output', () => {
  it('writes one row per step with curated columns', async () => {
    const cfg = makeConfig({outDir: dir});
    const r = new Reporter({outDir: dir, runMeta: meta(), config: cfg});
    r.addStep(stepResult(10, 20));
    r.addStep(stepResult(20, 40));
    const paths = await r.write();
    const csv = readFileSync(paths.csv, 'utf8');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('step,p50,p95,p99,max,throughput_csps,cpu_user,evloop_p95_ms,rss_mb,users,errors,break');
    expect(lines[1]!.split(',')[0]).toBe('10');
    expect(lines[1]!.split(',')[1]).toBe('20');
    expect(lines[2]!.split(',')[0]).toBe('20');
  });

  it('emits empty cells when a metric is missing', async () => {
    const cfg = makeConfig({outDir: dir});
    const r = new Reporter({outDir: dir, runMeta: meta(), config: cfg});
    const s = stepResult(10, 20);
    s.snapshot.gauges = {}; // strip all gauges
    r.addStep(s);
    const paths = await r.write();
    const csv = readFileSync(paths.csv, 'utf8');
    const cols = csv.trim().split('\n')[1]!.split(',');
    // step,p50,p95,p99,max,throughput_csps,<cpu_user>,<evloop_p95_ms>,<rss_mb>,<users>,errors,break
    expect(cols[6]).toBe(''); // cpu_user missing
    expect(cols[7]).toBe(''); // evloop missing
    expect(cols[8]).toBe(''); // rss missing
    expect(cols[9]).toBe(''); // users missing
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/sim/reporter.test.ts
```
Expected: 2 new tests fail (CSV is empty).

- [ ] **Step 3: Implement CSV writer**

Replace the body of `async write()` in `src/sim/reporter.ts`:

```ts
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
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/sim/reporter.test.ts
```
Expected: 4 tests pass total (JSON + CSV).

- [ ] **Step 5: Commit**

```bash
git add src/sim/reporter.ts tests/sim/reporter.test.ts
git commit -m "feat(sim): Reporter writes report.csv with curated columns"
```

---

### Task 10: Reporter — Markdown output

**Files:**
- Modify: `src/sim/reporter.ts`
- Modify: `tests/sim/reporter.test.ts`

- [ ] **Step 1: Append failing MD test**

Append to `tests/sim/reporter.test.ts`:

```ts
describe('Reporter MD output', () => {
  it('writes a markdown summary with table + sparkline', async () => {
    const cfg = makeConfig({outDir: dir});
    const r = new Reporter({outDir: dir, runMeta: meta(), config: cfg});
    r.addStep(stepResult(10, 20));
    r.addStep(stepResult(20, 40));
    const paths = await r.write();
    const md = readFileSync(paths.md, 'utf8');
    expect(md).toContain('# Etherpad scaling sweep');
    expect(md).toContain('test-run');
    expect(md).toContain('| Step | p50 | p95 |');
    expect(md).toContain('| 10 ');
    expect(md).toContain('| 20 ');
    expect(md).toContain('p95 latency (ms) vs concurrency');
  });

  it('jsonOnly skips csv and md', async () => {
    const cfg = makeConfig({outDir: dir, jsonOnly: true});
    const r = new Reporter({outDir: dir, runMeta: meta(), config: cfg});
    r.addStep(stepResult(10, 20));
    const paths = await r.write();
    expect(existsSync(paths.json)).toBe(true);
    expect(existsSync(paths.csv)).toBe(false);
    expect(existsSync(paths.md)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/sim/reporter.test.ts
```
Expected: 2 new tests fail (MD not written, jsonOnly not honored).

- [ ] **Step 3: Implement MD writer + jsonOnly**

In `src/sim/reporter.ts`, replace the `async write()` body and add `toMd()`:

```ts
async write(): Promise<WrittenPaths> {
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
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/sim/reporter.test.ts
```
Expected: 6 tests total pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/reporter.ts tests/sim/reporter.test.ts
git commit -m "feat(sim): Reporter writes report.md with table + sparkline"
```

---

### Task 11: Author — connect + sample matching

**Files:**
- Create: `src/sim/author.ts`
- Create: `tests/sim/author.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/sim/author.test.ts
import {describe, it, expect, vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {Author, type PadLike} from '../../src/sim/author.js';

class StubPad extends EventEmitter implements PadLike {
  appended: string[] = [];
  append(s: string): void { this.appended.push(s); this.emitAck(); }
  disconnect(): void { this.emit('disconnected'); }
  private ackQueue: number[] = [];
  /** Schedule an ACCEPT_COMMIT to fire `delayMs` after the next append() */
  scheduleAck(delayMs: number): void { this.ackQueue.push(delayMs); }
  private emitAck(): void {
    const d = this.ackQueue.shift() ?? 0;
    setTimeout(() => {
      this.emit('message', {type: 'COLLABROOM', data: {type: 'ACCEPT_COMMIT'}});
    }, d);
  }
}

describe('Author', () => {
  it('records latency for each ACCEPT_COMMIT in FIFO order', async () => {
    vi.useFakeTimers();
    const pad = new StubPad();
    const factory = () => pad;
    const a = new Author({url: 'http://x', padId: 'p', authorName: 'a1',
                          editIntervalMs: 100, padFactory: factory});
    await a.connect();
    pad.emit('connected', {});
    pad.scheduleAck(50);
    a.start();
    await vi.advanceTimersByTimeAsync(100); // one append fires
    await vi.advanceTimersByTimeAsync(60);  // ack arrives
    const samples = a.drainSamples();
    expect(samples).toHaveLength(1);
    expect(samples[0]!.latencyMs).toBeGreaterThanOrEqual(45);
    expect(samples[0]!.latencyMs).toBeLessThanOrEqual(60);
    await a.stop();
  });

  it('does not lose FIFO order across multiple in-flight acks', async () => {
    vi.useFakeTimers();
    const pad = new StubPad();
    const a = new Author({url: 'http://x', padId: 'p', authorName: 'a2',
                          editIntervalMs: 100, padFactory: () => pad});
    await a.connect();
    pad.emit('connected', {});
    pad.scheduleAck(150); // first append's ack
    pad.scheduleAck(20);  // second append's ack
    a.start();
    await vi.advanceTimersByTimeAsync(250);
    const samples = a.drainSamples();
    expect(samples).toHaveLength(2);
    // FIFO: first sample matches first ack (150ms), second matches second (20ms)
    expect(samples[0]!.latencyMs).toBeGreaterThan(samples[1]!.latencyMs);
    await a.stop();
  });

  it('drainSamples clears the buffer', async () => {
    vi.useFakeTimers();
    const pad = new StubPad();
    const a = new Author({url: 'http://x', padId: 'p', authorName: 'a3',
                          editIntervalMs: 100, padFactory: () => pad});
    await a.connect();
    pad.emit('connected', {});
    pad.scheduleAck(10);
    a.start();
    await vi.advanceTimersByTimeAsync(120);
    expect(a.drainSamples()).toHaveLength(1);
    expect(a.drainSamples()).toHaveLength(0);
    await a.stop();
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/sim/author.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement Author**

```ts
// src/sim/author.ts
import {EventEmitter} from 'node:events';
import {connect} from 'etherpad-cli-client';
import type {Sample} from './types.js';

export interface PadLike extends EventEmitter {
  append(s: string): void;
  disconnect(): void;
}

export interface AuthorOpts {
  url: string;
  padId: string;
  authorName: string;
  editIntervalMs: number;
  /** Override for tests. Defaults to the real etherpad-cli-client connect. */
  padFactory?: (url: string) => PadLike;
}

type CollabMsg = {type?: string; data?: {type?: string}};

const randomText = (len = 4): string => {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += String.fromCharCode(Math.floor(Math.random() * 26) + 97);
  }
  return s;
};

export class Author extends EventEmitter {
  private pad?: PadLike;
  private timer?: NodeJS.Timeout;
  private samples: Sample[] = [];
  private inFlight: bigint[] = [];
  private errors = 0;
  private stopped = false;

  constructor(private readonly opts: AuthorOpts) { super(); }

  async connect(): Promise<void> {
    const factory = this.opts.padFactory ?? ((u) => connect(u) as unknown as PadLike);
    this.pad = factory(this.opts.url);
    this.pad.on('connect_error', () => this.emit('drop'));
    this.pad.on('connect_timeout', () => this.emit('drop'));
    this.pad.on('message', (m: CollabMsg) => this.onMessage(m));
    this.pad.on('disconnected', () => this.emit('drop'));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.opts.editIntervalMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
    try { this.pad?.disconnect(); } catch { /* swallow */ }
  }

  drainSamples(): Sample[] {
    const out = this.samples;
    this.samples = [];
    return out;
  }

  getErrors(): number { return this.errors; }

  private tick(): void {
    if (this.stopped || !this.pad) return;
    try {
      this.inFlight.push(process.hrtime.bigint());
      this.pad.append(randomText());
    } catch {
      this.errors++;
      this.emit('error');
    }
  }

  private onMessage(m: CollabMsg): void {
    if (m.type !== 'COLLABROOM') return;
    const t = m.data?.type;
    if (t === 'ACCEPT_COMMIT') {
      const sent = this.inFlight.shift();
      if (sent === undefined) return;
      const ackedAt = process.hrtime.bigint();
      const latencyMs = Number(ackedAt - sent) / 1_000_000;
      this.samples.push({authorId: this.opts.authorName, sentAtNs: sent, ackedAtNs: ackedAt, latencyMs});
    }
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/sim/author.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/author.ts tests/sim/author.test.ts
git commit -m "feat(sim): Author with FIFO ACCEPT_COMMIT matching"
```

---

### Task 12: Author — disconnect-class errors counted

**Files:**
- Modify: `src/sim/author.ts`
- Modify: `tests/sim/author.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('Author disconnect-class events', () => {
  it('counts badChangeset disconnect as error and emits drop', async () => {
    vi.useFakeTimers();
    const pad = new StubPad();
    const a = new Author({url: 'http://x', padId: 'p', authorName: 'a4',
                          editIntervalMs: 100, padFactory: () => pad});
    let dropped = 0;
    a.on('drop', () => dropped++);
    await a.connect();
    pad.emit('connected', {});
    pad.emit('message', {type: 'COLLABROOM', data: {type: 'CLIENT_MESSAGE'}});
    pad.emit('message', {disconnect: 'badChangeset'});
    expect(a.getErrors()).toBe(1);
    expect(dropped).toBeGreaterThanOrEqual(1);
    await a.stop();
  });

  it('counts rateLimited disconnect with the rateLimited flag set', async () => {
    vi.useFakeTimers();
    const pad = new StubPad();
    const a = new Author({url: 'http://x', padId: 'p', authorName: 'a5',
                          editIntervalMs: 100, padFactory: () => pad});
    let rateLimited = false;
    a.on('rateLimited', () => { rateLimited = true; });
    await a.connect();
    pad.emit('connected', {});
    pad.emit('message', {disconnect: 'rateLimited'});
    expect(a.getErrors()).toBe(1);
    expect(rateLimited).toBe(true);
    await a.stop();
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/sim/author.test.ts
```
Expected: 2 new tests fail.

- [ ] **Step 3: Extend Author**

In `src/sim/author.ts`, broaden `CollabMsg` and `onMessage`:

```ts
type CollabMsg = {type?: string; data?: {type?: string}; disconnect?: string};
```

Replace `private onMessage(...)`:

```ts
private onMessage(m: CollabMsg): void {
  if (typeof m.disconnect === 'string') {
    this.errors++;
    if (m.disconnect === 'rateLimited') this.emit('rateLimited');
    this.emit('drop');
    return;
  }
  if (m.type !== 'COLLABROOM') return;
  if (m.data?.type === 'ACCEPT_COMMIT') {
    const sent = this.inFlight.shift();
    if (sent === undefined) return;
    const ackedAt = process.hrtime.bigint();
    const latencyMs = Number(ackedAt - sent) / 1_000_000;
    this.samples.push({authorId: this.opts.authorName, sentAtNs: sent, ackedAtNs: ackedAt, latencyMs});
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/sim/author.test.ts
```
Expected: 5 tests total pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/author.ts tests/sim/author.test.ts
git commit -m "feat(sim): Author counts disconnect-class events"
```

---

### Task 13: Harness — sweep loop

**Files:**
- Create: `src/sim/harness.ts`
- Create: `tests/sim/harness.test.ts`

- [ ] **Step 1: Write failing tests with stub Author**

```ts
// tests/sim/harness.test.ts
import {describe, it, expect, vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Harness} from '../../src/sim/harness.js';
import {makeConfig} from '../../src/sim/config.js';
import type {Sample} from '../../src/sim/types.js';

class StubAuthor extends EventEmitter {
  static instances: StubAuthor[] = [];
  private samples: Sample[] = [];
  private errs = 0;
  constructor() { super(); StubAuthor.instances.push(this); }
  async connect(): Promise<void> {}
  start(): void {}
  async stop(): Promise<void> {}
  drainSamples(): Sample[] { const o = this.samples; this.samples = []; return o; }
  getErrors(): number { return this.errs; }
  /** Test helper: push synthetic samples. */
  inject(ms: number, n = 1): void {
    for (let i = 0; i < n; i++) {
      this.samples.push({authorId: 't', sentAtNs: 0n, ackedAtNs: 0n, latencyMs: ms});
    }
  }
}

class StubScraper {
  start(): void {}
  async stop(): Promise<void> {}
  snapshot(label: string): {label: string; scrapedAt: string; gauges: Record<string, number>} {
    return {label, scrapedAt: '2026-05-15T00:00:00.000Z', gauges: {}};
  }
}

describe('Harness.run sweep', () => {
  it('produces one StepResult per swept step, with percentiles from drained samples', async () => {
    StubAuthor.instances = [];
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'h-'));
    try {
      const cfg = makeConfig({
        outDir: dir,
        sweep: {axis: 'authors', min: 1, max: 2, step: 1, warmupMs: 10, dwellMs: 20},
      });
      const h = new Harness(cfg, new StubScraper() as never,
                            { authorFactory: () => new StubAuthor() as never });
      const runPromise = h.run();
      // Step 1: 1 author. Drain warmup, then inject samples in dwell window.
      await vi.advanceTimersByTimeAsync(11);
      StubAuthor.instances.forEach((a) => a.inject(50, 10));
      await vi.advanceTimersByTimeAsync(20);
      // Step 2: now 2 authors. Drain warmup, inject samples.
      await vi.advanceTimersByTimeAsync(11);
      StubAuthor.instances.forEach((a) => a.inject(100, 10));
      await vi.advanceTimersByTimeAsync(20);
      const report = await runPromise;
      expect(report.steps).toHaveLength(2);
      expect(report.steps[0]!.step).toBe(1);
      expect(report.steps[0]!.latencyMs.count).toBeGreaterThan(0);
      expect(report.steps[1]!.step).toBe(2);
      expect(report.steps[1]!.latencyMs.p50).toBeGreaterThan(report.steps[0]!.latencyMs.p50);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/sim/harness.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement Harness**

```ts
// src/sim/harness.ts
import type {Config, Report, StepResult, RunMeta} from './types.js';
import type {Author} from './author.js';
import type {Scraper} from './scraper.js';
import {Reporter} from './reporter.js';
import {LatencyHistogram} from './histogram.js';
import {Author as RealAuthor} from './author.js';

export interface HarnessDeps {
  authorFactory?: (opts: {url: string; padId: string; authorName: string; editIntervalMs: number}) => Author;
  now?: () => Date;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const makeRunMeta = (cfg: Config, now: () => Date): RunMeta => ({
  runId: cfg.report.runId,
  startedAt: now().toISOString(),
  finishedAt: '', // filled at end
  sut: {url: cfg.sutUrl},
  machine: {
    cpus: 'unknown',
    totalMemMB: 0,
    node: process.version,
    os: process.platform,
  },
});

export class Harness {
  constructor(
    private readonly cfg: Config,
    private readonly scraper: Scraper,
    private readonly deps: HarnessDeps = {},
  ) {}

  async run(): Promise<Report> {
    const sweep = this.cfg.sweep;
    if (!sweep) throw new Error('Harness.run requires cfg.sweep; use runLegacy otherwise');
    const now = this.deps.now ?? (() => new Date());
    const factory = this.deps.authorFactory ?? ((o) => new RealAuthor(o));

    const meta = makeRunMeta(this.cfg, now);
    const reporter = new Reporter({outDir: this.cfg.report.outDir, runMeta: meta, config: this.cfg});

    this.scraper.start();
    const authors: Author[] = [];
    let counter = 0;

    try {
      for (let n = sweep.min; n <= sweep.max; n += sweep.step) {
        const delta = n - authors.length;
        for (let i = 0; i < delta; i++) {
          const a = factory({
            url: this.cfg.sutUrl,
            padId: this.cfg.padId ?? 'loadtest',
            authorName: `a${++counter}`,
            editIntervalMs: this.cfg.editIntervalMs,
          });
          await a.connect();
          a.start();
          authors.push(a);
        }
        // warmup
        await sleep(sweep.warmupMs);
        for (const a of authors) a.drainSamples();
        // dwell
        await sleep(sweep.dwellMs);
        const samples = authors.flatMap((a) => a.drainSamples());
        const errors = authors.reduce((acc, a) => acc + a.getErrors(), 0);
        const hist = new LatencyHistogram();
        for (const s of samples) hist.recordMs(s.latencyMs);
        const summary = hist.summary();
        const throughputCsps = summary.count / (sweep.dwellMs / 1_000);
        const snapshot = this.scraper.snapshot(`step=${n}`);
        const breakageFlags = this.flags(summary, snapshot, samples.length, errors);
        const step: StepResult = {
          step: n,
          latencyMs: summary,
          throughputCsps,
          snapshot,
          droppedAuthors: 0,
          errors,
          breakageFlags,
          samples: this.cfg.report.keepRawSamples ? samples : null,
        };
        reporter.addStep(step);
        if (breakageFlags.length > 0 && this.cfg.break.action === 'stop') break;
      }
    } finally {
      for (const a of authors) await a.stop();
      await this.scraper.stop();
    }

    meta.finishedAt = now().toISOString();
    return reporter.build() as Report;
  }

  private flags(
    summary: {p95: number},
    snap: {gauges: Record<string, number>},
    sampleCount: number,
    errors: number,
  ): string[] {
    const flags: string[] = [];
    if (summary.p95 > this.cfg.break.p95Ms) flags.push('p95');
    const el = snap.gauges['nodejs_eventloop_latency_gauge{type=p95}'];
    if (el !== undefined && el > this.cfg.break.eventLoopP95Ms) flags.push('evloop');
    const rate = sampleCount + errors > 0 ? errors / (sampleCount + errors) : 0;
    if (rate > this.cfg.break.errorRate) flags.push('errorRate');
    return flags;
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/sim/harness.test.ts
```
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/sim/harness.ts tests/sim/harness.test.ts
git commit -m "feat(sim): Harness sweep loop with reporter wiring"
```

---

### Task 14: Harness — breakage flags

**Files:**
- Modify: `tests/sim/harness.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('Harness breakage thresholds', () => {
  it('flags a step when p95 exceeds break.p95Ms', async () => {
    StubAuthor.instances = [];
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'h-'));
    try {
      const cfg = makeConfig({
        outDir: dir,
        sweep: {axis: 'authors', min: 1, max: 1, step: 1, warmupMs: 1, dwellMs: 10},
        breakP95Ms: 50,
      });
      const h = new Harness(cfg, new StubScraper() as never,
                            { authorFactory: () => new StubAuthor() as never });
      const p = h.run();
      await vi.advanceTimersByTimeAsync(2);
      StubAuthor.instances.forEach((a) => a.inject(100, 10));
      await vi.advanceTimersByTimeAsync(20);
      const report = await p;
      expect(report.steps[0]!.breakageFlags).toContain('p95');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('continues past breakage by default (action=continue)', async () => {
    StubAuthor.instances = [];
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'h-'));
    try {
      const cfg = makeConfig({
        outDir: dir,
        sweep: {axis: 'authors', min: 1, max: 2, step: 1, warmupMs: 1, dwellMs: 10},
        breakP95Ms: 50,
      });
      const h = new Harness(cfg, new StubScraper() as never,
                            { authorFactory: () => new StubAuthor() as never });
      const p = h.run();
      for (let i = 0; i < 2; i++) {
        await vi.advanceTimersByTimeAsync(2);
        StubAuthor.instances.forEach((a) => a.inject(100, 10));
        await vi.advanceTimersByTimeAsync(20);
      }
      const report = await p;
      expect(report.steps).toHaveLength(2);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
```

- [ ] **Step 2: Run, verify pass**

```bash
pnpm test tests/sim/harness.test.ts
```
Expected: the new tests pass against the existing implementation from Task 13 (which already implements `flags()` and the `action === 'stop'` early-exit).

- [ ] **Step 3: Commit**

```bash
git add tests/sim/harness.test.ts
git commit -m "test(sim): pin Harness breakage threshold behaviour"
```

---

### Task 15: Legacy port — runLegacy

**Files:**
- Create: `src/sim/legacy.ts`

- [ ] **Step 1: Port `app.ts` verbatim**

The legacy module is a near-verbatim move. Create `src/sim/legacy.ts`:

```ts
// src/sim/legacy.ts
//
// Byte-for-byte behavioural port of the original src/app.ts. The intent is
// that `etherpad-loadtest -d N -a M` still routes through this code and
// produces identical exit-code semantics, so ether/etherpad's CI cannot
// regress when this package republishes.
//
// IMPORTANT: do not "tidy up" this function. Any behaviour change here is
// a CI-contract change.

import {connect, type AText, type PadState} from 'etherpad-cli-client';
import {createCollection} from '../metrics.js';

export interface LegacyConfig {
  /** Pad URL; if missing or no /p/ segment, a random pad is created. */
  host?: string;
  authors?: number;
  lurkers?: number;
  /** Test duration in seconds. Undefined → "load until fail" mode. */
  durationS?: number;
}

const randomString = (len = 4): string => {
  let s = '';
  for (let i = 0; i < len; i++) {
    const charNumber = Math.random() * (300 - 1) + 1;
    s += String.fromCharCode(Math.floor(charNumber));
  }
  return s;
};

const randomPadName = (): string => {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 10; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
};

interface CollabRoomMessage {
  type?: string;
  data?: {type?: string};
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const runLegacy = async (cfg: LegacyConfig): Promise<number> => {
  const stats = createCollection();
  const startTimestamp = Date.now();
  const globalStats: {numConnectedUsers?: number} = {};
  let maxPS = 0;
  let loadUntilFail = false;

  let host: string;
  if (cfg.host && cfg.host.includes('http')) {
    host = cfg.host;
    if (!host.includes('/p/')) host = `${host}/p/${randomPadName()}`;
  } else {
    host = `http://127.0.0.1:9001/p/${randomPadName()}`;
  }

  const updateMetricsUI = (): void => {
    const jstats = stats.toJSON();
    const testDuration = Date.now() - startTimestamp;
    console.log('\x1b[2J\x1b[0;0H');
    console.log('Load Test Metrics -- Target Pad', host, '\n');
    if (globalStats.numConnectedUsers) {
      console.log('Total Clients Connected:', globalStats.numConnectedUsers);
    }
    if (jstats.clientsConnected?.count) console.log('Local Clients Connected:', jstats.clientsConnected.count);
    if (jstats.authorsConnected) console.log('Authors Connected:', jstats.authorsConnected.count);
    if (jstats.lurkersConnected) console.log('Lurkers Connected:', jstats.lurkersConnected.count);
    if (jstats.appendSent) console.log('Sent Append messages:', jstats.appendSent.count);
    if (jstats.error) console.log('Errors:', jstats.error.count);
    if (jstats.acceptedCommit) console.log('Commits accepted by server:', jstats.acceptedCommit.count);
    if (jstats.changeFromServer) {
      console.log('Commits sent from Server to Client:', jstats.changeFromServer.count);
      console.log('Current rate per second of Commits sent from Server to Client:',
          Math.round(jstats.changeFromServer.currentRate));
      console.log('Mean(per second) of # of Commits sent from Server to Client:',
          Math.round(jstats.changeFromServer.mean));
      if (Math.round(jstats.changeFromServer.currentRate) > maxPS) {
        maxPS = Math.round(jstats.changeFromServer.currentRate);
      }
      console.log('Max(per second) of # of Messages (SocketIO has cap of 10k):',
          maxPS || Math.round(jstats.changeFromServer.currentRate));
    }
    if (jstats.appendSent && jstats.acceptedCommit) {
      const diff = jstats.appendSent.count - jstats.acceptedCommit.count;
      if (diff > 5) {
        console.log('Number of commits not yet replied as ACCEPT_COMMIT from server', diff);
        if (loadUntilFail && diff > 100) bail(1);
      }
    }
    console.log('Seconds test has been running for:', Math.floor(testDuration / 1000));
  };

  let resolved = false;
  let resolveExit: (code: number) => void;
  const exitPromise = new Promise<number>((res) => { resolveExit = res; });
  const bail = (code: number): void => {
    if (resolved) return;
    resolved = true;
    resolveExit!(code);
  };

  const newAuthor = (): void => {
    const pad = connect(host);
    pad.on('connect_timeout', () => { console.error('socket timeout connecting to pad'); bail(1); });
    pad.on('connect_error', () => {
      console.error('connection error connecting to pad, did you remember to set loadTest to true?');
      bail(1);
    });
    pad.on('connected', (padState: PadState) => {
      globalStats.numConnectedUsers = (padState as PadState & {numConnectedUsers?: number}).numConnectedUsers;
      stats.meter('clientsConnected').mark();
      stats.meter('authorsConnected').mark();
      updateMetricsUI();
      setInterval(() => {
        stats.meter('appendSent').mark();
        updateMetricsUI();
        try { pad.append(randomString()); }
        catch { stats.meter('error').mark(); console.log('Error!'); }
      }, 400);
    });
    pad.on('message', (msg: CollabRoomMessage) => {
      if (msg.type !== 'COLLABROOM') return;
      if (msg.data?.type === 'ACCEPT_COMMIT') stats.meter('acceptedCommit').mark();
    });
    pad.on('newContents', (_atext: AText) => { stats.meter('changeFromServer').mark(); });
  };

  const newLurker = (): void => {
    const pad = connect(host);
    pad.on('connect_timeout', () => { console.error('socket timeout connecting to pad'); bail(1); });
    pad.on('connect_error', () => {
      console.error('connection error connecting to pad, did you remember to set loadTest to true?');
      bail(1);
    });
    pad.on('connected', (padState: PadState) => {
      globalStats.numConnectedUsers = (padState as PadState & {numConnectedUsers?: number}).numConnectedUsers;
      stats.meter('clientsConnected').mark();
      stats.meter('lurkersConnected').mark();
      updateMetricsUI();
    });
    pad.on('newContents', (_atext: AText) => { stats.meter('changeFromServer').mark(); });
  };

  const startUsers = async (users: string[]): Promise<void> => {
    const stagger = 200 / (users.length || 1);
    for (const type of users) {
      await sleep(stagger);
      if (type === 'l') newLurker();
      else if (type === 'a') newAuthor();
    }
  };

  const loadUntilFailFn = (): void => {
    loadUntilFail = true;
    const ramp = ['a', 'l', 'l', 'l'];
    setInterval(() => { void startUsers(ramp); }, 1000);
  };

  const users: string[] = [];
  if (cfg.lurkers) for (let i = 0; i < cfg.lurkers; i++) users.push('l');
  if (cfg.authors) for (let i = 0; i < cfg.authors; i++) users.push('a');

  const endTime: number | undefined = cfg.durationS
    ? startTimestamp + cfg.durationS * 1000
    : undefined;

  setInterval(() => {
    if (endTime !== undefined && Date.now() > endTime) {
      console.log('Test duration complete and Load Tests PASS');
      const snapshot = stats.toJSON();
      console.log(snapshot);
      if (Object.keys(snapshot).length === 0) {
        console.error("no test data gathered, perhaps loadTest wasn't enabled?");
        bail(1);
      } else {
        bail(0);
      }
    }
  }, 100);

  if (cfg.authors || cfg.lurkers) {
    void startUsers(users);
  } else {
    if (endTime === undefined) {
      console.log('Creating load until the pad server stops responding in a timely fashion');
    } else {
      const testD = Math.round((endTime - Date.now()) / 1000);
      console.log(`Creating load for ${testD} seconds`);
    }
    loadUntilFailFn();
  }

  return exitPromise;
};
```

- [ ] **Step 2: Build to verify it type-checks**

```bash
pnpm run build
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/sim/legacy.ts
git commit -m "feat(sim): port app.ts to runLegacy without behaviour change"
```

---

### Task 16: CLI — argv parsing + dispatch

**Files:**
- Create: `src/cli.ts`
- Create: `tests/sim/cli.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/sim/cli.test.ts
import {describe, it, expect} from 'vitest';
import {parseCliArgs, CliError} from '../../src/cli.js';

describe('parseCliArgs', () => {
  it('returns legacy-mode config when no --sweep is given', () => {
    const r = parseCliArgs(['-d', '25', '-a', '50']);
    expect(r.mode).toBe('legacy');
    expect(r.legacy.authors).toBe(50);
    expect(r.legacy.durationS).toBe(25);
  });

  it('returns sweep-mode config when --sweep is given', () => {
    const r = parseCliArgs(['--sweep', 'authors=10..50:step=10:dwell=2s:warmup=500ms',
                            '--report', '/tmp/out', '--scrape-interval', '500ms']);
    expect(r.mode).toBe('sweep');
    expect(r.config.sweep!.min).toBe(10);
    expect(r.config.sweep!.max).toBe(50);
    expect(r.config.sweep!.dwellMs).toBe(2000);
    expect(r.config.scrape.intervalMs).toBe(500);
    expect(r.config.report.outDir).toBe('/tmp/out');
  });

  it('threads positional URL through', () => {
    const r = parseCliArgs(['http://10.0.0.5:9001/p/x', '-d', '5']);
    expect(r.mode).toBe('legacy');
    expect(r.legacy.host).toBe('http://10.0.0.5:9001/p/x');
  });

  it('rejects unknown flags with CliError', () => {
    expect(() => parseCliArgs(['--bogus'])).toThrow(CliError);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/sim/cli.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement CLI**

```ts
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
  const {Reporter} = await import('./sim/reporter.js');
  const report = await harness.run();
  const reporter = new Reporter({outDir: r.config.report.outDir, runMeta: report.meta, config: r.config});
  for (const s of report.steps) reporter.addStep(s);
  await reporter.write();
  return 0;
};
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/sim/cli.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/sim/cli.test.ts
git commit -m "feat(cli): argv parsing with legacy/sweep dispatch"
```

---

### Task 17: Bin entrypoints — app.ts and multi.ts

**Files:**
- Modify: `src/app.ts`
- Modify: `src/multi.ts`

- [ ] **Step 1: Replace `src/app.ts` with a thin shim**

```ts
#!/usr/bin/env node
import {main} from './cli.js';

const argv = process.argv.slice(2);
main(argv).then((code) => process.exit(code));
```

- [ ] **Step 2: Replace `src/multi.ts` with a thin shim**

```ts
#!/usr/bin/env node
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

// Preserves the original behaviour of etherpad-loadtest-multi: spawn N
// child processes, each running `app.js -a 3 -d 30`, count messages.
const __dirname = dirname(fileURLToPath(import.meta.url));
const appPath = join(__dirname, 'app.js');

const maxPads = Number(process.argv[2] ?? 10);
let messageCount = 0;

for (let padCount = 0; padCount < maxPads; padCount++) {
  const child = fork(appPath, ['-a', '3', '-d', '30']);
  child.on('error', () => {
    console.log('total pads made', padCount);
    console.log('total messages', messageCount);
    process.exit(1);
  });
  child.on('message', () => { messageCount++; });
}
```

- [ ] **Step 3: Build + run a smoke check**

```bash
pnpm run build
node dist/app.js --help 2>&1 || true
```
Expected: build succeeds. Help may not exist yet (acceptable); the important thing is no crash on `--help`. If `parseArgs` errors out on `--help`, that's tolerable for now — core CI doesn't pass `--help`.

- [ ] **Step 4: Verify the existing test suite still passes**

```bash
pnpm test
```
Expected: all prior unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/multi.ts
git commit -m "feat(cli): wire bin entrypoints through cli.ts"
```

---

### Task 18: Legacy-contract integration test (gated)

**Files:**
- Create: `tests/sim/legacy-contract.test.ts`

- [ ] **Step 1: Write the gated test**

```ts
// tests/sim/legacy-contract.test.ts
//
// Acceptance test for the CI contract: `etherpad-loadtest -d N -a M` must
// continue to exit 0 against a healthy Etherpad. Gated by
// LOADTEST_INTEGRATION_URL so it doesn't run in plain `pnpm test`.

import {describe, it, expect} from 'vitest';
import {runLegacy} from '../../src/sim/legacy.js';

const URL = process.env.LOADTEST_INTEGRATION_URL;

describe.skipIf(!URL)('legacy contract', () => {
  it('exits 0 against a healthy Etherpad with -d 10 -a 5', async () => {
    const code = await runLegacy({host: URL!, durationS: 10, authors: 5});
    expect(code).toBe(0);
  }, 30_000);
});
```

- [ ] **Step 2: Verify it's skipped under normal `pnpm test`**

```bash
pnpm test
```
Expected: `legacy-contract.test.ts` reports skipped or excluded by the `--exclude` pattern in `pnpm test`. Either is acceptable.

- [ ] **Step 3: (Manual) verify against a real Etherpad locally if available**

Skip if no Etherpad is available; otherwise:
```bash
LOADTEST_INTEGRATION_URL=http://127.0.0.1:9001 pnpm test:integration
```
Expected: legacy-contract passes.

- [ ] **Step 4: Commit**

```bash
git add tests/sim/legacy-contract.test.ts
git commit -m "test: gated legacy-contract test against live Etherpad"
```

---

### Task 19: Sweep integration test (gated)

**Files:**
- Create: `tests/sim/integration.test.ts`

- [ ] **Step 1: Write the gated test**

```ts
// tests/sim/integration.test.ts
//
// Acceptance test for sweep mode. Spawns a tiny sweep against the
// integration Etherpad and asserts report.{json,csv,md} are produced
// and look sane. Gated by LOADTEST_INTEGRATION_URL.

import {describe, it, expect} from 'vitest';
import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Harness} from '../../src/sim/harness.js';
import {Scraper} from '../../src/sim/scraper.js';
import {Reporter} from '../../src/sim/reporter.js';
import {makeConfig} from '../../src/sim/config.js';

const URL = process.env.LOADTEST_INTEGRATION_URL;

describe.skipIf(!URL)('sweep integration', () => {
  it('produces a parseable report from a 2..4 author sweep', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'int-'));
    try {
      const cfg = makeConfig({
        sutUrl: URL!,
        sweep: {axis: 'authors', min: 2, max: 4, step: 2, warmupMs: 500, dwellMs: 2000},
        outDir: dir,
      });
      const scraper = new Scraper(cfg.scrape);
      const harness = new Harness(cfg, scraper);
      const report = await harness.run();
      const reporter = new Reporter({outDir: dir, runMeta: report.meta, config: cfg});
      for (const s of report.steps) reporter.addStep(s);
      const paths = await reporter.write();
      expect(existsSync(paths.json)).toBe(true);
      const j = JSON.parse(readFileSync(paths.json, 'utf8'));
      expect(j.steps.length).toBeGreaterThan(0);
      for (const s of j.steps) {
        expect(s.latencyMs.count).toBeGreaterThan(0);
        expect(s.latencyMs.p50).toBeGreaterThanOrEqual(0);
        expect(s.breakageFlags).toEqual([]); // trivial concurrency
      }
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  }, 30_000);
});
```

- [ ] **Step 2: Verify it's skipped under normal `pnpm test`**

```bash
pnpm test
```
Expected: skipped.

- [ ] **Step 3: Commit**

```bash
git add tests/sim/integration.test.ts
git commit -m "test: gated sweep integration test"
```

---

### Task 20: CI workflow + README

**Files:**
- Modify: `.github/workflows/backend-tests.yml`
- Modify: `README.md`

- [ ] **Step 1: Add `pnpm test` step to CI**

In `.github/workflows/backend-tests.yml`, after the `Build and link etherpad-load-test` step and **before** the "Install Etherpad core dependencies" step, insert:

```yaml
      - name: Run unit tests
        run: |
          cd ./loadtest
          pnpm test
```

- [ ] **Step 2: Add a `pnpm test:integration` step that runs after Etherpad is up**

In the same workflow, immediately after `Run the load test`, add:

```yaml
      - name: Run sweep integration test
        env:
          LOADTEST_INTEGRATION_URL: http://127.0.0.1:9001
        run: |
          # The previous step (`runnerLoadTest.sh`) tore Etherpad down, so
          # bring a minimal one back up just for the sweep integration test.
          cd ./etherpad
          (cd src && pnpm run prod &)
          for i in $(seq 1 60); do
            curl -sf http://127.0.0.1:9001/ >/dev/null && break
            sleep 1
          done
          cd ../loadtest
          pnpm test:integration
```

- [ ] **Step 3: Update `README.md` Usage section**

Add a new subsection after the current "Examples" block:

```markdown
### Sweep mode

For producing reproducible concurrency curves:

`etherpad-loadtest --sweep authors=10..200:step=10:dwell=30s:warmup=5s --report ./out`

Outputs `report.json`, `report.csv`, `report.md` in the report directory.
The CSV is plot-ready; the MD is paste-ready for issues.

Additional flags:
- `--scrape-url`, `--scrape-interval`, `--scrape-keep` — control `/stats/prometheus` polling
- `--break-p95`, `--break-evloop-p95`, `--break-error-rate`, `--break-action stop|continue`
- `--keep-raw-samples`, `--json-only`, `--run-id`, `--force`, `--respawn-drops`
- `--edit-interval`, `--connect-timeout` — accept duration strings (`200ms`, `30s`, `5m`)

Legacy invocation (`-l`, `-a`, `-d`) is unchanged.
```

- [ ] **Step 4: Run full test suite + lint**

```bash
pnpm test
pnpm run lint
pnpm run build
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/backend-tests.yml README.md
git commit -m "ci(harness): wire pnpm test + sweep integration into backend-tests"
```

---

## Self-review

**Spec coverage:**
- Sections 1 (layout) ↔ Tasks 1-2 ✓
- Section 2 (components) ↔ Tasks 6 (Scraper), 8-10 (Reporter), 11-12 (Author), 13 (Harness) ✓
- Section 3 (data flow) ↔ Task 13 (Harness.run sweep loop) ✓
- Section 4 (output format) ↔ Tasks 8-10 (JSON, CSV, MD with curated columns) ✓
- Section 5 (CLI surface, legacy mode) ↔ Tasks 15 (legacy port), 16 (CLI dispatch), 17 (bin shims) ✓
- Section 6 (server-side metrics) ↔ Task 4 (default scrape allowlist includes all current + future-3 metrics) ✓
- Section 7 (error handling) ↔ Task 12 (Author disconnect-class counting), Task 14 (breakage flags); Hard-error abort + non-empty `--report` check are minimal in this plan — only `force` is plumbed through Config (Task 4) and `parseCliArgs` (Task 16), but the actual fail-if-non-empty enforcement is in the Reporter. Adding a guard:

**Gap fix:** Reporter should refuse to write if outDir is non-empty and `force` is false. Adding to Task 8:

Actually, this is an additive guard, and putting it into Task 8 mid-plan would make later tests' temp-dir-empty assumption hold by coincidence. The cleanest fix is a small final task.

- Section 8 (testing strategy) ↔ Tasks 3-14 unit/invariant tests; Tasks 18-19 gated integration tests ✓
- Section 9 (Phase 2) — explicitly out of scope per spec's Implementation-plan-scope section ✓

**Placeholder scan:** every step has either runnable code or a runnable command. No "TBD" / "similar to" / "add validation". ✓

**Type consistency check:**
- `Sample.sentAtNs/ackedAtNs` (bigint) used consistently in Author and types ✓
- `Snapshot.gauges` keyed as `metric{labels}` strings used consistently in Scraper, Reporter, Harness.flags ✓
- `Config.report.outDir` used in Reporter constructor consistently ✓
- `cfg.break.p95Ms` vs `Config.break` field — both consistent ✓

### Task 21: Add Reporter --force guard (gap fix from review)

**Files:**
- Modify: `src/sim/reporter.ts`
- Modify: `tests/sim/reporter.test.ts`

- [ ] **Step 1: Append failing test**

```ts
import {writeFileSync as wfs} from 'node:fs';

describe('Reporter outDir collision', () => {
  it('refuses to write when outDir is non-empty and force=false', async () => {
    wfs(join(dir, 'sentinel'), 'x'); // dir is non-empty
    const cfg = makeConfig({outDir: dir, force: false});
    const r = new Reporter({outDir: dir, runMeta: meta(), config: cfg});
    r.addStep(stepResult(10, 20));
    await expect(r.write()).rejects.toThrow(/non-empty/);
  });

  it('overwrites when force=true', async () => {
    wfs(join(dir, 'sentinel'), 'x');
    const cfg = makeConfig({outDir: dir, force: true});
    const r = new Reporter({outDir: dir, runMeta: meta(), config: cfg});
    r.addStep(stepResult(10, 20));
    const paths = await r.write();
    expect(existsSync(paths.json)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test tests/sim/reporter.test.ts
```
Expected: 2 new tests fail.

- [ ] **Step 3: Add the guard**

In `src/sim/reporter.ts`, near the top:

```ts
import {readdirSync} from 'node:fs';
```

In `async write()`, prepend before `mkdirSync`:

```ts
try {
  const existing = readdirSync(this.opts.outDir);
  if (existing.length > 0 && !this.opts.config.report.force) {
    throw new Error(`report outDir is non-empty and --force was not set: ${this.opts.outDir}`);
  }
} catch (e) {
  // ENOENT is fine; rethrow anything else
  if ((e as NodeJS.ErrnoException).code && (e as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw e;
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test tests/sim/reporter.test.ts
```
Expected: all reporter tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/reporter.ts tests/sim/reporter.test.ts
git commit -m "feat(sim): Reporter refuses non-empty outDir without --force"
```

---

## Out of scope (in this plan)

- Phase 2 research dive (handled per spec methodology, no implementation plan needed).
- The three new core metric counters in `ether/etherpad` (`etherpad_pad_users`, `etherpad_changeset_apply_duration_seconds`, `etherpad_socket_emits_total`) — separate PR in core, scheduled after the harness is published. The harness already tolerates their absence via the `Scraper` allowlist.
- A `--compare runA runB` mode — deferred per spec.
- Continuous-benchmark dashboard / nightly long-sweep — deferred per spec.
- Distributed (multi-host) load generation — deferred per spec (curve, no fixed target).

## After the plan executes

When all 21 tasks are committed, the next steps (separate, not in this plan):

1. Open a PR from `spec/scaling-dive-7756` (or rename to a feature branch) against `ether/etherpad-load-test:main`.
2. After review/merge, publish a minor version bump to npm.
3. Watch `ether/etherpad`'s next `load-test.yml` run on `develop` for regressions.
4. Begin Phase 2 of the spec (research dive): run the harness against a fixed core SHA on the reference box, then run each lever in turn, then write the dive doc into `ether/etherpad`.
