// Solved code, kept for the admin to read (server/admin.js), in SQLite (node:sqlite).
// Each question keeps its newest PER_QUESTION solutions; when all of them together
// pass maxBytes (or the disk is full), the oldest go first.
//
// The file is SOLUTIONS_DB (default data/solutions.db). On a host whose disk is wiped
// on a restart (Render's free plan), point it at a persistent disk to keep them.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PER_QUESTION = 10;
const MAX_MB = Number(process.env.SOLUTIONS_MAX_MB) || 50;
const DEFAULT_FILE = process.env.SOLUTIONS_DB || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'solutions.db');
const MAX_CODE_CHARS = 20_000;
const EVICT_BATCH = 25; // rows dropped at once when the disk is full

const KINDS = ['solo', 'duel'];
const text = (s, max) => (typeof s === 'string' ? s.slice(0, max) : null);
const int = (n) => (Number.isFinite(n) && n >= 0 ? Math.round(n) : null);

/**
 * createSolutionStore({ file, perQuestion, maxBytes, log })
 * -> { add(entry), questions(), forQuestion(id), stats(), close() }
 */
export function createSolutionStore({
  file = DEFAULT_FILE,
  perQuestion = PER_QUESTION,
  maxBytes = MAX_MB * 1024 * 1024,
  log = console.log,
} = {}) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS solutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id TEXT NOT NULL,
      lang TEXT NOT NULL,
      name TEXT,
      kind TEXT NOT NULL,
      room TEXT,
      points INTEGER,
      time_ms INTEGER,
      code TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS solutions_by_question ON solutions (question_id, id);
  `);
  const q = {
    insert: db.prepare(`INSERT INTO solutions (question_id, lang, name, kind, room, points, time_ms, code, bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    trimQuestion: db.prepare(`DELETE FROM solutions WHERE question_id = ? AND id NOT IN
      (SELECT id FROM solutions WHERE question_id = ? ORDER BY id DESC LIMIT ?)`),
    bytes: db.prepare('SELECT COALESCE(SUM(bytes), 0) AS bytes, COUNT(*) AS count FROM solutions'),
    evictOldest: db.prepare('DELETE FROM solutions WHERE id IN (SELECT id FROM solutions ORDER BY id LIMIT ?)'),
    // The oldest rows that together free at least ? bytes.
    evictBytes: db.prepare(`DELETE FROM solutions WHERE id <= (SELECT id FROM
      (SELECT id, SUM(bytes) OVER (ORDER BY id) AS freed FROM solutions) WHERE freed >= ? ORDER BY id LIMIT 1)`),
    questions: db.prepare(`SELECT question_id AS questionId, COUNT(*) AS count, MAX(created_at) AS latestAt
      FROM solutions GROUP BY question_id ORDER BY latestAt DESC`),
    forQuestion: db.prepare(`SELECT id, lang, name, kind, room, points, time_ms AS timeMs, code, created_at AS createdAt
      FROM solutions WHERE question_id = ? ORDER BY id DESC`),
  };

  /** Deletes the oldest solutions, as few as possible, so all of them fit in maxBytes. */
  function fit() {
    const { bytes } = q.bytes.get();
    if (bytes > maxBytes) q.evictBytes.run(bytes - maxBytes);
  }

  function insert(e) {
    q.insert.run(e.questionId, e.lang, e.name, e.kind, e.room, e.points, e.timeMs, e.code, Buffer.byteLength(e.code), Date.now());
    q.trimQuestion.run(e.questionId, e.questionId, perQuestion);
    fit();
  }

  return {
    /** Saves a solve: { questionId, lang, name, kind: 'solo' | 'duel', room?, points?, timeMs?, code }. -> true if saved */
    add(entry) {
      const e = {
        questionId: text(entry?.questionId, 40),
        lang: text(entry?.lang, 10),
        name: text(entry?.name, 40),
        kind: KINDS.includes(entry?.kind) ? entry.kind : null,
        room: text(entry?.room, 8),
        points: int(entry?.points),
        timeMs: int(entry?.timeMs),
        code: typeof entry?.code === 'string' && entry.code.length <= MAX_CODE_CHARS ? entry.code : null,
      };
      if (!e.questionId || !e.lang || !e.kind || !e.code?.trim()) return false;
      try {
        insert(e);
      } catch (err) {
        // The disk is full: make room by dropping the oldest fifth, then try once more.
        if (!/full|SQLITE_FULL/i.test(String(err?.message ?? err))) throw err;
        const { count } = q.bytes.get();
        q.evictOldest.run(Math.max(EVICT_BATCH, Math.ceil(count / 5)));
        try {
          insert(e);
        } catch (again) {
          log('[solutions] could not save a solution:', again);
          return false;
        }
      }
      return true;
    },
    /** Questions that have solutions: [{ questionId, count, latestAt }], newest first. */
    questions: () => q.questions.all().map((r) => ({ ...r })),
    /** A question's solutions, newest first. */
    forQuestion: (questionId) => q.forQuestion.all(String(questionId)).map((r) => ({ ...r })),
    stats() {
      const { bytes, count } = q.bytes.get();
      return { bytes, count, maxBytes, perQuestion };
    },
    close: () => db.close(),
  };
}
