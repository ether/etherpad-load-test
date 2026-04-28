export interface MeterSnapshot {
  count: number;
  currentRate: number;
  mean: number;
}

class Meter {
  private count = 0;
  private readonly windowMs = 1000;
  private events: number[] = [];
  private readonly startedAt = Date.now();

  mark(): void {
    const now = Date.now();
    this.count++;
    this.events.push(now);
    const cutoff = now - this.windowMs;
    while (this.events.length > 0 && this.events[0]! < cutoff) {
      this.events.shift();
    }
  }

  toJSON(): MeterSnapshot {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    while (this.events.length > 0 && this.events[0]! < cutoff) {
      this.events.shift();
    }
    const elapsedSec = Math.max((now - this.startedAt) / 1000, 1e-9);
    return {
      count: this.count,
      currentRate: this.events.length,
      mean: this.count / elapsedSec,
    };
  }
}

export class MetricsCollection {
  private readonly meters = new Map<string, Meter>();

  meter(name: string): Meter {
    let m = this.meters.get(name);
    if (!m) {
      m = new Meter();
      this.meters.set(name, m);
    }
    return m;
  }

  toJSON(): Record<string, MeterSnapshot> {
    const out: Record<string, MeterSnapshot> = {};
    for (const [name, meter] of this.meters) {
      out[name] = meter.toJSON();
    }
    return out;
  }
}

export const createCollection = (): MetricsCollection => new MetricsCollection();
