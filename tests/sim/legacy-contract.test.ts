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

describe('legacy contract — failure path', () => {
  it('exits non-zero when no test data is gathered within the time limit', async () => {
    // runLegacy uses the real etherpad-cli-client which makes an HTTP preflight
    // via superagent before opening the socket. A refused connection produces a
    // void'd unhandled rejection inside the library. We suppress ECONNREFUSED
    // rejections here so the test runner stays clean while we verify that
    // runLegacy's "no test data gathered" branch fires bail(1) after durationS.
    const unhandled = (err: unknown, _promise: Promise<unknown>): void => {
      const e = err as NodeJS.ErrnoException;
      if (e?.code === 'ECONNREFUSED') return; // expected — library voids the superagent preflight
      throw err;
    };
    process.on('unhandledRejection', unhandled);
    try {
      // durationS:2 → after 2 s the interval checks endTime, finds stats empty
      // (no socket ever connected), and calls bail(1) via the "no test data"
      // path. Port 1 is unprivileged-refused on Linux; if somehow it were open,
      // the test still exits 1 because the ACCEPT_COMMIT meter won't tick in 2 s.
      const code = await runLegacy({
        host: 'http://127.0.0.1:1/p/test',
        durationS: 2,
        authors: 1,
      });
      expect(code).toBe(1);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  }, 10_000);
});
