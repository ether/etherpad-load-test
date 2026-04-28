#!/usr/bin/env node
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

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
  child.on('message', () => {
    messageCount++;
  });
}
