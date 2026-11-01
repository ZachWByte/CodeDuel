import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, submitResult, skip, next, tick, testRun, timeLeftSec, scoreQuestion, scoreBreakdown, timeLimitFor } from '../src/state/engine.js';

const qs = [
  { id: 'CR-E01', mode: 'code-race', difficulty: 'easy' },
  { id: 'CR-M01', mode: 'code-race', difficulty: 'medium', timeLimitSec: 60 },
];
const config = { lang: 'python', mode: 'code-race', difficulty: 'mixed', count: 2 };
const pass = (id) => ({ questionId: id, passedVisible: 2, passedHidden: 4, total: 6, timeMs: 1 });
const failRes = (id) => ({ questionId: id, passedVisible: 1, passedHidden: 4, total: 6, timeMs: 1 });

test('time limits follow the table and per-question overrides', () => {
  assert.equal(timeLimitFor({ mode: 'code-race', difficulty: 'easy' }), 300);
  assert.equal(timeLimitFor({ mode: 'bug-hunt', difficulty: 'hard' }), 600);
  assert.equal(timeLimitFor({ mode: 'bug-hunt', difficulty: 'hard', timeLimitSec: 42 }), 42);
});

test('scoring formula', () => {
  // full time left: 100 + 100 (the speed bonus is worth as much as the solve)
  assert.equal(scoreQuestion({ difficulty: 'easy', solved: true, timeLeftSec: 300, timeLimitSec: 300, failedSubmits: 0 }), 200);
  // half time, 2 failed submits on hard: 300 + 150 - 60
  assert.equal(scoreQuestion({ difficulty: 'hard', solved: true, timeLeftSec: 450, timeLimitSec: 900, failedSubmits: 2 }), 390);
  // floor at 20% of base
  assert.equal(scoreQuestion({ difficulty: 'medium', solved: true, timeLeftSec: 0, timeLimitSec: 600, failedSubmits: 50 }), 40);
  assert.equal(scoreQuestion({ difficulty: 'easy', solved: false, timeLeftSec: 300, timeLimitSec: 300, failedSubmits: 0 }), 0);
});

test('solve, fail, skip and finish a session', () => {
  let s = createSession({ config, questions: qs, now: 0 });
  assert.equal(s.current.timeLimitSec, 300);
  s = submitResult(s, failRes('CR-E01'), 10_000);
  assert.equal(s.current.status, 'playing');
  assert.equal(s.current.failedSubmits, 1);
  s = submitResult(s, pass('CR-E01'), 150_000);
  assert.equal(s.current.status, 'solved');
  // 100 + round(100 * 150/300) - 10 = 140
  assert.equal(s.current.points, 140);
  assert.deepEqual(s.results[0], { questionId: 'CR-E01', status: 'solved', solved: true, timeSec: 150, attempts: 2, testRuns: 0, extraLines: 0, points: 140,
    breakdown: { base: 100, timeBonus: 50, submitPenalty: 10, editPenalty: 0, points: 140 } });
  // results for the wrong question / after the end are ignored
  assert.equal(submitResult(s, pass('CR-E01'), 151_000), s);
  s = next(s, 200_000);
  assert.equal(s.current.questionId, 'CR-M01');
  assert.equal(s.current.timeLimitSec, 60);
  s = skip(s, 210_000);
  assert.equal(s.current.status, 'skipped');
  assert.equal(s.current.points, 0);
  s = next(s, 211_000);
  assert.equal(s.status, 'finished');
  assert.equal(s.total, 140);
  assert.equal(s.results.length, 2);
});

test('time runs out', () => {
  let s = createSession({ config, questions: qs, now: 0 });
  assert.equal(timeLeftSec(s, 299_000), 1);
  s = tick(s, 299_000);
  assert.equal(s.current.status, 'playing');
  s = tick(s, 301_000);
  assert.equal(s.current.status, 'timeout');
  assert.equal(s.results[0].timeSec, 300);
  // a submit that arrives after the deadline does not count
  let s2 = createSession({ config, questions: qs, now: 0 });
  s2 = submitResult(s2, pass('CR-E01'), 400_000);
  assert.equal(s2.current.status, 'timeout');
  assert.equal(s2.total, 0);
});

test('next does nothing while a question is still being played', () => {
  const s = createSession({ config, questions: qs, now: 0 });
  assert.equal(next(s, 5), s);
});

test('test runs are free; wrong submits and lines beyond par cost points', () => {
  const args = { difficulty: 'easy', solved: true, timeLeftSec: 0, timeLimitSec: 300, failedSubmits: 0 };
  assert.equal(scoreQuestion({ ...args, testRuns: 30 }), 100, 'running the visible tests never costs');
  assert.equal(scoreQuestion({ ...args, extraLines: 2 }), 80, '2 lines over par at 10 points');
  assert.deepEqual(scoreBreakdown({ ...args, extraLines: 1, failedSubmits: 1 }),
    { base: 100, timeBonus: 0, submitPenalty: 10, editPenalty: 10, points: 80 });
});

test('a session tracks test runs and lines changed for Bug Hunt', () => {
  const bug = { id: 'BH-E01', mode: 'bug-hunt', difficulty: 'easy', par: 1 };
  let s = createSession({ config: { ...config, mode: 'bug-hunt' }, questions: [bug], now: 0 });
  assert.equal(s.current.par, 1);
  s = testRun(s, { questionId: 'BH-E01', passed: 1, total: 2 }, 1000);
  s = testRun(s, { questionId: 'BH-E01', passed: 2, total: 2 }, 2000);
  assert.equal(s.current.testRuns, 2);
  assert.deepEqual(s.current.lastTest, { passed: 2, total: 2 });
  s = submitResult(s, { ...pass('BH-E01'), linesChanged: 3 }, 90000);
  // 100 + 50 time bonus (half of 180 s left) - 20 (2 lines over par); test runs are free
  assert.equal(s.results[0].extraLines, 2);
  assert.equal(s.results[0].points, 130);
});
