// Player accounts, in SQLite (node:sqlite): a username and password, the player's
// progress (src/state/progress.js), when they were last online and their recent games,
// which the admin can read (server/admin.js).
//
// Passwords are never stored: only a salted scrypt hash, with its cost next to it so
// the cost can be raised later. Login tokens are only kept as a SHA-256 hash, so a
// copy of the database logs nobody in. Wrong passwords are limited per address and per
// username.
//
// The file is ACCOUNTS_DB (default data/accounts.db). On a host whose disk is wiped on
// a restart (Render's free plan), every account goes with it: point this at a
// persistent disk.
//
// Client -> server (all with an ack callback):
//   account:signup { username, password }  -> { ok, token, username, progress } | { error }
//   account:login { username, password }   -> { ok, token, username, progress } | { error }
//   account:load { token }                 -> { ok, username, progress } | { error, expired? }
//                                             (also marks this connection as theirs)
//   account:save { token, patch }          -> { ok } | { error, expired? }
//   account:logout { token }
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanProgress, emptyProgress, mergeProgress } from '../src/state/progress.js';

const DEFAULT_FILE = process.env.ACCOUNTS_DB || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'accounts.db');
// OWASP's scrypt setting for 32 MiB per hash, which a small server can afford.
const SCRYPT = { N: 2 ** 15, r: 8, p: 3 };
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128; // keeps a hash's work bounded
const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PROGRESS_CHARS = 1024 * 1024;
const GAMES_KEPT = 50; // recent games per account
const MAX_HASHING = 16; // hashes at once, across everyone
const LOGIN_FAILS = { perIp: 30, perName: 10, perMs: 5 * 60 * 1000 };
const SIGNUPS = { perIp: 20, perMs: 60 * 60 * 1000 };
const SEEN_EVERY_MS = 60 * 1000;

const derive = (password, salt, { N, r, p }) => new Promise((resolve, reject) => {
  scrypt(password, salt, KEY_BYTES, { N, r, p, maxmem: SCRYPT_MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
});

/** 'scrypt$N$r$p$salt$hash', with a new random salt. */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await derive(password, Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p) });
  return got.length === want.length && timingSafeEqual(got, want);
}

const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const text = (s, max) => (typeof s === 'string' ? s.slice(0, max) : null);
const int = (n) => (Number.isFinite(n) && n >= 0 ? Math.round(n) : 0);

/**
 * createAccountStore({ file }) -> create, byUsername, newSession, sessionAccount, endSession,
 * saveProgress, touch, recordGame, list, games, close. Saves hashes only: hashing happens
 * before these are called.
 */
export function createAccountStore({ file = DEFAULT_FILE } = {}) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      progress TEXT NOT NULL,
      games_played INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      lang TEXT,
      mode TEXT,
      difficulty TEXT,
      category TEXT,
      questions INTEGER NOT NULL,
      solved INTEGER NOT NULL,
      points INTEGER NOT NULL,
      result TEXT,
      opponents TEXT,
      played_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS games_by_account ON games (account_id, id);
  `);
  const q = {
    insert: db.prepare('INSERT INTO accounts (username, password_hash, progress, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)'),
    byUsername: db.prepare('SELECT id, username, password_hash AS passwordHash FROM accounts WHERE username = ?'),
    byId: db.prepare('SELECT id, username, progress FROM accounts WHERE id = ?'),
    setProgress: db.prepare('UPDATE accounts SET progress = ?, last_seen_at = ? WHERE id = ?'),
    touch: db.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?'),
    newSession: db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)'),
    session: db.prepare('SELECT account_id AS accountId, expires_at AS expiresAt FROM sessions WHERE token_hash = ?'),
    extendSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    endSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    addGame: db.prepare(`INSERT INTO games (account_id, kind, lang, mode, difficulty, category, questions, solved, points, result, opponents, played_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    countGame: db.prepare('UPDATE accounts SET games_played = games_played + 1 WHERE id = ?'),
    trimGames: db.prepare(`DELETE FROM games WHERE account_id = ? AND id NOT IN
      (SELECT id FROM games WHERE account_id = ? ORDER BY id DESC LIMIT ?)`),
    list: db.prepare(`SELECT id, username, games_played AS gamesPlayed, created_at AS createdAt, last_seen_at AS lastSeenAt
      FROM accounts ORDER BY last_seen_at DESC LIMIT 500`),
    games: db.prepare(`SELECT kind, lang, mode, difficulty, category, questions, solved, points, result, opponents, played_at AS playedAt
      FROM games WHERE account_id = ? ORDER BY id DESC`),
  };
  const account = (id) => {
    const row = q.byId.get(id);
    return row ? { id: row.id, username: row.username, progress: JSON.parse(row.progress) } : null;
  };

  return {
    /** -> the new account's id, or null if the username is taken. */
    create(username, passwordHash) {
      const now = Date.now();
      try {
        return Number(q.insert.run(username, passwordHash, JSON.stringify(emptyProgress()), now, now).lastInsertRowid);
      } catch (err) {
        if (/UNIQUE/i.test(String(err?.message))) return null;
        throw err;
      }
    },
    byUsername: (username) => q.byUsername.get(username) ?? null,
    account,
    /** -> a new login token. Only its hash is stored. */
    newSession(accountId) {
      const now = Date.now();
      q.purgeSessions.run(now);
      const token = randomBytes(32).toString('hex');
      q.newSession.run(tokenHash(token), accountId, now + SESSION_MS);
      return token;
    },
    /** The account a token logs in to, or null. Using a token keeps it alive. */
    sessionAccount(token) {
      if (typeof token !== 'string' || token.length !== 64) return null;
      const hash = tokenHash(token);
      const s = q.session.get(hash);
      const now = Date.now();
      if (!s || s.expiresAt < now) return null;
      q.extendSession.run(now + SESSION_MS, hash);
      return account(s.accountId);
    },
    endSession(token) {
      if (typeof token === 'string') q.endSession.run(tokenHash(token));
    },
    /** Merges a patch in. -> false if the account would grow too big. */
    saveProgress(id, patch) {
      const merged = JSON.stringify(mergeProgress(account(id)?.progress, cleanProgress(patch)));
      if (merged.length > MAX_PROGRESS_CHARS) return false;
      q.setProgress.run(merged, Date.now(), id);
      return true;
    },
    touch: (id) => q.touch.run(Date.now(), id),
    /** A finished game: { kind: 'solo' | 'duel', lang, mode, difficulty, category?, questions, solved, points, result?, opponents? } */
    recordGame(id, g) {
      q.addGame.run(id, text(g.kind, 10) ?? 'solo', text(g.lang, 10), text(g.mode, 12), text(g.difficulty, 10), text(g.category, 20),
        int(g.questions), int(g.solved), int(g.points), text(g.result, 10), text(g.opponents, 120), Date.now());
      q.countGame.run(id);
      q.trimGames.run(id, id, GAMES_KEPT);
    },
    /** For the admin: never the password hash or progress. */
    list: () => q.list.all().map((r) => ({ ...r })),
    games: (id) => q.games.all(id).map((r) => ({ ...r })),
    close: () => db.close(),
  };
}

/** Counts events per key within a window. */
function limiter(max, perMs) {
  const hits = new Map();
  const recent = (key) => (hits.get(key) ?? []).filter((t) => Date.now() - t < perMs);
  return {
    blocked: (key) => recent(key).length >= max,
    hit(key) {
      if (hits.size > 10_000) hits.clear(); // only an attack gets here; it loses its count, nothing else
      hits.set(key, [...recent(key), Date.now()]);
    },
    clear: (key) => hits.delete(key),
  };
}

/** attachAccounts(io, { store, reserved, log }) -> { accountIdOf(socketId), onlineIds(), close() } */
export function attachAccounts(io, { store, reserved = [], log = console.log }) {
  const taken = new Set(reserved.map((name) => name.toLowerCase()));
  const failsByIp = limiter(LOGIN_FAILS.perIp, LOGIN_FAILS.perMs);
  const failsByName = limiter(LOGIN_FAILS.perName, LOGIN_FAILS.perMs);
  const signupsByIp = limiter(SIGNUPS.perIp, SIGNUPS.perMs);
  // Someone asking for a username that does not exist waits just as long.
  const decoy = hashPassword(randomBytes(16).toString('hex'));
  let hashing = 0;

  /** Runs a password hash, unless too many are running. -> { busy: true } or fn's result */
  async function withHashSlot(fn) {
    if (hashing >= MAX_HASHING) return { error: 'The server is busy. Try again in a moment.' };
    hashing += 1;
    try {
      return await fn();
    } finally {
      hashing -= 1;
    }
  }

  const onlineIds = () => {
    const ids = new Set();
    for (const socket of io.sockets.sockets.values()) if (socket.data.accountId) ids.add(socket.data.accountId);
    return ids;
  };

  // Last online: while connected, and the moment they go.
  const seenTimer = setInterval(() => {
    try {
      for (const id of onlineIds()) store.touch(id);
    } catch (err) {
      log('[accounts] last seen failed:', err?.message);
    }
  }, SEEN_EVERY_MS);
  seenTimer.unref?.();

  io.on('connection', (socket) => {
    const ip = String(socket.handshake.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || socket.handshake.address;
    // Never logs a message's contents: they can hold a password.
    const handle = (event, fn) => socket.on(event, async (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        reply(await fn(msg ?? {}) ?? { ok: true });
      } catch (err) {
        log(`[accounts] ${event} failed:`, err?.message);
        reply({ error: 'Something went wrong on the server.' });
      }
    });
    const claim = (accountId) => {
      socket.data.accountId = accountId;
      store.touch(accountId);
    };
    const signedIn = (id) => {
      claim(id);
      const a = store.account(id);
      return { ok: true, token: store.newSession(id), username: a.username, progress: a.progress };
    };
    let busy = false; // one password at a time per connection
    const onePassword = async (fn) => {
      if (busy) return { error: 'One moment…' };
      busy = true;
      try {
        return await withHashSlot(fn);
      } finally {
        busy = false;
      }
    };

    handle('account:signup', ({ username, password }) => onePassword(async () => {
      if (typeof username !== 'string' || !USERNAME.test(username)) return { error: 'Usernames are 3 to 20 letters, numbers, - or _.' };
      if (typeof password !== 'string' || password.length < PASSWORD_MIN) return { error: `Use at least ${PASSWORD_MIN} characters for your password.` };
      if (password.length > PASSWORD_MAX) return { error: `Use at most ${PASSWORD_MAX} characters for your password.` };
      if (password.toLowerCase() === username.toLowerCase()) return { error: 'Your password cannot be your username.' };
      if (signupsByIp.blocked(ip)) return { error: 'Too many new accounts from here. Try again later.' };
      if (taken.has(username.toLowerCase()) || store.byUsername(username)) return { error: 'That username is taken.' };
      const hash = await hashPassword(password);
      const id = store.create(username, hash);
      if (id === null) return { error: 'That username is taken.' };
      signupsByIp.hit(ip);
      return signedIn(id);
    }));

    handle('account:login', ({ username, password }) => onePassword(async () => {
      const wrong = { error: 'Wrong username or password.' };
      if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > PASSWORD_MAX) return wrong;
      const name = username.toLowerCase();
      if (failsByIp.blocked(ip) || failsByName.blocked(name)) return { error: 'Too many wrong tries. Wait a few minutes.' };
      const found = store.byUsername(username);
      const ok = await verifyPassword(password, found?.passwordHash ?? await decoy);
      if (!found || !ok) {
        failsByIp.hit(ip);
        failsByName.hit(name);
        return wrong;
      }
      failsByName.clear(name);
      return signedIn(found.id);
    }));

    handle('account:load', ({ token }) => {
      const a = store.sessionAccount(token);
      if (!a) return { error: 'Your login has expired. Log in again.', expired: true };
      claim(a.id);
      return { ok: true, username: a.username, progress: a.progress };
    });

    handle('account:save', ({ token, patch }) => {
      const a = store.sessionAccount(token);
      if (!a) return { error: 'Your login has expired. Log in again.', expired: true };
      return store.saveProgress(a.id, patch) ? null : { error: 'This account has too much saved.' };
    });

    handle('account:logout', ({ token }) => {
      if (socket.data.accountId) store.touch(socket.data.accountId);
      store.endSession(token);
      socket.data.accountId = null;
      return null;
    });

    socket.on('disconnect', () => {
      try {
        if (socket.data.accountId) store.touch(socket.data.accountId);
      } catch (err) {
        log('[accounts] last seen failed:', err?.message);
      }
    });
  });

  return {
    accountIdOf: (socketId) => (socketId ? io.sockets.sockets.get(socketId)?.data.accountId ?? null : null),
    onlineIds,
    close: () => clearInterval(seenTimer),
  };
}
