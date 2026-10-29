// Source Academy Python (§3 / §4) via py-slang's CSE machine. Shared by the
// browser worker and the Node validator so both judge identically.
import { runCode } from '@sourceacademy/py-slang';

// A step limit (rather than a clock) makes time-outs deterministic: the
// validator and the browser agree on what is too slow. 3 million steps is
// about 3 s in Chrome and under 1 s in Node; the heaviest reference solution
// needs about 0.6 million, and the textbook list-based queens(6) about 0.7 million.
export const STEP_LIMIT = 3_000_000;
const MARK = '@@CD-RESULT@@';
const SEP = '@@CD-EXPECTED@@';

export const chapterOf = (lang) => (lang === 'py4' ? 4 : 3);

function describeError(e) {
  const msg = String(e?.message ?? e).replace(/\s+$/, '');
  if (/^StepLimitExceeded/.test(msg)) {
    return { status: 'timeout', error: 'Time limit exceeded (the program ran too many steps — an infinite loop?)' };
  }
  return { status: 'error', error: msg };
}

const splitLines = (out) => (out ? out.replace(/\n$/, '').split('\n') : []);

export async function runSicpy(chapter, code) {
  const t0 = performance.now();
  try {
    const out = await runCode(code, chapter, { stepLimit: STEP_LIMIT });
    return { status: 'ok', output: splitLines(out), ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { ...describeError(e), output: splitLines(e?.output ?? ''), ms: Math.round(performance.now() - t0) };
  }
}

function testProgram(code, t) {
  return [
    code,
    t.setup ?? '',
    `__got = ${t.call}`,
    `__exp = ${t.expect}`,
    `print("${MARK}" + str(__got == __exp))`,
    'print(repr(__got))',
    `print("${SEP}")`,
    'print(repr(__exp))',
  ].join('\n');
}

export async function runSicpyTest(chapter, code, t) {
  let out;
  try {
    out = await runCode(testProgram(code, t), chapter, { stepLimit: STEP_LIMIT });
  } catch (e) {
    return describeError(e);
  }
  const at = out.lastIndexOf(MARK);
  if (at < 0) return { status: 'error', error: 'Could not read the test result' };
  const rest = out.slice(at + MARK.length);
  const nl = rest.indexOf('\n');
  const ok = rest.slice(0, nl) === 'True';
  const [got, expected] = rest.slice(nl + 1).replace(/\n$/, '').split(`\n${SEP}\n`);
  return { status: ok ? 'pass' : 'fail', got, expected };
}
