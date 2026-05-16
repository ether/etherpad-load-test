import {EventEmitter} from 'node:events';
import {connect} from 'etherpad-cli-client';
import type {Sample} from './types.js';
import {installEnginePackingClientPatch} from './engine-packing-client-patch.js';

// Forward-compat with servers that have settings.enginePacking enabled
// (ether/etherpad#7756 lever 8). Applied once at module load so any Author
// constructed afterwards uses the patched engine.io-client transport.
// Safe against legacy servers — a single-packet frame contains no `\x1e`,
// so the patch's discriminator preserves the original code path.
installEnginePackingClientPatch();

export interface PadLike extends EventEmitter {
  append(s: string): void;
  close(): void;
}

export interface AuthorOpts {
  url: string;
  padId: string;
  authorName: string;
  editIntervalMs: number;
  /** Override for tests. Defaults to the real etherpad-cli-client connect. */
  padFactory?: (url: string) => PadLike;
}

type CollabMsg = {type?: string; data?: {type?: string}; disconnect?: string};

const randomText = (len = 4): string => {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += String.fromCharCode(Math.floor(Math.random() * 26) + 97);
  }
  return s;
};

export class Author extends EventEmitter {
  private pad?: PadLike;
  private timer?: NodeJS.Timeout;
  private samples: Sample[] = [];
  private inFlight: bigint[] = [];
  private errors = 0;
  private stopped = false;

  constructor(private readonly opts: AuthorOpts) { super(); }

  connect(): Promise<void> {
    const factory = this.opts.padFactory ?? ((u) => connect(u) as unknown as PadLike);
    this.pad = factory(this.opts.url);
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void): void => { if (!settled) { settled = true; fn(); } };
      this.pad!.on('connected', () => settle(resolve));
      this.pad!.on('connect_error', (e: Error) => settle(() => reject(e ?? new Error('connect_error'))));
      this.pad!.on('connect_timeout', () => settle(() => reject(new Error('connect_timeout'))));
      this.pad!.on('message', (m: CollabMsg) => this.onMessage(m));
      this.pad!.on('disconnect', () => this.emit('drop'));
    });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.opts.editIntervalMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
    try { this.pad?.close(); } catch { /* swallow */ }
  }

  drainSamples(): Sample[] {
    const out = this.samples;
    this.samples = [];
    return out;
  }

  getErrors(): number { return this.errors; }

  private tick(): void {
    if (this.stopped || !this.pad) return;
    try {
      this.inFlight.push(process.hrtime.bigint());
      this.pad.append(randomText());
    } catch {
      this.errors++;
      this.emit('error');
    }
  }

  private onMessage(m: CollabMsg): void {
    if (typeof m.disconnect === 'string') {
      this.errors++;
      if (m.disconnect === 'rateLimited') this.emit('rateLimited');
      this.emit('drop');
      return;
    }
    if (m.type !== 'COLLABROOM') return;
    if (m.data?.type === 'ACCEPT_COMMIT') {
      const sent = this.inFlight.shift();
      if (sent === undefined) return;
      const ackedAt = process.hrtime.bigint();
      const latencyMs = Number(ackedAt - sent) / 1_000_000;
      this.samples.push({authorId: this.opts.authorName, sentAtNs: sent, ackedAtNs: ackedAt, latencyMs});
    }
  }
}
