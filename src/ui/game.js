// Game screen: problem panel, editor, console and test results.
import { h, setChildren, markdown, formatTime, confirmDialog, toast } from './dom.js';
import { viewButton, splitter, closePanel } from './view-settings.js';
import { createEditor, createViewer } from '../editor/editor.js';
import { getQuestion, LANG_LABELS, LANG_DOCS, MODE_LABELS, DIFFICULTY_LABELS } from '../questions/index.js';
import { resolveTests, startingCode, linesChanged, LANG_FAMILY } from '../judge/resolve.js';
import { runVisibleTests, submitSolution } from '../judge/judge.js';
import { run, onEngineStatus, isPythonInterruptible } from '../runners/runner.js';
import { timeLeftSec, BASE_POINTS, PENALTIES, FREE_TEST_RUNS } from '../state/engine.js';
import { loadDraft, saveDraft, clearDraft, loadBest, saveBestIfBetter } from '../state/storage.js';

const DRAFT_EVERY_MS = 3000;
let pythonReloadNoticeShown = false;

/** "function sum_digits(n) {" / "def sum_digits(n):" -> "sum_digits(n)" */
function signatureOf(q, code) {
  const re = new RegExp(`(?:function|def)\\s+(${q.functionName}\\s*\\([^)]*\\))`);
  return code.match(re)?.[1] ?? `${q.functionName}(…)`;
}

/**
 * renderGame(root, { store, resumed, onFinished, onQuit, headerExtra?, quitMessage? })
 * store: { getState(), dispatch(action), subscribe(fn) -> unsubscribe }
 * headerExtra: optional element shown in the header (the duel opponent bar)
 */
export function renderGame(root, { store, resumed, onFinished, onQuit, headerExtra = null,
  quitMessage = 'Leave this session? Your progress in it will be lost.' }) {
  const { lang, mode, difficulty } = store.getState().config;
  const fam = LANG_FAMILY[lang];
  let q = null;
  let editor = null;
  let busy = false;
  let alive = true;
  let lastSavedCode = null;
  let revealed = false;
  let viewers = [];
  let meterFrame = 0;

  // ---------------------------------------------------------------- skeleton
  const el = {
    qcount: h('span.hdr-q', {}),
    timer: h('span.hdr-timer', {}),
    score: h('span.hdr-score', {}),
    problem: h('div.problem-body', {}),
    endCard: h('div.end-card-host', {}),
    editorHost: h('div.editor-host', {}),
    status: h('span.run-status', {}),
    engineNote: h('span.engine-note', {}),
    output: h('div.console-pane.output', {}),
    results: h('div.console-pane.results', {}),
    main: h('main.game-main', {}),
    meter: h('span.meter', {}),
  };

  const btn = {
    run: h('button.btn#btn-run', { title: 'Run (Ctrl/⌘ + Enter)', onclick: () => doRun() }, '▶ Run'),
    tests: h('button.btn#btn-tests', { title: 'Run the visible tests', onclick: () => doTests() }, '✓ Run tests'),
    submit: h('button.btn.btn-primary#btn-submit', { title: 'Submit (Ctrl/⌘ + Shift + Enter)', onclick: () => doSubmit() }, 'Submit'),
    reset: h('button.btn.btn-ghost#btn-reset', { onclick: () => doReset() }, 'Reset'),
    skip: h('button.btn.btn-ghost#btn-skip', { onclick: () => doSkip() }, 'Skip'),
  };

  const tabs = {
    output: h('button.tab', { onclick: () => showTab('output') }, 'Output'),
    results: h('button.tab', { onclick: () => showTab('results') }, 'Test results'),
  };

  function showTab(name) {
    for (const [k, b] of Object.entries(tabs)) b.classList.toggle('active', k === name);
    el.output.hidden = name !== 'output';
    el.results.hidden = name !== 'results';
  }

  setChildren(root, h('div.game', {},
    h('header.game-header', {},
      h('div.hdr-left', {},
        h('button.btn.btn-ghost.btn-small#btn-quit', { onclick: () => doQuit() }, '← Home'),
        h('span.hdr-title', {}, `${MODE_LABELS[mode]} · ${DIFFICULTY_LABELS[difficulty]} · ${LANG_LABELS[lang]}`)),
      el.qcount,
      h('div.hdr-right', {}, headerExtra, el.timer, el.score, viewButton())),
    el.main));
  // The editor side and widths come from the view settings (CSS variables).
  el.main.append(
    h('section.panel.problem', {}, el.endCard, el.problem),
    splitter(el.main),
    h('section.panel.work', {},
      el.editorHost,
      h('div.toolbar', {},
        btn.run, btn.tests, btn.submit, el.meter, h('span.spacer', {}), el.status, btn.reset, btn.skip),
      h('div.console', {},
        h('div.tabs', {}, tabs.output, tabs.results, h('span.spacer', {}), el.engineNote),
        el.output, el.results)));
  showTab('output');
  el.output.append(h('p.muted', {}, 'Run your program to see its output here.'));

  editor = createEditor(el.editorHost, {
    lang,
    onRun: () => doRun(),
    onSubmit: () => doSubmit(),
    onChange: () => {
      if (meterFrame) return;
      meterFrame = requestAnimationFrame(() => { meterFrame = 0; updateMeter(); });
    },
  });

  // ---------------------------------------------------------------- engine status
  const offEngine = onEngineStatus(({ engine, state, message }) => {
    if ((engine === 'python') !== (lang === 'python')) return;
    if (state === 'loading') el.engineNote.textContent = engine === 'python' ? 'Loading Python…' : 'Loading Python §…';
    else if (state === 'reloading') {
      el.engineNote.textContent = 'Python is reloading…';
      if (!pythonReloadNoticeShown && !isPythonInterruptible()) {
        pythonReloadNoticeShown = true;
        toast('Python is reloading… (this browser cannot interrupt Python, so the worker was restarted)');
      }
    } else if (state === 'failed') el.engineNote.textContent = `⚠ ${message ?? 'Engine failed to load'}`;
    else el.engineNote.textContent = '';
  });

  // ---------------------------------------------------------------- question
  function mountQuestion(fresh) {
    const state = store.getState();
    q = getQuestion(state.current.questionId);
    revealed = false;
    viewers.forEach((v) => v.destroy());
    viewers = [];

    const start = startingCode(q, lang);
    let code = start;
    if (fresh) clearDraft(q.id, lang);
    else code = loadDraft(q.id, lang) ?? start;
    editor.setCode(code);
    lastSavedCode = code;

    drawProblem();
    setChildren(el.results, h('p.muted', {}, 'Run the tests to see results here.'));
    setChildren(el.output, h('p.muted', {}, 'Run your program to see its output here.'));
    showTab('output');
    drawEnd();
    updateHeader();
    updateButtons();
    updateMeter();
    editor.focus();
  }

  const editedLines = () => linesChanged(startingCode(q, lang), editor.getCode());

  /** Toolbar counters for the things that cost points: test runs and (Bug Hunt) edits. */
  function updateMeter() {
    const c = store.getState().current;
    const base = BASE_POINTS[c.difficulty];
    const runCost = Math.round(base * PENALTIES.testRun);
    const freeLeft = Math.max(0, FREE_TEST_RUNS - c.testRuns);
    const parts = [h(`span.meter-item${freeLeft ? '' : '.warn'}`, {
      title: `Each "Run tests" after the first ${FREE_TEST_RUNS} costs ${runCost} points`,
    }, `✓ ${c.testRuns} test run${c.testRuns === 1 ? '' : 's'}`, freeLeft ? h('span.muted', {}, ` · ${freeLeft} free`) : h('span', {}, ` · −${runCost} each`))];
    if (c.par !== null) {
      const n = editedLines();
      const lineCost = Math.round(base * PENALTIES.extraLine);
      parts.push(h(`span.meter-item${n > c.par ? '.over' : ''}`, {
        title: `Par is ${c.par} line${c.par === 1 ? '' : 's'}; each extra changed line costs ${lineCost} points`,
      }, `✎ ${n}/${c.par} line${c.par === 1 ? '' : 's'}`, n > c.par ? ` · −${(n - c.par) * lineCost}` : ''));
    }
    setChildren(el.meter, parts);
  }

  function drawProblem() {
    const state = store.getState();
    const tests = resolveTests(q, lang);
    const visible = tests.filter((t) => !t.hidden);
    const hiddenCount = tests.length - visible.length;
    const best = loadBest(q.id, lang);
    setChildren(el.problem, 
      h('div.problem-head', {},
        h('h2', {}, q.title),
        h('div.meta', {},
          h('span.qid', {}, q.id),
          h(`span.diff.diff-${q.difficulty}`, {}, DIFFICULTY_LABELS[q.difficulty]),
          h('span.tag', {}, q.topic),
          h('span.muted', {}, `⏱ ${formatTime(state.current.timeLimitSec)}`))),
      q.mode === 'bug-hunt'
        ? h('div.notice', {}, '🐞 This code has a bug. Fix it so all tests pass.')
        : null,
      h('div.description', { html: markdown(q.description) }),
      LANG_DOCS[lang]
        ? h('p.lang-note', {},
          `${LANG_LABELS[lang]}: lists are linked lists built with `, h('code', {}, 'pair'), ' / ', h('code', {}, 'llist'),
          ' (', h('code', {}, 'None'), ' is the empty list); ', h('code', {}, '[...]'), ' is an array. ',
          h('a', { href: LANG_DOCS[lang], target: '_blank', rel: 'noopener' }, 'Language reference ↗'))
        : null,
      h('div.signature', {}, h('span.muted', {}, 'Signature '), h('code', {}, signatureOf(q, startingCode(q, lang)))),
      h('h3', {}, 'Examples'),
      h('ul.examples', {}, visible.map((t) => h('li', {},
        t.setup ? h('pre.setup', {}, t.setup) : null,
        h('code', {}, t.call), h('span.arrow', {}, ' → '), h('code', {}, t.expect),
        t.note ? h('span.note', {}, `  · ${t.note}`) : null))),
      h('p.muted.small', {}, `+ ${hiddenCount} secret test${hiddenCount === 1 ? '' : 's'} on Submit.`),
      scoringNote(state.current),
      best ? h('p.muted.small', {}, `Your best: ${best.points} points in ${formatTime(best.timeSec)}`) : null,
    );
  }

  function scoringNote(c) {
    const base = BASE_POINTS[c.difficulty];
    const cost = (share) => Math.round(base * share);
    return h('p.scoring-note', {},
      h('strong', {}, 'Scoring: '), `${base} points + up to ${base / 2} for speed. `,
      `−${cost(PENALTIES.failedSubmit)} per wrong Submit, −${cost(PENALTIES.testRun)} per Run tests after the first`,
      c.par !== null ? `, −${cost(PENALTIES.extraLine)} per line changed beyond par (${c.par}).` : '.');
  }

  function breakdownText(b) {
    const parts = [`${b.base} base`, `+${b.timeBonus} speed`];
    if (b.submitPenalty) parts.push(`−${b.submitPenalty} wrong submits`);
    if (b.testPenalty) parts.push(`−${b.testPenalty} test runs`);
    if (b.editPenalty) parts.push(`−${b.editPenalty} extra edits`);
    return parts.join(' ');
  }

  function drawEnd() {
    const state = store.getState();
    const c = state.current;
    if (c.status === 'playing') {
      setChildren(el.endCard);
      return;
    }
    const last = state.index === state.questions.length - 1;
    const nextBtn = h('button.btn.btn-primary#btn-next', { onclick: () => doNext() }, last ? 'See results ▸' : 'Next ▸');
    const timeTaken = Math.round((c.endedAt - c.startedAt) / 1000);
    const parts = [];

    if (c.status === 'solved') {
      parts.push(h('div.end-title.ok', {}, '✓ Solved!'),
        h('div.end-stats', {},
          h('span', {}, `Time ${formatTime(timeTaken)}`),
          h('span', {}, `Attempts ${c.attempts}`),
          h('span.points', {}, `+${c.points} points`)),
        c.breakdown ? h('div.muted.small', {}, breakdownText(c.breakdown)) : null);
      if (q.mode === 'bug-hunt') {
        const original = startingCode(q, lang);
        parts.push(
          h('div.end-stats', {}, h('span', {}, `Lines changed: ${linesChanged(original, editor.getCode())}`),
            h('span.muted', {}, `(par ${c.par ?? '?'})`)),
          h('p.bug-explanation', {}, h('strong', {}, 'The bug: '), q.bugExplanation),
          h('div.muted.small', {}, 'Original code, bug highlighted:'));
        const host = h('div.viewer', {});
        parts.push(host);
        queueMicrotask(() => viewers.push(createViewer(host, { doc: original, lang, highlightLines: q.bugLines?.[fam] ?? [] })));
      }
    } else {
      parts.push(h('div.end-title.bad', {}, c.status === 'timeout' ? '⏱ Time is up' : 'Skipped'),
        h('div.end-stats', {}, h('span', {}, 'Not solved · 0 points')));
      if (q.mode === 'bug-hunt') parts.push(h('p.bug-explanation', {}, h('strong', {}, 'The bug: '), q.bugExplanation));
    }

    const solutionHost = h('div.viewer', {});
    const revealBtn = h('button.btn#btn-reveal', {
      onclick: () => {
        revealed = true;
        revealBtn.remove();
        viewers.push(createViewer(solutionHost, { doc: q.solution[fam], lang }));
      },
    }, 'Reveal solution');

    setChildren(el.endCard, h(`div.end-card.end-${c.status}`, {},
      ...parts,
      h('div.end-actions', {}, revealed ? null : revealBtn, nextBtn),
      solutionHost));
    el.endCard.scrollIntoView?.({ block: 'start' });
    nextBtn.focus();
  }

  // ---------------------------------------------------------------- header / buttons
  function updateHeader() {
    const state = store.getState();
    const now = Date.now();
    el.qcount.textContent = `Q ${state.index + 1}/${state.questions.length}`;
    // Before a duel round starts (countdown) the time left is more than the limit.
    const left = Math.min(state.current.timeLimitSec, timeLeftSec(state, now));
    el.timer.textContent = `⏱ ${formatTime(left)}`;
    el.timer.classList.toggle('low', state.current.status === 'playing' && left <= 30);
    el.score.textContent = `Score ${state.total}`;
  }

  function updateButtons() {
    const playing = store.getState().current.status === 'playing';
    btn.run.disabled = busy;
    btn.tests.disabled = busy;
    btn.submit.disabled = busy || !playing;
    btn.reset.disabled = busy;
    btn.skip.disabled = busy || !playing;
    setChildren(el.status, busy ? h('span.spinner', { 'aria-label': 'Running' }) : '', busy ? ' Running…' : '');
  }

  async function withBusy(fn) {
    if (busy) return;
    busy = true;
    updateButtons();
    try {
      await fn();
    } finally {
      busy = false;
      if (alive) updateButtons();
    }
  }

  // ---------------------------------------------------------------- actions
  function saveDraftNow() {
    const code = editor.getCode();
    if (code !== lastSavedCode) {
      saveDraft(q.id, lang, code);
      lastSavedCode = code;
    }
  }

  function doRun() {
    saveDraftNow();
    return withBusy(async () => {
      const code = editor.getCode();
      const qid = q.id;
      const r = await run(lang, code);
      if (!alive || q.id !== qid) return;
      showTab('output');
      setChildren(el.output, 
        ...r.output.map((line) => h('div.out-line', {}, line)),
        r.value !== undefined ? h('div.out-value', {}, `→ ${r.value}`) : null,
        r.status === 'timeout' ? h('div.out-error', {}, `⏱ ${r.error?.startsWith('Time limit') ? r.error : `Time limit exceeded${r.error ? ` (${r.error})` : ''}`}`) : null,
        r.status === 'error' ? h('div.out-error', {}, r.error) : null,
        r.output.length === 0 && r.value === undefined && r.status === 'ok' ? h('div.muted', {}, '(no output)') : null,
        h('div.out-meta', {}, `${r.status === 'ok' ? 'Finished' : 'Stopped'} in ${r.ms} ms`));
    });
  }

  function drawResults(report, { submitted }) {
    const visible = report.results.filter((r) => !r.hidden);
    const hidden = report.results.filter((r) => r.hidden);
    const label = { pass: '✓ Passed', fail: '✗ Wrong answer', error: '✗ Error', timeout: '✗ Time limit exceeded' };
    const rows = [];
    if (report.banned) rows.push(h('div.out-error', {}, `You can't use ${report.banned} in this question`));
    visible.forEach((r, i) => {
      rows.push(h(`div.test-row.${r.status === 'pass' ? 'pass' : 'fail'}`, {},
        h('div.test-head', {}, h('span.mark', {}, r.status === 'pass' ? '✓' : '✗'), ` Test ${i + 1}`, r.note ? h('span.note', {}, ` · ${r.note}`) : null,
          r.status === 'timeout' ? h('span.note', {}, ' · time limit exceeded') : null),
        h('div.test-grid', {},
          h('span.k', {}, 'call'), h('code', {}, r.call),
          h('span.k', {}, 'expected'), h('code', {}, r.expectText),
          r.got !== undefined ? [h('span.k', {}, 'got'), h('code', {}, r.got)] : null,
          r.error ? [h('span.k', {}, 'error'), h('code.err', {}, r.error)] : null)));
    });
    hidden.forEach((r, i) => {
      rows.push(h(`div.test-row.secret.${r.status === 'pass' ? 'pass' : 'fail'}`, {},
        `Secret test ${i + 1}: ${label[r.status] ?? '✗'}`));
    });
    const summary = submitted
      ? `Visible ${report.passedVisible}/${report.totalVisible} · Secret ${report.passedHidden}/${report.totalHidden}`
      : `Visible ${report.passedVisible}/${report.totalVisible}`;
    const allPass = submitted ? report.solved : report.passedVisible === report.totalVisible;
    setChildren(el.results, 
      h(`div.results-summary.${allPass ? 'pass' : 'fail'}`, {}, summary,
        submitted ? (report.solved ? ' — all tests pass!' : ' — not yet') : ''),
      ...rows);
    showTab('results');
  }

  function doTests() {
    saveDraftNow();
    return withBusy(async () => {
      const qid = q.id;
      const report = await runVisibleTests(q, lang, editor.getCode());
      if (!alive || q.id !== qid) return;
      drawResults(report, { submitted: false });
      store.dispatch({
        type: 'testRun',
        now: Date.now(),
        result: { questionId: qid, passed: report.passedVisible, total: report.totalVisible },
      });
    });
  }

  function doSubmit() {
    if (store.getState().current.status !== 'playing') return undefined;
    saveDraftNow();
    return withBusy(async () => {
      const qid = q.id;
      const t0 = performance.now();
      const code = editor.getCode();
      const report = await submitSolution(q, lang, code);
      if (!alive || q.id !== qid) return;
      drawResults(report, { submitted: true });
      store.dispatch({
        type: 'submitResult',
        now: Date.now(),
        result: {
          questionId: qid,
          passedVisible: report.passedVisible,
          passedHidden: report.passedHidden,
          total: report.total,
          timeMs: Math.round(performance.now() - t0),
          linesChanged: q.mode === 'bug-hunt' ? linesChanged(startingCode(q, lang), code) : undefined,
        },
      });
    });
  }

  async function doReset() {
    const what = q.mode === 'bug-hunt' ? 'the original buggy code' : 'the starter code';
    if (await confirmDialog(`Reset the editor to ${what}? Your changes will be lost.`, { ok: 'Reset', danger: true })) {
      editor.setCode(startingCode(q, lang));
      saveDraftNow();
      editor.focus();
    }
  }

  async function doSkip() {
    if (await confirmDialog('Skip this question? It will count as unsolved.', { ok: 'Skip', danger: true })) {
      store.dispatch({ type: 'skip', now: Date.now() });
    }
  }

  function doNext() {
    store.dispatch({ type: 'next', now: Date.now() });
  }

  async function doQuit() {
    if (await confirmDialog(quitMessage, { ok: 'Leave', danger: true })) {
      onQuit();
    }
  }

  // ---------------------------------------------------------------- store wiring
  const offStore = store.subscribe((state, prev) => {
    if (state.status === 'finished') {
      onFinished(state);
      return;
    }
    if (state.index !== prev.index) {
      mountQuestion(true);
      return;
    }
    if (state.current.status !== prev.current.status) {
      if (state.current.status === 'solved') {
        saveBestIfBetter(q.id, lang, {
          points: state.current.points,
          timeSec: Math.round((state.current.endedAt - state.current.startedAt) / 1000),
          attempts: state.current.attempts,
          date: new Date().toISOString(),
        });
      }
      drawEnd();
      updateButtons();
    }
    updateHeader();
    updateMeter();
  });

  const timer = setInterval(() => {
    store.dispatch({ type: 'tick', now: Date.now() });
    updateHeader();
  }, 250);
  const draftTimer = setInterval(saveDraftNow, DRAFT_EVERY_MS);
  const onUnload = () => saveDraftNow();
  window.addEventListener('beforeunload', onUnload);

  mountQuestion(!resumed);

  return function cleanup() {
    alive = false;
    closePanel();
    cancelAnimationFrame(meterFrame);
    saveDraftNow();
    clearInterval(timer);
    clearInterval(draftTimer);
    window.removeEventListener('beforeunload', onUnload);
    offStore();
    offEngine();
    viewers.forEach((v) => v.destroy());
    editor.destroy();
  };
}
