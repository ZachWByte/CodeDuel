// Duel rooms over Socket.IO. The server is the referee: it picks the questions,
// keeps every player's engine state and owns the clock. Code still runs in each
// player's browser and the server trusts the test results they report, which is
// fine for playing friends.
//
// A room plays a match of rounds. Before each round the players choose a mode and a
// topic: the first round (and any round after a draw) is a vote, decided by a coin
// flip if the votes differ; after that the loser of the last round chooses. When
// everyone is ready the round starts after a short countdown.
//
// Client -> server (with an ack callback, except duel:action and duel:chat):
//   duel:create { name, config }  duel:join { code, name }  duel:leave
//   duel:config { config }        (host, lobby: language, difficulty, questions per round)
//   duel:pick { mode, category }  ('random' allowed for both)
//   duel:ready { ready }          duel:next (after a round: back to the lobby)
//   duel:addBot { level }         duel:removeBot { id }   (host, lobby)
//   duel:action { type, result?, seq }  (engine actions testRun / submitResult / skip / next)
//   duel:chat { text }
// Server -> client:
//   duel:room     snapshot for this player, or null when they are not in a room
//   duel:chat     one new chat message;  duel:chatlog  the whole log (on joining)
//
// Players are identified by a token the client keeps in sessionStorage, so a
// reload or a dropped connection rejoins the same seat. A player who stays
// disconnected for too long (disconnectGraceMs) leaves the room, so a closed tab
// never holds up the other player.
//
// Hardening for a public server: small messages only, a per-socket event rate
// limit, a cap on connections per IP and on rooms, same-origin browsers only,
// and reported test counts must match the question.
import { Server } from 'socket.io';
import { randomBytes, randomUUID } from 'node:crypto';
import { createSession, reduce } from '../src/state/engine.js';
import { LANG_LABELS, MODE_LABELS, DIFFICULTY_LABELS, CATEGORIES, filterQuestions, getQuestion } from '../src/questions/index.js';
import { resolveTests } from '../src/judge/resolve.js';
import { pickQuestions } from '../src/questions/pick.js';
import { startBot, BOT_LEVELS } from './bot.js';

export const MAX_PLAYERS = 2;
const COUNTS = [1, 3, 5, 10];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const TICK_MS = 250;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const COUNTDOWN_MS = 3000;
const CHAT_KEEP = 100;
const CHAT_MAX_LENGTH = 200;
const CHAT_BURST = { messages: 5, perMs: 5000 };
const DISCONNECT_GRACE_MS = 60 * 1000;
const MAX_ROOMS = 1000;
const MAX_SOCKETS_PER_IP = 20;
const EVENTS_PER_SECOND = 20;
const MAX_MESSAGE_BYTES = 16 * 1024;
const ACTIONS = ['testRun', 'submitResult', 'skip', 'next'];
const MODES = Object.keys(MODE_LABELS);

const has = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);
const randomOf = (xs) => xs[Math.floor(Math.random() * xs.length)];

/** Room settings: { lang, difficulty, count }. The mode and topic are chosen per round. */
export function validConfig(c) {
  if (!c || !has(LANG_LABELS, c.lang) || !has(DIFFICULTY_LABELS, c.difficulty) || !COUNTS.includes(c.count)) return null;
  return { lang: c.lang, difficulty: c.difficulty, count: c.count };
}

/** A pick: { mode, category }, each a real value or 'random'. */
export function validPick(p) {
  if (!p) return null;
  const mode = p.mode === 'random' || MODES.includes(p.mode) ? p.mode : null;
  const category = p.category === 'random' || has(CATEGORIES, p.category) ? p.category : null;
  return mode && category ? { mode, category } : null;
}

const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Player';
const count = (n) => (Number.isInteger(n) && n >= 0 && n <= 1000 ? n : 0);

// How many tests a question has in a language: { visible, total }.
const testCounts = new Map();
function testsFor(questionId, lang) {
  const key = `${questionId}|${lang}`;
  if (!testCounts.has(key)) {
    const q = getQuestion(questionId);
    const tests = q ? resolveTests(q, lang) : [];
    testCounts.set(key, { visible: tests.filter((t) => !t.hidden).length, total: tests.length });
  }
  return testCounts.get(key);
}

/** A reported test result, or null if it cannot be right for the current question. */
function cleanResult(type, r, state) {
  if (!r || r.questionId !== state.current.questionId) return null;
  const expected = testsFor(r.questionId, state.config.lang);
  const total = count(r.total);
  // The browser runs the tests, but it cannot make up how many there are.
  if (total !== (type === 'testRun' ? expected.visible : expected.total)) return null;
  if (type === 'testRun') return { questionId: r.questionId, passed: Math.min(count(r.passed), total), total };
  const passedVisible = Math.min(count(r.passedVisible), total);
  const passedHidden = Math.min(count(r.passedHidden), total - passedVisible);
  const out = { questionId: r.questionId, passedVisible, passedHidden, total, timeMs: count(r.timeMs) };
  if (Number.isInteger(r.linesChanged)) out.linesChanged = count(r.linesChanged);
  return out;
}

/** Turns a pick with 'random' parts into a real mode and category that have questions. */
function settlePick(config, pick) {
  const modes = MODES.filter((m) => filterQuestions({ lang: config.lang, mode: m }).length > 0);
  const mode = pick.mode === 'random' ? randomOf(modes) : pick.mode;
  const categories = Object.keys(CATEGORIES).filter((c) => filterQuestions({ lang: config.lang, mode, category: c }).length > 0);
  const category = pick.category === 'random' || !categories.includes(pick.category) ? randomOf(categories) : pick.category;
  return { mode, category };
}

/**
 * Questions for a round: the chosen difficulty and topic first, topped up from the
 * topic's other difficulties, then from the mode's other topics, so a round has
 * `count` questions whenever the bank allows.
 */
function roundQuestions(config, { mode, category }) {
  const picked = pickQuestions({ ...config, mode, category });
  const topUp = (more) => {
    for (const q of more) if (picked.length < config.count && !picked.includes(q)) picked.push(q);
  };
  const all = { ...config, mode, difficulty: 'mixed', count: Infinity };
  if (picked.length < config.count) topUp(pickQuestions({ ...all, category }));
  if (picked.length < config.count) topUp(pickQuestions(all));
  return picked;
}

const describePick = ({ mode, category }) =>
  `${mode === 'random' ? 'Random mode' : MODE_LABELS[mode]} · ${category === 'random' ? 'random topic' : CATEGORIES[category].label}`;

/** Attaches the duel rooms to an http server. Returns { io, rooms, close() }. */
export function attachDuel(httpServer, {
  log = console.log,
  countdownMs = COUNTDOWN_MS,
  botSpeed = 1,
  disconnectGraceMs = DISCONNECT_GRACE_MS,
  maxRooms = MAX_ROOMS,
  maxSocketsPerIp = MAX_SOCKETS_PER_IP,
} = {}) {
  const io = new Server(httpServer, {
    destroyUpgrade: false, // leave other WebSocket upgrades (Vite's HMR) alone
    serveClient: false,
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    // Browsers on other sites may not use the rooms. (Bots and scripts send no Origin.)
    allowRequest: (req, callback) => {
      const { origin, host } = req.headers;
      let ok = !origin;
      try {
        ok ||= new URL(origin).host === host;
      } catch { /* malformed origin */ }
      callback(null, ok);
    },
  });
  const rooms = new Map(); // code -> room
  const seats = new Map(); // token -> { room, player }
  const botTokens = new Map(); // token -> level, for bots on their way in
  const bots = new Set(); // running bot clients
  const socketsPerIp = new Map(); // ip -> open sockets

  /** Runs fn, logging instead of crashing the server if it throws. */
  const guard = (what, fn) => {
    try {
      return fn();
    } catch (err) {
      log(`[duel] ${what} failed:`, err);
      return undefined;
    }
  };

  function newCode() {
    let code;
    do {
      code = Array.from(randomBytes(CODE_LENGTH), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    } while (rooms.has(code));
    return code;
  }

  const active = (room) => room.players.filter((p) => !p.left);
  const humans = (room) => active(room).filter((p) => !p.bot);

  function snapshot(room, me) {
    return {
      code: room.code,
      round: room.round,
      status: room.status, // 'lobby' | 'playing' | 'finished'
      config: room.config,
      roundInfo: room.roundInfo, // the round being played or last played
      // In a vote, the others only see that you voted, not what.
      pick: { pickerId: room.pick.pickerId, votes: visibleVotes(room, me), reason: room.pick.reason },
      wins: room.wins,
      draws: room.draws,
      lastWinnerId: room.lastWinnerId,
      startsAt: room.startsAt,
      youId: me.id,
      yourSeq: me.seq, // the last of your actions the server has applied
      hostId: room.hostId,
      maxPlayers: MAX_PLAYERS,
      serverNow: Date.now(),
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        bot: p.bot,
        connected: p.socketId !== null,
        left: p.left,
        ready: p.ready,
        state: p.state,
      })),
    };
  }

  function visibleVotes(room, me) {
    if (room.pick.pickerId) return room.pick.votes;
    return Object.fromEntries(Object.entries(room.pick.votes).map(([id, v]) => [id, id === me.id ? v : true]));
  }

  function broadcast(room) {
    for (const p of room.players) {
      if (p.socketId) io.to(p.socketId).emit('duel:room', snapshot(room, p));
    }
  }

  function say(room, from, text) {
    const msg = {
      id: randomUUID().slice(0, 8),
      at: Date.now(),
      fromId: from?.id ?? null,
      name: from?.name ?? null,
      bot: from?.bot ?? null,
      text,
    };
    room.chat.push(msg);
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    for (const p of room.players) if (p.socketId) io.to(p.socketId).emit('duel:chat', msg);
  }

  function deleteRoom(room) {
    rooms.delete(room.code);
    for (const p of room.players) {
      seats.delete(p.token);
      if (p.bot && p.socketId) io.sockets.sockets.get(p.socketId)?.disconnect(true);
    }
  }

  /** Who picks the next round: the loser of the last one, or a vote after a draw / at the start. */
  function resetPick(room) {
    const loser = room.lastWinnerId ? active(room).find((p) => p.id !== room.lastWinnerId) : null;
    room.pick = loser
      ? { pickerId: loser.id, votes: {}, reason: 'loser' }
      : { pickerId: null, votes: {}, reason: room.round === 0 ? 'first' : 'draw' };
    for (const p of room.players) p.ready = false;
  }

  function finishRound(room) {
    room.status = 'finished';
    room.startsAt = null;
    const scored = room.players.filter((p) => p.state);
    const stayed = scored.filter((p) => !p.left);
    const best = Math.max(...stayed.map((p) => p.state.total));
    const top = stayed.filter((p) => p.state.total === best);
    const winner = top.length === 1 ? top[0] : null;
    room.lastWinnerId = winner?.id ?? null;
    if (winner) room.wins[winner.id] = (room.wins[winner.id] ?? 0) + 1;
    else room.draws += 1;
    const totals = scored.map((p) => `${p.name} ${p.state.total}`).join(' – ');
    const match = active(room).map((p) => `${p.name} ${room.wins[p.id] ?? 0}`).join(' – ');
    say(room, null, `${winner ? `🏆 ${winner.name} wins round ${room.round}` : `🤝 Round ${room.round} is a draw`} (${totals}). Match: ${match}${room.draws ? `, ${room.draws} draw${room.draws === 1 ? '' : 's'}` : ''}.`);
  }

  function updateFinished(room) {
    if (room.status === 'playing' && active(room).every((p) => p.state?.status === 'finished')) finishRound(room);
  }

  function leave(token, why = 'left the room') {
    const seat = seats.get(token);
    if (!seat) return;
    const { room, player } = seat;
    seats.delete(token);
    if (room.status === 'lobby') room.players = room.players.filter((p) => p !== player);
    else {
      // Keep them in the scoreboard; the round goes on without them.
      player.left = true;
      player.socketId = null;
    }
    say(room, null, `${player.bot ? '🤖 ' : ''}${player.name} ${why}.`);
    if (humans(room).length === 0) {
      deleteRoom(room);
      return;
    }
    if (room.hostId === player.id) room.hostId = humans(room)[0].id;
    if (room.status === 'lobby') resetPick(room);
    updateFinished(room);
    broadcast(room);
  }

  function seat(room, token, name, socketId) {
    const level = botTokens.get(token) ?? null;
    botTokens.delete(token);
    const player = {
      id: randomUUID().slice(0, 8), token, name: cleanName(name), socketId,
      left: false, state: null, seq: 0, ready: false, bot: level, chatTimes: [], awaySince: null,
    };
    room.players.push(player);
    seats.set(token, { room, player });
    say(room, null, `${level ? '🤖 ' : ''}${player.name} joined${level ? ` (${BOT_LEVELS[level].label} bot)` : ''}.`);
    return player;
  }

  /** The pick for the round, once everyone who has to choose has chosen. */
  function decidePick(room) {
    const { pickerId, votes } = room.pick;
    if (pickerId) {
      const choice = votes[pickerId];
      if (!choice) return null;
      const picker = room.players.find((p) => p.id === pickerId);
      return { choice, note: `chosen by ${picker?.name ?? 'the loser'} (lost the last round)` };
    }
    const choices = active(room).map((p) => [p, votes[p.id]]);
    if (choices.some(([, c]) => !c)) return null;
    const same = choices.every(([, c]) => c.mode === choices[0][1].mode && c.category === choices[0][1].category);
    if (same) return { choice: choices[0][1], note: 'everyone voted for it' };
    const [p, c] = randomOf(choices);
    return { choice: c, note: `${p.name}'s vote won the coin flip` };
  }

  /** Starts the round if every player is ready and the pick is decided. */
  function maybeStart(room) {
    if (room.status !== 'lobby') return;
    const players = active(room);
    if (players.length < 2 || players.some((p) => !p.ready)) return;
    const decided = decidePick(room);
    if (!decided) return;
    const settled = settlePick(room.config, decided.choice);
    const questions = settled.category ? roundQuestions(room.config, settled) : [];
    if (questions.length === 0) {
      say(room, null, 'No questions match those settings. Pick something else.');
      resetPick(room);
      return;
    }
    room.players = players;
    const now = Date.now();
    room.startsAt = now + countdownMs;
    room.round += 1;
    const config = { ...room.config, mode: settled.mode, category: settled.category };
    for (const p of room.players) p.state = createSession({ config, questions, now: room.startsAt });
    room.roundInfo = { round: room.round, mode: settled.mode, category: settled.category, choice: decided.choice, note: decided.note };
    room.status = 'playing';
    say(room, null, `Round ${room.round}: ${MODE_LABELS[settled.mode]} · ${CATEGORIES[settled.category].label}, ${questions.length} question${questions.length === 1 ? '' : 's'} — ${decided.note}${decided.choice.mode === 'random' || decided.choice.category === 'random' ? ' (random)' : ''}.`);
  }

  function selfUrl() {
    const a = httpServer.address();
    if (!a || typeof a === 'string') return null;
    const host = a.address === '::' || a.address === '0.0.0.0' ? '127.0.0.1'
      : a.family === 'IPv6' || a.family === 6 ? `[${a.address}]` : a.address;
    return `http://${host}:${a.port}`;
  }

  // Behind Render's proxy the client's address is the first X-Forwarded-For entry.
  const ipOf = (socket) => String(socket.handshake.headers['x-forwarded-for'] ?? '').split(',')[0].trim() ||
    socket.handshake.address;

  io.on('connection', (socket) => {
    const raw = socket.handshake.auth?.token;
    const token = typeof raw === 'string' && raw.length >= 16 ? raw.slice(0, 64) : null;
    const ip = ipOf(socket);
    const open = socketsPerIp.get(ip) ?? 0;
    if (!token || open >= maxSocketsPerIp) {
      socket.disconnect(true);
      return;
    }
    socketsPerIp.set(ip, open + 1);
    socket.on('disconnect', () => {
      const n = (socketsPerIp.get(ip) ?? 1) - 1;
      if (n > 0) socketsPerIp.set(ip, n);
      else socketsPerIp.delete(ip);
    });

    // Drop events beyond a generous rate (a normal client sends a few per second at most).
    let windowStart = Date.now();
    let events = 0;
    socket.use((packet, next) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        events = 0;
      }
      events += 1;
      if (events <= EVENTS_PER_SECOND) next();
    });

    // Rejoin the seat this token holds, if any.
    const existing = seats.get(token);
    if (existing) {
      const { room, player } = existing;
      // The same seat open somewhere else (e.g. a duplicated tab): that one is closed.
      const old = player.socketId && io.sockets.sockets.get(player.socketId);
      if (old && old.id !== socket.id) {
        old.emit('duel:replaced');
        old.disconnect(true);
      }
      player.socketId = socket.id;
      player.awaySince = null;
      room.emptySince = null;
      socket.emit('duel:chatlog', room.chat);
      broadcast(room);
    } else {
      socket.emit('duel:room', null);
    }

    const handle = (event, fn) => socket.on(event, (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        reply(fn(msg ?? {}) ?? { ok: true });
      } catch (err) {
        log(`[duel] ${event} failed:`, err);
        reply({ error: 'Something went wrong on the server.' });
      }
    });
    const mine = () => seats.get(token);
    const hostLobby = () => {
      const s = mine();
      return s && s.room.hostId === s.player.id && s.room.status === 'lobby' ? s : null;
    };
    const joined = (room) => {
      socket.emit('duel:chatlog', room.chat);
      broadcast(room);
      return { ok: true, code: room.code };
    };

    handle('duel:create', ({ name, config }) => {
      const cfg = validConfig(config);
      if (!cfg) return { error: 'Those settings are not valid.' };
      if (rooms.size >= maxRooms) return { error: 'The server is full right now. Try again in a few minutes.' };
      leave(token);
      const room = {
        code: newCode(), config: cfg, players: [], hostId: null, status: 'lobby', round: 0, emptySince: null,
        wins: {}, draws: 0, lastWinnerId: null, roundInfo: null, startsAt: null, chat: [], pick: null,
      };
      rooms.set(room.code, room);
      room.hostId = seat(room, token, name, socket.id).id;
      resetPick(room);
      return joined(room);
    });

    handle('duel:join', ({ code, name }) => {
      const room = rooms.get(String(code ?? '').trim().toUpperCase());
      if (!room) return { error: 'No room with that code.' };
      if (mine()?.room === room) return joined(room);
      if (room.status !== 'lobby') return { error: 'That room is in the middle of a round. Try again when it is back in the lobby.' };
      if (active(room).length >= MAX_PLAYERS) return { error: 'That room is full.' };
      leave(token);
      seat(room, token, name, socket.id);
      room.emptySince = null;
      resetPick(room);
      return joined(room);
    });

    handle('duel:leave', () => {
      leave(token);
      socket.emit('duel:room', null);
    });

    handle('duel:config', ({ config }) => {
      const s = hostLobby();
      const cfg = validConfig(config);
      if (!s || !cfg) return { error: 'Only the host can change the settings, in the lobby.' };
      s.room.config = cfg;
      for (const p of s.room.players) p.ready = false;
      broadcast(s.room);
      return null;
    });

    handle('duel:pick', (pick) => {
      const s = mine();
      const choice = validPick(pick);
      if (!s || s.room.status !== 'lobby' || !choice) return { error: 'You cannot pick now.' };
      const { pickerId } = s.room.pick;
      if (pickerId && pickerId !== s.player.id) {
        const picker = s.room.players.find((p) => p.id === pickerId);
        return { error: `${picker?.name ?? 'The other player'} chooses this round.` };
      }
      s.room.pick.votes[s.player.id] = choice;
      if (pickerId) say(s.room, null, `${s.player.name} picked ${describePick(choice)}.`);
      maybeStart(s.room);
      broadcast(s.room);
      return null;
    });

    handle('duel:ready', ({ ready }) => {
      const s = mine();
      if (!s || s.room.status !== 'lobby') return { error: 'There is no round to get ready for.' };
      s.player.ready = ready !== false;
      maybeStart(s.room);
      broadcast(s.room);
      return null;
    });

    handle('duel:next', () => {
      const s = mine();
      if (!s || s.room.status !== 'finished') return { error: 'The round is not over yet.' };
      s.room.status = 'lobby';
      s.room.players = humans(s.room).length ? active(s.room) : [];
      for (const p of s.room.players) p.state = null;
      resetPick(s.room);
      broadcast(s.room);
      return null;
    });

    handle('duel:addBot', ({ level }) => {
      const s = hostLobby();
      if (!s) return { error: 'Only the host can add a bot, in the lobby.' };
      if (!has(BOT_LEVELS, level)) return { error: 'Unknown bot level.' };
      if (active(s.room).length >= MAX_PLAYERS) return { error: 'The room is full.' };
      const url = selfUrl();
      if (!url) return { error: 'The server is not listening yet.' };
      const botToken = randomBytes(16).toString('hex');
      botTokens.set(botToken, level);
      const bot = startBot({ url, code: s.room.code, token: botToken, level, speed: botSpeed, log });
      bots.add(bot);
      bot.done.finally(() => {
        bots.delete(bot);
        botTokens.delete(botToken);
      });
      return null;
    });

    handle('duel:removeBot', ({ id }) => {
      const s = hostLobby();
      const bot = s?.room.players.find((p) => p.id === id && p.bot);
      if (!bot) return { error: 'No such bot.' };
      if (bot.socketId) io.sockets.sockets.get(bot.socketId)?.disconnect(true);
      leave(bot.token);
      return null;
    });

    socket.on('duel:chat', (msg) => guard('duel:chat', () => {
      const s = mine();
      const text = String(msg?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
      if (!s || !text) return;
      const now = Date.now();
      s.player.chatTimes = s.player.chatTimes.filter((t) => now - t < CHAT_BURST.perMs);
      if (s.player.chatTimes.length >= CHAT_BURST.messages) return;
      s.player.chatTimes.push(now);
      say(s.room, s.player, text);
    }));

    socket.on('duel:action', (msg) => guard('duel:action', () => {
      const s = mine();
      if (!s) return;
      // The client numbers its actions and trusts our state again once we echo its number.
      if (Number.isInteger(msg?.seq)) s.player.seq = msg.seq;
      const echo = () => socket.emit('duel:room', snapshot(s.room, s.player));
      const now = Date.now();
      if (s.room.status !== 'playing' || !s.player.state || !ACTIONS.includes(msg?.type) ||
        (s.room.startsAt && now < s.room.startsAt)) return echo();
      const action = { type: msg.type, now };
      if (msg.type === 'submitResult' || msg.type === 'testRun') {
        action.result = cleanResult(msg.type, msg.result, s.player.state);
        if (!action.result) return echo();
      }
      const next = reduce(s.player.state, action);
      if (next === s.player.state) return echo();
      s.player.state = next;
      updateFinished(s.room);
      broadcast(s.room);
      return undefined;
    }));

    socket.on('disconnect', () => guard('disconnect', () => {
      const s = mine();
      if (!s || s.player.socketId !== socket.id) return;
      s.player.socketId = null;
      s.player.awaySince = Date.now();
      broadcast(s.room);
    }));
  });

  /** One clock step for a room: emptiness, players away too long, time limits. */
  function tickRoom(room, now) {
    // A room with no human connected is deleted after a while.
    if (humans(room).some((p) => p.socketId)) room.emptySince = null;
    else room.emptySince ??= now;
    if (now - (room.emptySince ?? now) > EMPTY_ROOM_TTL_MS) {
      deleteRoom(room);
      return;
    }
    // Someone gone too long leaves, so the others are not stuck waiting (in the lobby
    // or mid-round). Between rounds there is nothing to wait for.
    if (room.status !== 'finished') {
      for (const p of humans(room)) {
        if (!p.socketId && p.awaySince !== null && now - p.awaySince > disconnectGraceMs) {
          leave(p.token, 'was disconnected for too long and left');
          if (!rooms.has(room.code)) return;
        }
      }
    }
    if (room.status !== 'playing') return;
    let changed = false;
    if (room.startsAt && now >= room.startsAt) {
      room.startsAt = null;
      changed = true;
    }
    for (const p of active(room)) {
      const next = reduce(p.state, { type: 'tick', now });
      if (next !== p.state) {
        p.state = next;
        changed = true;
      }
    }
    if (changed) {
      updateFinished(room);
      broadcast(room);
    }
  }

  // The clock: end questions whose time is up, and drop rooms nobody is in.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const room of [...rooms.values()]) guard(`room ${room.code}`, () => tickRoom(room, now));
  }, TICK_MS);
  timer.unref?.();

  return {
    io,
    rooms,
    /** A system message in every room (e.g. before the server restarts). */
    announce: (text) => rooms.forEach((room) => guard('announce', () => say(room, null, text))),
    close: () => {
      clearInterval(timer);
      for (const bot of bots) bot.stop();
      return io.close();
    },
  };
}
