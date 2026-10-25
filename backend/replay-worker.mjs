import { parentPort } from 'node:worker_threads';
import { replayCheckpoint } from './replay.mjs';

// Keep the worker alive and reuse it for successive checkpoint messages.
parentPort.on('message', ({ id, state, moves, target }) => {
  try {
    const { state: nextState, summary } = replayCheckpoint(state, moves, target);
    parentPort.postMessage({ id, ok: true, state: nextState, summary });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, message: error?.message || '对局记录不合法。' });
  }
});
