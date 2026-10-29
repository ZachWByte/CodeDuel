// Python runner, backed by Pyodide (CPython compiled to WebAssembly).
// The main thread owns the interrupt buffer: writing 2 into it raises
// KeyboardInterrupt inside the running Python code.
import { PY_HARNESS } from './py-harness.js';

let pyodide = null;
let interrupt = null;
let output = null; // array while a Run is capturing output, else null

async function init(buffer) {
  const base = `${self.location.origin}${import.meta.env.BASE_URL}pyodide/`;
  const { loadPyodide } = await import(/* @vite-ignore */ `${base}pyodide.mjs`);
  pyodide = await loadPyodide({ indexURL: base });
  if (buffer) {
    interrupt = new Uint8Array(buffer);
    pyodide.setInterruptBuffer(interrupt);
  }
  pyodide.setStdout({ batched: (s) => output && output.push(s) });
  pyodide.setStderr({ batched: (s) => output && output.push(s) });
  pyodide.runPython(PY_HARNESS);
}

function callHarness(name, ...args) {
  if (interrupt) interrupt[0] = 0;
  const fn = pyodide.globals.get(name);
  const proxy = fn(...args);
  const result = proxy.toJs();
  proxy.destroy();
  fn.destroy();
  return result;
}

function run(code) {
  output = [];
  const t0 = performance.now();
  const [status, error] = callHarness('_cd_run', code);
  const res = { status: status === 'ok' ? 'ok' : status, output, ms: Math.round(performance.now() - t0) };
  if (error) res.error = error;
  output = null;
  return res;
}

function runTest(code, t) {
  const r = callHarness('_cd_test', code, t.setup ?? '', t.call, t.expect);
  if (r[0] === 'ok') return { status: r[1] ? 'pass' : 'fail', got: r[2], expected: r[3] };
  return { status: r[0], error: r[1] };
}

self.onmessage = async ({ data }) => {
  if (data.kind === 'init') {
    try {
      await init(data.buffer);
      self.postMessage({ ready: true });
    } catch (e) {
      self.postMessage({ ready: false, fatal: `Could not load Python: ${e?.message ?? e}` });
    }
    return;
  }
  const { id, kind, code } = data;
  try {
    if (kind === 'run') {
      self.postMessage({ id, start: 0 });
      self.postMessage({ id, done: true, result: run(code) });
    } else if (kind === 'tests') {
      for (const t of data.tests) {
        self.postMessage({ id, start: t.index });
        self.postMessage({ id, progress: { index: t.index, ...runTest(code, t) } });
      }
      self.postMessage({ id, done: true });
    }
  } catch (e) {
    output = null;
    self.postMessage({ id, done: true, fatal: String(e?.message ?? e) });
  }
};
