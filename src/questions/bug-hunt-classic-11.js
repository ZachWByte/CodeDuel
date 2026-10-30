import { ALL, breakCode } from './helpers.js';
import { SOL, TESTS } from './code-race-classic-11.js';

// Bug Hunt versions of the first dynamic-programming problems in
// code-race-classic-11.js. Each buggy program is the shared solution with a few
// pieces of text swapped.

const bh = (id, difficulty, title, fn, description, swaps, bugExplanation) => {
  const { buggy, lines } = breakCode(SOL[fn], swaps);
  return {
    id, mode: 'bug-hunt', difficulty, topic: 'dynamic programming', title, languages: ALL, functionName: fn,
    description: `${description} Find and fix the bug.`,
    buggy: { sicpy: buggy, python: buggy },
    bugLines: { sicpy: lines, python: lines },
    bugExplanation,
    solution: { sicpy: SOL[fn], python: SOL[fn] },
    tests: TESTS[fn],
  };
};

export default [
  bh('BH-E140', 'easy', 'Looking back the wrong distance', 'padovan',
    '`padovan(n)` should return the Padovan numbers 1, 1, 1, 2, 2, 3, 4, 5, 7, 9, …, each the sum of the numbers two and three places back. Its numbers grow too fast.',
    [['p[i - 2] + p[i - 3]', 'p[i - 1] + p[i - 3]']],
    'Each Padovan number adds the ones two and three places back; p[i - 1] is only one place back. Use p[i - 2] + p[i - 3].'),
  bh('BH-E141', 'easy', 'Starting the wrong way round', 'lucas',
    '`lucas(n)` should return the Lucas numbers 2, 1, 3, 4, 7, 11, … It gets every one after the first wrong.',
    [['    prev = 2\n    cur = 1', '    prev = 1\n    cur = 2']],
    'The loop starts from lucas(0) = 2 and lucas(1) = 1, in that order: prev is the older value (2) and cur the newer one (1). Swapped, every later number comes out wrong.'),
  bh('BH-E142', 'easy', 'The first long tile', 'tile_strip',
    '`tile_strip(n)` should count the ways to cover a strip of `n` squares with tiles 1 and 3 squares long. It misses the ways that use a long tile at the very start.',
    [['if i >= 3:', 'if i > 3:']],
    'A long tile fits as soon as the strip is 3 long, but i > 3 only allows it from 4 on, so the single long tile for n = 3 (and everything built on it) is lost. Use i >= 3.'),
  bh('BH-E143', 'easy', 'The step from the ground', 'count_ways',
    '`count_ways(n, steps)` should count the sequences of moves (each a size from `steps`) that climb exactly `n` stairs. It never counts a move that starts from the ground.',
    [['steps[j] <= i', 'steps[j] < i']],
    'A move of size steps[j] can land on stair i when steps[j] <= i; with <, a move from stair 0 (ways[0], the one way to stand at the bottom) is never used. Use steps[j] <= i.'),
  bh('BH-E144', 'easy', 'Two ones in a row', 'no_consecutive_ones',
    '`no_consecutive_ones(n)` should count binary strings of length `n` with no two 1s next to each other. It counts every binary string instead.',
    [['new1 = end0\n', 'new1 = end0 + end1\n']],
    'A 1 may only follow a 0, so the strings ending in 1 come only from those ending in 0: new1 = end0. Adding end1 lets 11 appear.'),
  bh('BH-E145', 'easy', 'Taking one away for free', 'min_steps_to_one',
    '`min_steps_to_one(n)` should return the fewest steps (subtract 1, halve, or divide by 3) from `n` to 1. Its answers are too small.',
    [['best = steps[i - 1] + 1', 'best = steps[i - 1]']],
    'Subtracting 1 is a step too: going through i - 1 costs steps[i - 1] + 1.'),
  bh('BH-E146', 'easy', 'No long jump off the start', 'frog_jumps',
    '`frog_jumps(h)` should return the cheapest cost for the frog to reach the last stone, jumping one or two stones at a time. It never jumps over the second stone.',
    [['if i >= 2:', 'if i > 2:']],
    'A two-stone jump can land on stone 2 (from stone 0), but i > 2 only allows it from stone 3 on. Use i >= 2.'),
  bh('BH-E147', 'easy', 'Doubling the wrong one', 'jacobsthal',
    '`jacobsthal(n)` should return 0, 1, 1, 3, 5, 11, 21, …, where each number is the one before plus twice the one before that. Its numbers grow too fast.',
    [['j[i - 1] + 2 * j[i - 2]', '2 * j[i - 1] + j[i - 2]']],
    'The doubled term is the one two places back: j[i - 1] + 2 * j[i - 2]. Doubling j[i - 1] gives the Pell numbers instead.'),
  bh('BH-E148', 'easy', 'Breaking the first few', 'broken_stairs',
    '`broken_stairs(n, broken)` should count the ways to climb to step `n` one or two steps at a time without standing on a broken step. It marks the wrong steps as broken.',
    [['ok[broken[i]] = False', 'ok[i] = False']],
    'i is a position in the array broken, not a step number. The step to mark is broken[i]: ok[broken[i]] = False.'),
  bh('BH-E149', 'easy', 'Never stopping at two pieces', 'integer_break',
    '`integer_break(n)` should split `n` into at least two parts with the biggest product. It is too low for some numbers, such as 4 = 2 + 2.',
    [['max(j * (i - j), j * best[i - j])', 'j * best[i - j]']],
    'After the first piece j, the rest can be broken up further (best[i - j]) or kept whole (i - j). Keeping it whole is sometimes better (4 = 2 + 2), so take the larger: max(j * (i - j), j * best[i - j]).'),
  bh('BH-M45', 'medium', 'Taking the poorer road', 'max_coins',
    '`max_coins(grid)` should return the most coins the robot can collect going right and down from the top-left to the bottom-right cell. It collects too few.',
    [['max(best[r - 1][c], best[r][c - 1])', 'min(best[r - 1][c], best[r][c - 1])']],
    'From above or from the left, the robot should arrive by the richer route: max, not min.'),
  bh('BH-M46', 'medium', 'The square that fits exactly', 'min_squares',
    '`min_squares(n)` should return the fewest perfect squares that add up to `n`. It never uses a square equal to the number itself, so 4, 9, 16, … come out too big.',
    [['while k * k <= i:', 'while k * k < i:']],
    'A square equal to i fits too (i itself is one square). With <, the loop stops before trying it. Use k * k <= i.'),
];
