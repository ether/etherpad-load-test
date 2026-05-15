// src/sim/types.ts

export interface Sample {
  authorId: string;
  sentAtNs: bigint;
  ackedAtNs: bigint;
  latencyMs: number;
}

export interface Snapshot {
  label: string;
  scrapedAt: string; // ISO timestamp
  gauges: Record<string, number>;
}

export interface StepResult {
  step: number;
  latencyMs: {p50: number; p95: number; p99: number; max: number; count: number};
  throughputCsps: number;
  snapshot: Snapshot;
  droppedAuthors: number;
  errors: number;
  breakageFlags: string[];
  samples: Sample[] | null;
}

export interface MachineInfo {
  cpus: string;
  totalMemMB: number;
  node: string;
  os: string;
}

export interface RunMeta {
  runId: string;
  startedAt: string;
  finishedAt: string;
  sut: {url: string; gitSha?: string; version?: string};
  machine: MachineInfo;
  partial?: boolean;
}

export interface SweepConfig {
  axis: 'authors' | 'pads';
  min: number;
  max: number;
  step: number;
  warmupMs: number;
  dwellMs: number;
}

export interface ScrapeConfig {
  url: string;
  intervalMs: number;
  keep: string[]; // base-name prefixes
}

export interface BreakConfig {
  p95Ms: number;
  eventLoopP95Ms: number;
  errorRate: number;
  action: 'stop' | 'continue';
}

export interface ReportConfig {
  outDir: string;
  runId: string;
  jsonOnly: boolean;
  keepRawSamples: boolean;
  force: boolean;
}

export interface Config {
  sutUrl: string;
  padId?: string;
  lurkers: number;
  authors: number;
  durationS?: number;
  editIntervalMs: number;
  connectTimeoutMs: number;
  respawnDrops: boolean;
  sweep?: SweepConfig;
  scrape: ScrapeConfig;
  break: BreakConfig;
  report: ReportConfig;
}

export interface Report {
  runId: string;
  startedAt: string;
  finishedAt: string;
  partial?: boolean;
  sut: RunMeta['sut'];
  machine: MachineInfo;
  config: Config;
  steps: StepResult[];
}
