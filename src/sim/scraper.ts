import {parsePromText, filterByPrefix} from './promtext.js';
import type {Snapshot, ScrapeConfig} from './types.js';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class Scraper {
  private timer?: NodeJS.Timeout;
  private latest: Record<string, number> = {};
  private latestAt = '1970-01-01T00:00:00.000Z';
  private readonly fetchFn: FetchLike;

  constructor(private readonly cfg: ScrapeConfig, fetchFn?: FetchLike) {
    this.fetchFn = fetchFn ?? ((u, init) => fetch(u, init));
  }

  start(): void {
    if (this.timer) return;
    const poll = async (): Promise<void> => {
      try {
        const resp = await this.fetchFn(this.cfg.url);
        if (!resp.ok) return;
        const text = await resp.text();
        const all = parsePromText(text);
        this.latest = filterByPrefix(all, this.cfg.keep);
        this.latestAt = new Date().toISOString();
      } catch {
        // swallow; harness keeps running, snapshot will show stale values
      }
    };
    void poll();
    this.timer = setInterval(() => { void poll(); }, this.cfg.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  snapshot(label: string): Snapshot {
    return {label, scrapedAt: this.latestAt, gauges: {...this.latest}};
  }
}
