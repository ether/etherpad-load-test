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

  let resolved = false;
  let resolveExit!: (code: number) => void;
  const exitPromise = new Promise<number>((res) => { resolveExit = res; });
  const bail = (code: number): void => {
    if (resolved) return;
    resolved = true;
    resolveExit(code);
  };

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
