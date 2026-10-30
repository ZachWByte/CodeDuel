// Admin: a login, and a live view of everyone playing. Solo games run in the
// browser, so a solo player's tab reports its session (and, about once a second,
// its code) here; duel players are already on the server (server/duel.js).
//
// The admin account comes from ADMIN_USERNAME / ADMIN_PASSWORD (default admin /
// 123456: set real ones on a public server). Logging in gives a token the tab
// keeps, so a reload stays logged in. Wrong passwords are limited per address.
//
// Client -> server (all with an ack callback, except solo:update, solo:code, solo:end):
//   solo:update { name, state, now }   a solo session (src/state/engine.js), when it changes
//   solo:code { questionId, code }     the code in a solo player's editor
//   solo:end                           back on the home screen
//   solo:solved { questionId, code }   the code of a question just solved (saved, see server/solutions.js)
//   admin:login { username, password } -> { ok, token } | { error }
//   admin:resume { token }             -> { ok } | { error }
//   admin:logout { token }
//   admin:leave                        (left the admin screen: no more admin:view, still logged in)
//   admin:watch { kind: 'solo' | 'duel', id, room? }  whose code to send (null: nobody)
//   admin:solutions                    -> { questions: [{ questionId, title, count, latestAt }], stats }
//   admin:solution { questionId }      -> { questionId, title, solutions: [...] } (newest first, with code)
// Server -> admin:
//   admin:view { serverNow, solos, rooms, watched }   about once a second, when it changed
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getQuestion } from '../src/questions/index.js';

const PUSH_EVERY_MS = 1000;
const SOLO_AWAY_MS = 60 * 1000; // a solo player whose tab closed is dropped after this
const SESSION_MS = 12 * 60 * 60 * 1000;
const LOGIN_FAILS = { max: 5, perMs: 5 * 60 * 1000 };
const MAX_CODE_CHARS = 20_000;
const MAX_QUESTIONS = 10;
const SOLVED_MIN_MS = 2000; // a solo player saves at most one solution this often

const digest = (s) => createHash('sha256').update(String(s ?? '')).digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b));
const int = (n, max = 1e6) => (Number.isInteger(n) && n >= 0 && n <= max ? n : 0);
const titleOf = (id) => getQuestion(id)?.title ?? id;
const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 20) || null;

/** What the admin sees of a solo session, from what the browser sent (checked, never trusted for more). */
function soloSummary(state, delta) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.questions) || !state.config) return null;
  const questions = state.questions.slice(0, MAX_QUESTIONS).filter((q) => typeof q?.id === 'string' && getQuestion(q.id));
  if (questions.length === 0) return null;
  const c = state.config;
  const index = Math.min(int(state.index), questions.length - 1);
  const cur = state.current ?? {};
  const results = Array.isArray(state.results) ? state.results.slice(0, MAX_QUESTIONS) : [];
  const startedAt = Number(cur.startedAt);
  const limit = int(cur.timeLimitSec, 3600);
  return {
    lang: String(c.lang ?? '').slice(0, 10),
    mode: String(c.mode ?? '').slice(0, 12),
    difficulty: String(c.difficulty ?? '').slice(0, 10),
    practice: c.practice === true,
    count: questions.length,
    index,
    status: state.status === 'finished' ? 'finished' : 'playing',
    total: int(state.total),
    solved: results.filter((r) => r?.status === 'solved').length,
    current: {
      questionId: questions[index].id,
      title: titleOf(questions[index].id),
      status: ['playing', 'solved', 'timeout', 'skipped'].includes(cur.status) ? cur.status : 'playing',
      points: int(cur.points),
      testRuns: int(cur.testRuns),
      failedSubmits: int(cur.failedSubmits),
      lastTest: cur.lastTest ? { passed: int(cur.lastTest.passed), total: int(cur.lastTest.total) } : null,
      // On the server's clock.
      endsAt: Number.isFinite(startedAt) && limit ? startedAt + delta + limit * 1000 : null,
    },
  };
}

/**
 * attachAdmin(io, { duel: { rooms(), code(room, playerId) }, solutions, log, username, password })
 * solutions: the store solves are saved in (server/solutions.js), or null.
 * -> { solos, close() }
 */
export function attachAdmin(io, {
  duel,
  solutions = null,
  log = console.log,
  username = process.env.ADMIN_USERNAME || 'admin',
  password = process.env.ADMIN_PASSWORD || '123456',
} = {}) {
  const solos = new Map(); // token -> { id, name, socketId, summary, code, updatedAt, awaySince }
  const sessions = new Map(); // admin token -> expiresAt
  const fails = new Map(); // ip -> [times]
  const admins = new Map(); // socket id -> { socket, watch, sent }

  const ipOf = (socket) => String(socket.handshake.headers['x-forwarded-for'] ?? '').split(',')[0].trim() ||
    socket.handshake.address;

  function view(watch) {
    const now = Date.now();
    const list = [...solos.values()].filter((s) => s.summary).map((s) => ({
      id: s.id, name: s.name, connected: s.socketId !== null, updatedAt: s.updatedAt, ...s.summary,
    }));
    let watched = null;
    if (watch?.kind === 'solo') {
      const s = [...solos.values()].find((x) => x.id === watch.id);
      if (s) {
        const code = s.code?.questionId === s.summary?.current.questionId ? s.code.text : null;
        watched = { ...watch, questionId: s.summary?.current.questionId ?? null, code };
      }
    } else if (watch?.kind === 'duel') {
      const c = duel?.code(watch.room, watch.id);
      if (c) watched = { ...watch, ...c };
    }
    if (watched?.questionId) watched.title = titleOf(watched.questionId);
    return { serverNow: now, solos: list, rooms: duel?.rooms() ?? [], watched };
  }

  /** Sends each admin the view, if it changed since the last one they got. */
  function push(force = false) {
    for (const a of admins.values()) {
      const v = view(a.watch);
      const key = JSON.stringify({ ...v, serverNow: 0 });
      if (!force && key === a.sent) continue;
      a.sent = key;
      a.socket.emit('admin:view', v);
    }
  }

  const isSession = (token) => {
    const exp = typeof token === 'string' ? sessions.get(token) : undefined;
    if (exp === undefined) return false;
    if (exp < Date.now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  };

  io.on('connection', (socket) => {
    if (!socket.connected) return; // turned away by the duel server
    const raw = socket.handshake.auth?.token;
    const token = typeof raw === 'string' && raw.length >= 16 ? raw.slice(0, 64) : null;
    if (!token) return;

    const handle = (event, fn) => socket.on(event, (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        reply(fn(msg ?? {}) ?? { ok: true });
      } catch (err) {
        log(`[admin] ${event} failed:`, err);
        reply({ error: 'Something went wrong on the server.' });
      }
    });
    const guard = (event, fn) => socket.on(event, (msg) => {
      try {
        fn(msg ?? {});
      } catch (err) {
        log(`[admin] ${event} failed:`, err);
      }
    });

    // A reload rejoins the same solo entry.
    const back = solos.get(token);
    if (back) {
      back.socketId = socket.id;
      back.awaySince = null;
    }

    guard('solo:update', ({ name, state, now }) => {
      const delta = Number.isFinite(now) ? Date.now() - now : 0;
      const summary = soloSummary(state, delta);
      if (!summary) return;
      let s = solos.get(token);
      if (!s) {
        s = { id: randomBytes(4).toString('hex'), code: null };
        solos.set(token, s);
      }
      Object.assign(s, { name: cleanName(name), socketId: socket.id, summary, updatedAt: Date.now(), awaySince: null });
    });

    guard('solo:code', ({ questionId, code }) => {
      const s = solos.get(token);
      if (!s || typeof questionId !== 'string' || typeof code !== 'string' || code.length > MAX_CODE_CHARS) return;
      s.code = { questionId, text: code };
      s.updatedAt = Date.now();
    });

    guard('solo:end', () => { solos.delete(token); });

    // Only for the question the session says was just solved, and not too often.
    guard('solo:solved', ({ questionId, code }) => {
      const s = solos.get(token);
      const cur = s?.summary?.current;
      const now = Date.now();
      if (!solutions || !cur || cur.questionId !== questionId || cur.status !== 'solved') return;
      if (s.savedQuestion === questionId || now - (s.savedAt ?? 0) < SOLVED_MIN_MS) return;
      s.savedQuestion = questionId;
      s.savedAt = now;
      solutions.add({ questionId, lang: s.summary.lang, name: s.name ?? 'Anonymous', kind: 'solo', points: cur.points, code });
    });

    const signIn = () => {
      admins.set(socket.id, { socket, watch: null, sent: null });
      setImmediate(() => push(true));
    };

    handle('admin:login', ({ username: u, password: p }) => {
      const ip = ipOf(socket);
      const now = Date.now();
      const recent = (fails.get(ip) ?? []).filter((t) => now - t < LOGIN_FAILS.perMs);
      fails.set(ip, recent);
      if (recent.length >= LOGIN_FAILS.max) return { error: 'Too many wrong tries. Wait a few minutes.' };
      // Both compared, so a wrong username takes as long as a wrong password.
      const okUser = same(u, username);
      const okPass = same(p, password);
      if (!okUser || !okPass) {
        recent.push(now);
        return { error: 'Wrong username or password.' };
      }
      fails.delete(ip);
      const session = randomBytes(24).toString('hex');
      sessions.set(session, now + SESSION_MS);
      signIn();
      return { ok: true, token: session };
    });

    handle('admin:resume', ({ token: t }) => {
      if (!isSession(t)) return { error: 'Your admin login has expired. Log in again.' };
      signIn();
      return null;
    });

    handle('admin:logout', ({ token: t }) => {
      if (typeof t === 'string') sessions.delete(t);
      admins.delete(socket.id);
      return null;
    });

    guard('admin:leave', () => { admins.delete(socket.id); });

    const isAdmin = () => admins.has(socket.id);

    handle('admin:solutions', () => {
      if (!isAdmin()) return { error: 'Log in as admin first.' };
      if (!solutions) return { questions: [], stats: null };
      return { questions: solutions.questions().map((x) => ({ ...x, title: titleOf(x.questionId) })), stats: solutions.stats() };
    });

    handle('admin:solution', ({ questionId }) => {
      if (!isAdmin()) return { error: 'Log in as admin first.' };
      if (typeof questionId !== 'string') return { error: 'Which question?' };
      return { questionId, title: titleOf(questionId), solutions: solutions?.forQuestion(questionId) ?? [] };
    });

    guard('admin:watch', ({ kind, id, room }) => {
      const a = admins.get(socket.id);
      if (!a) return;
      a.watch = (kind === 'solo' || kind === 'duel') && typeof id === 'string'
        ? { kind, id, room: typeof room === 'string' ? room : null } : null;
      push(true);
    });

    socket.on('disconnect', () => {
      admins.delete(socket.id);
      const s = solos.get(token);
      if (s?.socketId === socket.id) {
        s.socketId = null;
        s.awaySince = Date.now();
      }
    });
  });

  const timer = setInterval(() => {
    try {
      const now = Date.now();
      for (const [token, s] of solos) if (s.awaySince !== null && now - s.awaySince > SOLO_AWAY_MS) solos.delete(token);
      if (admins.size) push();
    } catch (err) {
      log('[admin] push failed:', err);
    }
  }, PUSH_EVERY_MS);
  timer.unref?.();

  return {
    solos,
    close: () => clearInterval(timer),
  };
}
