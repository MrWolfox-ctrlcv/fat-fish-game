import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createReplayVerifier } from '../backend/replay-verifier.mjs';
import { initialState } from '../backend/replay.mjs';

const count = Number(process.argv[2] || 12);
const state = initialState(431, 987);
const moves = Array.from({ length: 8 }, (_, i) => ({ step: i * 60, x: 50 + (i * 53) % 380 }));
const target = 600;
const url = new URL('../backend/replay-worker.mjs', import.meta.url);

async function oneShot(input) {
  const worker = new Worker(url, { resourceLimits: { maxOldGenerationSizeMb: 64 } });
  try {
    return await new Promise((resolve, reject) => {
      worker.once('message', (message) => message.ok ? resolve(message) : reject(new Error(message.message)));
      worker.once('error', reject);
      worker.postMessage({ id: 'benchmark', ...input });
    });
  } finally { await worker.terminate(); }
}

async function measure(label, run) {
  const cpuStart = process.cpuUsage();
  const heapStart = process.memoryUsage().heapUsed;
  const start = performance.now();
  for (let i = 0; i < count; i++) await run();
  const elapsed = performance.now() - start;
  const cpu = process.cpuUsage(cpuStart);
  console.log(JSON.stringify({ label, samples: count, elapsedMs: +elapsed.toFixed(1), meanMs: +(elapsed / count).toFixed(1), cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(1), heapDeltaBytes: process.memoryUsage().heapUsed - heapStart }));
}

console.log(`Local-only replay benchmark; same ${target}-step checkpoint and ${moves.length} moves per sample.`);
await measure('new worker per replay', () => oneShot({ state, moves, target }));
const verifier = createReplayVerifier();
await measure('reused lazy worker', () => verifier.verify(state, moves, target));
await verifier.close();
console.log('Memory values are parent-process heap deltas; worker RSS is not included. Results are local, indicative only.');
