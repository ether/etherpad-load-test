#!/usr/bin/env node
import {main} from './cli.js';

const argv = process.argv.slice(2);
main(argv).then((code) => process.exit(code));
