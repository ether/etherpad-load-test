'use strict';

exports.opts = [
  {
    name: 'lurkers',
    short: 'l',
    type: 'integer',
    description: 'Number of Lurkers to connect to each pad',
    example: "'etherpad-loadtest --lurkers=value' or 'etherpad-loadtest -l value'",
  },
  {
    name: 'authors',
    short: 'a',
    type: 'integer',
    description: 'Number of Authors to connect to each pad',
    example: "'etherpad-loadtest --authors=value' or 'etherpad-loadtest -a value'",
  },
  {
    name: 'padcount',
    short: 'p',
    type: 'integer',
    description: 'Number of Pads to connect to each pad',
    example: "'etherpad-loadtest --padcount=value' or 'etherpad-loadtest -p value'",
  },
  {
    name: 'duration',
    short: 'd',
    type: 'integer',
    description: 'Duration (in seconds) to test',
    example: "'etherpad-loadtest --duration=value' or 'etherpad-loadtest -d value'",
  },
];
