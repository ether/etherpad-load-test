#!/usr/bin/env node
'use strict';

// tests 10 pads (unless specified by "node multi.js X[int]" for 30 seconds
const child_process = require('child_process');

const maxPads = process.argv[2] || 10; // 10 padIds
let padCount = 0;
const messageCount = 0;

while (padCount < maxPads) {
  const child = child_process.fork(
      '/lib/node_modules/etherpad-load-test/app.js', ['-a', 3, '-d', 30]);
  padCount++;
  // below still not working...
  child.on('error', () => {
    console.log('total pads made');
    console.log('total messages', messageCount);
    process.exit(1); /* eslint-disable-line no-process-exit */
  });
}
