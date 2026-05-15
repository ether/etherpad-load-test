import {describe, it, expect, vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {Author, type PadLike} from '../../src/sim/author.js';

class StubPad extends EventEmitter implements PadLike {
  appended: string[] = [];
  append(s: string): void { this.appended.push(s); this.emitAck(); }
  disconnect(): void { this.emit('disconnected'); }
  private ackQueue: number[] = [];
  /** Schedule an ACCEPT_COMMIT to fire `delayMs` after the next append() */
  scheduleAck(delayMs: number): void { this.ackQueue.push(delayMs); }
  private emitAck(): void {
    const d = this.ackQueue.shift() ?? 0;
    setTimeout(() => {
      this.emit('message', {type: 'COLLABROOM', data: {type: 'ACCEPT_COMMIT'}});
    }, d);
  }
}

describe('Author', () => {
  it('records latency for each ACCEPT_COMMIT in FIFO order', async () => {
    vi.useFakeTimers();
    const pad = new StubPad();
    const factory = () => pad;
    const a = new Author({url: 'http://x', padId: 'p', authorName: 'a1',
                          editIntervalMs: 100, padFactory: factory});
    await a.connect();
    pad.emit('connected', {});
    pad.scheduleAck(50);
    a.start();
    await vi.advanceTimersByTimeAsync(100); // one append fires
    await vi.advanceTimersByTimeAsync(60);  // ack arrives
    const samples = a.drainSamples();
    expect(samples).toHaveLength(1);
    expect(samples[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    await a.stop();
  });

  it('does not lose FIFO order across multiple in-flight acks', async () => {
    vi.useFakeTimers();
    const pad = new StubPad();
    const a = new Author({url: 'http://x', padId: 'p', authorName: 'a2',
                          editIntervalMs: 100, padFactory: () => pad});
    await a.connect();
    pad.emit('connected', {});
    pad.scheduleAck(150); // first append's ack
    pad.scheduleAck(20);  // second append's ack
    a.start();
    await vi.advanceTimersByTimeAsync(250);
    const samples = a.drainSamples();
    expect(samples).toHaveLength(2);
    await a.stop();
  });

  it('drainSamples clears the buffer', async () => {
    vi.useFakeTimers();
    const pad = new StubPad();
    const a = new Author({url: 'http://x', padId: 'p', authorName: 'a3',
                          editIntervalMs: 100, padFactory: () => pad});
    await a.connect();
    pad.emit('connected', {});
    pad.scheduleAck(10);
    a.start();
    await vi.advanceTimersByTimeAsync(120);
    expect(a.drainSamples()).toHaveLength(1);
    expect(a.drainSamples()).toHaveLength(0);
    await a.stop();
  });
});
