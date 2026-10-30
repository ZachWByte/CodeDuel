// Runs a question's tests through the runner and builds results that are safe
// to show: secret tests never carry their call, expected value, output or error
// (a submit keeps those apart, in `secret`, for a duel's paid reveal).
import { runTests } from '../runners/runner.js';
import { resolveTests, findBanned } from './resolve.js';

function sanitize(result, test) {
  if (result.hidden) {
    return { index: result.index, hidden: true, status: result.status };
  }
  return { ...result, call: test.call, expectText: test.expect, note: test.note };
}

function summarize(results) {
  const visible = results.filter((r) => !r.hidden);
  const hidden = results.filter((r) => r.hidden);
  return {
    passedVisible: visible.filter((r) => r.status === 'pass').length,
    totalVisible: visible.length,
    passedHidden: hidden.filter((r) => r.status === 'pass').length,
    totalHidden: hidden.length,
  };
}

/** Visible tests only ("Run tests"). */
export async function runVisibleTests(question, lang, code) {
  const tests = resolveTests(question, lang).filter((t) => !t.hidden);
  const raw = await runTests(lang, code, tests);
  const results = raw.map((r, i) => sanitize(r, tests[i]));
  return { results, ...summarize(results) };
}

/** Visible + secret tests ("Submit"). */
export async function submitSolution(question, lang, code) {
  const tests = resolveTests(question, lang);
  const banned = findBanned(question, lang, code);
  if (banned) {
    const results = tests.map((t) => sanitize(
      { index: t.index, hidden: t.hidden, status: 'error', error: `You can't use ${banned} in this question` }, t));
    return { results, banned, solved: false, ...summarize(results), total: tests.length };
  }
  const raw = await runTests(lang, code, tests);
  const results = raw.map((r, i) => sanitize(r, tests[i]));
  const s = summarize(results);
  return {
    results,
    ...s,
    total: tests.length,
    solved: s.passedVisible === s.totalVisible && s.passedHidden === s.totalHidden,
    // Kept off the results: what each secret test did, for a duel's paid reveal.
    secret: Object.fromEntries(raw.map((r, i) => [r, tests[i]]).filter(([, t]) => t.hidden)
      .map(([r, t]) => [t.index, { call: t.call, expectText: t.expect, got: r.got, error: r.error }])),
  };
}
