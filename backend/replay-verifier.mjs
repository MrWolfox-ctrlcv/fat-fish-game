import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';

const workerUrl = new URL('./replay-worker.mjs', import.meta.url);
const invalid = (message) => Object.assign(new Error(message), { status: 422, code: 'INVALID_REPLAY' });
const unavailable = () => Object.assign(new Error('对局核验暂时不可用，请重试。'), { status: 503 });

/** A single lazily-created worker, with bounded FIFO waiting and idle teardown. */
export function createReplayVerifier({ timeoutMs = 7000, idleMs = 5000, maxQueue = 4, WorkerClass = Worker, url = workerUrl } = {}) {
  let worker = null;
  let terminating = false;
  let current = null;
  let queue = [];
  let idleTimer = null;
  let closed = false;
  let exits = 0;
  const idleWaiters = [];

  const clearIdle = () => { clearTimeout(idleTimer); idleTimer = null; };
  const settle = (task, error, result) => {
    if (!task || task.settled) return;
    task.settled = true;
    clearTimeout(task.timer);
    error ? task.reject(error) : task.resolve(result);
  };
  const resolveIdleWaiters = () => { for (const resolve of idleWaiters.splice(0)) resolve(); };

  function onExit(instance, code) {
    if (worker !== instance) return;
    worker = null;
    terminating = false;
    exits++;
    clearIdle();
    if (current) {
      settle(current, unavailable());
      current = null;
    }
    if (closed) {
      for (const task of queue.splice(0)) settle(task, unavailable());
      resolveIdleWaiters();
      return;
    }
    if (code !== 0 && queue.length === 0) { /* worker is fully released */ }
    pump();
  }

  function startWorker() {
    const instance = new WorkerClass(url, { resourceLimits: { maxOldGenerationSizeMb: 64 } });
    worker = instance;
    instance.on('message', (result) => {
      if (worker !== instance || !current || result?.id !== current.id) return;
      const task = current;
      current = null;
      if (result.ok) settle(task, null, { state: result.state, summary: result.summary });
      else settle(task, invalid(result.message || '对局记录不合法。'));
      pump();
    });
    instance.on('error', () => {
      if (worker !== instance) return;
      if (current) { settle(current, unavailable()); current = null; }
      // Wait for exit before starting another worker, keeping the peak at one.
      terminate(instance);
    });
    instance.on('exit', (code) => onExit(instance, code));
    return instance;
  }

  function terminate(instance = worker) {
    if (!instance || worker !== instance || terminating) return;
    terminating = true;
    clearIdle();
    void instance.terminate();
  }

  function pump() {
    if (terminating) return;
    if (closed || current || queue.length === 0) {
      if (!closed && worker && !current && queue.length === 0) {
        clearIdle();
        idleTimer = setTimeout(() => {
          if (worker && !current && queue.length === 0) terminate(worker);
        }, idleMs);
        idleTimer.unref?.();
      }
      if (!worker && !current && queue.length === 0) resolveIdleWaiters();
      return;
    }
    clearIdle();
    if (!worker) {
      try { startWorker(); }
      catch {
        settle(queue.shift(), unavailable());
        pump();
        return;
      }
    }
    const task = queue.shift();
    current = task;
    task.timer = setTimeout(() => {
      if (current !== task) return;
      settle(task, invalid('对局记录过长，请重新开始。'));
      current = null;
      // Do not admit another job until the timed-out worker has really exited.
      terminate(worker);
    }, timeoutMs);
    try { worker.postMessage({ id: task.id, state: task.state, moves: task.moves, target: task.target }); }
    catch { settle(task, unavailable()); current = null; terminate(worker); }
  }

  function verify(state, moves, target) {
    if (closed) return Promise.reject(unavailable());
    if (!current && !worker && queue.length === 0) clearIdle();
    if ((current || terminating) && queue.length >= maxQueue) return Promise.reject(Object.assign(new Error('正在核对其他对局，请稍后重试。'), { status: 503 }));
    return new Promise((resolve, reject) => {
      queue.push({ id: randomUUID(), state, moves, target, resolve, reject, settled: false, timer: null });
      pump();
    });
  }

  async function close() {
    if (!closed) {
      closed = true;
      clearIdle();
      for (const task of queue.splice(0)) settle(task, unavailable());
      if (current) { settle(current, unavailable()); current = null; }
      if (worker) {
        const instance = worker;
        terminate(instance);
        await instance.terminate();
        // terminate() waits for exit, whose handler clears worker and resolves waiters.
      }
    }
    if (worker) await new Promise((resolve) => idleWaiters.push(resolve));
  }

  return { verify, close, diagnostics: () => ({ active: Boolean(current), queued: queue.length, worker: Boolean(worker), exits, closed }) };
}
