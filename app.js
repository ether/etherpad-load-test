#!/usr/bin/env node
'use strict';

const etherpad = require('etherpad-cli-client');
const Measured = require('measured');
const async = require('async');
const argv = require('argv');
const argvopts = require('./argopts.js').opts;

const stats = Measured.createCollection();
const startTimestamp = Date.now();
const activeConnections = new Measured.Counter();
const users = [];
let loadUntilFail = false;
const globalStats = {};
let maxPS = 0;
let host;


const randomString = () => {
  let randomstring = '';
  // var string_length = Math.floor(Math.random() *2);
  const stringLength = 4; // See above for WPM stats
  for (let i = 0; i < stringLength; i++) {
    const charNumber = Math.random() * (300 - 1) + 1;
    const str = String.fromCharCode(parseInt(charNumber));
    // This method generates sufficient noise
    // It also includes white space and non ASCII Chars
    randomstring += str;
  }
  return randomstring;
};

// Redraws the UI of metrics
const updateMetricsUI = () => {
  const jstats = stats.toJSON();
  const testDuration = Date.now() - startTimestamp;

  console.log('\u001b[2J\u001b[0;0H');
  console.log('Load Test Metrics -- Target Pad', host, '\n');
  // console.log(jstats.clientsConnected);
  if (globalStats.numConnectedUsers) {
    console.log('Total Clients Connected:', globalStats.numConnectedUsers);
  }
  if (jstats.clientsConnected.count) {
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
      if (loadUntilFail && diff > 100) process.exit(1); /* eslint-disable-line n/no-process-exit */
    }
  }
  console.log('Seconds test has been running for:', parseInt(testDuration / 1000));
};

// Creates a new author
const newAuthor = () => {
  const pad = etherpad.connect(host);
  pad.on('socket_timeout', () => {
    console.error('socket timeout connecting to pad');
    process.exit(1); /* eslint-disable-line n/no-process-exit */
  });
  pad.on('socket_error', () => {
    console.error('connection error connecting to pad, did you remember to set loadTest to true?');
    process.exit(1); /* eslint-disable-line n/no-process-exit */
  });
  pad.on('connected', (padState) => {
    globalStats.numConnectedUsers = padState.numConnectedUsers;
    stats.meter('clientsConnected').mark();
    stats.meter('authorsConnected').mark();
    activeConnections.inc();
    updateMetricsUI();

    // console.log("Connected Author to", padState.host);
    // Every second we send 4 characters
    // Mean = 40 WPM = 240 characters/minute
    // https://imlocation.wordpress.com/2007/12/05/how-fast-do-people-type/
    // This simulates the Mean of an author
    setInterval(() => {
      stats.meter('appendSent').mark();
      updateMetricsUI();
      try {
        pad.append(randomString()); // Appends 4 Chars
      } catch (e) {
        stats.meter('error').mark();
        console.log('Error!');
      }
    }, 400);
  });
  pad.on('message', (msg) => {
    if (msg.type !== 'COLLABROOM') return;
    if (msg.data.type === 'ACCEPT_COMMIT') {
      stats.meter('acceptedCommit').mark();
    }
  });
  pad.on('newContents', (atext) => {
    stats.meter('changeFromServer').mark();
  });
};

// Creates a new lurker.
const newLurker = () => {
  const pad = etherpad.connect(host);
  pad.on('socket_timeout', () => {
    console.error('socket timeout connecting to pad');
    process.exit(1); /* eslint-disable-line n/no-process-exit */
  });
  pad.on('socket_error', () => {
    console.error('connection error connecting to pad, did you remember to set loadTest to true?');
    process.exit(1); /* eslint-disable-line n/no-process-exit */
  });
  pad.on('connected', (padState) => {
    globalStats.numConnectedUsers = padState.numConnectedUsers;
    stats.meter('clientsConnected').mark();
    stats.meter('lurkersConnected').mark();
    updateMetricsUI();
    // console.log("Connected new lurker to", padState.host);
  });
  pad.on('newContents', (atext) => {
    stats.meter('changeFromServer').mark();
  });
};


const randomPadName = () => { // From index.html
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const strLen = 10;
  let randomstring = '';
  for (let i = 0; i < strLen; i++) {
    const rnum = Math.floor(Math.random() * chars.length);
    randomstring += chars.substring(rnum, rnum + 1);
  }
  return randomstring;
};

// Take Params and process them
const args = argv.option(argvopts).run();
// Check for a host..
if (process.argv[2] && process.argv[2].indexOf('http') !== -1) {
  // It the arv2 item contains a hostname..
  host = process.argv[2];
  if (host.indexOf('/p/') === -1) { // No pad ID included so include one
    host = `${host}/p/${randomPadName()}`;
  }
} else {
  host = `http://127.0.0.1:9001/p/${randomPadName()}`;
}

if (args.options.lurkers) {
  let i = 0;
  while (i < args.options.lurkers) {
    users.push('l');
    i++;
  }
}
if (args.options.authors) {
  let x = 0;
  while (x < args.options.authors) {
    users.push('a');
    x++;
  }
}
let endTime;
if (args.options.duration) {
  endTime = startTimestamp + (args.options.duration * 1000);
}

// Check every second to see if currentTime is => endTime
setInterval(() => {
  const currentTime = Date.now();
  if (currentTime > endTime) {
    console.log('Test duration complete and Load Tests PASS');
    console.log(stats.toJSON());
    if (Object.keys(stats.toJSON()).length === 0) {
      console.error("no test data gathered, perhaps loadTest wasn't enabled?");
      process.exit(1); /* eslint-disable-line n/no-process-exit */
    }
    process.exit(0); /* eslint-disable-line n/no-process-exit */
  }
}, 100);

// Create load until failure.
const loadUntilFailFn = () => {
  loadUntilFail = true;
  // Loads at ratio of 3(lurkers):1(author), every 5 seconds it adds more.
  const users = ['a', 'l', 'l', 'l'];

  setInterval(() => {
    async.eachSeries(users, (type, callback) => {
      setTimeout(() => {
        if (type === 'l') {
          newLurker();
          callback();
        }
        if (type === 'a') {
          newAuthor();
          callback();
        }
      }, 200 / (users.length || 1));
    }, (_) => {
    });
  }, 1000); // every 5 seconds
};


// If there are authors / lurkers specified let's connect them up!
if (args.options.authors || args.options.lurkers) {
  async.eachSeries(users, (type, callback) => {
    setTimeout(() => {
      if (type === 'l') {
        newLurker();
        callback();
      }
      if (type === 'a') {
        newAuthor();
        callback();
      }

      //  }, 1000/(args.options.authors || 1));
    }, 200 / (users.length || 1));
    // All authors connect within 1 second but send messages on
    // slightly different intervals
    // This need slightly different logic
  }, (err) => {
  });
} else {
  if (!endTime) {
    console.log('Creating load until the pad server stops responding in a timely fashion');
  }
  if (endTime) {
    const testD = Math.round((endTime - Date.now()) / 1000);
    console.log(`Creating load for ${testD} seconds`);
  }
  loadUntilFailFn();
}
