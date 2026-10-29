// Validates the whole question bank (spec §10).
//   npm run validate               -> every question
//   npm run validate -- CR-E BH-M  -> only ids starting with these prefixes (skips the count check)
//
// Python §3/§4 runs through py-slang in a pool of Node worker threads (same code
// as the browser worker). Full Python runs through python3 with the same harness
// as Pyodide.
import { Worker } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { ALL_QUESTIONS, categoryOf } from '../src/questions/index.js';
import { resolveTests, findBanned, LANG_FAMILY } from '../src/judge/resolve.js';
import { PY_HARNESS } from '../src/runners/py-harness.js';

const prefixes = process.argv.slice(2);
const questions = prefixes.length
  ? ALL_QUESTIONS.filter((q) => prefixes.some((p) => q.id.startsWith(p)))
  : ALL_QUESTIONS;
if (questions.length === 0) {
  console.error(`No questions match ${prefixes.join(', ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------- Python § pool (py-slang)
const SICPY_WORKER = `
import { parentPort } from 'node:worker_threads';
import { runSicpy, runSicpyTest } from ${JSON.stringify(new URL('../src/runners/sicpy-core.js', import.meta.url).href)};
parentPort.on('message', async (job) => {
  const r = job.test ? await runSicpyTest(job.chapter, job.code, job.test) : await runSicpy(job.chapter, job.code);
  parentPort.postMessage({ id: job.id, r });
});
`;

function sicpyPool(size) {
  const queue = [];
  const waiting = new Map();
  const idle = [];
  let seq = 0;
  const workers = Array.from({ length: size }, () => {
    const w = new Worker(SICPY_WORKER, { eval: true, type: 'module' });
    w.on('message', ({ id, r }) => {
      waiting.get(id)(r);
      waiting.delete(id);
      next(w);
    });
    idle.push(w);
    return w;
  });
  function next(w) {
    const job = queue.shift();
    if (!job) { idle.push(w); return; }
    w.postMessage(job.msg);
  }
  return {
    run(msg) {
      return new Promise((resolve) => {
        const id = ++seq;
        waiting.set(id, resolve);
        const job = { msg: { ...msg, id } };
        const w = idle.pop();
        if (w) w.postMessage(job.msg); else queue.push(job);
      });
    },
    close: () => Promise.all(workers.map((w) => w.terminate())),
  };
}

// ---------------------------------------------------------------- Python batch
const PY_DRIVER = `${PY_HARNESS}
import json, signal, io
def _cd_alarm(signum, frame):
    raise KeyboardInterrupt
signal.signal(signal.SIGALRM, _cd_alarm)
_jobs = json.load(sys.stdin)
_out = []
for _j in _jobs:
    sys.stdout = io.StringIO()
    signal.setitimer(signal.ITIMER_REAL, 2.5)
    try:
        if _j.get('call') is None:
            _r = _cd_run(_j['code'])
        else:
            _r = _cd_test(_j['code'], _j.get('setup') or '', _j['call'], _j['expect'])
    except KeyboardInterrupt:
        _r = ['timeout', 'Time limit exceeded']
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    _out.append(_r)
sys.stdout = sys.__stdout__
json.dump(_out, sys.stdout)
`;

function runPythonBatch(jobs) {
  if (jobs.length === 0) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const p = spawn('python3', ['-I', '-c', PY_DRIVER]);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (codeNum) => {
      if (codeNum !== 0) return reject(new Error(`python3 exited ${codeNum}: ${err}`));
      resolve(JSON.parse(out).map((r) => {
        if (r[0] === 'ok' && r.length === 4) return { status: r[1] ? 'pass' : 'fail', got: r[2], expected: r[3] };
        if (r[0] === 'ok') return { status: 'ok' };
        return { status: r[0], error: r[1] };
      }));
    });
    p.stdin.end(JSON.stringify(jobs));
  });
}

// ---------------------------------------------------------------- checks
const problems = []; // { id, lang, check, detail }
const table = new Map(); // id -> { lang -> 'ok' | 'FAIL' }
const fail = (q, lang, check, detail) => {
  problems.push({ id: q.id, lang, check, detail });
  const row = table.get(q.id) ?? {};
  if (lang) row[lang] = 'FAIL';
  table.set(q.id, row);
};

/** 1-based line numbers of `before` that are not kept in an LCS line diff with `after`. */
function changedLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const changed = new Set();
  let i = 0;
  let j = 0;
  while (i < a.length) {
    if (j < b.length && a[i] === b[j]) { i++; j++; }
    else if (j < b.length && dp[i][j + 1] >= dp[i + 1][j]) j++;
    else { changed.add(i + 1); i++; }
  }
  return changed;
}

function schemaChecks() {
  const ids = new Set();
  for (const q of questions) {
    for (const f of ['id', 'mode', 'difficulty', 'title', 'topic', 'languages', 'description', 'functionName', 'solution', 'tests']) {
      if (q[f] === undefined || q[f] === '') fail(q, null, 'schema', `missing ${f}`);
    }
    if (ids.has(q.id)) fail(q, null, 'schema', 'duplicate id');
    ids.add(q.id);
    const prefix = { 'code-race': 'CR', 'bug-hunt': 'BH' }[q.mode] + '-' + { easy: 'E', medium: 'M', hard: 'H' }[q.difficulty];
    if (!q.id.startsWith(prefix)) fail(q, null, 'schema', `id does not match mode/difficulty (${prefix})`);
    if (!q.description.includes(q.functionName)) fail(q, null, 'schema', 'description does not mention functionName');
    if (q.languages.includes('py3') && !q.languages.includes('py4')) fail(q, null, 'schema', 'py3 without py4');
    for (const lang of q.languages) {
      const fam = LANG_FAMILY[lang];
      if (!q.solution[fam]) fail(q, lang, 'schema', 'no solution');
      if (q.mode === 'code-race' && !q.starter?.[fam]) fail(q, lang, 'schema', 'no starter');
      if (q.mode === 'bug-hunt') {
        if (!q.buggy?.[fam]) fail(q, lang, 'schema', 'no buggy code');
        const lines = q.bugLines?.[fam];
        const n = (q.buggy?.[fam] ?? '').split('\n').length;
        if (!lines?.length || lines.some((l) => l < 1 || l > n)) fail(q, lang, 'schema', 'bad bugLines');
        else {
          // A highlighted line must be one the fix changes (unless the fix only inserts lines).
          const changed = changedLines(q.buggy[fam], q.solution[fam] ?? '');
          if (changed.size && !lines.some((l) => changed.has(l))) {
            fail(q, lang, 'schema', `bugLines ${lines} do not touch the changed lines ${[...changed]}`);
          }
        }
      }
      const tests = resolveTests(q, lang);
      const vis = tests.filter((t) => !t.hidden).length;
      const hid = tests.length - vis;
      if (vis < 2 || hid < 4) fail(q, lang, 'schema', `needs ≥2 visible and ≥4 hidden tests (has ${vis}/${hid})`);
      if (findBanned(q, lang, q.solution[fam] ?? '')) fail(q, lang, 'banned', 'solution uses a banned name');
    }
    if (!categoryOf(q)) fail(q, null, 'schema', `topic "${q.topic}" is in no category (questions/index.js)`);
    if (q.mode === 'bug-hunt' && !q.bugExplanation) fail(q, null, 'schema', 'no bugExplanation');
    if (q.mode === 'code-race' && q.buggy) fail(q, null, 'schema', 'code race with buggy code');
    if (!q.languages.includes('python') && (q.solution.python || q.starter?.python || q.buggy?.python)) {
      fail(q, null, 'schema', 'python code on a question without python');
    }
  }
}

function countChecks() {
  if (prefixes.length) return;
  const count = (pred) => ALL_QUESTIONS.filter(pred).length;
  const want = [
    ['total', () => true, 275],
    ['code-race easy', (q) => q.mode === 'code-race' && q.difficulty === 'easy', 60],
    ['code-race medium', (q) => q.mode === 'code-race' && q.difficulty === 'medium', 62],
    ['code-race hard', (q) => q.mode === 'code-race' && q.difficulty === 'hard', 51],
    ['bug-hunt easy', (q) => q.mode === 'bug-hunt' && q.difficulty === 'easy', 33],
    ['bug-hunt medium', (q) => q.mode === 'bug-hunt' && q.difficulty === 'medium', 38],
    ['bug-hunt hard', (q) => q.mode === 'bug-hunt' && q.difficulty === 'hard', 31],
    ['py4', (q) => q.languages.includes('py4'), 275],
    ['py3', (q) => q.languages.includes('py3'), 270],
    ['python', (q) => q.languages.includes('python'), 265],
  ];
  for (const [name, pred, n] of want) {
    const got = count(pred);
    if (got !== n) problems.push({ id: '(bank)', lang: null, check: 'counts', detail: `${name}: expected ${n}, got ${got}` });
  }
}

/** Every program we need to run, as { q, lang, chapter, role, test? } */
function plan() {
  const jobs = [];
  for (const q of questions) {
    for (const lang of q.languages) {
      const fam = LANG_FAMILY[lang];
      const tests = resolveTests(q, lang);
      const chapter = lang === 'py4' ? 4 : 3;
      const add = (role, code, ch = chapter) => {
        if (!code) return;
        jobs.push({ q, lang, chapter: ch, role, code });              // bare run (syntax check)
        for (const t of tests) jobs.push({ q, lang, chapter: ch, role, code, test: t });
      };
      add('solution', q.solution[fam]);
      if (lang === 'py4' && !q.languages.includes('py3')) add('solution-in-s3', q.solution.sicpy, 3);
      // Starters and buggy programs: check once per family (in §3 when allowed).
      if (lang === 'py4' && q.languages.includes('py3')) continue;
      if (q.mode === 'code-race') add('starter', q.starter?.[fam]);
      else add('buggy', q.buggy?.[fam]);
    }
  }
  return jobs;
}

function evaluate(jobs) {
  const groups = new Map();
  for (const j of jobs) {
    const key = `${j.q.id}|${j.lang}|${j.role}`;
    if (!groups.has(key)) groups.set(key, { q: j.q, lang: j.lang, role: j.role, bare: null, tests: [] });
    const g = groups.get(key);
    if (j.test) g.tests.push({ t: j.test, r: j.r }); else g.bare = j.r;
  }
  for (const { q, lang, role, bare, tests } of groups.values()) {
    const failed = tests.filter((x) => x.r.status !== 'pass');
    const describe = (x) => `#${x.t.index}${x.t.hidden ? 'h' : ''} ${x.t.call} -> ${x.r.status}${x.r.got !== undefined ? ` got ${x.r.got}` : ''}${x.r.error ? ` (${x.r.error.split('\n')[0]})` : ''}`;
    if (role === 'solution') {
      if (bare.status !== 'ok') fail(q, lang, 'solution-runs', bare.error);
      for (const x of failed) fail(q, lang, 'solution', describe(x));
    } else if (role === 'solution-in-s3') {
      if (failed.length === 0) fail(q, lang, 'needs-s4', 'solution also passes in §3');
    } else if (role === 'starter') {
      if (bare.status !== 'ok') fail(q, lang, 'starter-runs', bare.error);
      if (failed.length === 0) fail(q, lang, 'starter', 'starter passes every test');
    } else if (role === 'buggy') {
      if (bare.status !== 'ok') fail(q, lang, 'buggy-runs', bare.error);
      if (!failed.some((x) => !x.t.hidden)) fail(q, lang, 'buggy-visible', 'buggy code passes all visible tests');
      if (!failed.some((x) => x.t.hidden)) fail(q, lang, 'buggy-hidden', 'buggy code passes all hidden tests');
      const summary = tests.map((x) => (x.r.status === 'pass' ? 'P' : 'F')).join('');
      groups.get(`${q.id}|${lang}|buggy`).summary = summary;
    }
  }
  return groups;
}

// ---------------------------------------------------------------- main
const t0 = Date.now();
schemaChecks();
countChecks();

const jobs = plan();
const sicpyJobs = jobs.filter((j) => j.lang !== 'python');
const pyJobs = jobs.filter((j) => j.lang === 'python');
const pool = sicpyPool(Math.max(2, Math.min(8, cpus().length - 1)));
const [sicpyResults, pyResults] = await Promise.all([
  Promise.all(sicpyJobs.map((j) => pool.run({ chapter: j.chapter, code: j.code, test: j.test }))),
  runPythonBatch(pyJobs.map((j) => ({ code: j.code, setup: j.test?.setup, call: j.test?.call ?? null, expect: j.test?.expect }))),
]);
await pool.close();
sicpyJobs.forEach((j, i) => { j.r = sicpyResults[i]; });
pyJobs.forEach((j, i) => { j.r = pyResults[i]; });
const groups = evaluate(jobs);

// Table: id × language
const LANGS = ['py3', 'py4', 'python'];
const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${pad('id', 8)} ${LANGS.map((l) => pad(l, 9)).join(' ')} buggy (P/F per test)`);
for (const q of questions) {
  const row = table.get(q.id) ?? {};
  const cells = LANGS.map((l) => pad(!q.languages.includes(l) ? '-' : row[l] ?? 'ok', 9));
  const bug = q.mode === 'bug-hunt'
    ? q.languages.map((l) => groups.get(`${q.id}|${l}|buggy`)?.summary).filter(Boolean).join(' ')
    : '';
  console.log(`${pad(q.id, 8)} ${cells.join(' ')} ${bug}`);
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ✗ ${p.id} ${p.lang ?? ''} [${p.check}] ${p.detail ?? ''}`);
}
console.log(`\n${questions.length} questions, ${jobs.length} programs run in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(problems.length ? 'VALIDATION FAILED' : 'ALL CHECKS PASSED');
process.exit(problems.length ? 1 : 0);
