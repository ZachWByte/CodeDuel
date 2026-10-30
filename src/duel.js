// Duel flow on the client. The server sends a room snapshot after every change;
// this module shows the lobby, the round or the duel results for it.
import { h, setChildren, toast } from './ui/dom.js';
import { renderRound } from './ui/round-game.js';
import { renderLobby } from './ui/lobby.js';
import { renderDuelResults } from './ui/duel-results.js';
import { createChatDock } from './ui/chat.js';
import { createSpectator } from './ui/spectate.js';
import { createPowerups } from './ui/powerups.js';
import { createExtension } from './ui/extension.js';
import { createLeaderboard, standingText, standings, mySide, titleOf } from './ui/leaderboard.js';
import { icon } from './ui/icons.js';
import { displayName } from './ui/lobby.js';
import { MODE_LABELS, CATEGORIES, BANK_VERSION } from './questions/index.js';
import { reduceRound } from './state/round.js';
import {
  request, send, on, onRoom, onChat, onVerify, onWatch, onTeamUpdates, onTeamCursor, onConnection, markInDuel, wasInDuel,
} from './net/duel-client.js';
import { warmUp } from './runners/runner.js';

const RESUME_TIMEOUT_MS = 10000;

/** Moves a round state's timestamps from the server's clock to ours. */
function rebase(state, delta) {
  if (!state) return state;
  const at = (t) => (t === null ? null : t + delta);
  return {
    ...state,
    startedAt: state.startedAt + delta,
    endsAt: state.endsAt + delta,
    endedAt: at(state.endedAt),
    qs: state.qs.map((q) => ({ ...q, solvedAt: at(q.solvedAt) })),
  };
}

/**
 * Same interface as the single-player store. Actions apply locally straight away
 * and go to the server, whose state replaces ours once it has seen them all.
 * Ticks stay local: the server runs its own clock. Teammates' actions arrive in the
 * server's state.
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
      set(reduceRound(state, action));
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

/** What changed for the other sides since the last snapshot, as [message, kind] toasts. */
function sideNews(prev, side) {
  if (!prev) return [];
  const s = side.state;
  const news = [];
  for (const q of s.qs) {
    if (q.status === 'solved' && !prev.solved.has(q.questionId)) news.push([`${side.name} solved ${titleOf(q.questionId)} (+${q.points})`, 'bad']);
  }
  if (s.status === 'finished' && !prev.finished) news.push([`${side.name} finished with ${s.total} points`, 'warn']);
  return news;
}

const sideSummary = (side) => ({
  solved: new Set(side.state.qs.filter((q) => q.status === 'solved').map((q) => q.questionId)),
  finished: side.state.status === 'finished',
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
  const watches = new Map(); // playerId -> what the server lets us see of their code
  const banner = h('div.conn-banner', { hidden: true }, 'Connection lost — reconnecting to the game server…');
  const extension = createExtension({
    onAsk: (minutes) => request('duel:extend', { minutes }),
    onVote: (yes) => request('duel:extendVote', { yes }),
  });
  const chat = createChatDock({
    onSend: (text, team) => send('duel:chat', { text, team }),
    onVoice: (audio, seconds, team) => request('duel:voice', { audio, seconds, team }),
  });

  function listen() {
    if (listening) return;
    listening = true;
    document.body.append(banner);
    onRoom(receive);
    onChat((msg) => { if (engaged) chat.add(msg); }, (log) => { if (engaged) chat.setLog(log); });
    onVerify(({ questionId, message }) => {
      if (!engaged) return;
      toast(message, 7000, 'bad');
      screen?.serverSaid?.(questionId, message);
    });
    onWatch(receiveWatch);
    on('duel:wipe', ({ questionId, code, by }) => {
      if (!engaged || screen?.kind !== 'game') return;
      screen.wipe?.(questionId, code);
      toast(`🧨 ${by} wiped your code on ${titleOf(questionId)}`, 5000, 'bad');
    });
    onConnection((status) => {
      if (status === 'replaced' && engaged) {
        goHome('This duel was opened in another tab, so it closed here.');
        return;
      }
      banner.hidden = status === 'connected' || !engaged;
    });
  }

  function receiveWatch(w) {
    if (!engaged || !room) return;
    const prev = watches.get(w.playerId);
    watches.set(w.playerId, w);
    // Finishing a question unlocks the code of an opponent still working on it.
    const p = room.players.find((x) => x.id === w.playerId);
    if (prev?.locked && !w.locked && prev.questionId === w.questionId && room.status === 'playing' &&
      p?.state?.status === 'playing' && !p.left) {
      toast(`Unlocked: you can now read ${displayName(p)}'s code in Watch`, 4500);
    }
    screen?.watch?.();
  }

  function goHome(message) {
    engaged = false;
    watches.clear();
    resuming = false;
    restoreDrafts = false;
    room = null;
    screen = null;
    markInDuel(false);
    banner.hidden = true;
    chat.detach();
    chat.setLog([]);
    extension.update(null);
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
    if (room && snap.round !== room.round) watches.clear();
    const at = (t) => (t ? t + delta : t);
    room = {
      ...snap,
      powers: snap.powers ? { ...snap.powers, blackoutReadyAt: at(snap.powers.blackoutReadyAt) } : null,
      extension: snap.extension ? { ...snap.extension, until: at(snap.extension.until) } : null,
      players: snap.players.map((p) => ({ ...p, state: rebase(p.state, delta), blackedUntil: at(p.blackedUntil), keyboardUntil: at(p.keyboardUntil) })),
    };
    markInDuel(true);
    chat.setYou(room.youId);
    chat.setTeam(room.players.find((p) => p.id === room.youId)?.team ?? null);
    if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);
    route();
    extension.update(room);
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
    // The chat is a lobby column; in a round it folds away into a side panel.
    if (kind === 'lobby') chat.place('column');
    else {
      chat.place('side');
      chat.setOpen(kind !== 'game');
    }
    mount(() => {
      const view = kind === 'lobby' ? lobbyScreen() : kind === 'game' ? gameScreen(restore) : resultsScreen();
      screen = { kind, round: room.round, update: view.update, watch: view.watch, wipe: view.wipe, serverSaid: view.serverSaid };
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
      chatEl: chat.el,
      onDrawn: () => chat.refresh(),
      onConfig: (config) => request('duel:config', { config }),
      onPick: (pick) => request('duel:pick', pick),
      onReady: (ready) => request('duel:ready', { ready }),
      onStart: (pick) => request('duel:start', { pick }),
      onTeam: (team, playerId) => request('duel:team', { team, playerId }),
      onGrant: (playerId, on) => request('duel:grant', { playerId, on }),
      onAddBot: (level) => request('duel:addBot', { level }),
      onRemoveBot: (id) => request('duel:removeBot', { id }),
      onLeave: leave,
    });
  }

  function resultsScreen() {
    const spectator = createSpectator();
    const view = renderDuelResults(root, {
      room,
      onNext: () => request('duel:next'),
      onLeave: leave,
      chatToggle: chat.toggle,
      watch: { el: spectator.el, update: (r) => spectator.update(r, watches) },
    });
    return {
      update: view.update,
      watch: () => spectator.update(room, watches),
      cleanup() {
        view.cleanup();
        spectator.destroy();
      },
    };
  }

  function gameScreen(restore) {
    const self = me();
    warmUp(self.state.config.lang);
    const store = createRemoteStore(self.state, room.yourSeq);
    const leaderboard = createLeaderboard();
    leaderboard.update(room);
    chat.setTop(h('div.opp-top', {}, h('h3.section-title', {}, 'Leaderboard'), leaderboard.el));
    const standing = h('span.standing', { title: 'Your place in the round' });
    const drawStanding = () => { standing.textContent = standingText(room); };
    drawStanding();

    // Watching the others takes over the work area (Watch, or after a solve).
    const spectator = createSpectator();
    const watchBtn = h('button.btn.watch-toggle#btn-watch', {
      type: 'button',
      title: 'Watch the other players. Their code is readable once you have solved the question they are on.',
      'aria-pressed': 'false',
    });
    const drawWatch = () => {
      spectator.update(room, watches);
      setChildren(watchBtn, icon(spectator.isLive() ? 'eye' : 'lock'), h('span', {}, 'Watch'));
      watchBtn.classList.toggle('is-live', spectator.isLive());
    };
    drawWatch();

    // In a team, the editor is shared with the teammates.
    const sideKey = mySide(room);
    const teamSide = room.sides.find((s) => s.key === sideKey && s.team);
    const mates = () => room.players.filter((p) => p.side === sideKey && p.id !== room.youId && !p.left);
    const firstQ = self.state.questions[0].id;
    const team = teamSide ? {
      open: (questionId) => request('team:open', { questionId }),
      push: (questionId, msg) => request('team:push', { questionId, ...msg }),
      pull: (questionId, version) => request('team:pull', { questionId, version }),
      onUpdates: onTeamUpdates,
      onCursor: onTeamCursor,
      sendCursor: (questionId, pos) => send('team:cursor', { questionId, pos }),
      matesOn: (questionId) => mates().filter((p) => (p.viewing ?? firstQ) === questionId).map((p) => p.name),
      mates: () => mates().map((p) => p.name),
    } : null;

    const seen = new Map(standings(room).map((s) => [s.key, sideSummary(s)]));
    const countdown = countdownOverlay(self.state.startedAt);
    let view = null;
    const powerups = createPowerups({
      onPower: (type, targetId) => request('duel:power', { type, targetId }),
      onHint: (questionId, kind) => request('duel:hint', { questionId, kind }),
      questionId: () => view?.questionId() ?? null,
    });
    powerups.update(room);
    view = renderRound(root, {
      store,
      resumed: restore,
      headerExtra: h('div.hdr-duel', {}, standing, extension.button, powerups.button, watchBtn, chat.toggle),
      watch: { el: spectator.el, button: watchBtn },
      team,
      hintsFor: (questionId) => room.hints?.[questionId] ?? null,
      onView: (questionId) => send('duel:view', { questionId }),
      onProgress: (questionId, lines) => send('duel:progress', { questionId, lines }),
      onCode: (questionId, code) => send('duel:code', { questionId, code }),
      onQuit: leave,
      onFinished: (state) => {
        // We finished before the server confirmed it: show the results (and the others) now.
        finishedRound = room.round;
        room = { ...room, players: room.players.map((p) => (p.side === sideKey ? { ...p, state } : p)) };
        show('results');
      },
    });

    const drawBlackout = () => {
      const mine = room.players.find((p) => p.id === room.youId);
      view.setBlackout(mine?.blackedUntil ?? null, mine?.blackedBy ?? null);
      view.setMouseKeys(mine?.keyboardUntil ?? null, mine?.keyboardBy ?? null);
    };
    drawBlackout();

    return {
      cleanup() {
        countdown.remove();
        chat.setTop(null);
        spectator.destroy();
        powerups.destroy();
        view.cleanup();
      },
      watch: drawWatch,
      wipe: (questionId, code) => view.wipe(questionId, code),
      serverSaid: (questionId, message) => view.serverSaid(questionId, message),
      update(next) {
        const mine = next.players.find((p) => p.id === next.youId);
        store.receive(mine.state, next.yourSeq);
        for (const side of standings(next)) {
          if (side.key === sideKey) continue;
          sideNews(seen.get(side.key), side).forEach(([text, kind]) => toast(text, 4500, kind));
          seen.set(side.key, sideSummary(side));
        }
        leaderboard.update(next);
        drawStanding();
        drawWatch();
        view.refresh();
        powerups.update(next);
        view.refreshHints();
        drawBlackout();
      },
    };
  }

  /** "Round 2 starts in 3…" over the game until the round's start time (our clock). */
  function countdownOverlay(startsAt) {
    const info = room.roundInfo;
    const num = h('div.numeral.countdown-num', {});
    // Swallow keys while counting down, so nobody gets a head start in the editor.
    const block = (e) => {
      if (e.target.closest?.('.chat-panel')) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const el = h('div.countdown', {},
      h('div.countdown-box', {},
        h('div.muted', {}, `Round ${room.round}`),
        info ? h('h2', {}, `${MODE_LABELS[info.mode]} · ${CATEGORIES[info.category]?.label}`) : null,
        info ? h('p.muted', {}, info.note) : null,
        h('div.clock-case', {}, h('div.face.face-lit', {}, h('span.label', {}, 'starts in'), num))));
    const tickDown = () => {
      const left = Math.ceil((startsAt - Date.now()) / 1000);
      if (left <= 0) {
        stop();
        return;
      }
      if (num.textContent !== String(left)) {
        num.textContent = String(left);
        // Press the clock: restart the animation on every new second.
        num.classList.remove('press');
        void num.offsetWidth;
        num.classList.add('press');
      }
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
    create: (config, name) => enter('duel:create', { config, name, bank: BANK_VERSION }),
    /** A room with a practice bot already in it. */
    async createWithBot(config, name, level = 'medium') {
      const res = await enter('duel:create', { config, name, bank: BANK_VERSION });
      if (res?.error) return res;
      // By now the lobby is showing, so report a problem there.
      const added = await request('duel:addBot', { level });
      if (added?.error) toast(added.error, 4000, 'bad');
      return added;
    },
    join: (code, name) => {
      if (!/^[A-Z0-9]{4}$/i.test(code.trim())) return Promise.resolve({ error: 'Enter the 4-letter room code.' });
      return enter('duel:join', { code: code.trim(), name, bank: BANK_VERSION });
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
