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
//   duel:grant { playerId, on }   (host, lobby: whether that player gets power-ups; everyone does by default)
//   duel:ready { ready }          duel:next (after a round: back to the lobby)
//   duel:addBot { level }         duel:removeBot { id }   (host, lobby)
//   duel:action { type, result?, seq }  (round actions testRun / submitResult / reveal / finish)
//   duel:chat { text, team? }     (team: only your teammates see it)
//   duel:voice { audio, seconds, team? }  (a voice message: WebM, Ogg or MP4 audio, up to 15 seconds)
//   duel:power { type: 'blackout' | 'wipe' }   (a power-up on every opponent)
//   duel:power { type: 'keyboard', targetId }  (mouse keys on one opponent)
//   duel:hint { questionId, kind: 'outline' | 'lines' } -> { ok, hint }
//   duel:extend { minutes }       ask everyone for more time;  duel:extendVote { yes }
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
//   duel:wipe     { questionId, code, by }: your code was wiped (players on their own; a
//                 team's wipe arrives as a change to its shared document)
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
// Power-ups (the host turns each on and sets how many uses everyone gets per round).
// Blackout and wipe hit every opponent at once:
//   blackout  their editors go dark for BLACKOUT_MS; then a cooldown of
//             BLACKOUT_COOLDOWN_MS before you can use it again. The server holds back
//             their runs and submits until it is over.
//   wipe      their code on the question each has open goes back to the start.
// Mouse keys hits one opponent you pick:
//   keyboard  for KEYBOARD_MS they cannot type in the editor with their keyboard, only
//             by clicking an on-screen one (their browser enforces it).
//   hint      help on a question of yours: pseudo-code or lines of a solution (server/hints.js).
//
// Time extension: during a round a player asks for more minutes; every other person
// in the room (bots always agree) has EXTEND_VOTE_MS to agree. If all do, every side
// still playing gets the time; one no (or silence) and it is off. At most
// MAX_EXTENSIONS per round, and someone whose ask failed waits EXTEND_RETRY_MS.
//
// Solves are spot-checked: in Python §3 / §4 a submit that claims to pass every test
// must include the code, and the server re-runs a few of the tests (server/verify.js).
// A side's actions are handled one at a time, and its clock waits while code is
// being checked, so the check never costs time.
import { Server } from 'socket.io';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRound, reduceRound, questionIndex, rankSides, ROUND_MINUTES, REVEAL_COSTS, DEFAULT_ROUND, POWERUP_USES, EXTEND_MINUTES, MAX_EXTENSIONS } from '../src/state/round.js';
import { LANG_LABELS, MODE_LABELS, DIFFICULTY_LABELS, CATEGORIES, filterQuestions, getQuestion, BANK_VERSION } from '../src/questions/index.js';
import { resolveTests, findBanned, linesChanged, startingCode } from '../src/judge/resolve.js';
import { createVerifier, VERIFY_LANGS } from './verify.js';
import { ChangeSet } from '@codemirror/state';
import { createDoc, docString, docVersion, pushUpdates, updatesSince } from './collab.js';
import { nextHint, HINT_KINDS } from './hints.js';
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
export const BLACKOUT_MS = 15 * 1000; // short, as it hits everyone
export const BLACKOUT_COOLDOWN_MS = 3 * 60 * 1000;
export const KEYBOARD_MS = 30 * 1000;
export const EXTEND_VOTE_MS = 30 * 1000;
const EXTEND_RETRY_MS = 60 * 1000;
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
 * Room settings: { lang, difficulty, count, minutes, partial, revealCost, powerups }.
 * The mode and topic are chosen per round. Missing round options take their
 * defaults; power-ups are off unless set.
 */
export function validConfig(c) {
  if (!c || !has(LANG_LABELS, c.lang) || !has(DIFFICULTY_LABELS, c.difficulty) || !COUNTS.includes(c.count)) return null;
  const minutes = c.minutes === undefined ? DEFAULT_ROUND.minutes : c.minutes;
  const revealCost = c.revealCost === undefined ? DEFAULT_ROUND.revealCost : c.revealCost;
  if (!ROUND_MINUTES.includes(minutes) || !REVEAL_COSTS.includes(revealCost)) return null;
  const powerups = {};
  for (const [key, allowed] of Object.entries(POWERUP_USES)) {
    const n = c.powerups?.[key] ?? 0;
    if (!allowed.includes(n)) return null;
    powerups[key] = n;
  }
  return { lang: c.lang, difficulty: c.difficulty, count: c.count, minutes, partial: c.partial === true, revealCost, powerups };
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
      // A time extension being voted on: { byId, minutes, votes: { playerId: true }, voters, until }.
      extension: room.extension,
      extensions: room.extensions ?? 0,
      youId: me.id,
      yourSeq: me.seq, // the last of your actions the server has applied
      // Your power-ups left this round, and the hints your side has (by question).
      powers: me.powers ?? null,
      hints: Object.fromEntries(sideOf(room, me)?.hints ?? []),
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
          powerups: !p.noPowers, // the host may leave someone without power-ups
          state: side?.state ?? null, // the side's state: teammates share one
          viewing: p.viewing, // the question they have open
          progress: p.progress, // { questionId, lines } for the question they have open
          blackedUntil: p.blackedUntil > Date.now() ? p.blackedUntil : null,
          blackedBy: p.blackedUntil > Date.now() ? p.blackedBy : null,
          keyboardUntil: p.keyboardUntil > Date.now() ? p.keyboardUntil : null,
          keyboardBy: p.keyboardUntil > Date.now() ? p.keyboardBy : null,
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

  /** p's code for a question: the team's shared document, or what p last sent for it. -> { text, scrambled } | null */
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
    return p.codes.get(questionId) ?? null;
  }

  /**
   * What `viewer` sees of `p`'s code: the question p has open, real or scrambled,
   * and (in `others`) p's code on every other question the viewer may read.
   */
  function watchOf(room, viewer, p) {
    const side = sideOf(room, p);
    const questionId = viewingOf(side, p);
    const locked = !canSee(room, viewer, questionId);
    const c = codeOf(side, p, questionId);
    const others = [];
    for (const { id } of side.state.questions) {
      if (id === questionId || !canSee(room, viewer, id)) continue;
      const o = codeOf(side, p, id);
      if (o) others.push({ questionId: id, code: o.text });
    }
    return { playerId: p.id, questionId, locked, code: c ? (locked ? c.scrambled : c.text) : null, others };
  }

  /** Remembers a player's code for a question (players on their own; teams share a document). */
  function keepCode(p, questionId, text) {
    const prev = p.codes.get(questionId);
    if (prev?.text === text) return false;
    // A salt per question, so the scramble never lines up across questions.
    const salt = prev?.salt ?? newSalt();
    p.codes.set(questionId, { text, salt, scrambled: scramble(text, salt) });
    return true;
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
        const key = JSON.stringify(w);
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
    room.extension = null;
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
    settleExtension(room);
    // The others keep their votes; only a missing picker means choosing again.
    if (room.status === 'lobby') {
      if (room.pick.pickerId === player.id) resetPick(room);
      else delete room.pick.votes[player.id];
      maybeStart(room);
    }
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
      codes: new Map(), codeAt: 0, watchSent: new Map(), // codes: questionId -> { text, salt, scrambled }
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
          hints: new Map(), // questionId -> { outline, lines, linesShown, more }
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
    const uses = room.config.powerups;
    for (const p of players) {
      p.codes = new Map();
      p.viewing = null;
      p.progress = null;
      p.watchSent.clear();
      const give = (n) => (p.noPowers ? 0 : n);
      p.powers = { blackout: give(uses.blackout), wipe: give(uses.wipe), keyboard: give(uses.keyboard), hints: give(uses.hints), blackoutReadyAt: 0 };
      p.blackedUntil = 0;
      p.keyboardUntil = 0;
    }
    room.extension = null;
    room.extensions = 0;
    for (const p of players) p.extendRetryAt = 0;
    room.roundInfo = { round: room.round, mode: settled.mode, category: settled.category, choice: decided.choice, note: decided.note };
    room.status = 'playing';
    const teams = room.sides.filter((s) => s.memberIds.length > 1).map((s) => sideName(room, s));
    say(room, null, `Round ${room.round}: ${MODE_LABELS[settled.mode]} · ${CATEGORIES[settled.category].label}, ${questions.length} question${questions.length === 1 ? '' : 's'} in ${room.config.minutes} minutes — ${decided.note}${decided.choice.mode === 'random' || decided.choice.category === 'random' ? ' (random)' : ''}.${teams.length ? ` Teams: ${teams.join(', ')}.` : ''}`);
    return true;
  }

  /** A team's shared document for a question (made from the starting code the first time). */
  function teamDoc(side, questionId) {
    if (!side.docs.has(questionId)) {
      const doc = createDoc(startingCode(getQuestion(questionId), side.state.config.lang));
      doc.salt = newSalt();
      side.docs.set(questionId, doc);
    }
    return side.docs.get(questionId);
  }

  // ---------------------------------------------------------------- power-ups

  /**
   * The opponents a power-up of `player`'s hits now (everyone still playing on
   * another side). -> { targets } | { error }
   */
  function powerTargets(room, player) {
    if (room.status !== 'playing' || (room.startsAt && Date.now() < room.startsAt)) return { error: 'Power-ups work during a round.' };
    const mySide = sideOf(room, player);
    if (mySide?.state.status !== 'playing') return { error: 'Your round is over.' };
    const targets = active(room).filter((p) => {
      const side = sideOf(room, p);
      return side && side !== mySide && side.state.status === 'playing';
    });
    return targets.length ? { targets } : { error: 'Everyone else has finished the round.' };
  }

  const names = (ps) => ps.map((p) => p.name).join(', ');

  /** Blacks out every opponent's editor. */
  function blackout(room, player, targets) {
    const now = Date.now();
    const pw = player.powers;
    if (!pw?.blackout) return { error: 'You have no blackouts left.' };
    if (now < pw.blackoutReadyAt) return { error: `Blackout is cooling down: ${Math.ceil((pw.blackoutReadyAt - now) / 1000)} s left.` };
    pw.blackout -= 1;
    pw.blackoutReadyAt = now + BLACKOUT_COOLDOWN_MS;
    for (const t of targets) {
      t.blackedUntil = Math.max(t.blackedUntil, now + BLACKOUT_MS);
      t.blackedBy = player.name;
    }
    say(room, null, `🌑 ${player.name} blacked out everyone (${names(targets)}) for ${BLACKOUT_MS / 1000} seconds.`);
    broadcast(room);
    return null;
  }

  /** Mouse keys: one opponent types with an on-screen keyboard for a while. */
  function mouseKeys(room, player, targets, targetId) {
    const now = Date.now();
    if (!player.powers?.keyboard) return { error: 'You have no Mouse keys left.' };
    const target = targets.find((p) => p.id === targetId);
    if (!target) return { error: 'Pick an opponent who is still playing.' };
    if (target.bot) return { error: 'Bots do not use a keyboard.' };
    if (target.keyboardUntil > now) return { error: `${target.name} already has Mouse keys.` };
    player.powers.keyboard -= 1;
    target.keyboardUntil = now + KEYBOARD_MS;
    target.keyboardBy = player.name;
    say(room, null, `⌨️ ${player.name} took ${target.name}'s keyboard for ${KEYBOARD_MS / 1000} seconds: on-screen keys only.`);
    broadcast(room);
    return null;
  }

  /** Puts a question of a side back to its starting code. */
  function wipeQuestion(room, side, target, questionId, by) {
    const start = startingCode(getQuestion(questionId), side.state.config.lang);
    if (side.team) {
      // A change to the team's document, as if someone had typed it.
      const doc = teamDoc(side, questionId);
      const len = doc.text.length;
      const changes = ChangeSet.of([{ from: 0, to: len, insert: start }], len).toJSON();
      const r = pushUpdates(doc, docVersion(doc), [{ clientID: 'wipe', changes }], { maxLength: MAX_CODE_CHARS });
      if (!r.ok) return;
      for (const p of members(room, side)) {
        if (p.socketId) io.to(p.socketId).emit('team:updates', { questionId, from: r.from, updates: r.updates });
      }
      return;
    }
    if (target.socketId) io.to(target.socketId).emit('duel:wipe', { questionId, code: start, by });
    keepCode(target, questionId, start);
  }

  /** Wipes every opponent's code on the question they have open (not solved ones, not bots). */
  function wipe(room, player, targets) {
    if (!player.powers?.wipe) return { error: 'You have no wipes left.' };
    const done = new Set(); // side key | question: a team's question is wiped once
    const hit = [];
    for (const t of targets) {
      if (t.bot) continue;
      const side = sideOf(room, t);
      const questionId = viewingOf(side, t);
      if (side.state.qs[questionIndex(side.state, questionId)]?.status === 'solved') continue;
      const key = `${side.key}|${questionId}`;
      if (!done.has(key)) wipeQuestion(room, side, t, questionId, player.name);
      done.add(key);
      hit.push(t);
    }
    if (hit.length === 0) return { error: 'Nobody has code to wipe right now (bots, or questions already solved).' };
    player.powers.wipe -= 1;
    scheduleWatch(room);
    say(room, null, `🧨 ${player.name} wiped everyone's code (${names(hit)}) on the question they had open.`);
    broadcast(room);
    return null;
  }

  // ---------------------------------------------------------------- time extension

  /** Who has to agree to an extension: every person in the room but the one asking. */
  const extensionVoters = (room, askerId) => humans(room).filter((p) => p.id !== askerId).map((p) => p.id);

  function askExtension(room, player, minutes) {
    const now = Date.now();
    if (room.status !== 'playing' || (room.startsAt && now < room.startsAt)) return { error: 'You can ask for more time during a round.' };
    if (sideOf(room, player)?.state.status !== 'playing') return { error: 'Your round is over.' };
    if (!EXTEND_MINUTES.includes(minutes)) return { error: 'Ask for 2, 5 or 10 minutes.' };
    if (room.extension) return { error: 'Someone already asked for more time. Answer that first.' };
    if ((room.extensions ?? 0) >= MAX_EXTENSIONS) return { error: `This round already had ${MAX_EXTENSIONS} extensions.` };
    if (now < (player.extendRetryAt ?? 0)) return { error: `Wait ${Math.ceil((player.extendRetryAt - now) / 1000)} s before asking again.` };
    room.extension = { byId: player.id, byName: player.name, minutes, votes: { [player.id]: true }, voters: extensionVoters(room, player.id), until: now + EXTEND_VOTE_MS };
    say(room, null, `⏱ ${player.name} asks for ${minutes} more minutes. Everyone has to agree.`);
    settleExtension(room);
    broadcast(room);
    return null;
  }

  function voteExtension(room, player, yes) {
    const ext = room.extension;
    if (!ext) return { error: 'Nobody is asking for more time.' };
    if (!ext.voters.includes(player.id)) return { error: 'You already agreed.' };
    if (!yes) {
      room.extension = null;
      const asker = byId(room, ext.byId);
      if (asker) asker.extendRetryAt = Date.now() + EXTEND_RETRY_MS;
      say(room, null, `⏱ ${player.name} said no: no extra time.`);
    } else {
      ext.votes[player.id] = true;
      settleExtension(room);
    }
    broadcast(room);
    return null;
  }

  /** Grants the extension once everyone still in the room has agreed. */
  function settleExtension(room) {
    const ext = room.extension;
    if (!ext) return;
    const waiting = ext.voters.filter((id) => !ext.votes[id] && byId(room, id) && !byId(room, id).left);
    if (waiting.length) return;
    room.extension = null;
    room.extensions = (room.extensions ?? 0) + 1;
    const now = Date.now();
    for (const side of room.sides) {
      if (side.state.status === 'playing') side.state = reduceRound(side.state, { type: 'extend', seconds: ext.minutes * 60, now });
    }
    say(room, null, `⏱ Everyone agreed: ${ext.minutes} more minutes on the clock.`);
  }

  /** A hint for the player's side on one of its questions. -> { ok, hint } | { error } */
  function useHint(room, player, questionId, kind) {
    const side = sideOf(room, player);
    if (room.status !== 'playing' || side?.state.status !== 'playing') return { error: 'Hints work during a round.' };
    if (!player.powers?.hints) return { error: 'You have no hints left.' };
    if (!HINT_KINDS.includes(kind)) return { error: 'Unknown hint.' };
    const i = typeof questionId === 'string' ? questionIndex(side.state, questionId) : -1;
    if (i < 0) return { error: 'That question is not in your round.' };
    if (side.state.qs[i].status === 'solved') return { error: 'You already solved that one.' };
    const seen = side.hints.get(questionId) ?? {};
    const next = nextHint(getQuestion(questionId), side.state.config.lang, kind, seen);
    if (!next) return { error: kind === 'lines' ? 'There is nothing more of that to show.' : 'You already have that hint.' };
    const hint = { ...seen, [kind]: next.text, more: kind === 'lines' ? next.more : seen.more ?? true };
    if (kind === 'lines') hint.linesShown = next.linesShown;
    side.hints.set(questionId, hint);
    player.powers.hints -= 1;
    if (side.team && side.memberIds.length > 1) say(room, null, `💡 ${player.name} used a hint on ${getQuestion(questionId)?.title}.`, side.team);
    broadcast(room);
    return { ok: true, hint };
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
    // The step limit stops slow code (a 'timeout' result below); running out of wall-clock
    // time means the server itself is slow, which is not the player's fault.
    if (checked.failure === 'time') return out;
    const failed = checked.results.filter((r) => r.status !== 'pass');
    if (failed.length === 0) return out;
    const slow = failed.some((r) => r.status === 'timeout');
    return fail(`The server re-ran your code on ${tests.length} test${tests.length === 1 ? '' : 's'} and ${failed.length} did not pass${slow ? ' (too slow)' : ''}, so it counts as a wrong submit.`, failed.length);
  }

  /** Handles one round action from a player (a side's actions run in order). */
  async function handleAction(token, socket, msg, arrivedAt) {
    let now = arrivedAt;
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
    // A submit that does not count always says why (the browser showed it passing).
    const echo = (why = null) => {
      handled();
      socket.emit('duel:room', snapshot(room, player));
      if (why && msg?.type === 'submitResult' && typeof msg.result?.questionId === 'string') {
        socket.emit('duel:verify', { questionId: msg.result.questionId, message: why });
      }
    };
    if (room.status !== 'playing' || !side || !ACTIONS.includes(msg?.type)) return echo('The round is over, so this submit did not count.');
    if (room.startsAt && now < room.startsAt) return echo('The round had not started yet, so this submit did not count.');
    // Blacked out: runs and submits wait until it is over (and count from then).
    if (msg.type !== 'finish' && player.blackedUntil > Date.now()) {
      await new Promise((r) => setTimeout(r, player.blackedUntil - Date.now()).unref?.());
      now = Date.now();
      if (room.status !== 'playing') return echo('The round ended while your editor was blacked out.');
    }
    const action = { type: msg.type, now };
    if (msg.type !== 'finish') {
      action.result = cleanResult(msg.type, msg.result, side.state);
      if (!action.result) {
        log(`[duel] ${room.code} ${player.name}: ${msg.type} rejected (does not match the server's question)`, msg.result?.questionId);
        return echo('The server could not count this submit: this page has a different version of the question. Reload the page, then submit again.');
      }
    }
    if (msg.type === 'submitResult') {
      side.checking += 1; // the clock waits for the check
      let checked;
      try {
        checked = await checkSubmit(side.state, action.result, msg.result.code);
      } finally {
        side.checking -= 1;
      }
      // The room may have moved on while the code ran (a leave, the round ending).
      // Otherwise the submit applies to the side as it is now.
      if (seats.get(token)?.player !== player || !room.sides.includes(side)) return echo('The round ended while your code was being checked.');
      action.result = checked.result;
      if (checked.message) socket.emit('duel:verify', { questionId: action.result.questionId, message: checked.message });
    }
    // The submitted code is the latest there is (it may be newer than the last duel:code).
    if (msg.type === 'submitResult' && !side.team && typeof msg.result.code === 'string' &&
      msg.result.code.length <= MAX_CODE_CHARS) keepCode(player, action.result.questionId, msg.result.code);
    const before = side.state;
    const next = reduceRound(side.state, action);
    if (next === side.state) return echo('That question was already closed (solved, or the time was up), so this submit did not count.');
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
      // Round actions (runs, submits) are never dropped: losing one would leave the
      // browser and the server disagreeing about a solve.
      if (events <= EVENTS_PER_SECOND || packet[0] === 'duel:action') next();
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

    // A page with another version of the questions would have its solves rejected.
    const STALE = 'This page is out of date (the questions were updated). Reload the page, then try again.';
    const stale = (bank) => bank !== undefined && bank !== BANK_VERSION;

    handle('duel:create', ({ name, config, bank }) => {
      if (stale(bank)) return { error: STALE };
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

    handle('duel:join', ({ code, name, bank }) => {
      if (stale(bank)) return { error: STALE };
      const room = rooms.get(String(code ?? '').trim().toUpperCase());
      if (!room) return { error: 'No room with that code.' };
      if (mine()?.room === room) return joined(room, mine().player);
      if (room.status !== 'lobby') return { error: 'That room is in the middle of a round. Try again when it is back in the lobby.' };
      if (active(room).length >= MAX_PLAYERS) return { error: 'That room is full.' };
      leave(token);
      const player = seat(room, token, name, socket.id);
      room.emptySince = null;
      // Votes and settings stay: the newcomer just has not voted (or readied) yet.
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

    handle('duel:power', ({ type, targetId }) => {
      const s = mine();
      if (!s) return { error: 'You are not in a room.' };
      if (!['blackout', 'wipe', 'keyboard'].includes(type)) return { error: 'Unknown power-up.' };
      const { targets, error } = powerTargets(s.room, s.player);
      if (error) return { error };
      if (type === 'keyboard') return mouseKeys(s.room, s.player, targets, targetId);
      return type === 'blackout' ? blackout(s.room, s.player, targets) : wipe(s.room, s.player, targets);
    });

    handle('duel:extend', ({ minutes }) => {
      const s = mine();
      return s ? askExtension(s.room, s.player, minutes) : { error: 'You are not in a room.' };
    });

    handle('duel:extendVote', ({ yes }) => {
      const s = mine();
      return s ? voteExtension(s.room, s.player, yes === true) : { error: 'You are not in a room.' };
    });

    handle('duel:hint', ({ questionId, kind }) => {
      const s = mine();
      return s ? useHint(s.room, s.player, questionId, kind) : { error: 'You are not in a room.' };
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

    handle('duel:grant', ({ playerId, on }) => {
      const s = hostLobby();
      if (!s) return { error: 'Only the host can choose who gets power-ups, in the lobby.' };
      const target = typeof playerId === 'string' ? byId(s.room, playerId) : null;
      if (!target) return { error: 'No such player.' };
      const noPowers = on === false;
      if (!!target.noPowers === noPowers) return null;
      target.noPowers = noPowers;
      say(s.room, null, `⚡ ${target.name} ${noPowers ? 'gets no power-ups' : 'gets power-ups again'}.`);
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
        p.codes = new Map();
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
      if (keepCode(s.player, msg.questionId, msg.code)) scheduleWatch(s.room);
    }));

    // ---------------------------------------------------------------- team editors
    const inTeam = (questionId) => {
      const s = inRound(questionId);
      return s?.side.team ? s : null;
    };
    const fullDoc = (doc) => ({ version: docVersion(doc), doc: docString(doc) });

    handle('team:open', ({ questionId }) => {
      const s = inTeam(questionId);
      if (!s) return { error: 'You are not in a team.' };
      return fullDoc(teamDoc(s.side, questionId));
    });

    handle('team:pull', ({ questionId, version }) => {
      const s = inTeam(questionId);
      if (!s) return { error: 'You are not in a team.' };
      const doc = teamDoc(s.side, questionId);
      const updates = updatesSince(doc, version);
      return updates ? { from: version, updates } : { resync: fullDoc(doc) };
    });

    handle('team:push', ({ questionId, version, updates }) => {
      const s = inTeam(questionId);
      if (!s) return { error: 'You are not in a team.' };
      const doc = teamDoc(s.side, questionId);
      // A blacked-out player cannot type (their browser locks the editor too).
      if (s.player.blackedUntil > Date.now()) return { resync: fullDoc(doc) };
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
    if (room.extension && now > room.extension.until) {
      const asker = byId(room, room.extension.byId);
      if (asker) asker.extendRetryAt = now + EXTEND_RETRY_MS;
      room.extension = null;
      say(room, null, '⏱ Not everyone answered in time: no extra time.');
      changed = true;
    }
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
