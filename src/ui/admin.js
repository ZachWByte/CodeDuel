// Admin screen, in two tabs. Live: everyone playing right now, solo players and duel
// rooms on the left and the question and code of whoever is picked on the right. Solutions: the
// code that solved each question (the newest few per question, server/solutions.js).
// Accounts: who has an account, when they were last online and their recent games.
import { h, setChildren, formatTime, toast } from './dom.js';
import { icon, brandMark } from './icons.js';
import { viewButton } from './view-settings.js';
import { LANG_LABELS, MODE_LABELS, DIFFICULTY_LABELS, CATEGORIES, getQuestion } from '../questions/index.js';
import { problemView } from './play-parts.js';

const TEAM = { red: 'Red', green: 'Green', blue: 'Blue' };
const SOLO_STATUS = { playing: 'working', solved: 'solved', timeout: 'out of time', skipped: 'skipped' };
const label = (labels, key) => labels[key] ?? key;

/**
 * renderAdmin(root, { onBack, onLogout, onWatch(watch | null), loadSolutions(), loadSolution(questionId), loadAccounts(), loadAccount(id) })
 * The loaders return a promise of the server's reply. -> { update(view), resubscribe(), cleanup() }
 */
export function renderAdmin(root, { onBack, onLogout, onWatch, loadSolutions, loadSolution, loadAccounts, loadAccount }) {
  let view = null;
  let delta = 0; // our clock minus the server's
  let watch = null; // { kind, id, room? }
  let tab = 'live'; // 'live' | 'solutions' | 'accounts'
  const sol = { questions: null, stats: null, open: null, entries: null }; // the Solutions tab
  const acc = { list: null, open: null, games: null }; // the Accounts tab

  const counts = h('span.admin-counts', {});
  const list = h('div.admin-list', {}, h('p.muted', {}, 'Loading…'));
  const codeHead = h('div.admin-code-head', {});
  const problem = h('div.admin-problem', { hidden: true });
  let problemKey = null; // the question shown in `problem`, so an update keeps its scroll
  const code = h('pre.admin-code', {});
  const tabs = h('div.admin-tabs', { role: 'tablist' });
  const live = h('div.admin-cols', {},
    h('section.admin-players', { 'aria-label': 'Players' }, list),
    h('section.admin-code-pane', { 'aria-label': 'Code' }, codeHead, problem, code));
  const solQuestions = h('div.admin-list', {});
  const solHead = h('div.admin-code-head', {});
  const solBody = h('div.sol-list', {});
  const solutions = h('div.admin-cols', { hidden: true },
    h('section.admin-players', { 'aria-label': 'Questions' }, solQuestions),
    h('section.admin-code-pane', { 'aria-label': 'Solutions' }, solHead, solBody));
  const accList = h('div.admin-list', {});
  const accHead = h('div.admin-code-head', {});
  const accBody = h('div.sol-list', {});
  const accountsPane = h('div.admin-cols', { hidden: true },
    h('section.admin-players', { 'aria-label': 'Accounts' }, accList),
    h('section.admin-code-pane', { 'aria-label': 'Recent games' }, accHead, accBody));
  setChildren(root, h('div.admin', {},
    h('header.admin-header', {},
      h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: onBack }, icon('back'), 'Home'),
      h('h1.brand', {}, brandMark(), h('span.brand-name', {}, 'Admin')),
      tabs,
      counts,
      viewButton(),
      h('button.btn.btn-small#btn-logout', { type: 'button', onclick: onLogout }, 'Log out')),
    live,
    solutions,
    accountsPane));

  function drawTabs() {
    const opt = (key, text) => h(`button.admin-tab${tab === key ? '.active' : ''}`, {
      type: 'button', role: 'tab', 'aria-selected': String(tab === key),
      onclick: () => { if (tab !== key) setTab(key); },
    }, text);
    setChildren(tabs, opt('live', 'Live'), opt('solutions', 'Solutions'), opt('accounts', 'Accounts'));
    live.hidden = tab !== 'live';
    solutions.hidden = tab !== 'solutions';
    accountsPane.hidden = tab !== 'accounts';
    counts.hidden = tab !== 'live';
  }

  function setTab(next) {
    tab = next;
    drawTabs();
    if (tab === 'solutions') refreshSolutions();
    if (tab === 'accounts') refreshAccounts();
  }

  // ---------------------------------------------------------------- accounts

  async function refreshAccounts() {
    const res = await loadAccounts();
    if (res?.error) {
      toast(res.error, 3500, 'bad');
      return;
    }
    acc.list = res.accounts;
    if (acc.open !== null) await openAccount(acc.open, false);
    drawAccounts();
  }

  async function openAccount(id, draw = true) {
    if (acc.open !== id) acc.games = null;
    acc.open = id;
    if (draw) drawAccounts();
    const res = await loadAccount(id);
    if (res?.error) {
      toast(res.error, 3500, 'bad');
      return;
    }
    if (acc.open !== id) return;
    acc.games = res.games;
    if (draw) drawAccounts();
  }

  function gameRow(g) {
    const what = [g.kind === 'duel' ? 'Duel' : g.kind === 'practice' ? 'Practice' : 'Solo', label(MODE_LABELS, g.mode),
      g.category ? CATEGORIES[g.category]?.label ?? g.category : null, label(DIFFICULTY_LABELS, g.difficulty), label(LANG_LABELS, g.lang)];
    return h('article.account-game', {},
      h('div', {},
        h('strong', {}, what.filter(Boolean).join(' · ')),
        h('p.muted.small', {}, [`${g.solved}/${g.questions} solved`, g.opponents ? `vs ${g.opponents}` : null].filter(Boolean).join(' · '))),
      h(`span.game-result${g.result ? `.game-${g.result}` : ''}`, {}, g.result ?? ''),
      h('span.admin-num.admin-score', { title: 'Points' }, String(g.points)),
      h('span.muted.small.sol-when', { title: new Date(g.playedAt).toLocaleString() }, ago(g.playedAt)));
  }

  function drawAccounts() {
    const list = acc.list;
    setChildren(accList,
      h('h2.col-title', {}, 'Accounts', h('span.muted', {}, list ? ` ${list.length}` : '')),
      !list ? h('p.muted', {}, 'Loading…')
        : list.length ? list.map((a) => h(`button.admin-row.sol-q${acc.open === a.id ? '.active' : ''}`, {
          type: 'button',
          onclick: () => openAccount(a.id),
        },
          h('span.admin-who', {}, dot(a.online), h('strong', {}, a.username)),
          h('span.admin-doing.muted', { title: new Date(a.lastSeenAt).toLocaleString() }, a.online ? 'online now' : `last online ${ago(a.lastSeenAt)}`),
          h('span.admin-num.admin-score', { title: 'Games played' }, String(a.gamesPlayed))))
          : h('p.muted', {}, 'No accounts yet.'));
    const open = list?.find((a) => a.id === acc.open);
    if (!open) {
      setChildren(accHead, h('h2.col-title', {}, 'Recent games'));
      setChildren(accBody, h('p.muted.sol-empty', {}, 'Pick an account to see their recent games.'));
      return;
    }
    setChildren(accHead, h('h2.col-title', {}, open.username), h('span.muted', {}, `${open.gamesPlayed} game${open.gamesPlayed === 1 ? '' : 's'} · joined ${ago(open.createdAt)}`));
    setChildren(accBody, !acc.games ? h('p.muted.sol-empty', {}, 'Loading…')
      : acc.games.length ? acc.games.map(gameRow) : h('p.muted.sol-empty', {}, 'No games yet.'));
  }

  // ---------------------------------------------------------------- solutions

  const ago = (t) => {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(t).toLocaleDateString();
  };
  const kb = (bytes) => (bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

  async function refreshSolutions() {
    const res = await loadSolutions();
    if (res?.error) {
      toast(res.error, 3500, 'bad');
      return;
    }
    sol.questions = res.questions;
    sol.stats = res.stats;
    if (sol.open) await openQuestion(sol.open, false);
    drawSolutions();
  }

  async function openQuestion(questionId, draw = true) {
    sol.open = questionId;
    if (draw) drawSolutions();
    const res = await loadSolution(questionId);
    if (res?.error) {
      toast(res.error, 3500, 'bad');
      return;
    }
    if (sol.open !== questionId) return;
    sol.entries = res;
    if (draw) drawSolutions();
  }

  function drawSolutions() {
    const qs = sol.questions;
    const st = sol.stats;
    setChildren(solQuestions,
      h('h2.col-title', {}, 'Solved questions', h('span.muted', {}, qs ? ` ${qs.length}` : ''),
        h('button.icon-btn.sol-refresh', { type: 'button', title: 'Refresh', 'aria-label': 'Refresh', onclick: refreshSolutions }, icon('reset'))),
      st ? h('p.muted.small', {}, `${st.count} solution${st.count === 1 ? '' : 's'} saved, ${kb(st.bytes)} of ${kb(st.maxBytes)}. Each question keeps its newest ${st.perQuestion}; the oldest go first when space runs out.`) : null,
      !qs ? h('p.muted', {}, 'Loading…')
        : qs.length ? qs.map((x) => h(`button.admin-row.sol-q${sol.open === x.questionId ? '.active' : ''}`, {
          type: 'button',
          onclick: () => openQuestion(x.questionId),
        },
          h('span.admin-who', {}, h('strong', {}, x.title), h('span.muted', {}, x.questionId)),
          h('span.admin-doing.muted', {}, `latest ${ago(x.latestAt)}`),
          h('span.admin-num.admin-score', { title: 'Solutions saved' }, String(x.count))))
          : h('p.muted', {}, 'No solutions yet. They appear here as players solve questions.'));

    const e = sol.entries?.questionId === sol.open ? sol.entries : null;
    if (!sol.open) {
      setChildren(solHead, h('h2.col-title', {}, 'Solutions'));
      setChildren(solBody, h('p.muted.sol-empty', {}, 'Pick a question to read how everyone solved it.'));
      return;
    }
    setChildren(solHead, h('h2.col-title', {}, e?.title ?? sol.open), h('span.muted', {}, sol.open));
    setChildren(solBody, !e ? h('p.muted.sol-empty', {}, 'Loading…') : e.solutions.map((x) => h('article.sol', {},
      h('header.sol-head', {},
        h('strong', {}, x.name ?? 'Anonymous'),
        h('span.muted', {}, [label(LANG_LABELS, x.lang), x.kind === 'duel' ? `duel ${x.room ?? ''}`.trim() : 'solo',
          x.points !== null ? `${x.points} pts` : null].filter(Boolean).join(' · ')),
        h('span.muted.sol-when', { title: new Date(x.createdAt).toLocaleString() }, ago(x.createdAt))),
      h('pre.admin-code.sol-code', {}, x.code))));
  }

  const timeLeft = (endsAt) => (endsAt ? formatTime((endsAt + delta - Date.now()) / 1000) : '—');
  const isWatched = (kind, id) => watch?.kind === kind && watch.id === id;

  function pick(next) {
    watch = next;
    onWatch(watch);
    draw();
  }

  const dot = (on) => h(`span.dot${on ? '.dot-on' : ''}`, { title: on ? 'online' : 'away' });

  function soloRow(s) {
    const c = s.current;
    const tests = c.lastTest ? `${c.lastTest.passed}/${c.lastTest.total} tests` : 'no test run';
    return h(`button.admin-row${isWatched('solo', s.id) ? '.active' : ''}`, {
      type: 'button',
      onclick: () => pick({ kind: 'solo', id: s.id }),
    },
      h('span.admin-who', {}, dot(s.connected), h('strong', {}, s.name ?? 'Anonymous'),
        h('span.muted', {}, `${label(LANG_LABELS, s.lang)} · ${label(MODE_LABELS, s.mode)} · ${label(DIFFICULTY_LABELS, s.difficulty)}${s.practice ? ' · practice' : ''}`)),
      s.status === 'finished'
        ? h('span.admin-doing', {}, h('strong', {}, 'Finished'), ` · ${s.solved}/${s.count} solved`)
        : h('span.admin-doing', {}, `Q${s.index + 1}/${s.count} `, h('strong', {}, c.title), ' · ', SOLO_STATUS[c.status],
          h('span.muted', {}, ` · ${tests} · ${c.testRuns} run${c.testRuns === 1 ? '' : 's'} · ${c.failedSubmits} wrong`)),
      h('span.admin-num', { title: 'Time left on the question' }, s.status === 'finished' || c.status !== 'playing' ? '—' : h('span.admin-clock', { dataset: { ends: c.endsAt ?? '' } }, timeLeft(c.endsAt))),
      h('span.admin-num.admin-score', { title: 'Score' }, String(s.total)));
  }

  function duelPlayerRow(room, p) {
    const canWatch = room.status !== 'lobby' && !p.bot;
    const tags = [p.host ? 'host' : null, p.bot ? `${p.bot} bot` : null, p.team ? `${TEAM[p.team]} team` : null, p.left ? 'left' : null].filter(Boolean);
    let doing;
    if (room.status === 'lobby') doing = p.ready ? 'ready' : 'not ready';
    else if (p.status === 'finished') doing = [h('strong', {}, 'Finished'), ` · ${p.solved}/${p.count} solved`];
    else doing = [h('strong', {}, p.viewingTitle ?? '—'), h('span.muted', {}, ` · ${p.solved}/${p.count} solved${p.lines !== null ? ` · ${p.lines} lines` : ''}`)];
    return h(`${canWatch ? 'button' : 'div'}.admin-row${isWatched('duel', p.id) ? '.active' : ''}${canWatch ? '' : '.static'}`, {
      type: canWatch ? 'button' : undefined,
      onclick: canWatch ? () => pick({ kind: 'duel', id: p.id, room: room.code }) : undefined,
    },
      h('span.admin-who', {}, dot(p.connected && !p.left), p.bot ? icon('bot', 'Bot') : null, h('strong', {}, p.name),
        tags.length ? h('span.muted', {}, tags.join(' · ')) : null),
      h('span.admin-doing', {}, doing),
      h('span.admin-num', { title: 'Time on the question' },
        room.status === 'playing' && p.status === 'playing' && p.onQuestionSec !== null ? formatTime(p.onQuestionSec) : '—'),
      h('span.admin-num.admin-score', { title: 'Score' }, room.status === 'lobby' ? '—' : String(p.total)));
  }

  function roomBlock(room) {
    const info = room.roundInfo;
    const what = room.status === 'lobby'
      ? `lobby${room.round ? ` · after round ${room.round}` : ''}`
      : `round ${room.round} · ${room.status === 'finished' ? 'finished' : 'playing'}${info ? ` · ${label(MODE_LABELS, info.mode)} · ${CATEGORIES[info.category]?.label ?? info.category}` : ''}`;
    return h('div.admin-room', {},
      h('div.admin-room-head', {}, h('span.numeral.admin-room-code', {}, room.code), h('span.muted', {}, `${label(LANG_LABELS, room.config.lang)} · ${what}`)),
      room.players.map((p) => duelPlayerRow(room, p)));
  }

  /** The question the watched player has open, in the language they are playing it in. */
  function drawProblem(w) {
    const q = w?.questionId ? getQuestion(w.questionId) : null;
    const played = watch?.kind === 'solo'
      ? view?.solos.find((s) => s.id === watch.id)?.lang
      : view?.rooms.find((r) => r.code === watch?.room)?.config.lang;
    const lang = q?.languages.includes(played) ? played : q?.languages[0];
    const key = q ? `${q.id}|${lang}` : null;
    if (key === problemKey) return;
    problemKey = key;
    problem.hidden = !q;
    setChildren(problem, q ? problemView(q, lang) : null);
    problem.scrollTop = 0;
  }

  function drawCode() {
    const w = view?.watched;
    drawProblem(watch ? w : null);
    if (!watch) {
      setChildren(codeHead, h('h2.col-title', {}, 'Code'));
      setChildren(code, h('span.muted', {}, 'Pick a player to watch their code live.'));
      return;
    }
    const who = watch.kind === 'solo'
      ? view?.solos.find((s) => s.id === watch.id)?.name ?? 'Anonymous'
      : view?.rooms.flatMap((r) => r.players).find((p) => p.id === watch.id)?.name ?? 'Player';
    setChildren(codeHead,
      h('h2.col-title', {}, who),
      h('span.muted', {}, w?.title ?? ''),
      h('button.icon-btn', { type: 'button', title: 'Stop watching', 'aria-label': 'Stop watching', onclick: () => pick(null) }, icon('close')));
    code.textContent = w?.code ?? (w ? 'No code yet.' : 'This player has left.');
  }

  function draw() {
    if (!view) return;
    const solos = view.solos;
    const rooms = view.rooms;
    const inDuels = rooms.reduce((n, r) => n + r.players.filter((p) => !p.bot && !p.left).length, 0);
    counts.textContent = `${solos.length} solo · ${inDuels} in ${rooms.length} duel room${rooms.length === 1 ? '' : 's'}`;
    setChildren(list,
      h('h2.col-title', {}, 'Solo', h('span.muted', {}, ` ${solos.length}`)),
      solos.length ? solos.map(soloRow) : h('p.muted', {}, 'Nobody is playing solo right now.'),
      h('h2.col-title', {}, 'Duel rooms', h('span.muted', {}, ` ${rooms.length}`)),
      rooms.length ? rooms.map(roomBlock) : h('p.muted', {}, 'No duel rooms open.'));
    drawCode();
  }

  // The clocks count down between updates.
  const clockTimer = setInterval(() => {
    for (const el of list.querySelectorAll('.admin-clock')) el.textContent = timeLeft(Number(el.dataset.ends) || null);
  }, 1000);

  drawTabs();
  // The Solutions tab refreshes itself while it is open.
  const solTimer = setInterval(() => {
    if (tab === 'solutions') refreshSolutions();
    if (tab === 'accounts') refreshAccounts();
  }, 10_000);

  return {
    update(next) {
      view = next;
      delta = Date.now() - next.serverNow;
      draw();
    },
    /** After the server signed this connection in again: ask for the same code. */
    resubscribe() { if (watch) onWatch(watch); },
    cleanup() {
      clearInterval(clockTimer);
      clearInterval(solTimer);
    },
  };
}
