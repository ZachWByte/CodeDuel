import test from 'node:test';
import assert from 'node:assert/strict';
import { createRound, reduceRound, roundTimeLeftSec, spentSec, worthNow, questionBreakdown, rankSides } from '../src/state/round.js';

const qs = [
  { id: 'CR-E01', mode: 'code-race', difficulty: 'easy' },
  { id: 'CR-M01', mode: 'code-race', difficulty: 'medium' },
];
const config = { lang: 'python', mode: 'code-race', difficulty: 'mixed', count: 2, minutes: 0 };
const timed = { ...config, minutes: 10 };
const pass = (id) => ({ questionId: id, passedVisible: 2, passedHidden: 4, total: 6, totalHidden: 4 });
const partly = (id, hidden) => ({ questionId: id, passedVisible: 2, passedHidden: hidden, total: 6, totalHidden: 4 });
const act = (s, type, result, now) => reduceRound(s, { type, result, now });
const open = (s, by, questionId, now) => reduceRound(s, { type: 'view', by, questionId, now });

test('questions are solved in any order; every question solved ends the round', () => {
  let s = createRound({ config, questions: qs, now: 0 });
  assert.equal(s.endsAt, null, 'no limit: no clock for the round');
  // The second question first, after 5 of its usual 10 minutes on it: 200 - 50.
  s = open(s, 'ada', 'CR-M01', 0);
  s = act(s, 'submitResult', pass('CR-M01'), 300_000);
  assert.equal(s.qs[1].status, 'solved');
  assert.equal(s.qs[1].points, 150);
  assert.equal(s.total, 150);
  assert.equal(s.status, 'playing');
  // Nobody has the first one open yet, so all that time cost it nothing: 100 - 10 (one wrong submit).
  s = act(s, 'submitResult', partly('CR-E01', 1), 310_000);
  assert.equal(s.qs[0].failedSubmits, 1);
  assert.equal(s.qs[0].points, 0, 'no partial credit unless the room turns it on');
  s = act(s, 'submitResult', pass('CR-E01'), 320_000);
  assert.equal(s.qs[0].points, 90);
  assert.equal(s.status, 'finished');
  assert.equal(s.endReason, 'solved');
  assert.equal(s.total, 240);
  assert.equal(act(s, 'finish', undefined, 330_000), s, 'nothing changes after the end');
});

test('the round clock ends the round; unsolved questions score nothing', () => {
  let s = createRound({ config: timed, questions: qs, now: 1000 });
  assert.equal(s.durationSec, 600);
  assert.equal(s.endsAt, 601_000);
  assert.equal(roundTimeLeftSec(s, 0), 600, 'never more than the round, even during the countdown');
  assert.equal(roundTimeLeftSec(s, 301_000), 300);
  s = open(s, 'ada', 'CR-E01', 1000);
  s = act(s, 'submitResult', pass('CR-E01'), 2000);
  s = open(s, 'ada', 'CR-M01', 2000);
  const same = s;
  s = act(s, 'tick', undefined, 600_999);
  assert.equal(s, same, 'not yet');
  s = act(s, 'tick', undefined, 700_000);
  assert.equal(s.status, 'finished');
  assert.equal(s.endReason, 'time');
  assert.equal(s.endedAt, 601_000, 'it ends when the clock ran out, not when someone noticed');
  assert.equal(roundTimeLeftSec(s, 700_000), 0);
  assert.equal(s.qs[1].points, 0);
  assert.equal(s.total, s.qs[0].points);
  assert.equal(spentSec(s.qs[1], 700_000), 599, 'the question’s clock stopped with the round');
});

test('an action after the time is up is too late', () => {
  for (const [type, result] of [['submitResult', pass('CR-E01')], ['testRun', { questionId: 'CR-E01', passed: 1, total: 2 }], ['finish', undefined]]) {
    const s = act(createRound({ config: timed, questions: qs, now: 0 }), type, result, 600_000);
    assert.equal(s.endReason, 'time', type);
    assert.equal(s.total, 0, type);
    assert.equal(s.qs[0].attempts + s.qs[0].testRuns, 0, type);
  }
});

test('no limit: the clock never ends the round', () => {
  const s = createRound({ config, questions: qs, now: 0 });
  assert.equal(roundTimeLeftSec(s, 1000), null);
  assert.equal(act(s, 'tick', undefined, 1e12), s);
});

test('a round with no minutes given gets the default clock', () => {
  const { minutes, ...plain } = config;
  assert.equal(createRound({ config: plain, questions: qs, now: 0 }).durationSec, 900);
});

test('only the open question loses points, and gently', () => {
  let s = createRound({ config, questions: qs, now: 1000 });
  s = open(s, 'ada', 'CR-E01', 0); // during the countdown: starts at the round's start
  assert.equal(s.qs[0].openSince, 1000);
  s = open(s, 'ada', 'CR-M01', 151_000); // 150 s on the first, half of its 5 minutes
  assert.equal(spentSec(s.qs[0], 400_000), 150, 'it stopped when they moved on');
  assert.equal(worthNow(s, s.qs[0], 400_000).timePenalty, 25);
  assert.equal(worthNow(s, s.qs[0], 400_000).points, 75);
  // Back to the first: it carries on from where it was.
  s = open(s, 'ada', 'CR-E01', 400_000);
  assert.equal(spentSec(s.qs[1], 900_000), 249, 'the second kept its time');
  assert.equal(spentSec(s.qs[0], 410_000), 160);
  // However long it takes, time alone costs at most half.
  assert.equal(worthNow(s, s.qs[0], 99_000_000).timePenalty, 50);
  assert.equal(worthNow(s, s.qs[0], 99_000_000).points, 50);
  // Away (null): no question's clock runs.
  s = open(s, 'ada', null, 410_000);
  assert.equal(spentSec(s.qs[0], 900_000), 160);
});

test('a question’s clock runs while any teammate has it open', () => {
  let s = createRound({ config, questions: qs, now: 0 });
  s = open(s, 'ada', 'CR-E01', 0);
  s = open(s, 'bob', 'CR-E01', 10_000);
  s = open(s, 'ada', 'CR-M01', 20_000);
  assert.equal(spentSec(s.qs[0], 30_000), 30, 'Bob is still on it');
  s = open(s, 'bob', 'CR-M01', 30_000);
  assert.equal(spentSec(s.qs[0], 90_000), 30);
  assert.equal(spentSec(s.qs[1], 40_000), 20, 'not counted twice');
});

test('a solved question and a finished round stop the clock', () => {
  let s = createRound({ config, questions: qs, now: 0 });
  s = open(s, 'ada', 'CR-E01', 0);
  s = act(s, 'submitResult', pass('CR-E01'), 30_000);
  assert.equal(s.qs[0].openSince, null);
  assert.equal(spentSec(s.qs[0], 90_000), 30);
  s = open(s, 'ada', 'CR-M01', 30_000);
  s = act(s, 'finish', undefined, 60_000);
  assert.equal(spentSec(s.qs[1], 90_000), 30);
  assert.equal(open(s, 'ada', 'CR-E01', 90_000), s, 'nothing changes after the end');
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
  assert.equal(worthNow(s, s.qs[0], 0).points, 100);
  s = act(s, 'reveal', { questionId: 'CR-E01', testIndex: 4 }, 1000);
  s = act(s, 'reveal', { questionId: 'CR-E01', testIndex: 4 }, 1000);
  assert.deepEqual(s.qs[0].reveals, [4], 'the same test is revealed once');
  const worth = worthNow(s, s.qs[0], 1000);
  assert.equal(worth.revealPenalty, 25);
  assert.equal(worth.points, 100 - 25);
  // Reveals are off when the room does not allow them.
  const off = act(createRound({ config, questions: qs, now: 0 }), 'reveal', { questionId: 'CR-E01', testIndex: 4 }, 1);
  assert.deepEqual(off.qs[0].reveals, []);
});

test('worth-now falls with the question’s clock and shows what was lost (test runs are free)', () => {
  let s = createRound({ config, questions: qs, now: 0 });
  s = open(s, 'ada', 'CR-E01', 0);
  s = act(s, 'testRun', { questionId: 'CR-E01', passed: 1, total: 2 }, 0);
  s = act(s, 'testRun', { questionId: 'CR-E01', passed: 2, total: 2 }, 0);
  s = act(s, 'submitResult', partly('CR-E01', 3), 0);
  const w = worthNow(s, s.qs[0], 150_000);
  assert.equal(w.timePenalty, 25);
  assert.equal(w.lost, 35, 'the time and the wrong submit');
  assert.equal(w.points, 100 - 35);
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
