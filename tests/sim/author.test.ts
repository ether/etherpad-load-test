import {describe, it, expect, vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {Author, type PadLike} from '../../src/sim/author.js';

class StubPad extends EventEmitter implements PadLike {
  appended: string[] = [];
  append(s: string): void { this.appended.push(s); this.emitAck(); }
  close(): void { this.emit('disconnect'); }
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

/** Construct an Author, attach listeners, schedule the 'connected' emit, then await connect(). */
const connectedAuthor = async (pad: StubPad, opts: {authorName: string; editIntervalMs?: number}): Promise<Author> => {
  const a = new Author({
    url: 'http://x', padId: 'p', authorName: opts.authorName,
    editIntervalMs: opts.editIntervalMs ?? 100, padFactory: () => pad,
  });
  const p = a.connect();
  queueMicrotask(() => pad.emit('connected', {}));
  await p;
  return a;
};

describe('Author', () => {
  it('records latency for each ACCEPT_COMMIT in FIFO order', async () => {
    vi.useFakeTimers();
    const pad = new StubPad();
    const a = await connectedAuthor(pad, {authorName: 'a1'});
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
    const a = await connectedAuthor(pad, {authorName: 'a2'});
    pad.scheduleAck(150);
    pad.scheduleAck(20);
    a.start();
    await vi.advanceTimersByTimeAsync(250);
    const samples = a.drainSamples();
    expect(samples).toHaveLength(2);
    await a.stop();
  });

  it('drainSamples clears the buffer', async () => {
    vi.useFakeTimers();
    const pad = new StubPad();
    const a = await connectedAuthor(pad, {authorName: 'a3'});
    pad.scheduleAck(10);
    a.start();
    await vi.advanceTimersByTimeAsync(120);
    expect(a.drainSamples()).toHaveLength(1);
    expect(a.drainSamples()).toHaveLength(0);
    await a.stop();
  });
});

describe('Author disconnect-class events', () => {
  it('counts badChangeset disconnect as error and emits drop', async () => {
    vi.useFakeTimers();
    const pad = new StubPad();
    const a = await connectedAuthor(pad, {authorName: 'a4'});
    let dropped = 0;
    a.on('drop', () => dropped++);
    pad.emit('message', {type: 'COLLABROOM', data: {type: 'CLIENT_MESSAGE'}});
    pad.emit('message', {disconnect: 'badChangeset'});
    expect(a.getErrors()).toBe(1);
    expect(dropped).toBeGreaterThanOrEqual(1);
    await a.stop();
  });

  it('counts rateLimited disconnect with the rateLimited flag set', async () => {
    vi.useFakeTimers();
    const pad = new StubPad();
    const a = await connectedAuthor(pad, {authorName: 'a5'});
    let rateLimited = false;
    a.on('rateLimited', () => { rateLimited = true; });
    pad.emit('message', {disconnect: 'rateLimited'});
    expect(a.getErrors()).toBe(1);
    expect(rateLimited).toBe(true);
    await a.stop();
  });

  it('emits drop on socket-level disconnect event', async () => {
    vi.useFakeTimers();
    const pad = new StubPad();
    const a = await connectedAuthor(pad, {authorName: 'a6'});
    let dropped = 0;
    a.on('drop', () => dropped++);
    pad.emit('disconnect', 'network gone');
    expect(dropped).toBe(1);
    await a.stop();
  });
});
