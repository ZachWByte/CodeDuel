import { T, H, A, ALL, stubs } from './helpers.js';

// Classic problems, eleventh batch: first steps in dynamic programming. Each one
// builds a table from the small cases up (number sequences, counting ways,
// cheapest and best paths), so plain recursion is too slow for the bigger tests.
// The solutions and tests are shared with bug-hunt-classic-11.js.

const mat = (rows) => A(rows.map((r) => A(r)));
const table = (n, first, step) => { const t = [...first]; for (let i = t.length; i <= n; i++) t.push(step(t, i)); return t[n]; };

// ---- plain-JS references
const padovanRef = (n) => table(n, [1, 1, 1], (p, i) => p[i - 2] + p[i - 3]);
const lucasRef = (n) => table(n, [2, 1], (l, i) => l[i - 1] + l[i - 2]);
const tileRef = (n) => table(n, [1, 1, 1], (t, i) => t[i - 1] + t[i - 3]);
const jacobsthalRef = (n) => table(n, [0, 1], (j, i) => j[i - 1] + 2 * j[i - 2]);
const noOnesRef = (n) => table(n, [1, 2], (f, i) => f[i - 1] + f[i - 2]);
const waysRef = (n, steps) => { const w = [1]; for (let i = 1; i <= n; i++) w.push(steps.reduce((s, k) => s + (k <= i ? w[i - k] : 0), 0)); return w[n]; };
const minStepsRef = (n) => { const s = [0, 0]; for (let i = 2; i <= n; i++) { let b = s[i - 1] + 1; if (i % 2 === 0) b = Math.min(b, s[i / 2] + 1); if (i % 3 === 0) b = Math.min(b, s[i / 3] + 1); s.push(b); } return s[n]; };
const frogRef = (h) => { const c = [0]; for (let i = 1; i < h.length; i++) c.push(Math.min(c[i - 1] + Math.abs(h[i] - h[i - 1]), i >= 2 ? c[i - 2] + Math.abs(h[i] - h[i - 2]) : Infinity)); return c[h.length - 1]; };
const brokenRef = (n, broken) => { const w = [1]; for (let i = 1; i <= n; i++) w.push(broken.includes(i) ? 0 : w[i - 1] + (i >= 2 ? w[i - 2] : 0)); return w[n]; };
const breakRef = (n) => { const b = [0, 1]; for (let i = 2; i <= n; i++) { let x = 0; for (let j = 1; j < i; j++) x = Math.max(x, j * (i - j), j * b[i - j]); b.push(x); } return b[n]; };
const coinsRef = (g) => { const b = g.map((r) => r.map(() => 0)); for (let r = 0; r < g.length; r++) for (let c = 0; c < g[0].length; c++) b[r][c] = g[r][c] + (r === 0 && c === 0 ? 0 : Math.max(r > 0 ? b[r - 1][c] : -Infinity, c > 0 ? b[r][c - 1] : -Infinity)); return b.at(-1).at(-1); };
const squaresRef = (n) => { const b = [0]; for (let i = 1; i <= n; i++) { let x = i; for (let k = 1; k * k <= i; k++) x = Math.min(x, b[i - k * k] + 1); b.push(x); } return b[n]; };

const hills = [10, 30, 40, 20, 50, 10, 60, 30, 70, 40, 90, 20, 80];
const field = [[1, 3, 1, 5], [2, 0, 4, 1], [6, 2, 1, 3], [0, 4, 2, 2]];
const big = Array.from({ length: 9 }, (_, r) => Array.from({ length: 11 }, (_, c) => (r * 7 + c * 5) % 10));

export const SOL = {
  padovan: `def padovan(n):\n    p = [1] * (n + 3)\n    for i in range(3, n + 1):\n        p[i] = p[i - 2] + p[i - 3]\n    return p[n]`,
  lucas: `def lucas(n):\n    if n == 0:\n        return 2\n    prev = 2\n    cur = 1\n    for i in range(2, n + 1):\n        nxt = prev + cur\n        prev = cur\n        cur = nxt\n    return cur`,
  tile_strip: `def tile_strip(n):\n    ways = [0] * (n + 1)\n    ways[0] = 1\n    for i in range(1, n + 1):\n        ways[i] = ways[i - 1]\n        if i >= 3:\n            ways[i] = ways[i] + ways[i - 3]\n    return ways[n]`,
  count_ways: `def count_ways(n, steps):\n    ways = [0] * (n + 1)\n    ways[0] = 1\n    for i in range(1, n + 1):\n        for j in range(len(steps)):\n            if steps[j] <= i:\n                ways[i] = ways[i] + ways[i - steps[j]]\n    return ways[n]`,
  no_consecutive_ones: `def no_consecutive_ones(n):\n    if n == 0:\n        return 1\n    end0 = 1\n    end1 = 1\n    for i in range(2, n + 1):\n        new0 = end0 + end1\n        new1 = end0\n        end0 = new0\n        end1 = new1\n    return end0 + end1`,
  min_steps_to_one: `def min_steps_to_one(n):\n    steps = [0] * (n + 1)\n    for i in range(2, n + 1):\n        best = steps[i - 1] + 1\n        if i % 2 == 0:\n            best = min(best, steps[i // 2] + 1)\n        if i % 3 == 0:\n            best = min(best, steps[i // 3] + 1)\n        steps[i] = best\n    return steps[n]`,
  frog_jumps: `def frog_jumps(h):\n    n = len(h)\n    cost = [0] * n\n    for i in range(1, n):\n        cost[i] = cost[i - 1] + abs(h[i] - h[i - 1])\n        if i >= 2:\n            cost[i] = min(cost[i], cost[i - 2] + abs(h[i] - h[i - 2]))\n    return cost[n - 1]`,
  jacobsthal: `def jacobsthal(n):\n    j = [0] * (n + 2)\n    j[1] = 1\n    for i in range(2, n + 1):\n        j[i] = j[i - 1] + 2 * j[i - 2]\n    return j[n]`,
  broken_stairs: `def broken_stairs(n, broken):\n    ok = [True] * (n + 1)\n    for i in range(len(broken)):\n        ok[broken[i]] = False\n    ways = [0] * (n + 1)\n    ways[0] = 1\n    for i in range(1, n + 1):\n        if ok[i]:\n            ways[i] = ways[i - 1]\n            if i >= 2:\n                ways[i] = ways[i] + ways[i - 2]\n    return ways[n]`,
  integer_break: `def integer_break(n):\n    best = [0] * (n + 1)\n    best[1] = 1\n    for i in range(2, n + 1):\n        for j in range(1, i):\n            best[i] = max(best[i], max(j * (i - j), j * best[i - j]))\n    return best[n]`,
  max_coins: `def max_coins(grid):\n    rows = len(grid)\n    cols = len(grid[0])\n    best = [None] * rows\n    for r in range(rows):\n        best[r] = [0] * cols\n    for r in range(rows):\n        for c in range(cols):\n            if r == 0 and c == 0:\n                best[r][c] = grid[0][0]\n            elif r == 0:\n                best[r][c] = best[r][c - 1] + grid[r][c]\n            elif c == 0:\n                best[r][c] = best[r - 1][c] + grid[r][c]\n            else:\n                best[r][c] = max(best[r - 1][c], best[r][c - 1]) + grid[r][c]\n    return best[rows - 1][cols - 1]`,
  min_squares: `def min_squares(n):\n    best = [0] * (n + 1)\n    for i in range(1, n + 1):\n        best[i] = i\n        k = 1\n        while k * k <= i:\n            best[i] = min(best[i], best[i - k * k] + 1)\n            k = k + 1\n    return best[n]`,
};

export const TESTS = {
  padovan: [
    T('padovan', [5], 3),
    T('padovan', [0], 1, { note: 'the first one' }),
    T('padovan', [9], 9),
    H('padovan', [2], 1),
    H('padovan', [3], 2),
    H('padovan', [12], padovanRef(12)),
    H('padovan', [60], padovanRef(60)),
  ],
  lucas: [
    T('lucas', [0], 2),
    T('lucas', [1], 1),
    T('lucas', [5], 11),
    H('lucas', [2], 3),
    H('lucas', [10], lucasRef(10)),
    H('lucas', [40], lucasRef(40)),
    H('lucas', [70], lucasRef(70)),
  ],
  tile_strip: [
    T('tile_strip', [4], 3),
    T('tile_strip', [3], 2, { note: 'one long tile, or three short ones' }),
    H('tile_strip', [0], 1),
    H('tile_strip', [2], 1),
    H('tile_strip', [6], tileRef(6)),
    H('tile_strip', [60], tileRef(60)),
  ],
  count_ways: [
    T('count_ways', [4, A([1, 2])], 5),
    T('count_ways', [3, A([3])], 1, { note: 'one big step' }),
    H('count_ways', [0, A([1, 2])], 1),
    H('count_ways', [5, A([2])], 0),
    H('count_ways', [10, A([1, 3, 5])], waysRef(10, [1, 3, 5])),
    H('count_ways', [40, A([1, 2, 3])], waysRef(40, [1, 2, 3])),
  ],
  no_consecutive_ones: [
    T('no_consecutive_ones', [3], 5),
    T('no_consecutive_ones', [2], 3, { note: '00, 01 and 10' }),
    H('no_consecutive_ones', [0], 1),
    H('no_consecutive_ones', [1], 2),
    H('no_consecutive_ones', [10], noOnesRef(10)),
    H('no_consecutive_ones', [40], noOnesRef(40)),
  ],
  min_steps_to_one: [
    T('min_steps_to_one', [10], 3),
    T('min_steps_to_one', [1], 0, { note: 'already there' }),
    T('min_steps_to_one', [2], 1),
    H('min_steps_to_one', [3], 1),
    H('min_steps_to_one', [7], 3),
    H('min_steps_to_one', [100], minStepsRef(100)),
    H('min_steps_to_one', [9999], minStepsRef(9999)),
  ],
  frog_jumps: [
    T('frog_jumps', [A([10, 30, 40, 20])], 30),
    T('frog_jumps', [A([5])], 0, { note: 'already on the last stone' }),
    T('frog_jumps', [A([10, 50, 10])], 0, { note: 'jump over the middle' }),
    H('frog_jumps', [A([1, 2])], 1),
    H('frog_jumps', [A([30, 10, 60, 10, 60, 50])], frogRef([30, 10, 60, 10, 60, 50])),
    H('frog_jumps', [A([7, 100, 7, 100, 7])], 0),
    H('frog_jumps', [A(hills)], frogRef(hills)),
  ],
  jacobsthal: [
    T('jacobsthal', [4], 5),
    T('jacobsthal', [0], 0),
    T('jacobsthal', [1], 1),
    H('jacobsthal', [2], 1),
    H('jacobsthal', [3], 3),
    H('jacobsthal', [10], jacobsthalRef(10)),
    H('jacobsthal', [50], jacobsthalRef(50)),
  ],
  broken_stairs: [
    T('broken_stairs', [4, A([2])], 1),
    T('broken_stairs', [3, A([])], 3, { note: 'nothing broken' }),
    H('broken_stairs', [1, A([])], 1),
    H('broken_stairs', [5, A([2, 3])], 0),
    H('broken_stairs', [6, A([1, 4])], brokenRef(6, [1, 4])),
    H('broken_stairs', [30, A([5, 11, 17])], brokenRef(30, [5, 11, 17])),
  ],
  integer_break: [
    T('integer_break', [10], 36),
    T('integer_break', [2], 1, { note: '1 + 1' }),
    T('integer_break', [4], 4),
    H('integer_break', [3], 2),
    H('integer_break', [8], 18),
    H('integer_break', [20], breakRef(20)),
    H('integer_break', [58], breakRef(58)),
  ],
  max_coins: [
    T('max_coins', [mat(field)], coinsRef(field)),
    T('max_coins', [mat([[5]])], 5, { note: 'one cell' }),
    H('max_coins', [mat([[1, 2, 3]])], 6),
    H('max_coins', [mat([[1], [9], [1]])], 11),
    H('max_coins', [mat([[0, 9], [9, 0]])], 9),
    H('max_coins', [mat(big)], coinsRef(big)),
  ],
  min_squares: [
    T('min_squares', [12], 3),
    T('min_squares', [13], 2, { note: '4 + 9' }),
    T('min_squares', [16], 1, { note: 'a square already' }),
    H('min_squares', [1], 1),
    H('min_squares', [7], 4),
    H('min_squares', [100], 1),
    H('min_squares', [500], squaresRef(500)),
  ],
};

const q = (id, title, fn, args, description, extra = {}) => ({
  id, mode: 'code-race', difficulty: 'easy', topic: 'dynamic programming', title, languages: ALL, functionName: fn, description,
  starter: stubs(`${fn}(${args})`), solution: { sicpy: SOL[fn], python: SOL[fn] }, tests: TESTS[fn], ...extra,
});

export default [
  q('CR-E175', 'Padovan numbers', 'padovan', 'n',
    'The Padovan numbers start 1, 1, 1, and after that each one is the sum of the numbers **two and three places back**: 1, 1, 1, 2, 2, 3, 4, 5, 7, 9, … Write `padovan(n)` that returns the `n`-th one, counting from 0.\n\n`n` goes up to 60: fill in an array from the start rather than recursing.'),
  q('CR-E176', 'Lucas numbers', 'lucas', 'n',
    'The Lucas numbers are like the Fibonacci numbers but start with 2 and 1: 2, 1, 3, 4, 7, 11, 18, … (each is the sum of the two before). Write `lucas(n)` that returns the `n`-th one, counting from 0.\n\n`n` goes up to 70, so keep just the last two values as you go.'),
  q('CR-E177', 'Tiling a strip', 'tile_strip', 'n',
    'A strip `n` squares long is covered with tiles that are 1 or 3 squares long. Write `tile_strip(n)` that returns how many different ways there are to cover it. For example a strip of 4 can be 1+1+1+1, 1+3 or 3+1, so 3 ways. An empty strip (`n` = 0) has one way: no tiles.\n\nThe last tile is either short or long, so the ways for `n` are the ways for `n - 1` plus the ways for `n - 3`. `n` goes up to 60.'),
  q('CR-E178', 'Climbing with any steps', 'count_ways', 'n, steps',
    'You climb `n` stairs, and each move goes up by one of the sizes in the array `steps` (all different and positive). Write `count_ways(n, steps)` that returns how many different sequences of moves reach exactly the top. Climbing 0 stairs takes one way: do nothing.\n\nFor example with steps `[1, 2]`, 4 stairs can be climbed in 5 ways. `n` goes up to 40: count the ways for each stair from the bottom up.'),
  q('CR-E179', 'No two ones in a row', 'no_consecutive_ones', 'n',
    'Write `no_consecutive_ones(n)` that returns how many strings of `n` binary digits have no two 1s next to each other. For length 2 there are 3 (`00`, `01`, `10`); the empty string (`n` = 0) counts as one.\n\nKeep two counts as the length grows: strings ending in 0, and strings ending in 1. A 0 can follow either; a 1 can only follow a 0. `n` goes up to 40.'),
  q('CR-E180', 'Down to one', 'min_steps_to_one', 'n',
    'Starting from `n` (n ≥ 1), each step you may subtract 1, halve the number if it is even, or divide it by 3 if it is a multiple of 3. Write `min_steps_to_one(n)` that returns the fewest steps to reach 1. For example 10 → 9 → 3 → 1 takes 3.\n\nHalving whenever you can is not always best (10 → 5 → 4 → 2 → 1 takes 4). Work out the answer for every number from 2 up to `n` (at most 10 000).'),
  q('CR-E181', 'Frog on the stones', 'frog_jumps', 'h',
    'A frog sits on the first of a row of stones with heights `h`. It jumps to the next stone or the one after it, and a jump from height `a` to height `b` costs `abs(a - b)`. Write `frog_jumps(h)` that returns the cheapest total cost to reach the last stone (0 if there is only one).\n\nThe cheapest way to reach stone `i` comes from stone `i - 1` or stone `i - 2`.'),
  q('CR-E182', 'Jacobsthal numbers', 'jacobsthal', 'n',
    'The Jacobsthal numbers start 0, 1, and after that each one is the one before **plus twice** the one before that: 0, 1, 1, 3, 5, 11, 21, … Write `jacobsthal(n)` that returns the `n`-th one, counting from 0. `n` goes up to 50.\n\nIn full Python you may **not** use `**` or `pow`.',
    { banned: { python: ['**', 'pow'] } }),
  q('CR-E183', 'Broken stairs', 'broken_stairs', 'n, broken',
    'You climb from step 0 to step `n`, one or two steps at a time, but you may not stand on the steps listed in the array `broken` (each between 1 and `n - 1`). Write `broken_stairs(n, broken)` that returns how many ways there are to reach step `n`.\n\nMark the broken steps first; a broken step can be reached in 0 ways.'),
  q('CR-E184', 'Break it up', 'integer_break', 'n',
    'Write `integer_break(n)` (n ≥ 2) that splits `n` into **at least two** positive whole numbers that add up to `n` and returns the biggest product they can have. For example 10 = 3 + 3 + 4 gives 36.\n\nFor each number, try every size `j` for the first piece: the rest is either kept whole or broken up further (its best, from your table).'),
  q('CR-M70', 'Collect the most coins', 'max_coins', 'grid',
    '`grid` is a 2-D array of coin counts. A robot starts in the top-left cell and moves only **right** or **down** to the bottom-right cell, collecting the coins on every cell it visits (both ends included). Write `max_coins(grid)` that returns the most coins it can collect.\n\nThe best total for a cell is its coins plus the better of the best totals above it and to its left.',
    { difficulty: 'medium' }),
  q('CR-M71', 'Fewest squares', 'min_squares', 'n',
    'Write `min_squares(n)` (n ≥ 1) that returns the fewest perfect squares (1, 4, 9, 16, …) that add up to `n`. For example 12 = 4 + 4 + 4 takes 3, and 13 = 4 + 9 takes 2.\n\nTaking the biggest square first is not always best (12 = 9 + 1 + 1 + 1 takes 4). For each number up to `n` (at most 500), try every square that fits.\n\nIn full Python you may **not** use `sqrt` or `isqrt`.',
    { difficulty: 'medium', banned: { python: ['sqrt', 'isqrt'] } }),
];
