// Duel rooms over Socket.IO. The server is the referee: it picks the questions,
// keeps every side's round state and owns the clock. Code still runs in each
// player's browser and the server trusts the test results they report, which is
// fine for playing friends.
//
// A room plays a match of rounds. Before each round the players choose a mode and a
// topic: the first round (and any round after a draw) is a vote, decided by a coin
// flip if the votes differ; after that the last-placed side chooses. When everyone
// is ready the round starts after a short countdown.
//
// A round has one clock (the host sets its length) and every question is open at
// once (src/state/round.js). Players play for a side: on their own, or in a team
// (red, green or blue) that shares one score, one state and one live editor per
// question (server/collab.js). The host also chooses whether secret tests passed
// earn points without a solve, and whether (and at what cost) a failed secret test
// can be revealed. Everyone sees the host's settings.
//
// Client -> server (with an ack callback, except duel:action, duel:chat, duel:view,
// duel:code, duel:progress and team:cursor):
//   duel:create { name, config }  duel:join { code, name }  duel:leave
//   duel:config { config }        (host, lobby: language, difficulty, questions, minutes, options)
//   duel:pick { mode, category }  ('random' allowed for both)
//   duel:start { pick? }          (host, lobby: start now, without waiting for everyone to be ready;
//                                  pick is the host's vote if they have not cast one)
//   duel:team { team, playerId? } (lobby: your team, or a bot's if you are the host; null = on your own)
//   duel:ready { ready }          duel:next (after a round: back to the lobby)
//   duel:addBot { level }         duel:removeBot { id }   (host, lobby)
//   duel:action { type, result?, seq }  (round actions testRun / submitResult / reveal / finish)
//   duel:chat { text, team? }     (team: only your teammates see it)
//   duel:voice { audio, seconds, team? }  (a voice message: WebM, Ogg or MP4 audio, up to 15 seconds)
//   duel:view { questionId }      (the question you have open, for spectators and teammates)
//   duel:progress { questionId, lines }  (lines of code in the editor, sent every few seconds at most)
//   duel:code { questionId, code }       (your code, about once a second while it changes; not in a team)
//   team:open { questionId }             -> { version, doc }   (a team's shared document)
//   team:push { questionId, version, updates } -> { ok } | { stale, from, updates } | { resync }
//   team:pull { questionId, version }    -> { from, updates } | { resync }
//   team:cursor { questionId, pos }
// Server -> client:
//   duel:room     snapshot for this player, or null when they are not in a room
//   duel:chat     one new chat message;  duel:chatlog  the whole log (on joining)
//                 (a voice message has voice: { mime, seconds, audio }; audio is null once
//                 it is older than the room's last few clips)
//   duel:watch    { playerId, questionId, locked, code }: an opponent's code to spectate
//   team:updates  { questionId, from, updates }: teammates' edits
//   team:cursor   { playerId, name, team, questionId, pos }
//
// Spectating: a player sees an opponent's code for a question only once their own
// side has solved it, or their side's round is over. Until then they get it
// scrambled: the same lines, indentation and lengths, so they can watch the
// opponent type, but every other character replaced. The real code never reaches
// a player who is locked out.
//
// Players are identified by a token the client keeps in sessionStorage, so a
// reload or a dropped connection rejoins the same seat. A player who stays
// disconnected for too long (disconnectGraceMs) leaves the room, so a closed tab
// never holds up the others.
//
// Hardening for a public server: small messages only, a per-socket event rate
// limit, a cap on connections per IP and on rooms, same-origin browsers only,
// and reported test counts must match the question.
//
// Solves are spot-checked: in Python §3 / §4 a submit that claims to pass every test
// must include the code, and the server re-runs a few of the tests (server/verify.js).
// A side's actions are handled one at a time, and its clock waits while code is
// being checked, so the check never costs time.
import { Server } from 'socket.io';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRound, reduceRound, questionIndex, rankSides, ROUND_MINUTES, REVEAL_COSTS, DEFAULT_ROUND } from '../src/state/round.js';
import { LANG_LABELS, MODE_LABELS, DIFFICULTY_LABELS, CATEGORIES, filterQuestions, getQuestion } from '../src/questions/index.js';
import { resolveTests, findBanned, linesChanged, startingCode } from '../src/judge/resolve.js';
import { createVerifier, VERIFY_LANGS } from './verify.js';
import { createDoc, docString, docVersion, pushUpdates, updatesSince } from './collab.js';
import { pickQuestions } from '../src/questions/pick.js';
import { startBot, BOT_LEVELS } from './bot.js';
import { attachAdmin } from './admin.js';
import { createSolutionStore } from './solutions.js';

export const MAX_PLAYERS = 6;
export const TEAMS = ['red', 'green', 'blue'];
const COUNTS = [1, 3, 5, 10];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const TICK_MS = 250;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const COUNTDOWN_MS = 3000;
const CHAT_KEEP = 100;
const CHAT_MAX_LENGTH = 200;
const CHAT_BURST = { messages: 5, perMs: 5000 };
const VOICE_MAX_SECONDS = 15;
const VOICE_MAX_BYTES = 96 * 1024;
const VOICE_BURST = { messages: 3, perMs: 30_000 };
const VOICE_KEEP = 10; // clips a room keeps the audio of (older ones stay in the log as expired)
const DISCONNECT_GRACE_MS = 60 * 1000;
const MAX_ROOMS = 1000;
const MAX_SOCKETS_PER_IP = 20;
const EVENTS_PER_SECOND = 20;
const PROGRESS_MIN_MS = 3000; // line counts update at most this often per player
const CODE_MIN_MS = 500; // spectated code updates at most this often per player
const WATCH_EVERY_MS = 300; // spectators get code at most this often
const MAX_MESSAGE_BYTES = 128 * 1024; // room for a voice message
const MAX_CODE_CHARS = 20_000;
const VERIFY_TESTS = 2; // tests re-run per checked solve
const ACTIONS = ['testRun', 'submitResult', 'reveal', 'finish'];
const MODES = Object.keys(MODE_LABELS);

// Stand-ins for the characters of code a spectator may not see yet.
const SCRAMBLE_GLYPHS = 'abcdefghijklmnopqrstuvwxyz0123456789_=+-*/<>()[]{}:;.,#@$%&!?';

/** A 32-bit hash of (salt, line, column), so a glyph depends on where it is and never on what it hides. */
function glyphHash(salt, line, col) {
  let x = salt ^ Math.imul(line + 1, 0x9e3779b1) ^ Math.imul(col + 1, 0x85ebca77);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return x >>> 0;
}

/**
 * Code with every non-space character replaced by a glyph chosen by its position.
 * Lines, indentation and lengths stay, so typing shows, but nothing of the text does.
 * A position keeps its glyph while the player types elsewhere.
 */
export function scramble(code, salt) {
  return code.split('\n').map((line, l) => Array.from(line, (ch, c) => (/\s/.test(ch) ? ch
    : SCRAMBLE_GLYPHS[glyphHash(salt, l, c) % SCRAMBLE_GLYPHS.length])).join('')).join('\n');
}

const RANDOM_PICK = { mode: 'random', category: 'random' };

/** The audio type of a voice clip, read from its first bytes (never from what the client says), or null. */
export function audioType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return 'audio/webm';
  if (buf.toString('latin1', 0, 4) === 'OggS') return 'audio/ogg';
  if (buf.toString('latin1', 4, 8) === 'ftyp') return 'audio/mp4';
  return null;
}

/** Records a message sent at `now` in `times`, unless the burst is used up. */
function withinBurst(times, burst, now) {
  const recent = times.filter((t) => now - t < burst.perMs);
  times.splice(0, times.length, ...recent);
  if (recent.length >= burst.messages) return false;
  times.push(now);
  return true;
}

const has = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);
const randomOf = (xs) => xs[Math.floor(Math.random() * xs.length)];
const newSalt = () => randomBytes(4).readUInt32LE(0);

/**
 * Room settings: { lang, difficulty, count, minutes, partial, revealCost }. The mode
 * and topic are chosen per round. Missing round options take their defaults.
 */
export function validConfig(c) {
  if (!c || !has(LANG_LABELS, c.lang) || !has(DIFFICULTY_LABELS, c.difficulty) || !COUNTS.includes(c.count)) return null;
  const minutes = c.minutes === undefined ? DEFAULT_ROUND.minutes : c.minutes;
  const revealCost = c.revealCost === undefined ? DEFAULT_ROUND.revealCost : c.revealCost;
  if (!ROUND_MINUTES.includes(minutes) || !REVEAL_COSTS.includes(revealCost)) return null;
  return { lang: c.lang, difficulty: c.difficulty, count: c.count, minutes, partial: c.partial === true, revealCost };
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
const capital = (s) => s[0].toUpperCase() + s.slice(1);

// How many tests a question has in a language: { visible, total, hidden: Set of secret indexes }.
const testCounts = new Map();
function testsFor(questionId, lang) {
  const key = `${questionId}|${lang}`;
  if (!testCounts.has(key)) {
    const q = getQuestion(questionId);
    const tests = q ? resolveTests(q, lang) : [];
    testCounts.set(key, {
      visible: tests.filter((t) => !t.hidden).length,
      total: tests.length,
      hidden: new Set(tests.filter((t) => t.hidden).map((t) => t.index)),
    });
  }
  return testCounts.get(key);
}

/** A reported result, or null if it cannot be right for a question of the round. */
function cleanResult(type, r, state) {
  if (!r || typeof r.questionId !== 'string' || questionIndex(state, r.questionId) < 0) return null;
  const expected = testsFor(r.questionId, state.config.lang);
  if (type === 'reveal') return expected.hidden.has(r.testIndex) ? { questionId: r.questionId, testIndex: r.testIndex } : null;
  const total = count(r.total);
  // The browser runs the tests, but it cannot make up how many there are.
  if (total !== (type === 'testRun' ? expected.visible : expected.total)) return null;
  if (type === 'testRun') return { questionId: r.questionId, passed: Math.min(count(r.passed), total), total };
  const totalHidden = expected.total - expected.visible;
  const passedVisible = Math.min(count(r.passedVisible), expected.visible);
  const passedHidden = Math.min(count(r.passedHidden), totalHidden);
  const out = { questionId: r.questionId, passedVisible, passedHidden, total, totalHidden, timeMs: count(r.timeMs) };
  if (Number.isInteger(r.linesChanged)) out.linesChanged = count(r.linesChanged);
  return out;
}

const claimsSolve = (r) => r.total > 0 && r.passedVisible + r.passedHidden === r.total;

/** Up to n tests to re-run: secret tests first (in random order), then visible ones. */
function sampleTests(tests, n) {
  const shuffle = (xs) => xs.map((t) => [Math.random(), t]).sort((a, b) => a[0] - b[0]).map(([, t]) => t);
  return [...shuffle(tests.filter((t) => t.hidden)), ...shuffle(tests.filter((t) => !t.hidden))].slice(0, n);
}

/** The reported result turned into a failed submit with `failed` tests not passing. */
function asFailed(r, failed) {
  const passed = Math.max(0, r.total - failed);
  const passedVisible = Math.min(r.passedVisible, passed);
  return { ...r, passedVisible, passedHidden: passed - passedVisible };
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
  verifier = createVerifier(),
  admin: adminOptions = {},
  solutions = createSolutionStore({ log }),
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
  const byId = (room, id) => room.players.find((p) => p.id === id);
  const sideOf = (room, p) => room.sides.find((s) => s.memberIds.includes(p.id)) ?? null;
  const members = (room, side) => side.memberIds.map((id) => byId(room, id)).filter(Boolean);
  /** Sides that still have someone playing. */
  const liveSides = (room) => room.sides.filter((s) => members(room, s).some((p) => !p.left));
  const sideName = (room, side) => (side.team ? `${capital(side.team)} team` : members(room, side)[0]?.name ?? 'Someone');

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
      lastWinnerId: room.lastWinnerId, // a player on the side that won the last round
      lastWinnerSide: room.lastWinnerSide,
      startsAt: room.startsAt,
      youId: me.id,
      yourSeq: me.seq, // the last of your actions the server has applied
      hostId: room.hostId,
      maxPlayers: MAX_PLAYERS,
      teams: TEAMS,
      serverNow: Date.now(),
      sides: room.sides.map((s) => ({ key: s.key, team: s.team, memberIds: s.memberIds, name: sideName(room, s) })),
      players: room.players.map((p) => {
        const side = sideOf(room, p);
        return {
          id: p.id,
          name: p.name,
          bot: p.bot,
          team: p.team,
          side: side?.key ?? null,
          connected: p.socketId !== null,
          left: p.left,
          ready: p.ready,
          state: side?.state ?? null, // the side's state: teammates share one
          viewing: p.viewing, // the question they have open
          progress: p.progress, // { questionId, lines } for the question they have open
        };
      }),
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
    pushWatch(room);
  }

  // ---------------------------------------------------------------- spectating

  /** May `viewer` read the code of question `questionId`? Once their side solved it, or their round is over. */
  function canSee(room, viewer, questionId) {
    if (room.status === 'finished') return true;
    const state = sideOf(room, viewer)?.state;
    if (!state) return false;
    if (state.status === 'finished') return true;
    return state.qs[questionIndex(state, questionId)]?.status === 'solved';
  }

  /** The question a player has open (their first question until they say otherwise). */
  function viewingOf(side, p) {
    return p.viewing && questionIndex(side.state, p.viewing) >= 0 ? p.viewing : side.state.questions[0].id;
  }

  /** p's code for a question: the team's shared document, or what p last sent. -> { text, scrambled } | null */
  function codeOf(side, p, questionId) {
    if (side.team) {
      const doc = side.docs.get(questionId);
      if (!doc) return null;
      const text = docString(doc);
      if (doc.scrambledFrom !== text) {
        doc.scrambledFrom = text;
        doc.scrambled = scramble(text, doc.salt);
      }
      return { text, scrambled: doc.scrambled };
    }
    return p.code?.questionId === questionId ? p.code : null;
  }

  /** What `viewer` sees of `p`'s code: for the question p has open, real or scrambled. */
  function watchOf(room, viewer, p) {
    const side = sideOf(room, p);
    const questionId = viewingOf(side, p);
    const locked = !canSee(room, viewer, questionId);
    const c = codeOf(side, p, questionId);
    return { playerId: p.id, questionId, locked, code: c ? (locked ? c.scrambled : c.text) : null };
  }

  /** Sends every human their opponents' code, when what they would see has changed. */
  function pushWatch(room) {
    clearTimeout(room.watchTimer);
    room.watchTimer = null;
    if (room.status === 'lobby') return;
    for (const viewer of room.players) {
      if (!viewer.socketId || viewer.bot) continue;
      const mySide = sideOf(room, viewer);
      for (const p of room.players) {
        const side = sideOf(room, p);
        if (p === viewer || !side || side === mySide) continue;
        const w = watchOf(room, viewer, p);
        const key = `${w.questionId}|${w.locked}|${w.code}`;
        if (viewer.watchSent.get(p.id) === key) continue;
        viewer.watchSent.set(p.id, key);
        io.to(viewer.socketId).emit('duel:watch', w);
      }
    }
  }

  /** pushWatch soon, at most every WATCH_EVERY_MS (code changes arrive in bursts). */
  function scheduleWatch(room) {
    room.watchTimer ??= setTimeout(() => guard('watch', () => pushWatch(room)), WATCH_EVERY_MS);
  }

  // ---------------------------------------------------------------- chat

  /** Who may read a message: everyone, or the teammates it is for. */
  const canRead = (p, msg) => !msg.team || p.team === msg.team;

  function say(room, from, text, team = null, voice = null) {
    const msg = {
      id: randomUUID().slice(0, 8),
      at: Date.now(),
      fromId: from?.id ?? null,
      name: from?.name ?? null,
      bot: from?.bot ?? null,
      team, // a team-only message
      text,
    };
    if (voice) msg.voice = voice; // { mime, seconds, audio }
    room.chat.push(msg);
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    // Only the last few clips keep their audio, so a room's log stays small.
    if (voice) {
      for (const m of room.chat.filter((x) => x.voice?.audio).slice(0, -VOICE_KEEP)) m.voice = { ...m.voice, audio: null };
    }
    for (const p of room.players) if (p.socketId && canRead(p, msg)) io.to(p.socketId).emit('duel:chat', msg);
  }

  const chatlogFor = (room, p) => room.chat.filter((m) => canRead(p, m));

  function deleteRoom(room) {
    rooms.delete(room.code);
    clearTimeout(room.watchTimer);
    for (const p of room.players) {
      seats.delete(p.token);
      if (p.bot && p.socketId) io.sockets.sockets.get(p.socketId)?.disconnect(true);
    }
  }

  /** Who picks the next round: the last-placed side of the last one, or a vote after a draw / at the start. */
  function resetPick(room) {
    const loser = room.lastLoserId ? active(room).find((p) => p.id === room.lastLoserId) : null;
    room.pick = loser
      ? { pickerId: loser.id, votes: {}, reason: 'loser' }
      : { pickerId: null, votes: {}, reason: room.round === 0 ? 'first' : 'draw' };
    for (const p of room.players) p.ready = false;
  }

  function finishRound(room) {
    room.status = 'finished';
    room.startsAt = null;
    const ranked = rankSides(liveSides(room));
    const winner = ranked.length && ranked.filter((s) => s.rank === 1).length === 1 ? ranked[0] : null;
    room.lastWinnerSide = winner?.key ?? null;
    room.lastWinnerId = winner ? winner.memberIds[0] : null;
    if (winner) for (const id of winner.memberIds) room.wins[id] = (room.wins[id] ?? 0) + 1;
    else room.draws += 1;
    // The last side (if a single one) chooses next; pick a member still in the room.
    const lastRank = ranked.at(-1)?.rank;
    const last = winner && ranked.length > 1 && ranked.filter((s) => s.rank === lastRank).length === 1 ? ranked.at(-1) : null;
    const stay = last ? members(room, last).filter((p) => !p.left) : [];
    room.lastLoserId = (stay.find((p) => !p.bot) ?? stay[0])?.id ?? null;
    const totals = ranked.map((s) => `${sideName(room, s)} ${s.state.total}`).join(' – ');
    const match = active(room).map((p) => `${p.name} ${room.wins[p.id] ?? 0}`).join(' – ');
    say(room, null, `${winner ? `🏆 ${sideName(room, winner)} wins round ${room.round}` : `🤝 Round ${room.round} is a draw`} (${totals}). Match: ${match}${room.draws ? `, ${room.draws} draw${room.draws === 1 ? '' : 's'}` : ''}.`);
  }

  function updateFinished(room) {
    if (room.status === 'playing' && liveSides(room).every((s) => s.state.status === 'finished')) finishRound(room);
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
    say(room, null, `${player.name} ${why}.`);
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
      left: false, seq: 0, ready: false, bot: level, chatTimes: [], voiceTimes: [], awaySince: null,
      actions: Promise.resolve(), team: null, viewing: null, progress: null, progressAt: 0,
      code: null, codeAt: 0, watchSent: new Map(),
    };
    room.players.push(player);
    seats.set(token, { room, player });
    say(room, null, `${player.name} joined${level ? ` (${BOT_LEVELS[level].label} bot)` : ''}.`);
    return player;
  }

  /**
   * The pick for the round, once everyone who has to choose has chosen. With force
   * (the host starting early) it settles for what has been chosen so far: the votes
   * cast, or random when there are none.
   */
  function decidePick(room, { force = false } = {}) {
    const { pickerId, votes } = room.pick;
    if (pickerId) {
      const choice = votes[pickerId];
      const picker = byId(room, pickerId);
      if (choice) return { choice, note: `chosen by ${picker?.name ?? 'last place'} (last place in the last round)` };
      return force ? { choice: RANDOM_PICK, note: `random, as ${picker?.name ?? 'last place'} had not chosen yet` } : null;
    }
    const choices = active(room).map((p) => [p, votes[p.id]]);
    if (!force && choices.some(([, c]) => !c)) return null;
    const cast = choices.filter(([, c]) => c);
    if (cast.length === 0) return { choice: RANDOM_PICK, note: 'random, as nobody had voted' };
    const same = cast.every(([, c]) => c.mode === cast[0][1].mode && c.category === cast[0][1].category);
    if (same && cast.length === choices.length) return { choice: cast[0][1], note: 'everyone voted for it' };
    if (same) return { choice: cast[0][1], note: cast.length === 1 ? `${cast[0][0].name}'s vote, the only one cast` : 'everyone who voted chose it' };
    const [p, c] = randomOf(cast);
    return { choice: c, note: `${p.name}'s vote won the coin flip` };
  }

  /** Players grouped into sides: a team colour, or a player on their own. */
  function makeSides(players, config, questions, now) {
    const sides = new Map();
    for (const p of players) {
      const key = p.team ? `team:${p.team}` : `p:${p.id}`;
      if (!sides.has(key)) {
        sides.set(key, {
          key, team: p.team, memberIds: [], state: createRound({ config, questions, now }),
          docs: new Map(), checking: 0, actions: Promise.resolve(),
        });
      }
      sides.get(key).memberIds.push(p.id);
    }
    return [...sides.values()];
  }

  /** Starts the round if every player is ready and the pick is decided. */
  function maybeStart(room) {
    if (room.status !== 'lobby') return;
    const players = active(room);
    if (players.length < 2 || players.some((p) => !p.ready)) return;
    const decided = decidePick(room);
    if (decided) startRound(room, decided);
  }

  /** Starts a round with the pick decided (the countdown first). Returns false if no questions match. */
  function startRound(room, decided) {
    const players = active(room);
    const settled = settlePick(room.config, decided.choice);
    const questions = settled.category ? roundQuestions(room.config, settled) : [];
    if (questions.length === 0) {
      say(room, null, 'No questions match those settings. Pick something else.');
      resetPick(room);
      return false;
    }
    room.players = players;
    room.startsAt = Date.now() + countdownMs;
    room.round += 1;
    const config = { ...room.config, mode: settled.mode, category: settled.category };
    room.sides = makeSides(players, config, questions, room.startsAt);
    for (const p of players) {
      p.code = null;
      p.viewing = null;
      p.progress = null;
      p.watchSent.clear();
    }
    room.roundInfo = { round: room.round, mode: settled.mode, category: settled.category, choice: decided.choice, note: decided.note };
    room.status = 'playing';
    const teams = room.sides.filter((s) => s.memberIds.length > 1).map((s) => sideName(room, s));
    say(room, null, `Round ${room.round}: ${MODE_LABELS[settled.mode]} · ${CATEGORIES[settled.category].label}, ${questions.length} question${questions.length === 1 ? '' : 's'} in ${room.config.minutes} minutes — ${decided.note}${decided.choice.mode === 'random' || decided.choice.category === 'random' ? ' (random)' : ''}.${teams.length ? ` Teams: ${teams.join(', ')}.` : ''}`);
    return true;
  }

  /**
   * Checks a submit that claims a solve. Returns { result, message } where result
   * may have been turned into a failed submit and message says why.
   */
  async function checkSubmit(state, result, code) {
    const lang = state.config.lang;
    const q = getQuestion(result.questionId);
    const out = { result, message: null };
    const usable = typeof code === 'string' && code.length <= MAX_CODE_CHARS;
    // Bug Hunt edits are counted from the code itself when we have it.
    if (usable && q.mode === 'bug-hunt') out.result = { ...result, linesChanged: linesChanged(startingCode(q, lang), code) };
    if (!claimsSolve(result)) return out;
    const fail = (message, failed = 1) => ({ result: asFailed(out.result, failed), message });
    if (!usable) {
      return VERIFY_LANGS.includes(lang) ? fail('The server did not receive your code, so the solve could not be checked. Submit again.') : out;
    }
    const banned = findBanned(q, lang, code);
    if (banned) return fail(`You can't use ${banned} in this question.`);
    if (!VERIFY_LANGS.includes(lang)) return out;
    const tests = sampleTests(resolveTests(q, lang), VERIFY_TESTS);
    const checked = await verifier.run(lang === 'py4' ? 4 : 3, code, tests);
    if (!checked) return out; // the server is too busy to check: trust the browser
    if (checked.failure === 'memory') return fail('Your code used too much memory when the server re-ran it, so it counts as a wrong submit.');
    if (checked.failure === 'time') return fail('Your code took too long when the server re-ran it, so it counts as a wrong submit.');
    const failed = checked.results.filter((r) => r.status !== 'pass');
    if (failed.length === 0) return out;
    const slow = failed.some((r) => r.status === 'timeout');
    return fail(`The server re-ran your code on ${tests.length} test${tests.length === 1 ? '' : 's'} and ${failed.length} did not pass${slow ? ' (too slow)' : ''}, so it counts as a wrong submit.`, failed.length);
  }

  /** Handles one round action from a player (a side's actions run in order). */
  async function handleAction(token, socket, msg, now) {
    const s = seats.get(token);
    if (!s) return;
    const { room, player } = s;
    const side = sideOf(room, player);
    // The client numbers its actions and trusts our state again once we echo its
    // number, so the number is only recorded once the action has been applied (or
    // dropped), never while its code is still being checked.
    const handled = () => {
      if (Number.isInteger(msg?.seq)) player.seq = msg.seq;
    };
    const echo = () => {
      handled();
      socket.emit('duel:room', snapshot(room, player));
    };
    if (room.status !== 'playing' || !side || !ACTIONS.includes(msg?.type) ||
      (room.startsAt && now < room.startsAt)) return echo();
    const action = { type: msg.type, now };
    if (msg.type !== 'finish') {
      action.result = cleanResult(msg.type, msg.result, side.state);
      if (!action.result) return echo();
    }
    const before = side.state;
    if (msg.type === 'submitResult') {
      side.checking += 1; // the clock waits for the check
      let checked;
      try {
        checked = await checkSubmit(side.state, action.result, msg.result.code);
      } finally {
        side.checking -= 1;
      }
      // The room may have moved on while the code ran (a leave, the round ending).
      if (seats.get(token)?.player !== player || !room.sides.includes(side) || side.state !== before) return echo();
      action.result = checked.result;
      if (checked.message) socket.emit('duel:verify', { questionId: action.result.questionId, message: checked.message });
    }
    const next = reduceRound(side.state, action);
    if (next === side.state) return echo();
    side.state = next;
    handled();
    if (msg.type === 'submitResult') {
      const i = questionIndex(next, action.result.questionId);
      const q = next.qs[i];
      if (q.status === 'solved' && before.qs[i].status !== 'solved') {
        if (side.team && side.memberIds.length > 1) say(room, null, `${player.name} solved ${getQuestion(q.questionId)?.title} for the team (+${q.points}).`, side.team);
        guard('save solution', () => solutions?.add({
          questionId: q.questionId,
          lang: next.config.lang,
          name: side.team ? `${player.name} (${capital(side.team)} team)` : player.name,
          kind: 'duel',
          room: room.code,
          points: q.points,
          timeMs: action.result.timeMs,
          code: msg.result.code,
        }));
      }
    }
    updateFinished(room);
    broadcast(room);
    return undefined;
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
      player.watchSent.clear(); // a new tab needs the opponents' code again
      room.emptySince = null;
      socket.emit('duel:chatlog', chatlogFor(room, player));
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
    const joined = (room, player) => {
      socket.emit('duel:chatlog', chatlogFor(room, player));
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
        wins: {}, draws: 0, lastWinnerId: null, lastWinnerSide: null, lastLoserId: null, roundInfo: null,
        startsAt: null, chat: [], pick: null, sides: [], watchTimer: null,
      };
      rooms.set(room.code, room);
      const player = seat(room, token, name, socket.id);
      room.hostId = player.id;
      resetPick(room);
      return joined(room, player);
    });

    handle('duel:join', ({ code, name }) => {
      const room = rooms.get(String(code ?? '').trim().toUpperCase());
      if (!room) return { error: 'No room with that code.' };
      if (mine()?.room === room) return joined(room, mine().player);
      if (room.status !== 'lobby') return { error: 'That room is in the middle of a round. Try again when it is back in the lobby.' };
      if (active(room).length >= MAX_PLAYERS) return { error: 'That room is full.' };
      leave(token);
      const player = seat(room, token, name, socket.id);
      room.emptySince = null;
      resetPick(room);
      return joined(room, player);
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
        const picker = byId(s.room, pickerId);
        return { error: `${picker?.name ?? 'The other player'} chooses this round.` };
      }
      s.room.pick.votes[s.player.id] = choice;
      if (pickerId) say(s.room, null, `${s.player.name} picked ${describePick(choice)}.`);
      maybeStart(s.room);
      broadcast(s.room);
      return null;
    });

    // The host starts the round now: nobody has to be ready, and a missing vote or
    // pick is settled (see decidePick).
    handle('duel:start', ({ pick }) => {
      const s = hostLobby();
      if (!s) return { error: 'Only the host can start the round, in the lobby.' };
      const { room, player } = s;
      if (active(room).length < 2) return { error: 'Wait for someone to join first.' };
      const choice = validPick(pick);
      const { pickerId, votes } = room.pick;
      if (choice && (!pickerId || pickerId === player.id) && !votes[player.id]) votes[player.id] = choice;
      const decided = decidePick(room, { force: true });
      if (active(room).some((p) => p !== player && !p.ready)) decided.note += `; ${player.name} (host) started it without waiting`;
      startRound(room, decided);
      broadcast(room);
      return null;
    });

    handle('duel:team', ({ team, playerId }) => {
      const s = mine();
      if (!s || s.room.status !== 'lobby') return { error: 'Teams are chosen in the lobby.' };
      const choice = team ?? null;
      if (choice !== null && !TEAMS.includes(choice)) return { error: 'Unknown team.' };
      // You set your own team; the host can also place bots.
      const target = playerId && playerId !== s.player.id ? byId(s.room, playerId) : s.player;
      if (!target || (target !== s.player && !(target.bot && s.room.hostId === s.player.id))) {
        return { error: 'You can only choose your own team.' };
      }
      if (target.team === choice) return null;
      target.team = choice;
      for (const p of s.room.players) p.ready = false;
      say(s.room, null, choice ? `${target.name} joined the ${capital(choice)} team.` : `${target.name} plays on their own.`);
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
      s.room.sides = [];
      for (const p of s.room.players) {
        p.code = null;
        p.viewing = null;
      }
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
      if (msg.team && !s.player.team) return;
      if (!withinBurst(s.player.chatTimes, CHAT_BURST, Date.now())) return;
      say(s.room, s.player, text, msg.team ? s.player.team : null);
    }));

    handle('duel:voice', ({ audio, seconds, team }) => {
      const s = mine();
      if (!s) return { error: 'You are not in a room.' };
      if (team && !s.player.team) return { error: 'You are not in a team.' };
      const mime = Buffer.isBuffer(audio) && audio.length <= VOICE_MAX_BYTES ? audioType(audio) : null;
      const length = Number(seconds);
      if (!mime || !(length > 0 && length <= VOICE_MAX_SECONDS + 1)) {
        return { error: `That voice message could not be sent. They can be up to ${VOICE_MAX_SECONDS} seconds long.` };
      }
      if (!withinBurst(s.player.voiceTimes, VOICE_BURST, Date.now())) return { error: 'Too many voice messages. Wait a few seconds.' };
      const voice = { mime, seconds: Math.round(Math.min(length, VOICE_MAX_SECONDS) * 10) / 10, audio };
      say(s.room, s.player, '', team ? s.player.team : null, voice);
      return null;
    });

    /** The seat and side for a round message about `questionId`, or null. */
    const inRound = (questionId) => {
      const s = mine();
      if (!s || s.room.status !== 'playing') return null;
      const side = sideOf(s.room, s.player);
      if (!side || typeof questionId !== 'string' || questionIndex(side.state, questionId) < 0) return null;
      return { ...s, side };
    };

    socket.on('duel:view', (msg) => guard('duel:view', () => {
      const s = inRound(msg?.questionId);
      if (!s || s.player.viewing === msg.questionId) return;
      s.player.viewing = msg.questionId;
      broadcast(s.room);
    }));

    // How many lines of code a player has on the question they have open. Clients
    // send it every few seconds at most; the server drops anything faster.
    socket.on('duel:progress', (msg) => guard('duel:progress', () => {
      const s = inRound(msg?.questionId);
      if (!s) return;
      const now = Date.now();
      if (now - s.player.progressAt < PROGRESS_MIN_MS) return;
      const lines = Math.min(999, Math.max(0, Math.trunc(Number(msg.lines)) || 0));
      if (s.player.progress?.questionId === msg.questionId && s.player.progress.lines === lines) return;
      s.player.progressAt = now;
      s.player.progress = { questionId: msg.questionId, lines };
      broadcast(s.room);
    }));

    // The code in a player's editor, for opponents to spectate (teams share a
    // document, which the server already has). At most about twice a second.
    socket.on('duel:code', (msg) => guard('duel:code', () => {
      const s = inRound(msg?.questionId);
      if (!s || s.side.team || s.side.state.status !== 'playing') return;
      if (typeof msg.code !== 'string' || msg.code.length > MAX_CODE_CHARS) return;
      const now = Date.now();
      if (now - s.player.codeAt < CODE_MIN_MS) return;
      s.player.codeAt = now;
      const prev = s.player.code;
      if (prev?.questionId === msg.questionId && prev.text === msg.code) return;
      // A fresh salt per question, so the scramble never lines up across questions.
      const salt = prev?.questionId === msg.questionId ? prev.salt : newSalt();
      s.player.code = { questionId: msg.questionId, text: msg.code, salt, scrambled: scramble(msg.code, salt) };
      scheduleWatch(s.room);
    }));

    // ---------------------------------------------------------------- team editors
    const teamDoc = (s, questionId) => {
      if (!s.side.docs.has(questionId)) {
        const doc = createDoc(startingCode(getQuestion(questionId), s.side.state.config.lang));
        doc.salt = newSalt();
        s.side.docs.set(questionId, doc);
      }
      return s.side.docs.get(questionId);
    };
    const inTeam = (questionId) => {
      const s = inRound(questionId);
      return s?.side.team ? s : null;
    };
    const fullDoc = (doc) => ({ version: docVersion(doc), doc: docString(doc) });

    handle('team:open', ({ questionId }) => {
      const s = inTeam(questionId);
      if (!s) return { error: 'You are not in a team.' };
      return fullDoc(teamDoc(s, questionId));
    });

    handle('team:pull', ({ questionId, version }) => {
      const s = inTeam(questionId);
      if (!s) return { error: 'You are not in a team.' };
      const doc = teamDoc(s, questionId);
      const updates = updatesSince(doc, version);
      return updates ? { from: version, updates } : { resync: fullDoc(doc) };
    });

    handle('team:push', ({ questionId, version, updates }) => {
      const s = inTeam(questionId);
      if (!s) return { error: 'You are not in a team.' };
      const doc = teamDoc(s, questionId);
      const r = pushUpdates(doc, version, updates, { maxLength: MAX_CODE_CHARS });
      if (r.stale) {
        const missed = updatesSince(doc, version);
        return missed ? { stale: true, from: version, updates: missed } : { resync: fullDoc(doc) };
      }
      if (r.error) return { resync: fullDoc(doc) };
      for (const p of members(s.room, s.side)) {
        if (p.socketId) io.to(p.socketId).emit('team:updates', { questionId, from: r.from, updates: r.updates });
      }
      scheduleWatch(s.room);
      return { ok: true };
    });

    socket.on('team:cursor', (msg) => guard('team:cursor', () => {
      const s = inTeam(msg?.questionId);
      if (!s || !Number.isInteger(msg.pos) || msg.pos < 0 || msg.pos > MAX_CODE_CHARS) return;
      const out = { playerId: s.player.id, name: s.player.name, team: s.side.team, questionId: msg.questionId, pos: msg.pos };
      for (const p of members(s.room, s.side)) {
        if (p !== s.player && p.socketId) io.to(p.socketId).emit('team:cursor', out);
      }
    }));

    socket.on('duel:action', (msg) => {
      const s = mine();
      if (!s) return;
      const now = Date.now(); // the action counts from when it arrived, not when its check ends
      // A side's actions run one at a time, whoever on the team sends them.
      const queue = sideOf(s.room, s.player) ?? s.player;
      queue.actions = queue.actions
        .then(() => handleAction(token, socket, msg, now))
        .catch((err) => log('[duel] duel:action failed:', err));
    });

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
    for (const side of room.sides) {
      if (side.checking) continue;
      const next = reduceRound(side.state, { type: 'tick', now });
      if (next !== side.state) {
        side.state = next;
        changed = true;
      }
    }
    if (changed) {
      updateFinished(room);
      broadcast(room);
    }
  }

  // ---------------------------------------------------------------- admin view

  /** Every room as the admin sees it: who is in it and how each is doing. */
  function adminRooms() {
    return [...rooms.values()].map((room) => ({
      code: room.code,
      status: room.status,
      round: room.round,
      config: room.config,
      roundInfo: room.roundInfo,
      players: room.players.map((p) => {
        const side = room.status === 'lobby' ? null : sideOf(room, p);
        const st = side?.state;
        const viewing = st ? viewingOf(side, p) : null;
        return {
          id: p.id,
          name: p.name,
          bot: p.bot,
          team: p.team,
          host: p.id === room.hostId,
          connected: p.socketId !== null,
          left: p.left,
          ready: p.ready,
          viewing,
          viewingTitle: viewing ? getQuestion(viewing)?.title ?? viewing : null,
          lines: p.progress?.questionId === viewing ? p.progress.lines : null,
          solved: st ? st.qs.filter((q) => q.status === 'solved').length : 0,
          count: st?.qs.length ?? 0,
          total: st?.total ?? 0,
          status: st?.status ?? null,
          endsAt: st?.endsAt ?? null,
        };
      }),
    }));
  }

  /** The code a duel player has open: { questionId, code } or null. */
  function adminCode(roomCode, playerId) {
    const room = rooms.get(roomCode);
    const p = room && byId(room, playerId);
    const side = p && room.status !== 'lobby' ? sideOf(room, p) : null;
    if (!side) return null;
    const questionId = viewingOf(side, p);
    return { questionId, code: codeOf(side, p, questionId)?.text ?? null };
  }

  const admin = attachAdmin(io, { log, solutions, ...adminOptions, duel: { rooms: adminRooms, code: adminCode } });

  // The clock: end rounds whose time is up, and drop rooms nobody is in.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const room of [...rooms.values()]) guard(`room ${room.code}`, () => tickRoom(room, now));
  }, TICK_MS);
  timer.unref?.();

  return {
    io,
    rooms,
    solos: admin.solos,
    /** A system message in every room (e.g. before the server restarts). */
    announce: (text) => rooms.forEach((room) => guard('announce', () => say(room, null, text))),
    close: () => {
      clearInterval(timer);
      admin.close();
      solutions?.close();
      for (const room of rooms.values()) clearTimeout(room.watchTimer);
      for (const bot of bots) bot.stop();
      verifier.close?.();
      return io.close();
    },
  };
}
