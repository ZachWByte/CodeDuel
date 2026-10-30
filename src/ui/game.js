// Solo game screen: problem panel, editor, console and test results, one question
// at a time with a clock per question. Duel rounds use round-game.js.
import { h, setChildren, formatTime, confirmDialog } from './dom.js';
import { viewButton, splitter, closePanel } from './view-settings.js';
import { createEditor, createViewer } from '../editor/editor.js';
import { getQuestion, LANG_LABELS, MODE_LABELS, DIFFICULTY_LABELS } from '../questions/index.js';
import { startingCode, linesChanged, LANG_FAMILY } from '../judge/resolve.js';
import { runVisibleTests, submitSolution } from '../judge/judge.js';
import { run } from '../runners/runner.js';
import { timeLeftSec, scoreBreakdown, BASE_POINTS, PENALTIES, FREE_TEST_RUNS } from '../state/engine.js';
import { loadDraft, saveDraft, clearDraft, loadBest, saveBestIfBetter } from '../state/storage.js';
import { icon, brandMark, clockCase } from './icons.js';
import { markEl } from './annotate.js';
import { problemView, outputView, resultsView, breakdownRows, watchEngine } from './play-parts.js';

const DRAFT_EVERY_MS = 3000;

/**
 * renderGame(root, { store, resumed, onFinished, onQuit })
 * store: { getState(), dispatch(action), subscribe(fn) -> unsubscribe }
 */
export function renderGame(root, { store, resumed, onFinished, onQuit }) {
  const quitMessage = 'Leave this session? Your progress in it will be lost.';
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
    qcount: h('span.numeral.hdr-q', {}),
    timer: h('span.numeral.hdr-timer', {}),
    score: h('span.numeral.hdr-score', {}),
    sheet: h('footer.scoresheet', { 'aria-label': 'Scoresheet' }),
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
    run: h('button.btn#btn-run', { title: 'Run (Ctrl/⌘ + Enter)', onclick: () => doRun() }, icon('play'), 'Run'),
    tests: h('button.btn#btn-tests', { title: 'Run the visible tests', onclick: () => doTests() }, icon('tests'), 'Run tests'),
    submit: h('button.btn.btn-primary#btn-submit', { title: 'Submit (Ctrl/⌘ + Shift + Enter)', onclick: () => doSubmit() }, 'Submit'),
    reset: h('button.btn.btn-ghost#btn-reset', { onclick: () => doReset() }, icon('reset'), 'Reset'),
    skip: h('button.btn.btn-ghost#btn-skip', { onclick: () => doSkip() }, icon('skip'), 'Skip'),
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

  el.clock = clockCase([
    ['question', el.qcount, { className: '.face-q' }],
    ['clock', el.timer, { lit: true, flag: true }],
    ['score', el.score],
  ]);
  setChildren(root, h('div.game', {},
    h('header.game-header', {},
      h('div.hdr-left', {},
        h('button.btn.btn-ghost.btn-small#btn-quit', { onclick: () => doQuit() }, icon('back'), 'Home'),
        h('span.brand', {}, brandMark()),
        h('span.hdr-title', {}, `${MODE_LABELS[mode]} · ${DIFFICULTY_LABELS[difficulty]} · ${LANG_LABELS[lang]}`)),
      el.clock,
      h('div.hdr-right', {}, viewButton())),
    el.main,
    el.sheet));
  // The editor side and widths come from the view settings (CSS variables).
  el.main.append(
    h('section.panel.problem', {}, el.endCard, el.problem),
    splitter(el.main),
    h('section.panel.work', {},
      el.editorHost,
      h('div.toolbar', {},
        h('div.tool-group', {}, btn.run, btn.tests, btn.submit),
        el.meter, h('span.spacer', {}), el.status,
        h('div.tool-group.tool-end', {}, btn.reset, btn.skip)),
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

  const offEngine = watchEngine(lang, el.engineNote);

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
    }, icon('tests'), h('span', {}, h('b', {}, c.testRuns), h('span.long', {}, ` test run${c.testRuns === 1 ? '' : 's'}`), h('span.short', {}, ` run${c.testRuns === 1 ? '' : 's'}`)),
    freeLeft ? h('span.muted', {}, `· ${freeLeft} free`) : h('span.cost-each', {}, `· −${runCost} each`))];
    if (c.par !== null) {
      const n = editedLines();
      const lineCost = Math.round(base * PENALTIES.extraLine);
      parts.push(h(`span.meter-item${n > c.par ? '.over' : ''}`, {
        title: `Par is ${c.par} line${c.par === 1 ? '' : 's'}; each extra changed line costs ${lineCost} points`,
      }, icon('pencil'), h('span', {}, h('b', {}, n), `/${c.par}`, h('span.long', {}, ` line${c.par === 1 ? '' : 's'} changed`)), n > c.par ? h('span', {}, `· −${(n - c.par) * lineCost}`) : null));
    }
    setChildren(el.meter, parts);
    updateRules();
  }

  function drawProblem() {
    const state = store.getState();
    const best = loadBest(q.id, lang);
    live.worth = h('p.worth', {});
    setChildren(el.problem,
      ...problemView(q, lang, { timeSec: state.current.timeLimitSec, extra: live.worth }),
      scoringNote(state.current),
      best ? h('p.your-best', {}, `Your best: ${best.points} points in ${formatTime(best.timeSec)}`) : null);
  }

  /** Scoring rules, each beside its live number; updateRules() keeps the numbers current. */
  const live = {};
  function scoringNote(c) {
    Object.keys(live).forEach((k) => { if (k !== 'worth') delete live[k]; });
    const base = BASE_POINTS[c.difficulty];
    const cost = (share) => Math.round(base * share);
    const row = (key, label, rule) => {
      live[key] = h('dd', {});
      return [h('dt', {}, label, h('span.rule', {}, rule)), live[key]];
    };
    const free = FREE_TEST_RUNS === 1 ? 'first free' : `first ${FREE_TEST_RUNS} free`;
    return h('dl.rules.rules-live', { 'aria-label': 'Scoring' },
      row('base', `Solve · ${DIFFICULTY_LABELS[c.difficulty]}`, ''),
      row('speed', 'Speed bonus', `up to +${base / 2}, falls as the clock runs`),
      row('runs', 'Run tests', `${free}, then −${cost(PENALTIES.testRun)} each`),
      row('submits', 'Wrong submits', `−${cost(PENALTIES.failedSubmit)} each`),
      c.par !== null ? row('lines', 'Lines changed', `par ${c.par}, then −${cost(PENALTIES.extraLine)} each`) : null,
      h('dt.rules-total', {}, 'If you solve it now'), (live.total = h('dd.rules-total', {})));
  }

  function updateRules() {
    const state = store.getState();
    const c = state.current;
    if (c.status !== 'playing' || !live.total) return;
    const left = Math.min(c.timeLimitSec, timeLeftSec(state, Date.now()));
    const edited = c.par !== null ? editedLines() : 0;
    const b = scoreBreakdown({
      difficulty: c.difficulty, solved: true, timeLeftSec: left, timeLimitSec: c.timeLimitSec,
      failedSubmits: c.failedSubmits, testRuns: c.testRuns, extraLines: Math.max(0, edited - (c.par ?? 0)),
    });
    const set = (key, text, kind = '') => {
      if (!live[key]) return;
      if (live[key].textContent !== text) live[key].textContent = text;
      live[key].className = kind;
    };
    set('base', String(b.base));
    set('speed', `now +${b.timeBonus}`, 'gain');
    set('runs', `${c.testRuns} used${b.testPenalty ? ` · −${b.testPenalty}` : ''}`, b.testPenalty ? 'cost' : '');
    set('submits', c.failedSubmits ? `${c.failedSubmits} · −${b.submitPenalty}` : '0', b.submitPenalty ? 'cost' : '');
    set('lines', `${edited}/${c.par}${b.editPenalty ? ` · −${b.editPenalty}` : ''}`, b.editPenalty ? 'cost' : '');
    set('total', String(b.points), 'rules-total');
    const lost = b.submitPenalty + b.testPenalty + b.editPenalty;
    if (live.worth) {
      setChildren(live.worth, 'Worth up to ', h('strong', {}, b.points), ' now',
        lost ? h('span.cost', {}, ` · −${lost} lost`) : null);
    }
  }

  function drawEnd() {
    const state = store.getState();
    const c = state.current;
    if (c.status === 'playing') {
      setChildren(el.endCard);
      return;
    }
    const last = state.index === state.questions.length - 1;
    const nextBtn = h('button.btn.btn-primary#btn-next', { onclick: () => doNext() }, last ? 'See results' : 'Next', icon('chevron'));
    const timeTaken = Math.round((c.endedAt - c.startedAt) / 1000);
    const parts = [];

    if (c.status === 'solved') {
      parts.push(h('div.end-head', {},
        markEl({ solved: true, breakdown: c.breakdown }),
        h('div', {},
          h('div.end-title.ok', {}, 'Solved'),
          h('div.end-stats', {},
            h('span', {}, `Time ${formatTime(timeTaken)}`),
            h('span', {}, `Attempts ${c.attempts}`))),
        h('div.end-points', {}, h('span.label', {}, 'points'), h('div.numeral.points', {}, `+${c.points}`))),
        c.breakdown ? breakdownRows(c.breakdown) : null);
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
      parts.push(h('div.end-head', {},
        markEl({ solved: false }),
        h('div', {},
          h('div.end-title.bad', {}, c.status === 'timeout' ? 'Time is up' : 'Skipped'),
          h('div.end-sub', {}, 'Not solved')),
        h('div.end-points', {}, h('span.label', {}, 'points'), h('div.numeral', {}, '0'))));
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
    el.qcount.textContent = `${state.index + 1}/${state.questions.length}`;
    // Before a duel round starts (countdown) the time left is more than the limit.
    const left = Math.min(state.current.timeLimitSec, timeLeftSec(state, now));
    el.timer.textContent = formatTime(left);
    el.clock.classList.toggle('clock-low', state.current.status === 'playing' && left <= 30);
    el.clock.classList.toggle('clock-fallen', state.current.status === 'timeout');
    el.score.textContent = String(state.total);
    drawSheet(state);
    updateRules();
  }

  /** The scoresheet strip: one move per question, annotated once it ends. */
  let sheetKey = '';
  function drawSheet(state) {
    const key = `${state.index}:${state.current.status}:${state.results.length}`;
    if (key === sheetKey) return;
    sheetKey = key;
    const moves = state.questions.map((meta, i) => {
      const r = state.results[i];
      const n = h('span.n', {}, `${i + 1}.`);
      if (r) return h('span.move', {}, n, h('span.qid', {}, meta.id), markEl(r), h('span.pts', {}, `${r.points}`));
      if (i === state.index) return h('span.move.move-now', { 'aria-current': 'step' }, n, h('span.qid', {}, meta.id), h('span.pending', {}, 'playing'));
      return h('span.move.move-todo', {}, n, h('span.qid', {}, '···'));
    });
    setChildren(el.sheet, h('span.label', {}, 'Scoresheet'), moves);
    el.sheet.querySelector('.move-now')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
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
      setChildren(el.output, ...outputView(r));
    });
  }

  function drawResults(report, { submitted }) {
    setChildren(el.results, ...resultsView(report, { submitted }));
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
          code, // a duel server re-runs a few tests of claimed solves
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
