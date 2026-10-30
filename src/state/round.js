// A duel round: one clock for the whole round and every question open at once, so
// a player (or a team, sharing one state) works on them in any order until the
// time runs out. Pure like engine.js: the server runs it as the referee and each
// browser runs it to show its own moves straight away.
//
// Room options (config): minutes (the round clock), partial (secret tests passed
// earn points even when the question is not solved) and revealCost (the share of a
// question's base points that revealing one failed secret test costs; 0 = off).
//
// Actions: tick, testRun, submitResult, reveal, finish.
import { parLines } from '../judge/resolve.js';
import { BASE_POINTS, PENALTIES, FREE_TEST_RUNS } from './engine.js';

export const ROUND_MINUTES = [5, 10, 15, 20, 30, 45, 60];
export const REVEAL_COSTS = [0, 0.1, 0.25, 0.5];
export const DEFAULT_ROUND = { minutes: 15, partial: false, revealCost: 0 };
const SPEED_SHARE = 0.5; // the speed bonus at the start of the round
const PARTIAL_SHARE = 0.5; // every secret test passing, not solved
const MIN_SHARE = 0.2; // a solve is always worth at least this
const MAX_REVEALS = 20;

function questionState(meta) {
  return {
    questionId: meta.id,
    difficulty: meta.difficulty,
    par: meta.par ?? null, // Bug Hunt: lines the reference fix changes
    attempts: 0,
    failedSubmits: 0,
    testRuns: 0,
    lastTest: null, // { passed, total } of the last "Run tests"
    lastSubmit: null, // { passed, total } of the last Submit
    linesChanged: null, // Bug Hunt: lines changed in the last submit
    bestHidden: 0, // most secret tests passed in one submit
    hiddenTotal: null,
    reveals: [], // indexes of the secret tests revealed
    status: 'open', // 'open' | 'solved'
    solvedAt: null,
    points: 0,
    breakdown: null,
  };
}

/**
 * Start a round. config: { lang, mode, difficulty, count, minutes, partial, revealCost }
 * questions: [{ id, mode, difficulty }] (full questions also get a Bug Hunt par).
 */
export function createRound({ config, questions, now }) {
  if (questions.length === 0) throw new Error('A round needs at least one question');
  const cfg = { ...DEFAULT_ROUND, ...config };
  const metas = questions.map((q) => ({
    id: q.id,
    mode: q.mode,
    difficulty: q.difficulty,
    par: q.par ?? (q.buggy ? parLines(q, cfg.lang) : null),
  }));
  const durationSec = cfg.minutes * 60;
  return {
    kind: 'round',
    config: cfg,
    questions: metas,
    qs: metas.map(questionState),
    startedAt: now,
    endsAt: now + durationSec * 1000,
    durationSec,
    total: 0,
    status: 'playing', // 'playing' | 'finished'
    endedAt: null,
    endReason: null, // 'time' | 'solved' | 'finished'
  };
}

/** Seconds left on the round clock (never more than the round, even during the countdown). */
export function roundTimeLeftSec(state, now) {
  const at = state.endedAt ?? now;
  return Math.max(0, Math.min(state.durationSec, (state.endsAt - at) / 1000));
}

const share = (base, s) => Math.round(base * s);

/**
 * Points for a question and where they came from. solved: score it as solved now,
 * with timeLeftSec on the round clock (the "worth up to" figure when it is not).
 */
export function questionBreakdown(q, config, { solved, timeLeftSec = 0, durationSec = 1 }) {
  const base = BASE_POINTS[q.difficulty];
  const extraLines = q.par !== null && q.linesChanged !== null ? Math.max(0, q.linesChanged - q.par) : 0;
  const submitPenalty = share(base, PENALTIES.failedSubmit) * q.failedSubmits;
  const testPenalty = share(base, PENALTIES.testRun) * Math.max(0, q.testRuns - FREE_TEST_RUNS);
  const editPenalty = share(base, PENALTIES.extraLine) * extraLines;
  const revealPenalty = share(base, config.revealCost ?? 0) * q.reveals.length;
  const lost = submitPenalty + testPenalty + editPenalty + revealPenalty;
  if (solved) {
    const timeBonus = Math.round(base * SPEED_SHARE * Math.min(1, Math.max(0, timeLeftSec) / durationSec));
    // Solving is never worth less than passing every secret test without solving.
    const floor = Math.max(share(base, MIN_SHARE), config.partial ? share(base, PARTIAL_SHARE) - revealPenalty : 0);
    const points = Math.max(floor, base + timeBonus - lost);
    return { base, timeBonus, partial: 0, submitPenalty, testPenalty, editPenalty, revealPenalty, lost, extraLines, points };
  }
  const partial = config.partial && q.hiddenTotal ? Math.round(base * PARTIAL_SHARE * q.bestHidden / q.hiddenTotal) : 0;
  return { base, timeBonus: 0, partial, submitPenalty, testPenalty, editPenalty, revealPenalty, lost, extraLines, points: Math.max(0, partial - revealPenalty) };
}

/** The most a question can still score: solved right now. */
export function worthNow(state, q, now) {
  if (q.status === 'solved') return q.breakdown;
  return questionBreakdown(q, state.config, { solved: true, timeLeftSec: roundTimeLeftSec(state, now), durationSec: state.durationSec });
}

export const questionIndex = (state, questionId) => state.qs.findIndex((q) => q.questionId === questionId);
export const solvedCount = (state) => state.qs.filter((q) => q.status === 'solved').length;

function withQuestion(state, i, q) {
  const qs = state.qs.map((x, j) => (j === i ? q : x));
  return { ...state, qs, total: qs.reduce((sum, x) => sum + x.points, 0) };
}

/** An unsolved question's points after a change (partial credit, reveals). */
function rescore(state, q) {
  const breakdown = questionBreakdown(q, state.config, { solved: false });
  return { ...q, breakdown, points: breakdown.points };
}

function end(state, reason, now) {
  return { ...state, status: 'finished', endedAt: Math.min(now, state.endsAt), endReason: reason };
}

/** Ends the round when the clock runs out. */
export function tick(state, now) {
  if (state.status === 'playing' && now >= state.endsAt) return end(state, 'time', state.endsAt);
  return state;
}

/** The open question an action is about, or -1. */
function openQuestion(state, questionId) {
  if (state.status !== 'playing') return -1;
  const i = questionIndex(state, questionId);
  return i >= 0 && state.qs[i].status === 'open' ? i : -1;
}

/** result: { questionId, passed, total } from "Run tests" (visible tests only). */
export function testRun(state, result, now) {
  const timed = tick(state, now);
  const i = openQuestion(timed, result?.questionId);
  if (i < 0) return timed;
  const q = timed.qs[i];
  return withQuestion(timed, i, { ...q, testRuns: q.testRuns + 1, lastTest: { passed: result.passed, total: result.total } });
}

/**
 * result: { questionId, passedVisible, passedHidden, total, totalHidden?, linesChanged? }
 * Solving every question ends the round early.
 */
export function submitResult(state, result, now) {
  const timed = tick(state, now);
  const i = openQuestion(timed, result?.questionId);
  if (i < 0) return timed;
  const q = timed.qs[i];
  const solved = result.total > 0 && result.passedVisible + result.passedHidden === result.total;
  const next = {
    ...q,
    attempts: q.attempts + 1,
    failedSubmits: q.failedSubmits + (solved ? 0 : 1),
    linesChanged: Number.isInteger(result.linesChanged) ? result.linesChanged : q.linesChanged,
    lastSubmit: { passed: result.passedVisible + result.passedHidden, total: result.total },
    bestHidden: Math.max(q.bestHidden, result.passedHidden),
    hiddenTotal: Number.isInteger(result.totalHidden) ? result.totalHidden : q.hiddenTotal,
  };
  let updated;
  if (solved) {
    const breakdown = questionBreakdown(next, timed.config, {
      solved: true, timeLeftSec: roundTimeLeftSec(timed, now), durationSec: timed.durationSec,
    });
    updated = withQuestion(timed, i, { ...next, status: 'solved', solvedAt: now, breakdown, points: breakdown.points });
  } else {
    updated = withQuestion(timed, i, rescore(timed, next));
  }
  return updated.qs.every((x) => x.status === 'solved') ? end(updated, 'solved', now) : updated;
}

/** Reveal a failed secret test: { questionId, testIndex }. Only when the room allows it. */
export function reveal(state, result, now) {
  const timed = tick(state, now);
  if (!(timed.config.revealCost > 0)) return timed;
  const i = openQuestion(timed, result?.questionId);
  if (i < 0) return timed;
  const q = timed.qs[i];
  const t = result.testIndex;
  if (!Number.isInteger(t) || t < 0 || t > 999 || q.reveals.includes(t) || q.reveals.length >= MAX_REVEALS) return timed;
  return withQuestion(timed, i, rescore(timed, { ...q, reveals: [...q.reveals, t] }));
}

/** Stop early: whatever is scored now is the final score. */
export function finish(state, now) {
  const timed = tick(state, now);
  return timed.status === 'playing' ? end(timed, 'finished', now) : timed;
}

export function reduceRound(state, action) {
  switch (action.type) {
    case 'tick': return tick(state, action.now);
    case 'testRun': return testRun(state, action.result, action.now);
    case 'submitResult': return submitResult(state, action.result, action.now);
    case 'reveal': return reveal(state, action.result, action.now);
    case 'finish': return finish(state, action.now);
    default: return state;
  }
}

/**
 * Sides ranked for a leaderboard: most points, then most solved, then whoever
 * solved their last question first. sides: [{ key, state, ... }] -> same, with rank.
 */
export function rankSides(sides) {
  const lastSolve = (s) => Math.max(0, ...s.state.qs.map((q) => q.solvedAt ?? 0));
  const sorted = [...sides].sort((a, b) => b.state.total - a.state.total ||
    solvedCount(b.state) - solvedCount(a.state) || lastSolve(a) - lastSolve(b));
  let rank = 0;
  return sorted.map((s, i) => {
    const prev = sorted[i - 1];
    if (!prev || prev.state.total !== s.state.total) rank = i + 1;
    return { ...s, rank };
  });
}
