import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createReplayVerifier } from '../backend/replay-verifier.mjs';
import { initialState } from '../backend/replay.mjs';

const state = initialState(431, 987);

test('reuses one worker, isolates invalid replay, then accepts a valid replay', async () => {
  const verifier = createReplayVerifier({ idleMs: 50 });
  const invalid = verifier.verify(state, [{ step: 0, x: 240 }, { step: 0, x: 240 }], 1);
  await assert.rejects(invalid, (error) => error.status === 422 && error.code === 'INVALID_REPLAY');
  const result = await verifier.verify(state, [], 120);
  assert.equal(result.state.stepIndex, 120);
  assert.equal(verifier.diagnostics().exits, 0);
  await verifier.close();
  assert.equal(verifier.diagnostics().worker, false);
});

class FakeWorker extends EventEmitter {
  static all = [];
  static exitDelayMs = 0;
  static holdExit = false;
  constructor() { super(); this.terminated = false; FakeWorker.all.push(this); }
  postMessage(payload) { this.payload = payload; this.postCount = (this.postCount || 0) + 1; }
  terminate() {
    if (!this.terminated) {
      this.terminated = true;
      if (!FakeWorker.holdExit) setTimeout(() => this.emit('exit', 1), FakeWorker.exitDelayMs);
    }
    return Promise.resolve(1);
  }
}

test('bounds waiting queue, keeps only one worker, and starts next only after exit on timeout', async () => {
  FakeWorker.all = [];
  const verifier = createReplayVerifier({ WorkerClass: FakeWorker, timeoutMs: 15, idleMs: 100, maxQueue: 2 });
  const first = verifier.verify(state, [], 1);
  const second = verifier.verify(state, [], 2);
  const third = verifier.verify(state, [], 3);
  await assert.rejects(verifier.verify(state, [], 4), (error) => error.status === 503);
  await assert.rejects(first, (error) => error.status === 422);
  while (verifier.diagnostics().exits < 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(FakeWorker.all.length, 2);
  assert.equal(verifier.diagnostics().exits, 1);
  await assert.rejects(second, (error) => error.status === 422);
  await assert.rejects(third, (error) => error.status === 422);
  await verifier.close();
  assert.equal(verifier.diagnostics().worker, false);
});

test('a submission during timeout termination waits for the old worker exit', async () => {
  FakeWorker.all = [];
  FakeWorker.holdExit = true;
  const verifier = createReplayVerifier({ WorkerClass: FakeWorker, timeoutMs: 12, idleMs: 100, maxQueue: 1 });
  const first = verifier.verify(state, [], 1);
  await assert.rejects(first, (error) => error.status === 422);
  const second = verifier.verify(state, [], 2);
  assert.equal(FakeWorker.all.length, 1);
  assert.equal(FakeWorker.all[0].postCount, 1);
  FakeWorker.holdExit = false;
  FakeWorker.all[0].emit('exit', 1);
  await assert.rejects(second, (error) => error.status === 422);
  assert.equal(FakeWorker.all.length, 2);
  assert.equal(FakeWorker.all[1].payload.target, 2);
  await verifier.close();
  FakeWorker.holdExit = false;
});

test('a submission racing idle teardown starts only after exit', async () => {
  FakeWorker.all = [];
  FakeWorker.holdExit = true;
  const verifier = createReplayVerifier({ WorkerClass: FakeWorker, timeoutMs: 30, idleMs: 5, maxQueue: 1 });
  const first = verifier.verify(state, [], 1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  FakeWorker.all[0].emit('message', { id: FakeWorker.all[0].payload.id, ok: true, state, summary: {} });
  await first;
  while (!FakeWorker.all[0].terminated) await new Promise((resolve) => setTimeout(resolve, 1));
  const second = verifier.verify(state, [], 2);
  assert.equal(FakeWorker.all.length, 1);
  assert.equal(FakeWorker.all[0].postCount, 1);
  FakeWorker.holdExit = false;
  FakeWorker.all[0].emit('exit', 1);
  await assert.rejects(second, (error) => error.status === 422);
  assert.equal(FakeWorker.all.length, 2);
  await verifier.close();
  FakeWorker.holdExit = false;
});

test('close rejects active and queued work and terminates the worker', async () => {
  FakeWorker.all = [];
  const verifier = createReplayVerifier({ WorkerClass: FakeWorker, timeoutMs: 1000, maxQueue: 2 });
  const active = verifier.verify(state, [], 1);
  const queued = verifier.verify(state, [], 2);
  const activeRejected = assert.rejects(active, (error) => error.status === 503);
  const queuedRejected = assert.rejects(queued, (error) => error.status === 503);
  await verifier.close();
  await Promise.all([activeRejected, queuedRejected]);
  assert.equal(FakeWorker.all[0].terminated, true);
  assert.equal(verifier.diagnostics().worker, false);
});
