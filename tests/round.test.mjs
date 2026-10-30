import test from 'node:test';
import assert from 'node:assert/strict';
import { createRound, reduceRound, roundTimeLeftSec, worthNow, questionBreakdown, rankSides } from '../src/state/round.js';

const qs = [
  { id: 'CR-E01', mode: 'code-race', difficulty: 'easy' },
  { id: 'CR-M01', mode: 'code-race', difficulty: 'medium' },
];
const config = { lang: 'python', mode: 'code-race', difficulty: 'mixed', count: 2, minutes: 10 };
const pass = (id) => ({ questionId: id, passedVisible: 2, passedHidden: 4, total: 6, totalHidden: 4 });
const partly = (id, hidden) => ({ questionId: id, passedVisible: 2, passedHidden: hidden, total: 6, totalHidden: 4 });
const act = (s, type, result, now) => reduceRound(s, { type, result, now });

test('one clock for the round; questions are solved in any order', () => {
  let s = createRound({ config, questions: qs, now: 0 });
  assert.equal(s.durationSec, 600);
  assert.equal(roundTimeLeftSec(s, 150_000), 450);
  // The second question first, with a quarter of the round gone: 200 + 75.
  s = act(s, 'submitResult', pass('CR-M01'), 150_000);
  assert.equal(s.qs[1].status, 'solved');
  assert.equal(s.qs[1].points, 275);
  assert.equal(s.total, 275);
  assert.equal(s.status, 'playing');
  s = act(s, 'submitResult', partly('CR-E01', 1), 160_000);
  assert.equal(s.qs[0].failedSubmits, 1);
  assert.equal(s.qs[0].points, 0, 'no partial credit unless the room turns it on');
  s = act(s, 'submitResult', pass('CR-E01'), 300_000);
  // 100 + 25 - 10 (one wrong submit); every question solved ends the round.
  assert.equal(s.qs[0].points, 115);
  assert.equal(s.status, 'finished');
  assert.equal(s.endReason, 'solved');
  assert.equal(s.total, 390);
});

test('the clock ends the round and nothing counts after it', () => {
  let s = createRound({ config, questions: qs, now: 0 });
  s = act(s, 'tick', undefined, 600_000);
  assert.equal(s.status, 'finished');
  assert.equal(s.endReason, 'time');
  const after = act(s, 'submitResult', pass('CR-E01'), 600_001);
  assert.equal(after.total, 0);
  assert.equal(roundTimeLeftSec(after, 900_000), 0);
});

test('partial credit: secret tests passed earn points, the best submit counts', () => {
  const cfg = { ...config, partial: true };
  let s = createRound({ config: cfg, questions: qs, now: 0 });
  s = act(s, 'submitResult', partly('CR-E01', 2), 10_000);
  assert.equal(s.qs[0].points, 25, 'half of 100 for 2 of 4 secret tests');
  s = act(s, 'submitResult', partly('CR-E01', 1), 20_000);
  assert.equal(s.qs[0].points, 25, 'a worse submit does not lower it');
  s = act(s, 'submitResult', partly('CR-M01', 3), 20_000);
  assert.equal(s.qs[1].points, 75);
  assert.equal(s.total, 100);
  // A late solve with penalties never scores below full partial credit.
  for (let i = 0; i < 9; i++) s = act(s, 'submitResult', partly('CR-E01', 0), 30_000);
  s = act(s, 'submitResult', pass('CR-E01'), 599_000);
  assert.equal(s.qs[0].points, 50);
});

test('revealing a failed secret test costs a share of the question', () => {
  const cfg = { ...config, revealCost: 0.25 };
  let s = createRound({ config: cfg, questions: qs, now: 0 });
  assert.equal(worthNow(s, s.qs[0], 0).points, 150);
  s = act(s, 'reveal', { questionId: 'CR-E01', testIndex: 4 }, 1000);
  s = act(s, 'reveal', { questionId: 'CR-E01', testIndex: 4 }, 1000);
  assert.deepEqual(s.qs[0].reveals, [4], 'the same test is revealed once');
  const worth = worthNow(s, s.qs[0], 1000);
  assert.equal(worth.revealPenalty, 25);
  assert.equal(worth.points, 150 - 25);
  // Reveals are off when the room does not allow them.
  const off = act(createRound({ config, questions: qs, now: 0 }), 'reveal', { questionId: 'CR-E01', testIndex: 4 }, 1);
  assert.deepEqual(off.qs[0].reveals, []);
});

test('worth-now falls with the clock and shows what was lost', () => {
  let s = createRound({ config, questions: qs, now: 0 });
  s = act(s, 'testRun', { questionId: 'CR-E01', passed: 1, total: 2 }, 0);
  s = act(s, 'testRun', { questionId: 'CR-E01', passed: 2, total: 2 }, 0);
  s = act(s, 'submitResult', partly('CR-E01', 3), 0);
  const w = worthNow(s, s.qs[0], 300_000);
  assert.equal(w.timeBonus, 25);
  assert.equal(w.lost, 5 + 10);
  assert.equal(w.points, 100 + 25 - 15);
  assert.equal(questionBreakdown(s.qs[0], s.config, { solved: false }).points, 0);
});

test('finish stops a round early', () => {
  let s = createRound({ config, questions: qs, now: 0 });
  s = act(s, 'submitResult', pass('CR-E01'), 60_000);
  s = act(s, 'finish', undefined, 61_000);
  assert.equal(s.status, 'finished');
  assert.equal(s.endReason, 'finished');
  assert.equal(act(s, 'submitResult', pass('CR-M01'), 62_000).total, s.total);
});

test('sides rank by points, then solves; ties share a rank', () => {
  const mk = (key, total, solvedAt = []) => ({ key, state: { total, qs: solvedAt.map((t) => ({ status: 'solved', solvedAt: t })) } });
  const ranked = rankSides([mk('a', 100, [5]), mk('b', 300, [9]), mk('c', 100, [3]), mk('d', 0)]);
  assert.deepEqual(ranked.map((s) => [s.key, s.rank]), [['b', 1], ['c', 2], ['a', 2], ['d', 4]]);
});
