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
