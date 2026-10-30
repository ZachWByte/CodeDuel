// Re-runs a few tests of a duel submission on the server, so a player cannot
// claim a solve their code does not earn. Only for Python §3 / §4: py-slang is an
// interpreter written in JavaScript with no access to files, the network or the
// machine, so running untrusted code in it is safe. (Full Python stays trusted
// from the browser: running untrusted CPython on the server would not be.)
//
// The code runs in a worker thread with py-slang's step limit, a memory cap and a
// wall-clock timeout, so an infinite loop or a memory bomb only costs a worker.
// Running out of memory or time is the code's fault and counts against it. Jobs
// run one at a time; only when the queue is full is a check skipped (the result is
// then trusted, as before) rather than slowing every game down.
import { Worker } from 'node:worker_threads';

const CORE_URL = new URL('../src/runners/sicpy-core.js', import.meta.url).href;
const WORKER_SOURCE = `
import { parentPort } from 'node:worker_threads';
import { runSicpyTest } from ${JSON.stringify(CORE_URL)};
parentPort.on('message', async ({ chapter, code, tests }) => {
  const results = [];
  for (const t of tests) results.push(await runSicpyTest(chapter, code, t));
  parentPort.postMessage(results);
});
`;

export const VERIFY_LANGS = ['py3', 'py4'];

/**
 * createVerifier({ timeoutMs, memoryMb, maxQueue }) -> { run(chapter, code, tests), close() }
 * run resolves with
 *   { results: [{ status: 'pass' | 'fail' | 'error' | 'timeout' }] }  the tests ran,
 *   { failure: 'memory' | 'time' }  the code used too much memory or took too long,
 *   null  the check was skipped because the queue is full.
 * The timeout is generous: the step limit stops slow code first, and it has to
 * allow for a slow CPU (Render's free plan).
 */
export function createVerifier({ timeoutMs = 45_000, memoryMb = 128, maxQueue = 8 } = {}) {
  let worker = null;
  let chain = Promise.resolve();
  let queued = 0;

  function spawn() {
    worker ??= new Worker(WORKER_SOURCE, {
      eval: true,
      type: 'module',
      resourceLimits: { maxOldGenerationSizeMb: memoryMb, maxYoungGenerationSizeMb: 32 },
    });
    worker.unref();
    return worker;
  }

  function kill(w) {
    if (worker === w) worker = null;
    w.terminate().catch(() => {});
  }

  function runOne(job) {
    return new Promise((resolve) => {
      const w = spawn();
      const finish = (value) => {
        clearTimeout(timer);
        w.off('message', onMessage);
        w.off('error', onError);
        w.off('exit', onExit);
        resolve(value);
      };
      const onMessage = (results) => finish({ results });
      // A worker only dies like this when the code blows the memory cap.
      const onError = () => { kill(w); finish({ failure: 'memory' }); };
      const onExit = () => { if (worker === w) worker = null; finish({ failure: 'memory' }); };
      const timer = setTimeout(() => { kill(w); finish({ failure: 'time' }); }, timeoutMs);
      w.on('message', onMessage);
      w.on('error', onError);
      w.on('exit', onExit);
      w.postMessage(job);
    });
  }

  return {
    run(chapter, code, tests) {
      if (queued >= maxQueue) return Promise.resolve(null);
      queued += 1;
      const result = chain.then(() => runOne({ chapter, code, tests }));
      chain = result.then(() => { queued -= 1; }, () => { queued -= 1; });
      return result;
    },
    close() {
      if (worker) kill(worker);
    },
  };
}
