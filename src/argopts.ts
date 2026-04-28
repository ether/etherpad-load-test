import {parseArgs, type ParseArgsConfig} from 'node:util';

export const optionsConfig = {
  lurkers: {type: 'string', short: 'l'},
  authors: {type: 'string', short: 'a'},
  padcount: {type: 'string', short: 'p'},
  duration: {type: 'string', short: 'd'},
} as const satisfies NonNullable<ParseArgsConfig['options']>;

export interface ParsedOptions {
  lurkers?: number;
  authors?: number;
  padcount?: number;
  duration?: number;
}

export const parseOptions = (argv: string[] = process.argv.slice(2)): {
  options: ParsedOptions;
  positionals: string[];
} => {
  const {values, positionals} = parseArgs({
    args: argv,
    options: optionsConfig,
    allowPositionals: true,
    strict: false,
  });

  const toNum = (v: string | boolean | undefined): number | undefined =>
    typeof v === 'string' ? Number(v) : undefined;

  return {
    options: {
      lurkers: toNum(values.lurkers as string | undefined),
      authors: toNum(values.authors as string | undefined),
      padcount: toNum(values.padcount as string | undefined),
      duration: toNum(values.duration as string | undefined),
    },
    positionals,
  };
};
