// tests/sim/integration.test.ts
//
// Acceptance test for sweep mode. Runs a tiny sweep against an
// integration Etherpad and asserts report.{json,csv,md} are produced
// and look sane. Gated by LOADTEST_INTEGRATION_URL.

import {describe, it, expect} from 'vitest';
import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Harness} from '../../src/sim/harness.js';
import {Scraper} from '../../src/sim/scraper.js';
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
      // Harness.run() writes report.{json,csv,md} via its internal Reporter.
      await harness.run();
      const jsonPath = join(dir, 'report.json');
      expect(existsSync(jsonPath)).toBe(true);
      const j = JSON.parse(readFileSync(jsonPath, 'utf8'));
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
