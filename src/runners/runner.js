// Common interface over the Source Academy Python (py-slang) and full Python
// (Pyodide) workers.
//
//   run(lang, code)
//     -> { status: 'ok'|'error'|'timeout', output: string[], value?, error?, ms }
//   runTests(lang, code, tests)
//     tests: [{ index, hidden, setup?, call, expect }] (already resolved for lang)
//     -> [{ index, hidden, status: 'pass'|'fail'|'error'|'timeout', got?, expected?, error? }]
//
// Hidden-test details are stripped later by the judge, before anything reaches the UI.

export const PER_TEST_MS = 2500;
// py-slang stops runaway programs itself with a step limit; the hard cap per
// test is longer so that limit (not the cap) is what normally ends a run.
const PER_TEST_MS_SICPY = 4000;
const RUN_LIMIT_MS = 3000; // Python "Run" interrupt
const CAP_EXTRA_MS = 3000;
const TLE = 'Time limit exceeded';

const listeners = new Set();
/** Subscribe to engine status: { engine: 'sicpy'|'python', state: 'loading'|'ready'|'reloading'|'failed', message? } */
export function onEngineStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (e) => listeners.forEach((fn) => fn(e));

class WorkerEngine {
  constructor(name, factory) {
    this.name = name;
    this.factory = factory;
    this.worker = null;
    this.ready = null;
    this.queue = Promise.resolve();
    this.seq = 0;
    this.isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
    this.interrupt = null;
    this.loadedOnce = false;
  }

  spawn() {
    const worker = this.factory();
    this.worker = worker;
    emit({ engine: this.name, state: this.loadedOnce ? 'reloading' : 'loading' });
    this.ready = new Promise((resolve, reject) => {
      const onMsg = ({ data }) => {
        if (!('ready' in data)) return;
        worker.removeEventListener('message', onMsg);
        if (data.ready) {
          this.loadedOnce = true;
          emit({ engine: this.name, state: 'ready' });
          resolve();
        } else {
          emit({ engine: this.name, state: 'failed', message: data.fatal });
          reject(new Error(data.fatal));
        }
      };
      worker.addEventListener('message', onMsg);
      worker.addEventListener('error', (e) => {
        emit({ engine: this.name, state: 'failed', message: e.message });
        reject(new Error(e.message || `${this.name} worker failed to start`));
      });
    });
    if (this.name === 'python') {
      const buffer = this.isolated ? new SharedArrayBuffer(1) : null;
      this.interrupt = buffer ? new Uint8Array(buffer) : null;
      worker.postMessage({ kind: 'init', buffer });
    }
    // Avoid an unhandled rejection if nobody is waiting yet.
    this.ready.catch(() => {});
  }

  restart() {
    try { this.worker?.terminate(); } catch { /* already gone */ }
    this.worker = null;
    this.spawn();
  }

  /** Make sure the worker exists; resolves when it is ready. */
  warm() {
    if (!this.worker) this.spawn();
    return this.ready;
  }

  /** Serialize requests: one program runs at a time per engine. */
  request(msg, count) {
    const job = this.queue.then(() => this.execute(msg, count));
    this.queue = job.catch(() => {});
    return job;
  }

  async execute(msg, count) {
    try {
      await this.warm();
    } catch (e) {
      this.worker = null; // retry the load next time
      return { fatal: e.message, progress: [] };
    }
    const id = ++this.seq;
    const worker = this.worker;
    const progress = [];
    return new Promise((resolve) => {
      let testTimer = null;
      let finished = false;

      const finish = (out) => {
        if (finished) return;
        finished = true;
        clearTimeout(capTimer);
        clearTimeout(testTimer);
        worker.removeEventListener('message', onMsg);
        resolve({ progress, ...out });
      };

      const kill = (reason) => {
        this.restart();
        finish({ killed: reason });
      };

      const perTest = this.name === 'python' ? PER_TEST_MS : PER_TEST_MS_SICPY;
      const capTimer = setTimeout(() => kill('cap'), perTest * Math.max(1, count) + CAP_EXTRA_MS);

      const onMsg = ({ data }) => {
        if (data.id !== id) return;
        if ('start' in data && this.name === 'python') {
          // Per-test time limit for full Python. py-slang enforces its own step limit.
          clearTimeout(testTimer);
          const limit = msg.kind === 'run' ? RUN_LIMIT_MS : PER_TEST_MS;
          testTimer = setTimeout(() => {
            if (this.interrupt) this.interrupt[0] = 2; // raises KeyboardInterrupt
            else kill('timeout');                     // fallback: not cross-origin isolated
          }, limit);
        } else if (data.progress) {
          clearTimeout(testTimer);
          progress.push(data.progress);
        } else if (data.done) {
          // A fatal error (e.g. Pyodide's WebAssembly stack overflowing) can leave
          // the engine unusable, so start a fresh worker for the next request.
          if (data.fatal) this.restart();
          finish({ result: data.result, fatal: data.fatal });
        }
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ ...msg, id });
    });
  }
}

const engines = {
  sicpy: new WorkerEngine('sicpy', () =>
    new Worker(new URL('./sicpy.worker.js', import.meta.url), { type: 'module' })),
  python: new WorkerEngine('python', () =>
    new Worker(new URL('./python.worker.js', import.meta.url), { type: 'module' })),
};

const engineFor = (lang) => (lang === 'python' ? engines.python : engines.sicpy);

/** Start loading an engine in the background (e.g. when the player picks Python). */
export function warmUp(lang) {
  return engineFor(lang).warm().catch(() => {});
}

export function isPythonInterruptible() {
  return engines.python.isolated;
}

export async function run(lang, code) {
  const t0 = performance.now();
  const r = await engineFor(lang).request({ kind: 'run', lang, code }, 1);
  if (r.result) return r.result;
  const ms = Math.round(performance.now() - t0);
  if (r.killed) return { status: 'timeout', output: [], error: TLE, ms };
  return { status: 'error', output: [], error: describeFatal(r.fatal), ms };
}

export async function runTests(lang, code, tests) {
  if (tests.length === 0) return [];
  const r = await engineFor(lang).request(
    { kind: 'tests', lang, code, tests: tests.map(({ index, setup, call, expect }) => ({ index, setup, call, expect })) },
    tests.length,
  );
  const byIndex = new Map(r.progress.map((p) => [p.index, p]));
  return tests.map((t) => {
    const p = byIndex.get(t.index);
    if (p) return { ...p, hidden: !!t.hidden };
    if (r.killed) return { index: t.index, hidden: !!t.hidden, status: 'timeout', error: TLE };
    return { index: t.index, hidden: !!t.hidden, status: 'error', error: r.fatal ? describeFatal(r.fatal) : 'Test did not run' };
  });
}

function describeFatal(msg) {
  if (!msg) return 'Unknown error';
  if (/call stack|stack overflow/i.test(msg)) return 'RecursionError: maximum recursion depth exceeded (the engine was restarted)';
  return msg;
}
