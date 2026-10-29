// A practice opponent. It connects to the duel server like any player (Socket.IO,
// same messages), so it also exercises the real protocol. It does not run code:
// for each question it plans how long it "takes", how many test runs and wrong
// submits it makes, and whether it solves it at all, from its level.
//
// Used by the server ("Add bot" in the lobby) and by scripts/bot.mjs, which can
// join a room on any server, e.g. one deployed on Render.
import { io } from 'socket.io-client';
import { randomBytes } from 'node:crypto';
import { getQuestion, CATEGORIES, MODE_LABELS } from '../src/questions/index.js';
import { resolveTests } from '../src/judge/resolve.js';

export const BOT_LEVELS = {
  easy: {
    label: 'Easy',
    names: ['Pebble', 'Byte', 'Noodle'],
    solve: { easy: 0.75, medium: 0.45, hard: 0.2 }, // chance to solve a question
    pace: [0.45, 0.85], // share of the time limit it takes to solve
    testRuns: [1, 3],
    wrongSubmits: [0, 2],
    extraLineChance: 0.5, // Bug Hunt: chance to change one line more than par
  },
  medium: {
    label: 'Medium',
    names: ['Turing', 'Lovelace', 'Hopper'],
    solve: { easy: 0.92, medium: 0.75, hard: 0.5 },
    pace: [0.25, 0.6],
    testRuns: [1, 2],
    wrongSubmits: [0, 1],
    extraLineChance: 0.2,
  },
  hard: {
    label: 'Hard',
    names: ['Knuth', 'Dijkstra', 'Karp'],
    solve: { easy: 1, medium: 0.95, hard: 0.85 },
    pace: [0.1, 0.35],
    testRuns: [0, 1],
    wrongSubmits: [0, 1],
    extraLineChance: 0,
  },
};

const LINES = {
  hello: ['hi! good luck 🤖', 'hello human. may the best coder win', 'ready to lose? 😄 (kidding, good luck)'],
  theySolved: ['nice one 👏', 'ok that was quick', 'hmm, I see you', "you're fast today", 'not bad!'],
  iSolved: ['✓ got it', 'that one was fun', 'done ✌️'],
  win: ['gg 🤖', 'gg! close one', 'gg, rematch?'],
  lose: ['gg, well played!', 'you got me. gg', "gg — I'll get you next round"],
  draw: ['a draw?! gg', 'perfectly balanced. gg'],
  greet: ['hey 👋', 'hi!', 'hello!'],
  reply: ['beep boop, busy coding 🤖', '🤖👍', 'focus mode 🤫'],
};

const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const between = ([lo, hi]) => lo + Math.random() * (hi - lo);
const intBetween = ([lo, hi]) => Math.floor(lo + Math.random() * (hi - lo + 1));

/**
 * startBot({ url, code, level, token?, name?, speed?, log? }) -> { stop(), done }
 * speed > 1 makes the bot act faster (tests use it); done resolves when it leaves.
 */
export function startBot({ url, code, level = 'medium', token, name, speed = 1, log = () => {} }) {
  const cfg = BOT_LEVELS[level] ?? BOT_LEVELS.medium;
  const botName = name ?? pick(cfg.names);
  const socket = io(url, { auth: { token: token ?? randomBytes(16).toString('hex') }, transports: ['websocket'], reconnectionAttempts: 5 });
  const timers = new Set(); // planned moves; cleared when the plan changes
  const chatTimers = new Set(); // chat lines; only cleared when the bot stops
  let room = null;
  let joined = false;
  let stopped = false;
  let delta = 0; // our clock - server clock
  let planned = ''; // "round:index" of the question we have planned
  let movedOn = ''; // "round:index" we already pressed Next for
  let lastPick = ''; // the pick state we last answered
  let roundOver = 0; // the last round we said gg for
  let theirSolved = new Map(); // opponent id -> solved count
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });

  const later = (ms, fn, set = timers) => {
    const t = setTimeout(() => {
      set.delete(t);
      if (!stopped) fn();
    }, Math.max(0, ms / speed));
    set.add(t);
  };
  const clearPlans = () => {
    timers.forEach(clearTimeout);
    timers.clear();
  };
  const chat = (text, chance = 1) => {
    if (Math.random() < chance) later(600 + Math.random() * 1500, () => socket.emit('duel:chat', { text }), chatTimers);
  };
  const act = (type, result) => socket.emit('duel:action', { type, result });

  function stop() {
    if (stopped) return;
    stopped = true;
    clearPlans();
    chatTimers.forEach(clearTimeout);
    socket.close();
    resolveDone();
  }

  socket.on('connect', () => {
    if (joined) return;
    socket.emit('duel:join', { code, name: botName }, (res) => {
      if (res?.error) {
        log(`[bot] could not join ${code}: ${res.error}`);
        stop();
        return;
      }
      joined = true;
      chat(pick(LINES.hello));
    });
  });
  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect' || reason === 'io client disconnect') stop();
  });
  socket.on('connect_error', () => {
    if (!socket.active) stop();
  });

  socket.on('duel:chat', (msg) => {
    if (!room || msg.fromId === null || msg.fromId === room.youId) return;
    if (/\b(hi|hey|hello|yo)\b/i.test(msg.text)) chat(pick(LINES.greet), 0.8);
    else if (/\bgg\b/i.test(msg.text)) chat('gg', 0.6);
    else chat(pick(LINES.reply), 0.2);
  });

  socket.on('duel:room', (snap) => {
    if (!snap) {
      if (joined) stop();
      return;
    }
    room = snap;
    delta = Date.now() - snap.serverNow;
    if (snap.status === 'lobby') onLobby();
    else onRound();
  });

  function onLobby() {
    planned = '';
    const me = room.players.find((p) => p.id === room.youId);
    const { pickerId, votes } = room.pick;
    const mustPick = (pickerId === null || pickerId === me.id) && !votes[me.id];
    // Re-plan only when what we have to do changes (other updates arrive all the time).
    const key = `${room.round}:${pickerId}:${mustPick}:${me.ready}`;
    if (key === lastPick) return;
    lastPick = key;
    clearPlans();
    if (mustPick) {
      // After a loss pick a specific topic; in a vote usually go random.
      const choice = pickerId === me.id || Math.random() < 0.4
        ? { mode: pick(Object.keys(MODE_LABELS)), category: pick(Object.keys(CATEGORIES)) }
        : { mode: 'random', category: 'random' };
      later(1200 + Math.random() * 1500, () => socket.emit('duel:pick', choice));
    }
    if (!me.ready) later(2000 + Math.random() * 1500, () => socket.emit('duel:ready', { ready: true }));
  }

  function onRound() {
    const me = room.players.find((p) => p.id === room.youId);
    const s = me?.state;
    if (!s) return;

    // React to the other player's progress.
    for (const p of room.players) {
      if (p.id === me.id || !p.state) continue;
      const solved = p.state.results.filter((r) => r.solved).length;
      if (solved > (theirSolved.get(p.id) ?? 0)) chat(pick(LINES.theySolved), 0.5);
      theirSolved.set(p.id, solved);
    }

    if (room.status === 'finished') {
      if (roundOver !== room.round) {
        roundOver = room.round;
        theirSolved = new Map();
        chat(room.lastWinnerId === me.id ? pick(LINES.win) : room.lastWinnerId ? pick(LINES.lose) : pick(LINES.draw));
      }
      return;
    }
    if (s.status !== 'playing') return;

    const key = `${room.round}:${s.index}`;
    if (s.current.status !== 'playing') {
      if (movedOn !== key) {
        movedOn = key;
        later(1500 + Math.random() * 2500, () => act('next'));
      }
      return;
    }
    if (planned === key) return;
    planned = key;
    clearPlans();
    planQuestion(s);
  }

  /** Schedules this question's test runs, wrong submits and (maybe) the solve. */
  function planQuestion(s) {
    const c = s.current;
    const q = getQuestion(c.questionId);
    const tests = resolveTests(q, s.config.lang);
    const visible = tests.filter((t) => !t.hidden).length;
    const total = tests.length;
    const limitMs = c.timeLimitSec * 1000;
    const startIn = c.startedAt + delta - Date.now(); // the countdown, if any
    const solves = Math.random() < cfg.solve[c.difficulty];
    const finishAt = solves ? between(cfg.pace) * limitMs : 0.9 * limitMs;
    // later() divides by speed; the countdown is real time, so undo that for it.
    const at = (share) => startIn * speed + share * finishAt;

    const runs = intBetween(cfg.testRuns);
    for (let i = 1; i <= runs; i++) {
      const share = (i / (runs + 1)) * 0.8;
      const passed = Math.min(visible, Math.round(visible * share * (solves ? 1.2 : 0.8)));
      later(at(share), () => act('testRun', { questionId: c.questionId, passed, total: visible }));
    }
    const wrong = intBetween(cfg.wrongSubmits);
    for (let i = 1; i <= wrong; i++) {
      const share = 0.8 + (i / (wrong + 1)) * 0.15;
      const passed = Math.max(0, total - 1 - Math.floor(Math.random() * Math.max(1, total / 2)));
      later(at(share), () => act('submitResult', {
        questionId: c.questionId, passedVisible: Math.min(visible, passed), passedHidden: Math.max(0, passed - visible), total, timeMs: 30,
      }));
    }
    if (solves) {
      const extra = c.par !== null && Math.random() < cfg.extraLineChance ? 1 : 0;
      later(at(1), () => {
        act('submitResult', {
          questionId: c.questionId, passedVisible: visible, passedHidden: total - visible, total, timeMs: 30,
          linesChanged: c.par !== null ? c.par + extra : undefined,
        });
        chat(pick(LINES.iSolved), 0.3);
      });
    } else {
      // Give up shortly before the time runs out.
      later(at(1), () => act('skip'));
    }
  }

  return { stop, done, name: botName };
}
