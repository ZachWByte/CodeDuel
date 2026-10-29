// Pure game logic: no DOM, no storage, no timers. Every function takes a state
// and returns a new one, so a future multiplayer server can run the same code
// as the referee.
//
// Actions: start (createSession), tick, testRun, submitResult, skip, next.
import { parLines } from '../judge/resolve.js';

export const TIME_LIMITS = {
  'code-race': { easy: 300, medium: 600, hard: 900 },
  'bug-hunt': { easy: 180, medium: 360, hard: 600 },
};
export const BASE_POINTS = { easy: 100, medium: 200, hard: 300 };
// Penalties, as shares of the question's base points.
export const PENALTIES = {
  failedSubmit: 0.1, // each wrong Submit
  testRun: 0.05, // each "Run tests" after the free ones
  extraLine: 0.1, // Bug Hunt: each changed line beyond par
};
export const FREE_TEST_RUNS = 1;
const MIN_SHARE = 0.2; // a solved question is always worth at least this

export const timeLimitFor = (q) => q.timeLimitSec ?? TIME_LIMITS[q.mode][q.difficulty];

/** Points for a question and where they came from. */
export function scoreBreakdown({ difficulty, solved, timeLeftSec, timeLimitSec, failedSubmits = 0, testRuns = 0, extraLines = 0 }) {
  const base = BASE_POINTS[difficulty];
  if (!solved) return { base, timeBonus: 0, submitPenalty: 0, testPenalty: 0, editPenalty: 0, points: 0 };
  const timeBonus = Math.round(base * 0.5 * Math.min(1, Math.max(0, timeLeftSec) / timeLimitSec));
  const submitPenalty = Math.round(base * PENALTIES.failedSubmit) * failedSubmits;
  const testPenalty = Math.round(base * PENALTIES.testRun) * Math.max(0, testRuns - FREE_TEST_RUNS);
  const editPenalty = Math.round(base * PENALTIES.extraLine) * extraLines;
  const points = Math.max(Math.round(base * MIN_SHARE), base + timeBonus - submitPenalty - testPenalty - editPenalty);
  return { base, timeBonus, submitPenalty, testPenalty, editPenalty, points };
}

export const scoreQuestion = (args) => scoreBreakdown(args).points;

function questionState(meta, now) {
  return {
    questionId: meta.id,
    difficulty: meta.difficulty,
    startedAt: now,
    endedAt: null,
    timeLimitSec: timeLimitFor(meta),
    attempts: 0,
    failedSubmits: 0,
    testRuns: 0, // "Run tests" presses
    lastTest: null, // { passed, total } of the last "Run tests"
    par: meta.par ?? null, // Bug Hunt: lines the reference fix changes
    linesChanged: null, // Bug Hunt: lines changed in the last submit
    status: 'playing', // 'playing' | 'solved' | 'timeout' | 'skipped'
    points: 0,
  };
}

/**
 * Start a session.
 * config: { lang, mode, difficulty, count, practice? }
 * questions: [{ id, mode, difficulty, timeLimitSec? }] in play order
 */
export function createSession({ config, questions, now }) {
  if (questions.length === 0) throw new Error('A session needs at least one question');
  // Full questions (with code) get a Bug Hunt par; bare metas get none.
  const metas = questions.map((q) => ({
    id: q.id,
    mode: q.mode,
    difficulty: q.difficulty,
    timeLimitSec: q.timeLimitSec,
    par: q.par ?? (q.buggy ? parLines(q, config.lang) : null),
  }));
  return {
    config: { ...config },
    questions: metas,
    index: 0,
    current: questionState(metas[0], now),
    results: [],
    total: 0,
    status: 'playing', // 'playing' | 'finished'
    startedAt: now,
  };
}

export function elapsedSec(state, now) {
  const c = state.current;
  return ((c.endedAt ?? now) - c.startedAt) / 1000;
}

export function timeLeftSec(state, now) {
  return Math.max(0, state.current.timeLimitSec - elapsedSec(state, now));
}

function endQuestion(state, status, now) {
  const c = state.current;
  const endedAt = Math.min(now, c.startedAt + c.timeLimitSec * 1000);
  const timeLeft = Math.max(0, c.timeLimitSec - (endedAt - c.startedAt) / 1000);
  const extraLines = c.par !== null && c.linesChanged !== null ? Math.max(0, c.linesChanged - c.par) : 0;
  const breakdown = scoreBreakdown({
    difficulty: c.difficulty,
    solved: status === 'solved',
    timeLeftSec: timeLeft,
    timeLimitSec: c.timeLimitSec,
    failedSubmits: c.failedSubmits,
    testRuns: c.testRuns,
    extraLines,
  });
  const { points } = breakdown;
  const current = { ...c, status, endedAt, points, breakdown };
  const result = {
    questionId: c.questionId,
    status,
    solved: status === 'solved',
    timeSec: Math.round((endedAt - c.startedAt) / 1000),
    attempts: c.attempts,
    testRuns: c.testRuns,
    extraLines,
    points,
    breakdown,
  };
  return { ...state, current, results: [...state.results, result], total: state.total + points };
}

function isActive(state) {
  return state.status === 'playing' && state.current.status === 'playing';
}

/** Ends the question if its time is up. */
export function tick(state, now) {
  if (!isActive(state)) return state;
  if (timeLeftSec(state, now) <= 0) return endQuestion(state, 'timeout', now);
  return state;
}

/** result: { questionId, passed, total } from "Run tests" (visible tests only). */
export function testRun(state, result, now) {
  const timed = tick(state, now);
  if (!isActive(timed) || result.questionId !== timed.current.questionId) return timed;
  const c = timed.current;
  return { ...timed, current: { ...c, testRuns: c.testRuns + 1, lastTest: { passed: result.passed, total: result.total } } };
}

/**
 * result: { questionId, passedVisible, passedHidden, total, timeMs, linesChanged? }
 * linesChanged: Bug Hunt only, lines changed from the buggy program.
 */
export function submitResult(state, result, now) {
  const timed = tick(state, now);
  if (!isActive(timed) || result.questionId !== timed.current.questionId) return timed;
  const solved = result.total > 0 && result.passedVisible + result.passedHidden === result.total;
  const c = timed.current;
  const updated = {
    ...timed,
    current: {
      ...c,
      attempts: c.attempts + 1,
      failedSubmits: c.failedSubmits + (solved ? 0 : 1),
      linesChanged: Number.isInteger(result.linesChanged) ? result.linesChanged : c.linesChanged,
      lastSubmit: { passed: result.passedVisible + result.passedHidden, total: result.total },
    },
  };
  return solved ? endQuestion(updated, 'solved', now) : updated;
}

export function skip(state, now) {
  const timed = tick(state, now);
  if (!isActive(timed)) return timed;
  return endQuestion(timed, 'skipped', now);
}

/** Move on after the current question has ended. */
export function next(state, now) {
  if (state.status !== 'playing' || state.current.status === 'playing') return state;
  const index = state.index + 1;
  if (index >= state.questions.length) return { ...state, status: 'finished' };
  return { ...state, index, current: questionState(state.questions[index], now) };
}

/** Dispatch helper so callers (UI now, network later) can send plain actions. */
export function reduce(state, action) {
  switch (action.type) {
    case 'tick': return tick(state, action.now);
    case 'testRun': return testRun(state, action.result, action.now);
    case 'submitResult': return submitResult(state, action.result, action.now);
    case 'skip': return skip(state, action.now);
    case 'next': return next(state, action.now);
    default: return state;
  }
}
