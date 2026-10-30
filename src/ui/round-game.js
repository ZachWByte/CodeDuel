// Duel round screen: every question of the round is open at once under one clock.
// Tabs along the bottom switch question, and each question keeps its own code (a
// team shares one live document per question, with teammates' cursors). Solving a
// question offers the next one, or watching an opponent instead.
import { h, setChildren, formatTime, confirmDialog } from './dom.js';
import { viewButton, splitter, closePanel } from './view-settings.js';
import { createEditor, createViewer } from '../editor/editor.js';
import { createCollabSession, remoteChange, setCursors } from '../editor/collab.js';
import { getQuestion, LANG_LABELS, MODE_LABELS, DIFFICULTY_LABELS } from '../questions/index.js';
import { startingCode, linesChanged, resolveTests, LANG_FAMILY } from '../judge/resolve.js';
import { runVisibleTests, submitSolution } from '../judge/judge.js';
import { run } from '../runners/runner.js';
import { roundTimeLeftSec, worthNow, solvedCount } from '../state/round.js';
import { BASE_POINTS, PENALTIES, FREE_TEST_RUNS } from '../state/engine.js';
import { loadDraft, saveDraft, clearDraft } from '../state/storage.js';
import { icon, brandMark, clockCase } from './icons.js';
import { markEl } from './annotate.js';
import { problemView, outputView, resultsView, breakdownRows, watchEngine } from './play-parts.js';

const DRAFT_EVERY_MS = 3000;
const PROGRESS_EVERY_MS = 5000; // line counts for the opponents' leaderboard
const CODE_EVERY_MS = 1000; // code for spectators (players on their own; teams share a server document)
const CURSOR_EVERY_MS = 250; // your cursor, for teammates

/**
 * renderRound(root, { store, resumed, headerExtra?, watch?, team?, onView, onCode, onProgress, onFinished, onQuit })
 *   -> { cleanup(), refresh() }
 * store: { getState(), dispatch(action), subscribe(fn) } over a round state (src/state/round.js)
 * watch: { el, button }: the spectator view, and the header button that shows it
 * team: null, or the team editor's network: { open(qid), push(qid, msg), pull(qid, version),
 *   onUpdates(fn), sendCursor(qid, pos), onCursor(fn), matesOn(qid) -> names, mates() -> names }
 * refresh(): teammates moved (the tabs show who is where)
 */
export function renderRound(root, { store, resumed, headerExtra = null, watch = null, team = null,
  onView, onCode, onProgress, onFinished, onQuit }) {
  const { lang, mode, difficulty } = store.getState().config;
  const fam = LANG_FAMILY[lang];
  let viewIndex = -1;
  let q = null; // the question on screen
  let busy = false;
  let alive = true;
  let watching = false;
  let lastSavedCode = null;
  let revealedSolution = false;
  let viewers = [];
  let meterFrame = 0;
  const reports = new Map(); // questionId -> { report, submitted } (the last test results)
  const outputs = new Map(); // questionId -> nodes of the last Run

  // ---------------------------------------------------------------- skeleton
  const el = {
    solved: h('span.numeral', {}),
    timer: h('span.numeral.hdr-timer', {}),
    score: h('span.numeral.hdr-score', {}),
    tabs: h('nav.scoresheet.qtabs', { 'aria-label': 'Questions' }),
    problem: h('div.problem-body', {}),
    endCard: h('div.end-card-host', {}),
    editorHost: h('div.editor-host', {}),
    teamStrip: h('div.team-strip', { hidden: !team }),
    status: h('span.run-status', {}),
    engineNote: h('span.engine-note', {}),
    output: h('div.console-pane.output', {}),
    results: h('div.console-pane.results', {}),
    main: h('main.game-main', {}),
    meter: h('span.meter', {}),
    toolbar: null,
    console: null,
    watchPane: h('div.watch-pane', { hidden: true }),
    worth: h('p.worth', {}),
  };
  const btn = {
    run: h('button.btn#btn-run', { title: 'Run (Ctrl/⌘ + Enter)', onclick: () => doRun() }, icon('play'), 'Run'),
    tests: h('button.btn#btn-tests', { title: 'Run the visible tests', onclick: () => doTests() }, icon('tests'), 'Run tests'),
    submit: h('button.btn.btn-primary#btn-submit', { title: 'Submit (Ctrl/⌘ + Shift + Enter)', onclick: () => doSubmit() }, 'Submit'),
    reset: h('button.btn.btn-ghost#btn-reset', { onclick: () => doReset() }, icon('reset'), 'Reset'),
    finish: h('button.btn.btn-ghost#btn-finish', { title: 'Stop now: your score so far is final', onclick: () => doFinish() }, icon('skip'), 'Finish'),
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
    ['solved', el.solved, { className: '.face-q' }],
    ['clock', el.timer, { lit: true, flag: true }],
    ['score', el.score],
  ]);
  el.toolbar = h('div.toolbar', {},
    h('div.tool-group', {}, btn.run, btn.tests, btn.submit),
    el.meter, h('span.spacer', {}), el.status,
    h('div.tool-group.tool-end', {}, btn.reset, btn.finish));
  el.console = h('div.console', {},
    h('div.tabs', {}, tabs.output, tabs.results, h('span.spacer', {}), el.engineNote),
    el.output, el.results);
  if (watch) {
    setChildren(el.watchPane,
      h('div.watch-head', {},
        h('h2.watch-title', {}, icon('eye'), 'Watching'),
        h('p.muted.small', {}, 'Their code is scrambled until you solve the question they are on.'),
        h('button.btn.btn-small#btn-watch-back', { type: 'button', onclick: () => setWatching(false) }, icon('back'), 'Back to my code')),
      watch.el);
  }
  setChildren(root, h('div.game.round-game', {},
    h('header.game-header', {},
      h('div.hdr-left', {},
        h('button.btn.btn-ghost.btn-small#btn-quit', { onclick: () => doQuit() }, icon('back'), 'Leave'),
        h('span.brand', {}, brandMark()),
        h('span.hdr-title', {}, `${MODE_LABELS[mode]} · ${DIFFICULTY_LABELS[difficulty]} · ${LANG_LABELS[lang]}`)),
      el.clock,
      h('div.hdr-right', {}, headerExtra, viewButton({ compact: !!headerExtra }))),
    el.main,
    el.tabs));
  el.main.append(
    h('section.panel.problem', {}, el.endCard, el.problem),
    splitter(el.main),
    h('section.panel.work', {}, el.teamStrip, el.editorHost, el.toolbar, el.console, el.watchPane));
  showTab('output');

  // ---------------------------------------------------------------- the editor (and the team's shared one)
  let session = null; // the team document on screen
  const draining = new Set(); // team documents left with edits not yet confirmed
  let opening = 0;
  let cursorTimer = 0;

  const editor = createEditor(el.editorHost, {
    lang,
    onRun: () => doRun(),
    onSubmit: () => doSubmit(),
    onChange: () => {
      if (meterFrame) return;
      meterFrame = requestAnimationFrame(() => { meterFrame = 0; updateMeter(); });
    },
    onUpdate: (u) => {
      if (!team || !session) return;
      for (const tr of u.transactions) {
        if (tr.docChanged && !tr.annotation(remoteChange)) session.local(tr.changes);
      }
      if ((u.selectionSet || u.docChanged) && !cursorTimer) {
        cursorTimer = setTimeout(() => {
          cursorTimer = 0;
          if (alive && q) team.sendCursor(q.id, editor.view.state.selection.main.head);
        }, CURSOR_EVERY_MS);
      }
    },
  });

  const offUpdates = team?.onUpdates(({ questionId, from, updates }) => {
    if (session?.questionId === questionId) session.receive(from, updates);
    for (const d of draining) if (d.questionId === questionId) d.receive(from, updates);
  });
  const cursors = new Map(); // playerId -> { name, team, questionId, pos }
  function showCursors() {
    if (!q) return;
    const here = [...cursors.values()].filter((c) => c.questionId === q.id);
    editor.view.dispatch({ effects: setCursors.of(here.map((c) => ({ name: c.name, color: c.team, pos: c.pos }))) });
  }
  const offCursor = team?.onCursor((c) => {
    cursors.set(c.playerId, c);
    showCursors();
  });

  async function openTeamDoc(questionId) {
    const token = ++opening;
    if (session) {
      const old = session;
      old.detach(() => {
        old.close();
        draining.delete(old);
      });
      if (old.pending()) draining.add(old);
      else old.close();
      session = null;
    }
    editor.load(questionId, '# Loading your team’s code…', { fresh: true });
    editor.view.dispatch({ effects: setCursors.of([]) });
    const reply = await team.open(questionId);
    if (!alive || token !== opening || reply?.error) return;
    editor.load(questionId, reply.doc, { fresh: true });
    const s = createCollabSession({
      version: reply.version,
      net: { push: (msg) => team.push(questionId, msg), pull: (version) => team.pull(questionId, version) },
    });
    s.questionId = questionId;
    s.attach(editor.view);
    session = s;
    showCursors();
    updateMeter();
  }

  // ---------------------------------------------------------------- questions
  const stateQ = () => store.getState().qs[viewIndex];
  const isOpen = () => store.getState().status === 'playing' && stateQ()?.status === 'open';

  function openQuestion(i) {
    if (i === viewIndex) return;
    saveDraftNow();
    const state = store.getState();
    viewIndex = i;
    q = getQuestion(state.questions[i].id);
    revealedSolution = false;
    viewers.forEach((v) => v.destroy());
    viewers = [];
    if (team) openTeamDoc(q.id);
    else {
      const code = editor.codeOf(q.id) ?? loadDraft(q.id, lang) ?? startingCode(q, lang);
      editor.load(q.id, code);
      lastSavedCode = editor.getCode();
    }
    const last = reports.get(q.id);
    if (last) setChildren(el.results, ...resultsView(last.report, { submitted: last.submitted, reveal: revealFor(last) }));
    else setChildren(el.results, h('p.muted', {}, 'Run the tests to see results here.'));
    setChildren(el.output, ...(outputs.get(q.id) ?? [h('p.muted', {}, 'Run your program to see its output here.')]));
    showTab(last ? 'results' : 'output');
    drawProblem();
    drawEnd();
    drawTabs();
    drawTeamStrip();
    updateHeader();
    updateButtons();
    updateMeter();
    onView?.(q.id);
    if (!watching) editor.focus();
  }

  /** The next open question after the one on screen, or -1. */
  function nextOpen() {
    const { qs } = store.getState();
    for (let k = 1; k <= qs.length; k++) {
      const i = (viewIndex + k) % qs.length;
      if (qs[i].status === 'open') return i;
    }
    return -1;
  }

  const editedLines = () => linesChanged(startingCode(q, lang), editor.getCode());

  /** Toolbar counters for what costs points: test runs and (Bug Hunt) edits. */
  function updateMeter() {
    const c = stateQ();
    if (!c) return;
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
    updateWorth();
  }

  /** "Worth up to 148 now · 10 lost" under the title, and the scoring rules' live numbers. */
  const live = {};
  function updateWorth() {
    const state = store.getState();
    const c = stateQ();
    if (!c) return;
    if (c.status === 'solved') {
      setChildren(el.worth, 'Scored ', h('strong', {}, c.points));
      return;
    }
    const w = worthNow(state, { ...c, linesChanged: c.par !== null ? editedLines() : c.linesChanged }, Date.now());
    setChildren(el.worth,
      'Worth up to ', h('strong', {}, w.points), state.status === 'playing' ? ' now' : '',
      w.lost ? h('span.cost', { title: lostTitle(w) }, ` · ${w.lost} lost`) : null,
      c.points ? h('span.gain', { title: 'Secret tests your best submit passed' }, ` · ${c.points} banked`) : null);
    const set = (key, text, kind = '') => {
      if (!live[key]) return;
      if (live[key].textContent !== text) live[key].textContent = text;
      live[key].className = kind;
    };
    set('speed', `now +${w.timeBonus}`, 'gain');
    set('runs', `${c.testRuns} used${w.testPenalty ? ` · −${w.testPenalty}` : ''}`, w.testPenalty ? 'cost' : '');
    set('submits', c.failedSubmits ? `${c.failedSubmits} · −${w.submitPenalty}` : '0', w.submitPenalty ? 'cost' : '');
    set('lines', `${editedLines()}/${c.par}${w.editPenalty ? ` · −${w.editPenalty}` : ''}`, w.editPenalty ? 'cost' : '');
    set('reveals', c.reveals.length ? `${c.reveals.length} · −${w.revealPenalty}` : '0', w.revealPenalty ? 'cost' : '');
    set('partial', c.points ? `+${c.points} banked` : 'none yet', c.points ? 'gain' : '');
    set('total', String(w.points), 'rules-total');
  }
  const lostTitle = (w) => [
    w.submitPenalty && `wrong submits −${w.submitPenalty}`, w.testPenalty && `extra test runs −${w.testPenalty}`,
    w.editPenalty && `lines over par −${w.editPenalty}`, w.revealPenalty && `tests revealed −${w.revealPenalty}`,
  ].filter(Boolean).join(', ');

  function scoringNote(c) {
    Object.keys(live).forEach((k) => delete live[k]);
    const cfg = store.getState().config;
    const base = BASE_POINTS[c.difficulty];
    const cost = (s) => Math.round(base * s);
    const row = (key, label, rule) => {
      live[key] = h('dd', {});
      return [h('dt', {}, label, h('span.rule', {}, rule)), live[key]];
    };
    return h('dl.rules.rules-live', { 'aria-label': 'Scoring' },
      [h('dt', {}, 'Solve'), h('dd', {}, String(base))],
      row('speed', 'Speed bonus', `up to +${base / 2}, falls with the round clock`),
      row('runs', 'Run tests', `first ${FREE_TEST_RUNS === 1 ? 'one' : FREE_TEST_RUNS} free, then −${cost(PENALTIES.testRun)}`),
      row('submits', 'Wrong submits', `−${cost(PENALTIES.failedSubmit)} each`),
      c.par !== null ? row('lines', 'Lines changed', `par ${c.par}, then −${cost(PENALTIES.extraLine)} each`) : null,
      cfg.revealCost > 0 ? row('reveals', 'Tests revealed', `−${cost(cfg.revealCost)} each`) : null,
      cfg.partial ? row('partial', 'Secret tests', `up to ${cost(0.5)} without a solve`) : null,
      h('dt.rules-total', {}, 'If you solve it now'), (live.total = h('dd.rules-total', {})));
  }

  /** Secret tests revealed so far (they stay revealed for the whole round). */
  function revealedList() {
    const c = stateQ();
    if (!c?.reveals.length) return null;
    const tests = resolveTests(q, lang);
    return [h('h3.section-title', {}, 'Revealed secret tests'),
      h('ul.examples.revealed', {}, c.reveals.map((i) => {
        const t = tests.find((x) => x.index === i);
        return t ? h('li', {}, t.setup ? h('pre.setup', {}, t.setup) : null, h('code', {}, t.call), h('span.arrow', {}, ' → '), h('code', {}, t.expect)) : null;
      }))];
  }

  function drawProblem() {
    setChildren(el.problem, ...problemView(q, lang, { extra: el.worth }), revealedList(), scoringNote(stateQ()));
    updateWorth();
  }

  function drawEnd() {
    const c = stateQ();
    if (c.status !== 'solved') {
      setChildren(el.endCard);
      return;
    }
    const next = nextOpen();
    const nextBtn = next >= 0
      ? h('button.btn.btn-primary#btn-next', { onclick: () => openQuestion(next) }, 'Next question', icon('chevron')) : null;
    const watchBtn = watch ? h('button.btn#btn-end-watch', { onclick: () => setWatching(true) }, icon('eye'), 'Watch the others') : null;
    const solutionHost = h('div.viewer', {});
    const revealBtn = revealedSolution ? null : h('button.btn.btn-ghost#btn-reveal', {
      onclick: () => {
        revealedSolution = true;
        revealBtn.remove();
        viewers.push(createViewer(solutionHost, { doc: q.solution[fam], lang }));
      },
    }, 'Reference solution');
    const parts = [h('div.end-head', {},
      markEl({ solved: true, breakdown: c.breakdown }),
      h('div', {},
        h('div.end-title.ok', {}, 'Solved'),
        h('div.end-stats', {}, h('span', {}, `at ${formatTime(Math.round((c.solvedAt - store.getState().startedAt) / 1000))}`),
          h('span', {}, `${c.attempts} submit${c.attempts === 1 ? '' : 's'}`))),
      h('div.end-points', {}, h('span.label', {}, 'points'), h('div.numeral.points', {}, `+${c.points}`))),
    breakdownRows(c.breakdown)];
    if (q.mode === 'bug-hunt') {
      parts.push(h('p.bug-explanation', {}, h('strong', {}, 'The bug: '), q.bugExplanation));
      const host = h('div.viewer', {});
      parts.push(h('div.muted.small', {}, 'Original code, bug highlighted:'), host);
      queueMicrotask(() => viewers.push(createViewer(host, { doc: startingCode(q, lang), lang, highlightLines: q.bugLines?.[fam] ?? [] })));
    }
    setChildren(el.endCard, h('div.end-card.end-solved', {},
      ...parts,
      h('div.end-actions', {}, revealBtn, watchBtn, nextBtn),
      solutionHost));
    el.endCard.scrollIntoView?.({ block: 'start' });
    (nextBtn ?? watchBtn)?.focus();
  }

  /** The question tabs along the bottom: number, title, score, and teammates on it. */
  function drawTabs() {
    const state = store.getState();
    setChildren(el.tabs, h('span.label', {}, 'Questions'), state.qs.map((c, i) => {
      const meta = state.questions[i];
      const mates = team?.matesOn(meta.id) ?? [];
      return h(`button.qtab${i === viewIndex ? '.qtab-now' : ''}${c.status === 'solved' ? '.qtab-solved' : ''}`, {
        type: 'button',
        'aria-current': i === viewIndex ? 'true' : null,
        title: getQuestion(meta.id)?.title,
        onclick: () => {
          if (watching) setWatching(false);
          openQuestion(i);
        },
      },
      h('span.n', {}, `${i + 1}.`),
      h('span.qtab-title', {}, getQuestion(meta.id)?.title),
      c.status === 'solved' ? [markEl({ solved: true, breakdown: c.breakdown }), h('span.pts', {}, c.points)]
        : c.points ? h('span.pts.partial', { title: 'Points from secret tests' }, c.points) : null,
      mates.length ? h('span.qtab-mates', { title: `${mates.join(', ')} ${mates.length === 1 ? 'is' : 'are'} here` },
        mates.map((n) => h('i', {}, n.slice(0, 1).toUpperCase()))) : null);
    }));
  }

  function drawTeamStrip() {
    if (!team) return;
    const here = team.matesOn(q.id);
    const all = team.mates();
    setChildren(el.teamStrip, icon('pencil'),
      all.length ? h('span', {}, 'Shared with ', h('strong', {}, all.join(', ')), here.length ? ` · ${here.join(', ')} on this question` : '') : h('span', {}, 'Your team’s editor'));
  }

  // ---------------------------------------------------------------- header / buttons
  function updateHeader() {
    const state = store.getState();
    const left = roundTimeLeftSec(state, Date.now());
    el.solved.textContent = `${solvedCount(state)}/${state.qs.length}`;
    el.timer.textContent = formatTime(left);
    el.clock.classList.toggle('clock-low', state.status === 'playing' && left <= 60);
    el.clock.classList.toggle('clock-fallen', state.status === 'finished' && state.endReason === 'time');
    el.score.textContent = String(state.total);
    updateWorth();
  }

  function updateButtons() {
    const open = isOpen();
    btn.run.disabled = busy;
    btn.tests.disabled = busy;
    btn.submit.disabled = busy || !open;
    btn.reset.disabled = busy;
    btn.finish.disabled = busy || store.getState().status !== 'playing';
    setChildren(el.status, busy ? h('span.spinner', { 'aria-label': 'Running' }) : '', busy ? ' Running…' : '');
  }

  function setWatching(on) {
    if (!watch) return;
    watching = on;
    for (const x of [el.teamStrip, el.editorHost, el.toolbar, el.console]) x.classList.toggle('is-away', on);
    el.watchPane.hidden = !on;
    watch.button?.classList.toggle('active', on);
    watch.button?.setAttribute('aria-pressed', String(on));
    if (!on) {
      editor.view.requestMeasure();
      editor.focus();
    }
  }
  if (watch?.button) watch.button.onclick = () => setWatching(!watching);

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
    if (team || !q) return;
    const code = editor.getCode();
    if (code !== lastSavedCode) {
      saveDraft(q.id, lang, code);
      lastSavedCode = code;
    }
  }

  function doRun() {
    saveDraftNow();
    return withBusy(async () => {
      const qid = q.id;
      const r = await run(lang, editor.getCode());
      if (!alive) return;
      const nodes = outputView(r);
      outputs.set(qid, nodes);
      if (q.id !== qid) return;
      showTab('output');
      setChildren(el.output, ...nodes);
    });
  }

  /** Reveal options for a submit's results (when the room allows reveals). */
  function revealFor({ report, submitted }) {
    const cfg = store.getState().config;
    if (!submitted || !(cfg.revealCost > 0)) return null;
    const c = stateQ();
    const tests = resolveTests(q, lang);
    return {
      cost: Math.round(BASE_POINTS[c.difficulty] * cfg.revealCost),
      isRevealed: (i) => stateQ().reveals.includes(i),
      detail: (i) => report.secret?.[i] ?? (({ call, expect }) => ({ call, expectText: expect }))(tests.find((t) => t.index === i)),
      onReveal: isOpen() ? doReveal : null,
    };
  }

  function drawResults(qid, report, submitted) {
    reports.set(qid, { report, submitted });
    if (q.id !== qid) return;
    setChildren(el.results, ...resultsView(report, { submitted, reveal: revealFor({ report, submitted }) }));
    showTab('results');
  }

  async function doReveal(index) {
    const cfg = store.getState().config;
    const cost = Math.round(BASE_POINTS[stateQ().difficulty] * cfg.revealCost);
    const ok = await confirmDialog(`Reveal this secret test? The most this question can score drops by ${cost}.`, { ok: `Reveal · −${cost}` });
    if (!ok || !alive || !isOpen()) return;
    store.dispatch({ type: 'reveal', now: Date.now(), result: { questionId: q.id, testIndex: index } });
  }

  function doTests() {
    saveDraftNow();
    return withBusy(async () => {
      const qid = q.id;
      const question = q;
      const report = await runVisibleTests(question, lang, editor.getCode());
      if (!alive) return;
      drawResults(qid, report, false);
      store.dispatch({ type: 'testRun', now: Date.now(), result: { questionId: qid, passed: report.passedVisible, total: report.totalVisible } });
    });
  }

  function doSubmit() {
    if (!isOpen()) return undefined;
    saveDraftNow();
    return withBusy(async () => {
      const qid = q.id;
      const question = q;
      const t0 = performance.now();
      const code = editor.getCode();
      const report = await submitSolution(question, lang, code);
      if (!alive) return;
      drawResults(qid, report, true);
      store.dispatch({
        type: 'submitResult',
        now: Date.now(),
        result: {
          questionId: qid,
          passedVisible: report.passedVisible,
          passedHidden: report.passedHidden,
          total: report.total,
          totalHidden: report.totalHidden,
          timeMs: Math.round(performance.now() - t0),
          linesChanged: question.mode === 'bug-hunt' ? linesChanged(startingCode(question, lang), code) : undefined,
          code, // the server re-runs a few tests of claimed solves
        },
      });
    });
  }

  async function doReset() {
    const what = q.mode === 'bug-hunt' ? 'the original buggy code' : 'the starter code';
    const whose = team ? ' This changes it for your whole team.' : ' Your changes will be lost.';
    if (await confirmDialog(`Reset this question to ${what}?${whose}`, { ok: 'Reset', danger: true })) {
      editor.setCode(startingCode(q, lang));
      saveDraftNow();
      editor.focus();
    }
  }

  async function doFinish() {
    const solved = solvedCount(store.getState());
    const msg = team
      ? `Stop the round for your whole team? Your ${store.getState().total} points so far are final.`
      : `Stop now? Your ${store.getState().total} points so far (${solved} solved) are final, and you can watch the others finish.`;
    if (await confirmDialog(msg, { ok: 'Finish', danger: true })) store.dispatch({ type: 'finish', now: Date.now() });
  }

  async function doQuit() {
    if (await confirmDialog('Leave the duel? You leave the room, and your score stays as it is.', { ok: 'Leave', danger: true })) onQuit();
  }

  // ---------------------------------------------------------------- store wiring
  let finished = false;
  const offStore = store.subscribe((state, prev) => {
    if (state.status === 'finished') {
      if (!finished) {
        finished = true;
        onFinished(state);
      }
      return;
    }
    const c = state.qs[viewIndex];
    const was = prev.qs[viewIndex];
    if (c.status !== was.status) {
      drawEnd();
      updateButtons();
    }
    if (c.reveals.length !== was.reveals.length) {
      drawProblem();
      const last = reports.get(q.id);
      if (last) setChildren(el.results, ...resultsView(last.report, { submitted: last.submitted, reveal: revealFor(last) }));
    }
    drawTabs();
    updateHeader();
    updateMeter();
  });

  const timer = setInterval(() => {
    store.dispatch({ type: 'tick', now: Date.now() });
    updateHeader();
  }, 250);
  const draftTimer = setInterval(saveDraftNow, DRAFT_EVERY_MS);

  // Line counts for the others, every few seconds, when they change.
  let sentProgress = '';
  const progressTimer = setInterval(() => {
    if (!q || !isOpen()) return;
    const lines = q.mode === 'bug-hunt' ? editedLines() : editor.getCode().split('\n').filter((l) => l.trim()).length;
    const key = `${q.id}:${lines}`;
    if (key === sentProgress) return;
    sentProgress = key;
    onProgress?.(q.id, lines);
  }, PROGRESS_EVERY_MS);

  // The code itself, for spectators (a team's document is on the server already).
  let sentCode = null;
  const codeTimer = team ? 0 : setInterval(() => {
    if (!q || !isOpen()) return;
    const code = editor.getCode();
    const key = `${q.id}\n${code}`;
    if (key === sentCode) return;
    sentCode = key;
    onCode?.(q.id, code);
  }, CODE_EVERY_MS);

  const offEngine = watchEngine(lang, el.engineNote);
  const onUnload = () => saveDraftNow();
  window.addEventListener('beforeunload', onUnload);

  // A fresh round starts from the starter code, not an old draft of the same question.
  if (!resumed && !team) for (const meta of store.getState().questions) clearDraft(meta.id, lang);
  openQuestion(0);

  return {
    refresh() {
      if (!alive) return;
      drawTabs();
      drawTeamStrip();
    },
    cleanup() {
      alive = false;
      closePanel();
      cancelAnimationFrame(meterFrame);
      saveDraftNow();
      clearInterval(timer);
      clearInterval(draftTimer);
      clearInterval(progressTimer);
      clearInterval(codeTimer);
      clearTimeout(cursorTimer);
      window.removeEventListener('beforeunload', onUnload);
      offStore();
      offEngine();
      offUpdates?.();
      offCursor?.();
      session?.close();
      for (const d of draining) d.close();
      viewers.forEach((v) => v.destroy());
      editor.destroy();
    },
  };
}
