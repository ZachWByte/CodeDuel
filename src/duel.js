// Duel flow on the client. The server sends a room snapshot after every change;
// this module shows the lobby, the game or the duel results for it.
import { h, setChildren, toast } from './ui/dom.js';
import { renderGame } from './ui/game.js';
import { renderLobby } from './ui/lobby.js';
import { renderDuelResults } from './ui/duel-results.js';
import { createChatDock } from './ui/chat.js';
import { matchScore, displayName } from './ui/lobby.js';
import { getQuestion, MODE_LABELS, CATEGORIES } from './questions/index.js';
import { reduce } from './state/engine.js';
import { request, send, onRoom, onChat, onConnection, markInDuel, wasInDuel } from './net/duel-client.js';
import { warmUp } from './runners/runner.js';

const RESUME_TIMEOUT_MS = 10000;

/** Moves an engine state's timestamps from the server's clock to ours. */
function rebase(state, delta) {
  if (!state) return state;
  const c = state.current;
  return {
    ...state,
    startedAt: state.startedAt + delta,
    current: { ...c, startedAt: c.startedAt + delta, endedAt: c.endedAt === null ? null : c.endedAt + delta },
  };
}

/**
 * Same interface as the single-player store. Actions apply locally straight away
 * and go to the server, whose state replaces ours once it has seen them all.
 * Ticks stay local: the server runs its own clock.
 */
function createRemoteStore(initial, lastSeq) {
  let state = initial;
  // Continue the numbering the server already has, so its older snapshots never
  // look up to date (it keeps counting across rounds and reloads).
  let sent = lastSeq;
  const listeners = new Set();
  const set = (next) => {
    const prev = state;
    state = next;
    if (state !== prev) listeners.forEach((fn) => fn(state, prev));
  };
  return {
    getState: () => state,
    dispatch(action) {
      if (action.type !== 'tick') send('duel:action', { type: action.type, result: action.result, seq: ++sent });
      set(reduce(state, action));
    },
    /** Server state, ignored while it has not caught up with our own actions. */
    receive(next, ack) {
      if (ack >= sent) set(next);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Header bar: each opponent's question, test progress and score, your lead, and the match score. */
function drawOpponents(el, room, myTotal, flashIds = []) {
  const score = matchScore(room);
  setChildren(el,
    room.players.filter((p) => p.id !== room.youId && p.state).map((p) => {
      const s = p.state;
      const t = s.current.lastTest;
      const where = p.left ? 'left' : s.status === 'finished' ? 'done' : `Q${s.index + 1}/${s.questions.length}`;
      const lead = myTotal - s.total;
      return h(`span.opp${p.left || !p.connected ? '.opp-away' : ''}${flashIds.includes(p.id) ? '.opp-flash' : ''}`,
        { title: p.connected ? p.name : `${p.name} (offline)` },
        h('span.opp-vs', {}, 'vs '), h('span.opp-name', {}, displayName(p)), ' ',
        h('span.muted', {}, where),
        t && s.status !== 'finished' && s.current.status === 'playing' ? h('span.opp-tests', { title: 'Their last "Run tests"' }, ` ✓${t.passed}/${t.total}`) : null,
        ' ', h('span.opp-score', {}, s.total),
        h(`span.lead${lead > 0 ? '.ahead' : lead < 0 ? '.behind' : ''}`, { title: 'Your lead' }, lead > 0 ? `+${lead}` : lead < 0 ? `−${-lead}` : '±0'));
    }),
    score ? h('span.match-chip', { title: 'Rounds won' }, score) : null);
}

/** What changed for an opponent since the last snapshot, as [message, kind] toasts. */
function opponentNews(prev, p) {
  const s = p.state;
  if (!prev || !s) return [];
  const c = s.current;
  const name = displayName(p);
  const qn = `Q${s.index + 1}`;
  const news = [];
  const solved = s.results.filter((r) => r.solved);
  if (solved.length > prev.solved) {
    const r = solved.at(-1);
    news.push([`⚔ ${name} solved ${getQuestion(r.questionId)?.title ?? 'a question'} (+${r.points})`, 'bad']);
  } else if (s.index === prev.index && c.testRuns > prev.testRuns && c.lastTest) {
    const { passed, total } = c.lastTest;
    if (passed === total) news.push([`⚠ ${name} passes all ${total} visible tests on ${qn} — a submit may be coming!`, 'warn']);
    else if (passed > prev.passed) news.push([`⚠ ${name} now passes ${passed}/${total} tests on ${qn}`, 'warn']);
  }
  if (s.index === prev.index && c.attempts > prev.attempts && c.status === 'playing' && c.lastSubmit) {
    news.push([`${name} submitted on ${qn}: ${c.lastSubmit.passed}/${c.lastSubmit.total} tests, not yet`, null]);
  }
  if (s.status === 'finished' && prev.status !== 'finished') news.push([`🏁 ${name} finished with ${s.total} points`, 'warn']);
  return news;
}

const opponentSummary = (p) => ({
  index: p.state.index,
  status: p.state.status,
  solved: p.state.results.filter((r) => r.solved).length,
  testRuns: p.state.current.testRuns ?? 0,
  passed: p.state.current.lastTest?.passed ?? 0,
  attempts: p.state.current.attempts,
});

/** createDuel({ root, mount, showHome }) -> { create, join, resume, active } */
export function createDuel({ root, mount, showHome }) {
  let room = null; // latest snapshot, timestamps on our clock
  let screen = null; // { kind, round, update(room) }
  let engaged = false; // we want to be in a room (snapshots are ignored otherwise)
  let resuming = false; // reloaded mid-duel, waiting for the server to say where we were
  let restoreDrafts = false; // the first screen after a reload keeps the editor's draft
  let finishedRound = -1; // we finished this round locally, before the server said so
  let listening = false;
  const banner = h('div.conn-banner', { hidden: true }, 'Connection lost — reconnecting to the game server…');
  const chat = createChatDock({ onSend: (text) => send('duel:chat', { text }) });

  function listen() {
    if (listening) return;
    listening = true;
    document.body.append(banner);
    onRoom(receive);
    onChat((msg) => { if (engaged) chat.add(msg); }, (log) => { if (engaged) chat.setLog(log); });
    onConnection((status) => {
      if (status === 'replaced' && engaged) {
        goHome('This duel was opened in another tab, so it closed here.');
        return;
      }
      banner.hidden = status === 'connected' || !engaged;
    });
  }

  function goHome(message) {
    engaged = false;
    resuming = false;
    restoreDrafts = false;
    room = null;
    screen = null;
    markInDuel(false);
    banner.hidden = true;
    chat.detach();
    chat.setLog([]);
    if (message) toast(message);
    showHome();
  }

  function receive(snap) {
    if (!engaged) return;
    if (!snap) {
      // The server has no seat for us: the room expired or the server restarted.
      if (screen || resuming) goHome('You are no longer in that duel room: it closed, or you were away for too long.');
      return;
    }
    resuming = false;
    const delta = Date.now() - snap.serverNow;
    room = { ...snap, players: snap.players.map((p) => ({ ...p, state: rebase(p.state, delta) })) };
    markInDuel(true);
    chat.setYou(room.youId);
    if (!chat.el.isConnected) {
      document.body.append(chat.el);
      chat.setOpen(chat.isOpen());
    }
    if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);
    route();
  }

  const me = () => room.players.find((p) => p.id === room.youId);

  function route() {
    const self = me();
    let kind = 'results';
    if (room.status === 'lobby') kind = 'lobby';
    else if (room.status === 'playing' && self.state?.status === 'playing' && finishedRound !== room.round) kind = 'game';
    if (screen?.kind === kind && screen.round === room.round) screen.update(room);
    else show(kind);
  }

  function show(kind) {
    const restore = restoreDrafts;
    restoreDrafts = false;
    // The chat folds away during a round.
    chat.setOpen(kind !== 'game');
    mount(() => {
      const view = kind === 'lobby' ? lobbyScreen() : kind === 'game' ? gameScreen(restore) : resultsScreen();
      screen = { kind, round: room.round, update: view.update };
      return view.cleanup;
    });
  }

  async function leave() {
    const wasEngaged = engaged;
    goHome();
    if (wasEngaged) await request('duel:leave');
  }

  function lobbyScreen() {
    return renderLobby(root, {
      room,
      onConfig: (config) => request('duel:config', { config }),
      onPick: (pick) => request('duel:pick', pick),
      onReady: (ready) => request('duel:ready', { ready }),
      onAddBot: (level) => request('duel:addBot', { level }),
      onRemoveBot: (id) => request('duel:removeBot', { id }),
      onLeave: leave,
    });
  }

  function resultsScreen() {
    return renderDuelResults(root, {
      room,
      onNext: () => request('duel:next'),
      onLeave: leave,
    });
  }

  function gameScreen(restore) {
    const self = me();
    const round = room.round;
    warmUp(self.state.config.lang);
    const store = createRemoteStore(self.state, room.yourSeq);
    const opponents = h('span.opponents', {});
    drawOpponents(opponents, room, self.state.total);
    const seen = new Map(room.players.filter((p) => p.state).map((p) => [p.id, opponentSummary(p)]));
    const countdown = countdownOverlay(self.state.startedAt);

    const stopGame = renderGame(root, {
      store,
      resumed: restore,
      headerExtra: opponents,
      quitMessage: 'Leave the duel? You forfeit this round and leave the room.',
      onQuit: leave,
      onFinished: (state) => {
        // We pressed "See results" before the server confirmed it.
        finishedRound = round;
        room = { ...room, players: room.players.map((p) => (p.id === room.youId ? { ...p, state } : p)) };
        show('results');
      },
    });

    return {
      cleanup() {
        countdown.remove();
        stopGame();
      },
      update(next) {
        const mine = next.players.find((p) => p.id === next.youId);
        store.receive(mine.state, next.yourSeq);
        const flash = [];
        for (const p of next.players) {
          if (p.id === next.youId || !p.state) continue;
          const news = opponentNews(seen.get(p.id), p);
          news.forEach(([text, kind]) => toast(text, 4500, kind));
          if (news.length) flash.push(p.id);
          seen.set(p.id, opponentSummary(p));
        }
        drawOpponents(opponents, next, store.getState().total, flash);
      },
    };
  }

  /** "Round 2 starts in 3…" over the game until the round's start time (our clock). */
  function countdownOverlay(startsAt) {
    const info = room.roundInfo;
    const num = h('div.countdown-num', {});
    // Swallow keys while counting down, so nobody gets a head start in the editor.
    const block = (e) => {
      if (e.target.closest?.('.chat-dock')) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const el = h('div.countdown', {},
      h('div.countdown-box', {},
        h('div.muted', {}, `Round ${room.round}`),
        info ? h('h2', {}, `${MODE_LABELS[info.mode]} · ${CATEGORIES[info.category]?.label}`) : null,
        info ? h('p.muted', {}, info.note) : null,
        num));
    const tickDown = () => {
      const left = Math.ceil((startsAt - Date.now()) / 1000);
      if (left <= 0) {
        stop();
        return;
      }
      num.textContent = String(left);
    };
    const timer = setInterval(tickDown, 100);
    function stop() {
      clearInterval(timer);
      el.remove();
      document.removeEventListener('keydown', block, true);
    }
    if (startsAt > Date.now() + 200) {
      document.body.append(el);
      document.addEventListener('keydown', block, true);
      tickDown();
    } else stop();
    return { remove: stop };
  }

  /** Waits for the first snapshot; failures come back as { error }. */
  async function enter(event, payload) {
    listen();
    engaged = true;
    const res = await request(event, payload);
    if (res?.error && !screen) engaged = false;
    return res;
  }

  return {
    create: (config, name) => enter('duel:create', { config, name }),
    /** A room with a practice bot already in it. */
    async createWithBot(config, name, level = 'medium') {
      const res = await enter('duel:create', { config, name });
      if (res?.error) return res;
      // By now the lobby is showing, so report a problem there.
      const added = await request('duel:addBot', { level });
      if (added?.error) toast(added.error, 4000, 'bad');
      return added;
    },
    join: (code, name) => {
      if (!/^[A-Z0-9]{4}$/i.test(code.trim())) return Promise.resolve({ error: 'Enter the 4-letter room code.' });
      return enter('duel:join', { code: code.trim(), name });
    },
    /** After a reload: rejoin the room this tab was in. */
    resume() {
      resuming = true;
      restoreDrafts = true;
      engaged = true;
      setChildren(root, h('p.boot', {}, 'Reconnecting to your duel…'));
      listen();
      setTimeout(() => {
        if (!screen && engaged) goHome("Couldn't reach the game server.");
      }, RESUME_TIMEOUT_MS);
    },
    wasInDuel,
  };
}
