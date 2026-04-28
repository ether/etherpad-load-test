#!/usr/bin/env node
import {connect, type AText, type PadState} from 'etherpad-cli-client';
import {createCollection} from './metrics.js';
import {parseOptions} from './argopts.js';

const stats = createCollection();
const startTimestamp = Date.now();
const globalStats: {numConnectedUsers?: number} = {};
let maxPS = 0;
let loadUntilFail = false;
let host: string;

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

const updateMetricsUI = (): void => {
  const jstats = stats.toJSON();
  const testDuration = Date.now() - startTimestamp;

  console.log('[2J[0;0H');
  console.log('Load Test Metrics -- Target Pad', host, '\n');
  if (globalStats.numConnectedUsers) {
    console.log('Total Clients Connected:', globalStats.numConnectedUsers);
  }
  if (jstats.clientsConnected?.count) {
    console.log('Local Clients Connected:', jstats.clientsConnected.count);
  }
  if (jstats.authorsConnected) {
    console.log('Authors Connected:', jstats.authorsConnected.count);
  }
  if (jstats.lurkersConnected) {
    console.log('Lurkers Connected:', jstats.lurkersConnected.count);
  }
  if (jstats.appendSent) {
    console.log('Sent Append messages:', jstats.appendSent.count);
  }
  if (jstats.error) {
    console.log('Errors:', jstats.error.count);
  }
  if (jstats.acceptedCommit) {
    console.log('Commits accepted by server:', jstats.acceptedCommit.count);
  }
  if (jstats.changeFromServer) {
    console.log('Commits sent from Server to Client:',
        jstats.changeFromServer.count);
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
      if (loadUntilFail && diff > 100) process.exit(1);
    }
  }
  console.log('Seconds test has been running for:', Math.floor(testDuration / 1000));
};

interface CollabRoomMessage {
  type?: string;
  data?: {type?: string};
}

const newAuthor = (): void => {
  const pad = connect(host);
  pad.on('connect_timeout', () => {
    console.error('socket timeout connecting to pad');
    process.exit(1);
  });
  pad.on('connect_error', () => {
    console.error('connection error connecting to pad, did you remember to set loadTest to true?');
    process.exit(1);
  });
  pad.on('connected', (padState: PadState) => {
    globalStats.numConnectedUsers = (padState as PadState & {numConnectedUsers?: number})
        .numConnectedUsers;
    stats.meter('clientsConnected').mark();
    stats.meter('authorsConnected').mark();
    updateMetricsUI();

    setInterval(() => {
      stats.meter('appendSent').mark();
      updateMetricsUI();
      try {
        pad.append(randomString());
      } catch {
        stats.meter('error').mark();
        console.log('Error!');
      }
    }, 400);
  });
  pad.on('message', (msg: CollabRoomMessage) => {
    if (msg.type !== 'COLLABROOM') return;
    if (msg.data?.type === 'ACCEPT_COMMIT') {
      stats.meter('acceptedCommit').mark();
    }
  });
  pad.on('newContents', (_atext: AText) => {
    stats.meter('changeFromServer').mark();
  });
};

const newLurker = (): void => {
  const pad = connect(host);
  pad.on('connect_timeout', () => {
    console.error('socket timeout connecting to pad');
    process.exit(1);
  });
  pad.on('connect_error', () => {
    console.error('connection error connecting to pad, did you remember to set loadTest to true?');
    process.exit(1);
  });
  pad.on('connected', (padState: PadState) => {
    globalStats.numConnectedUsers = (padState as PadState & {numConnectedUsers?: number})
        .numConnectedUsers;
    stats.meter('clientsConnected').mark();
    stats.meter('lurkersConnected').mark();
    updateMetricsUI();
  });
  pad.on('newContents', (_atext: AText) => {
    stats.meter('changeFromServer').mark();
  });
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
  setInterval(() => {
    void startUsers(ramp);
  }, 1000);
};

const {options, positionals} = parseOptions();
const hostArg = positionals.find((p) => p.includes('http'));
if (hostArg) {
  host = hostArg;
  if (!host.includes('/p/')) {
    host = `${host}/p/${randomPadName()}`;
  }
} else {
  host = `http://127.0.0.1:9001/p/${randomPadName()}`;
}

const users: string[] = [];
if (options.lurkers) {
  for (let i = 0; i < options.lurkers; i++) users.push('l');
}
if (options.authors) {
  for (let i = 0; i < options.authors; i++) users.push('a');
}

const endTime: number | undefined = options.duration
  ? startTimestamp + options.duration * 1000
  : undefined;

setInterval(() => {
  if (endTime !== undefined && Date.now() > endTime) {
    console.log('Test duration complete and Load Tests PASS');
    const snapshot = stats.toJSON();
    console.log(snapshot);
    if (Object.keys(snapshot).length === 0) {
      console.error("no test data gathered, perhaps loadTest wasn't enabled?");
      process.exit(1);
    }
    process.exit(0);
  }
}, 100);

if (options.authors || options.lurkers) {
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
