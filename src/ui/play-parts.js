// Pieces of the play screen shared by solo sessions (game.js) and duel rounds
// (round-game.js): the problem statement, run output, test results and the score
// breakdown.
import { h, markdown, formatTime, toast } from './dom.js';
import { LANG_LABELS, LANG_DOCS, DIFFICULTY_LABELS } from '../questions/index.js';
import { resolveTests, startingCode } from '../judge/resolve.js';
import { onEngineStatus, isPythonInterruptible } from '../runners/runner.js';
import { icon } from './icons.js';

let pythonReloadNoticeShown = false;

/** "def sum_digits(n):" -> "sum_digits(n)" */
export function signatureOf(q, code) {
  const re = new RegExp(`(?:function|def)\\s+(${q.functionName}\\s*\\([^)]*\\))`);
  return code.match(re)?.[1] ?? `${q.functionName}(…)`;
}

/**
 * The problem: title, a plain meta line, the statement, the signature and the
 * visible examples. extra: nodes shown under the meta line (e.g. what it is worth).
 */
export function problemView(q, lang, { timeSec = null, extra = null } = {}) {
  const tests = resolveTests(q, lang);
  const visible = tests.filter((t) => !t.hidden);
  const hiddenCount = tests.length - visible.length;
  return [
    h('div.problem-head', {},
      h('h2', {}, q.title),
      h('p.meta', {},
        h('span.qid', {}, q.id), ' · ',
        h(`span.diff.diff-${q.difficulty}`, {}, DIFFICULTY_LABELS[q.difficulty]), ' · ',
        h('span', {}, q.topic),
        timeSec !== null ? [' · ', h('span.time-limit', { title: 'Time limit' }, formatTime(timeSec))] : null),
      extra),
    q.mode === 'bug-hunt' ? h('div.notice', {}, icon('bug'), 'This code has a bug. Fix it so all tests pass.') : null,
    h('div.description', { html: markdown(q.description) }),
    LANG_DOCS[lang]
      ? h('p.lang-note', {},
        `In ${LANG_LABELS[lang]}, `, h('code', {}, 'pair'), ' / ', h('code', {}, 'llist'), ' build linked lists (',
        h('code', {}, 'None'), ' is the empty list) and ', h('code', {}, '[...]'), ' is an array. ',
        h('a', { href: LANG_DOCS[lang], target: '_blank', rel: 'noopener' }, 'Language reference'))
      : null,
    h('pre.signature', {}, h('code', {}, `def ${signatureOf(q, startingCode(q, lang))}`)),
    h('h3.section-title', {}, 'Examples'),
    h('ul.examples', {}, visible.map((t) => h('li', {},
      t.setup ? h('pre.setup', {}, t.setup) : null,
      h('code', {}, t.call), h('span.arrow', {}, ' → '), h('code', {}, t.expect),
      t.note ? h('span.note', {}, `  · ${t.note}`) : null))),
    h('p.secret-count', {}, `Submit also runs ${hiddenCount} secret test${hiddenCount === 1 ? '' : 's'}.`),
  ];
}

/** What a "Run" printed, as console lines. */
export function outputView(r) {
  return [
    ...r.output.map((line) => h('div.out-line', {}, line)),
    r.value !== undefined ? h('div.out-value', {}, `→ ${r.value}`) : null,
    r.status === 'timeout' ? h('div.out-error', {}, r.error?.startsWith('Time limit') ? r.error : `Time limit exceeded${r.error ? ` (${r.error})` : ''}`) : null,
    r.status === 'error' ? h('div.out-error', {}, r.error) : null,
    r.output.length === 0 && r.value === undefined && r.status === 'ok' ? h('div.muted', {}, '(no output)') : null,
    h('div.out-meta', {}, `${r.status === 'ok' ? 'Finished' : 'Stopped'} in ${r.ms} ms`),
  ];
}

const STATUS_LABEL = { pass: 'Passed', fail: 'Wrong answer', error: 'Error', timeout: 'Time limit exceeded' };

/**
 * Test results after "Run tests" or Submit.
 * reveal (duel rounds): { cost, isRevealed(index), detail(index) -> { call, expectText, got?, error? }, onReveal(index) | null }
 * Failed secret tests then offer a reveal for `cost` points, and revealed ones show their call.
 */
export function resultsView(report, { submitted, reveal = null }) {
  const visible = report.results.filter((r) => !r.hidden);
  const hidden = report.results.filter((r) => r.hidden);
  const mark = (pass) => h('span.mark', {}, icon(pass ? 'check' : 'cross', pass ? 'Passed' : 'Failed'));
  const grid = (d) => h('div.test-grid', {},
    h('span.k', {}, 'call'), h('code', {}, d.call),
    h('span.k', {}, 'expected'), h('code', {}, d.expectText),
    d.got !== undefined ? [h('span.k', {}, 'got'), h('code', {}, d.got)] : null,
    d.error ? [h('span.k', {}, 'error'), h('code.err', {}, d.error)] : null);
  const rows = [];
  if (report.banned) rows.push(h('div.out-error', {}, `You can't use ${report.banned} in this question`));
  visible.forEach((r, i) => {
    rows.push(h(`div.test-row.${r.status === 'pass' ? 'pass' : 'fail'}`, {},
      mark(r.status === 'pass'),
      h('div.test-head', {}, `Test ${i + 1}`, r.note ? h('span.note', {}, ` · ${r.note}`) : null,
        r.status === 'timeout' ? h('span.note', {}, ' · time limit exceeded') : null),
      grid(r)));
  });
  hidden.forEach((r, i) => {
    const pass = r.status === 'pass';
    const shown = reveal?.isRevealed(r.index);
    const canReveal = !pass && !shown && reveal?.onReveal;
    rows.push(h(`div.test-row.secret.${pass ? 'pass' : 'fail'}${shown ? '.revealed' : ''}`, {},
      mark(pass),
      h('div.test-head', {}, `Secret test ${i + 1}: ${STATUS_LABEL[r.status] ?? 'Failed'}`,
        canReveal ? h('button.btn.btn-small.btn-ghost.reveal-btn', {
          type: 'button',
          title: `Show this test's call and expected value. It lowers the most this question can score by ${reveal.cost}.`,
          onclick: () => reveal.onReveal(r.index),
        }, icon('eye'), `Reveal · −${reveal.cost}`) : null),
      shown ? grid(reveal.detail(r.index)) : null));
  });
  const summary = submitted
    ? `Visible ${report.passedVisible}/${report.totalVisible} · Secret ${report.passedHidden}/${report.totalHidden}`
    : `Visible ${report.passedVisible}/${report.totalVisible}`;
  const allPass = submitted ? report.solved : report.passedVisible === report.totalVisible;
  return [
    h(`div.results-summary.${allPass ? 'pass' : 'fail'}`, {}, summary, submitted ? (report.solved ? ' · all tests pass' : ' · not yet') : ''),
    ...rows,
  ];
}

/** How a question's points were worked out. */
export function breakdownRows(b) {
  const row = (label, value, kind = '') => [h('dt', {}, label), h(`dd${kind}`, {}, value)];
  return h('dl.rules', { 'aria-label': 'How this score was worked out' },
    row('Solve', b.base),
    b.partial ? row('Secret tests passed', `+${b.partial}`, '.gain') : row('Speed bonus', `+${b.timeBonus}`, '.gain'),
    b.submitPenalty ? row('Wrong submits', `−${b.submitPenalty}`, '.cost') : null,
    b.testPenalty ? row('Extra test runs', `−${b.testPenalty}`, '.cost') : null,
    b.editPenalty ? row('Lines over par', `−${b.editPenalty}`, '.cost') : null,
    b.revealPenalty ? row('Tests revealed', `−${b.revealPenalty}`, '.cost') : null);
}

/** Shows the code engine's loading state in `el`. -> stop() */
export function watchEngine(lang, el) {
  return onEngineStatus(({ engine, state, message }) => {
    if ((engine === 'python') !== (lang === 'python')) return;
    if (state === 'loading') el.textContent = engine === 'python' ? 'Loading Python…' : 'Loading Python §…';
    else if (state === 'reloading') {
      el.textContent = 'Python is reloading…';
      if (!pythonReloadNoticeShown && !isPythonInterruptible()) {
        pythonReloadNoticeShown = true;
        toast('Python is reloading… (this browser cannot interrupt Python, so the worker was restarted)');
      }
    } else if (state === 'failed') el.textContent = message ?? 'Engine failed to load';
    else el.textContent = '';
  });
}
