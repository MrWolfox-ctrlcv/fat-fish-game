import { parentPort, workerData } from 'node:worker_threads';
import { replayCheckpoint } from './replay.mjs';
try { parentPort.postMessage({ ok: true, ...replayCheckpoint(workerData.state, workerData.moves, workerData.target) }); }
catch (error) { parentPort.postMessage({ ok: false, message: error.message }); }
