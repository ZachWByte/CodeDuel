import { T, H, A, ALL, stubs } from './helpers.js';

// Classic contest and interview problems (the ideas behind well-known LeetCode /
// Codeforces tasks, written fresh). Inputs are arrays ([...]), which look the same
// in Python § and full Python, so one program usually works in both.

const both = (code) => ({ sicpy: code, python: code });
const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const chars = (s) => A(s.split(''));

// ---- plain-JS references for the bigger tests
const collatz = (n) => { let s = 0; while (n !== 1) { n = n % 2 === 0 ? n / 2 : 3 * n + 1; s++; } return s; };
const kadane = (a) => { let best = a[0]; let cur = a[0]; for (let i = 1; i < a.length; i++) { cur = Math.max(a[i], cur + a[i]); best = Math.max(best, cur); } return best; };
const robRef = (a) => { let take = 0; let skip = 0; for (const x of a) { const t = skip + x; skip = Math.max(skip, take); take = t; } return Math.max(take, skip); };
const balanceRef = (a) => { const total = a.reduce((s, x) => s + x, 0); let left = 0; for (let i = 0; i < a.length; i++) { if (left === total - left - a[i]) return i; left += a[i]; } return -1; };
const coinsRef = (coins, amount) => {
  const best = new Array(amount + 1).fill(amount + 1); best[0] = 0;
  for (let c = 1; c <= amount; c++) for (const k of coins) if (k <= c) best[c] = Math.min(best[c], best[c - k] + 1);
  return best[amount] > amount ? -1 : best[amount];
};
const trapRef = (h) => { let w = 0; for (let i = 0; i < h.length; i++) { const l = Math.max(...h.slice(0, i + 1)); const r = Math.max(...h.slice(i)); w += Math.min(l, r) - h[i]; } return w; };
const decodeRef = (d) => { const w = new Array(d.length + 1).fill(0); w[0] = 1; for (let i = 1; i <= d.length; i++) { if (d[i - 1] !== 0) w[i] = w[i - 1]; if (i >= 2) { const t = d[i - 2] * 10 + d[i - 1]; if (t >= 10 && t <= 26) w[i] += w[i - 2]; } } return w[d.length]; };
const splitRef = (a) => { const total = a.reduce((s, x) => s + x, 0); if (total % 2) return false; const half = total / 2; const ok = new Array(half + 1).fill(false); ok[0] = true; for (const x of a) for (let s = half; s >= x; s--) if (ok[s - x]) ok[s] = true; return ok[half]; };
const nextGreaterRef = (a) => a.map((x, i) => a.slice(i + 1).find((y) => y > x) ?? -1);
const diceRef = (n, t) => { let ways = new Array(t + 1).fill(0); ways[0] = 1; for (let k = 0; k < n; k++) { const nw = new Array(t + 1).fill(0); for (let s = 0; s <= t; s++) for (let f = 1; f <= 6 && f <= s; f++) nw[s] += ways[s - f]; ways = nw; } return ways[t]; };

const wave = seq(60, (i) => ((i * 37) % 23) - 11);
const street = seq(60, (i) => (i * 53) % 97);
const bumpy = seq(120, (i) => (i * 29) % 17);
const longBalance = [...seq(30, (i) => (i % 7) + 1), 50, ...seq(30, (i) => ((29 - i) % 7) + 1)];
const rotated = seq(200, (i) => (i + 57) % 200);
const shuffled = seq(100, (i) => (i * 37) % 100).filter((x) => x !== 37);
const splitBig = seq(30, (i) => (i * 13) % 31 + 1);

export default [
// ------------------------------------------------------------------ easy
{
  id: 'CR-E21', mode: 'code-race', difficulty: 'easy', topic: 'memoisation',
  title: 'Climbing stairs',
  languages: ALL,
  functionName: 'climb_stairs',
  description: 'You climb a staircase of `n` steps, taking either 1 or 2 steps at a time. Write `climb_stairs(n)` that returns the number of different ways to reach the top.\n\n`n` is an integer, 1 ≤ n ≤ 45. The plain recursive answer repeats the same work over and over and is far too slow for big `n`: remember (or build up) the answers you have already worked out.',
  starter: stubs('climb_stairs(n)'),
  solution: both(`def climb_stairs(n):\n    a = 1\n    b = 1\n    for i in range(n - 1):\n        c = a + b\n        a = b\n        b = c\n    return b`),
  tests: [
    T('climb_stairs', [3], 3),
    T('climb_stairs', [1], 1, { note: 'one step' }),
    H('climb_stairs', [2], 2),
    H('climb_stairs', [5], 8),
    H('climb_stairs', [10], 89),
    H('climb_stairs', [30], 1346269),
    H('climb_stairs', [45], 1836311903),
  ],
},
{
  id: 'CR-E22', mode: 'code-race', difficulty: 'easy', topic: 'greedy',
  title: 'Best trade',
  languages: ALL,
  functionName: 'best_trade',
  description: '`prices[i]` is the price of a share on day `i`. Write `best_trade(prices)` that returns the largest profit you can make by buying on one day and selling on a **later** day. If no trade makes money, return 0.\n\n`prices` is a non-empty array (a list written `[...]`) of at most 200 integers.',
  starter: stubs('best_trade(prices)'),
  solution: both(`def best_trade(prices):\n    lowest = prices[0]\n    best = 0\n    for i in range(1, len(prices)):\n        best = max(best, prices[i] - lowest)\n        lowest = min(lowest, prices[i])\n    return best`),
  tests: [
    T('best_trade', [A([7, 1, 5, 3, 6, 4])], 5),
    T('best_trade', [A([7, 6, 4, 3, 1])], 0, { note: 'prices only fall' }),
    H('best_trade', [A([5])], 0),
    H('best_trade', [A([1, 2])], 1),
    H('best_trade', [A([2, 4, 1, 7])], 6),
    H('best_trade', [A([3, 3, 3])], 0),
    H('best_trade', [A(seq(200, (i) => (i * 71) % 113))], (() => { const p = seq(200, (i) => (i * 71) % 113); let lo = p[0]; let b = 0; for (const x of p) { b = Math.max(b, x - lo); lo = Math.min(lo, x); } return b; })()),
  ],
},
{
  id: 'CR-E23', mode: 'code-race', difficulty: 'easy', topic: 'math',
  title: 'The missing number',
  languages: ALL,
  functionName: 'missing_number',
  description: 'The array `a` holds `n` different numbers taken from 0, 1, …, n, so exactly one of those numbers is missing. Write `missing_number(a)` that returns it.\n\n`a` is an array (a list written `[...]`) of at most 200 numbers. Try to do it in one pass, without sorting.',
  starter: stubs('missing_number(a)'),
  solution: both(`def missing_number(a):\n    n = len(a)\n    total = n * (n + 1) // 2\n    for i in range(n):\n        total = total - a[i]\n    return total`),
  tests: [
    T('missing_number', [A([3, 0, 1])], 2),
    T('missing_number', [A([0, 1])], 2, { note: 'the largest one is missing' }),
    H('missing_number', [A([1])], 0),
    H('missing_number', [A([0])], 1),
    H('missing_number', [A([9, 6, 4, 2, 3, 5, 7, 0, 1])], 8),
    H('missing_number', [A(shuffled)], 37),
  ],
},
{
  id: 'CR-E24', mode: 'code-race', difficulty: 'easy', topic: 'loops',
  title: 'Collatz steps',
  languages: ALL,
  functionName: 'collatz_steps',
  description: 'Start from a positive integer `n`. If it is even, halve it; if it is odd, replace it by `3 * n + 1`. Write `collatz_steps(n)` that returns how many steps it takes to reach 1.\n\n`n` is an integer, 1 ≤ n ≤ 10000.',
  starter: stubs('collatz_steps(n)'),
  solution: both(`def collatz_steps(n):\n    steps = 0\n    k = n\n    while k != 1:\n        if k % 2 == 0:\n            k = k // 2\n        else:\n            k = 3 * k + 1\n        steps = steps + 1\n    return steps`),
  tests: [
    T('collatz_steps', [6], collatz(6)),
    T('collatz_steps', [1], 0, { note: 'already at 1' }),
    H('collatz_steps', [2], 1),
    H('collatz_steps', [7], collatz(7)),
    H('collatz_steps', [27], collatz(27)),
    H('collatz_steps', [97], collatz(97)),
    H('collatz_steps', [6171], collatz(6171)),
  ],
},
{
  id: 'CR-E25', mode: 'code-race', difficulty: 'easy', topic: 'arrays',
  title: 'Majority vote',
  languages: ALL,
  functionName: 'majority',
  description: 'In the array `votes`, one value appears **more than half** of the time. Write `majority(votes)` that returns it.\n\n`votes` is a non-empty array of at most 300 integers. There is a neat one-pass trick: keep a candidate and a counter that goes up when you see the candidate and down otherwise.',
  starter: stubs('majority(votes)'),
  solution: both(`def majority(votes):\n    candidate = votes[0]\n    count = 0\n    for i in range(len(votes)):\n        if count == 0:\n            candidate = votes[i]\n        if votes[i] == candidate:\n            count = count + 1\n        else:\n            count = count - 1\n    return candidate`),
  tests: [
    T('majority', [A([3, 2, 3])], 3),
    T('majority', [A([2, 2, 1, 1, 1, 2, 2])], 2),
    H('majority', [A([5])], 5),
    H('majority', [A([1, 1, 2])], 1),
    H('majority', [A([4, 5, 4])], 4),
    H('majority', [A([7, 1, 7, 2, 7])], 7),
    H('majority', [A(seq(301, (i) => (i % 2 === 0 ? 9 : i)))], 9),
  ],
},
// ------------------------------------------------------------------ medium
{
  id: 'CR-M21', mode: 'code-race', difficulty: 'medium', topic: 'dynamic programming',
  title: 'Best stretch',
  languages: ALL,
  functionName: 'max_subarray',
  description: 'Write `max_subarray(a)` that returns the largest sum of a **contiguous**, non-empty stretch of the array `a`.\n\n`a` is a non-empty array of at most 300 integers, which may be negative. Checking every stretch is slow: as you walk through `a`, keep the best sum of a stretch that ends at the current element.',
  starter: stubs('max_subarray(a)'),
  solution: both(`def max_subarray(a):\n    best = a[0]\n    current = a[0]\n    for i in range(1, len(a)):\n        current = max(a[i], current + a[i])\n        best = max(best, current)\n    return best`),
  tests: [
    T('max_subarray', [A([-2, 1, -3, 4, -1, 2, 1, -5, 4])], 6),
    T('max_subarray', [A([-3, -1, -2])], -1, { note: 'all negative' }),
    H('max_subarray', [A([5])], 5),
    H('max_subarray', [A([1, 2, 3])], 6),
    H('max_subarray', [A([-1])], -1),
    H('max_subarray', [A([2, -1, 2])], 3),
    H('max_subarray', [A(wave)], kadane(wave)),
  ],
},
{
  id: 'CR-M22', mode: 'code-race', difficulty: 'medium', topic: 'dynamic programming',
  title: 'Street of houses',
  languages: ALL,
  functionName: 'rob',
  description: 'A street of houses has `houses[i]` coins in house `i`. You may collect from any houses you like, but never from **two neighbouring** houses. Write `rob(houses)` that returns the most coins you can collect.\n\n`houses` is an array of at most 100 non-negative integers (it may be empty).',
  starter: stubs('rob(houses)'),
  solution: both(`def rob(houses):\n    take = 0\n    skip = 0\n    for i in range(len(houses)):\n        new_take = skip + houses[i]\n        skip = max(skip, take)\n        take = new_take\n    return max(take, skip)`),
  tests: [
    T('rob', [A([1, 2, 3, 1])], 4),
    T('rob', [A([2, 7, 9, 3, 1])], 12),
    H('rob', [A([])], 0),
    H('rob', [A([5])], 5),
    H('rob', [A([2, 1, 1, 2])], 4),
    H('rob', [A([10, 1, 1, 10])], 20),
    H('rob', [A(street)], robRef(street)),
  ],
},
{
  id: 'CR-M23', mode: 'code-race', difficulty: 'medium', topic: 'prefix sums',
  title: 'Balance point',
  languages: ALL,
  functionName: 'balance_point',
  description: 'Write `balance_point(a)` that returns the smallest index `i` where the sum of the elements **left** of `i` equals the sum of the elements **right** of `i` (the element at `i` itself is in neither). Return -1 if there is no such index.\n\n`a` is an array of at most 300 integers. Work out the total once, then walk through the array keeping a running sum.',
  starter: stubs('balance_point(a)'),
  solution: both(`def balance_point(a):\n    total = 0\n    for i in range(len(a)):\n        total = total + a[i]\n    left = 0\n    for i in range(len(a)):\n        if left == total - left - a[i]:\n            return i\n        left = left + a[i]\n    return -1`),
  tests: [
    T('balance_point', [A([1, 7, 3, 6, 5, 6])], 3),
    T('balance_point', [A([1, 2, 3])], -1, { note: 'no balance point' }),
    H('balance_point', [A([5])], 0),
    H('balance_point', [A([2, 1, -1])], 0),
    H('balance_point', [A([1, -1, 4])], 2),
    H('balance_point', [A([0, 0, 0])], 0),
    H('balance_point', [A(longBalance)], balanceRef(longBalance)),
  ],
},
{
  id: 'CR-M24', mode: 'code-race', difficulty: 'medium', topic: 'stacks',
  title: 'Balanced brackets',
  languages: ALL,
  functionName: 'balanced',
  description: '`brackets` is an array of one-character strings, each one of `(` `)` `[` `]` `{` `}`. Write `balanced(brackets)` that returns `True` if every bracket is closed by the matching kind, in the right order, and `False` otherwise.\n\nUse a stack: an array as long as the input plus a counter for its top (in Python § arrays cannot grow).',
  starter: stubs('balanced(brackets)'),
  solution: both(`def balanced(brackets):\n    n = len(brackets)\n    stack = [None] * n\n    top = 0\n    for i in range(n):\n        b = brackets[i]\n        if b == "(" or b == "[" or b == "{":\n            stack[top] = b\n            top = top + 1\n        else:\n            if top == 0:\n                return False\n            opener = stack[top - 1]\n            top = top - 1\n            if b == ")" and opener != "(":\n                return False\n            if b == "]" and opener != "[":\n                return False\n            if b == "}" and opener != "{":\n                return False\n    return top == 0`),
  tests: [
    T('balanced', [chars('([]{})')], true),
    T('balanced', [chars('([)]')], false, { note: 'crossed pairs' }),
    H('balanced', [A([])], true),
    H('balanced', [chars('(((')], false),
    H('balanced', [chars('())')], false),
    H('balanced', [chars('{[()()]}')], true),
    H('balanced', [chars(')(')], false),
  ],
},
{
  id: 'CR-M25', mode: 'code-race', difficulty: 'medium', topic: 'searching',
  title: 'Search a rotated array',
  languages: ALL,
  functionName: 'search_rotated',
  description: 'An ascending array of **distinct** integers was rotated: some prefix was moved to the end (e.g. `[0, 1, 2, 4, 5, 6, 7]` became `[4, 5, 6, 7, 0, 1, 2]`). Write `search_rotated(a, x)` that returns the index of `x` in `a`, or -1 if it is not there.\n\n`a` has at most 200 elements. Aim for binary search: at every step one half of the range is still sorted.',
  starter: stubs('search_rotated(a, x)'),
  solution: both(`def search_rotated(a, x):\n    lo = 0\n    hi = len(a) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if a[mid] == x:\n            return mid\n        if a[lo] <= a[mid]:\n            if a[lo] <= x and x < a[mid]:\n                hi = mid - 1\n            else:\n                lo = mid + 1\n        else:\n            if a[mid] < x and x <= a[hi]:\n                lo = mid + 1\n            else:\n                hi = mid - 1\n    return -1`),
  tests: [
    T('search_rotated', [A([4, 5, 6, 7, 0, 1, 2]), 0], 4),
    T('search_rotated', [A([4, 5, 6, 7, 0, 1, 2]), 3], -1, { note: 'not there' }),
    H('search_rotated', [A([1]), 1], 0),
    H('search_rotated', [A([]), 5], -1),
    H('search_rotated', [A([3, 1]), 1], 1),
    H('search_rotated', [A([5, 1, 3]), 5], 0),
    H('search_rotated', [A([6, 7, 1, 2, 3, 4, 5]), 7], 1),
    H('search_rotated', [A(rotated), 10], rotated.indexOf(10)),
    H('search_rotated', [A(rotated), 199], rotated.indexOf(199)),
  ],
},
{
  id: 'CR-M26', mode: 'code-race', difficulty: 'medium', topic: 'dynamic programming',
  title: 'Fewest coins',
  languages: ALL,
  functionName: 'fewest_coins',
  description: 'Write `fewest_coins(coins, amount)` that returns the smallest number of coins that add up to exactly `amount`, using any number of each coin value in the array `coins`. Return -1 if it cannot be done.\n\nAlways taking the biggest coin does **not** always work (with coins 1, 3 and 4, the best way to make 6 is 3 + 3). `amount` is at most 500.',
  starter: stubs('fewest_coins(coins, amount)'),
  solution: both(`def fewest_coins(coins, amount):\n    best = [amount + 1] * (amount + 1)\n    best[0] = 0\n    for c in range(1, amount + 1):\n        for i in range(len(coins)):\n            if coins[i] <= c:\n                best[c] = min(best[c], best[c - coins[i]] + 1)\n    return -1 if best[amount] > amount else best[amount]`),
  tests: [
    T('fewest_coins', [A([1, 2, 5]), 11], 3),
    T('fewest_coins', [A([2]), 3], -1, { note: 'impossible' }),
    H('fewest_coins', [A([1]), 0], 0),
    H('fewest_coins', [A([1]), 7], 7),
    H('fewest_coins', [A([3, 7]), 5], -1),
    H('fewest_coins', [A([1, 3, 4]), 6], 2),
    H('fewest_coins', [A([2, 5, 10, 1]), 27], 4),
    H('fewest_coins', [A([186, 419, 83, 408]), 500], coinsRef([186, 419, 83, 408], 500)),
  ],
},
{
  id: 'CR-M27', mode: 'code-race', difficulty: 'medium', topic: 'greedy',
  title: 'Jump game',
  languages: ALL,
  functionName: 'can_jump',
  description: 'You start on index 0 of the array `a`. From index `i` you may jump forward by any number of places from 1 up to `a[i]`. Write `can_jump(a)` that returns `True` if you can reach the last index, and `False` otherwise.\n\n`a` is a non-empty array of at most 300 non-negative integers. Keep track of the furthest index you can reach so far.',
  starter: stubs('can_jump(a)'),
  solution: both(`def can_jump(a):\n    reach = 0\n    for i in range(len(a)):\n        if i > reach:\n            return False\n        reach = max(reach, i + a[i])\n    return True`),
  tests: [
    T('can_jump', [A([2, 3, 1, 1, 4])], true),
    T('can_jump', [A([3, 2, 1, 0, 4])], false, { note: 'stuck on the 0' }),
    H('can_jump', [A([0])], true),
    H('can_jump', [A([1, 0, 1])], false),
    H('can_jump', [A([2, 0, 0])], true),
    H('can_jump', [A([1, 1, 1, 1])], true),
    H('can_jump', [A([0, 2])], false),
  ],
},
{
  id: 'CR-M28', mode: 'code-race', difficulty: 'medium', topic: 'two pointers',
  title: 'Squares in order',
  languages: ALL,
  functionName: 'sorted_squares',
  description: 'Write `sorted_squares(a)` that takes an ascending array of integers (some may be negative) and returns a **new** ascending array of their squares.\n\nIn full Python you may **not** use `sort` or `sorted`. The biggest square is always at one of the two ends of `a`: fill the result from the back with two pointers.',
  starter: stubs('sorted_squares(a)'),
  solution: both(`def sorted_squares(a):\n    n = len(a)\n    out = [0] * n\n    lo = 0\n    hi = n - 1\n    for k in range(n - 1, -1, -1):\n        if a[lo] * a[lo] > a[hi] * a[hi]:\n            out[k] = a[lo] * a[lo]\n            lo = lo + 1\n        else:\n            out[k] = a[hi] * a[hi]\n            hi = hi - 1\n    return out`),
  banned: { python: ['sort', 'sorted'] },
  tests: [
    T('sorted_squares', [A([-4, -1, 0, 3, 10])], A([0, 1, 9, 16, 100])),
    T('sorted_squares', [A([-7, -3, 2, 3, 11])], A([4, 9, 9, 49, 121])),
    H('sorted_squares', [A([])], A([])),
    H('sorted_squares', [A([5])], A([25])),
    H('sorted_squares', [A([-3, -2, -1])], A([1, 4, 9])),
    H('sorted_squares', [A([1, 2, 3])], A([1, 4, 9])),
    H('sorted_squares', [A(seq(41, (i) => i - 20))], A(seq(41, (i) => i - 20).map((x) => x * x).sort((p, q) => p - q))),
  ],
},
// ------------------------------------------------------------------ hard
{
  id: 'CR-H21', mode: 'code-race', difficulty: 'hard', topic: 'two pointers',
  title: 'Trapping rain water',
  languages: ALL,
  functionName: 'trap_water',
  description: '`heights` describes a row of walls of width 1. Write `trap_water(heights)` that returns how many units of rain water stay trapped between the walls after it rains.\n\nThe water above a wall is limited by the tallest wall to its left and the tallest wall to its right. `heights` is an array of at most 300 non-negative integers.',
  starter: stubs('trap_water(heights)'),
  solution: both(`def trap_water(heights):\n    lo = 0\n    hi = len(heights) - 1\n    left_max = 0\n    right_max = 0\n    water = 0\n    while lo < hi:\n        if heights[lo] < heights[hi]:\n            left_max = max(left_max, heights[lo])\n            water = water + left_max - heights[lo]\n            lo = lo + 1\n        else:\n            right_max = max(right_max, heights[hi])\n            water = water + right_max - heights[hi]\n            hi = hi - 1\n    return water`),
  tests: [
    T('trap_water', [A([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1])], 6),
    T('trap_water', [A([4, 2, 0, 3, 2, 5])], 9),
    H('trap_water', [A([])], 0),
    H('trap_water', [A([3])], 0),
    H('trap_water', [A([1, 2, 3])], 0),
    H('trap_water', [A([3, 0, 3])], 3),
    H('trap_water', [A([5, 1, 1, 1, 5])], 12),
    H('trap_water', [A(bumpy)], trapRef(bumpy)),
  ],
},
{
  id: 'CR-H22', mode: 'code-race', difficulty: 'hard', topic: 'dynamic programming',
  title: 'Decode ways',
  languages: ALL,
  functionName: 'decode_ways',
  description: 'A message of letters was encoded as numbers: A → 1, B → 2, …, Z → 26, and the numbers were written one after another as digits. Write `decode_ways(digits)` that returns how many different messages the array of digits could stand for.\n\nA 0 cannot stand on its own, and a two-digit number must be between 10 and 26. `digits` has at most 40 elements, so try every split with care: build the answer for longer and longer prefixes.',
  starter: stubs('decode_ways(digits)'),
  solution: both(`def decode_ways(digits):\n    n = len(digits)\n    ways = [0] * (n + 1)\n    ways[0] = 1\n    for i in range(1, n + 1):\n        if digits[i - 1] != 0:\n            ways[i] = ways[i - 1]\n        if i >= 2:\n            two = digits[i - 2] * 10 + digits[i - 1]\n            if two >= 10 and two <= 26:\n                ways[i] = ways[i] + ways[i - 2]\n    return ways[n]`),
  tests: [
    T('decode_ways', [A([1, 2])], 2, { note: 'AB or L' }),
    T('decode_ways', [A([2, 2, 6])], 3),
    H('decode_ways', [A([0])], 0),
    H('decode_ways', [A([1, 0])], 1),
    H('decode_ways', [A([3, 0])], 0),
    H('decode_ways', [A([1, 1, 1, 1, 1])], 8),
    H('decode_ways', [A([2, 2, 6, 1, 1, 0, 2])], decodeRef([2, 2, 6, 1, 1, 0, 2])),
    H('decode_ways', [A(seq(40, () => 1))], decodeRef(seq(40, () => 1))),
  ],
},
{
  id: 'CR-H23', mode: 'code-race', difficulty: 'hard', topic: 'dynamic programming',
  title: 'Fair split',
  languages: ALL,
  functionName: 'can_split',
  description: 'Write `can_split(a)` that returns `True` if the positive integers in the array `a` can be divided into two groups with the **same sum**, and `False` otherwise.\n\n`a` is a non-empty array of at most 30 integers, each at most 100. Trying every grouping is too slow: work out which sums up to half the total can be made.',
  starter: stubs('can_split(a)'),
  solution: both(`def can_split(a):\n    total = 0\n    for i in range(len(a)):\n        total = total + a[i]\n    if total % 2 == 1:\n        return False\n    half = total // 2\n    ok = [False] * (half + 1)\n    ok[0] = True\n    for i in range(len(a)):\n        for s in range(half, a[i] - 1, -1):\n            if ok[s - a[i]]:\n                ok[s] = True\n    return ok[half]`),
  tests: [
    T('can_split', [A([1, 5, 11, 5])], true),
    T('can_split', [A([1, 2, 3, 5])], false),
    H('can_split', [A([2])], false),
    H('can_split', [A([1, 1])], true),
    H('can_split', [A([3, 3, 3, 4, 5])], true),
    H('can_split', [A([100, 1])], false),
    H('can_split', [A(splitBig)], splitRef(splitBig)),
    H('can_split', [A([...splitBig, 1])], splitRef([...splitBig, 1])),
  ],
},
{
  id: 'CR-H24', mode: 'code-race', difficulty: 'hard', topic: 'stacks',
  title: 'Next greater element',
  languages: ALL,
  functionName: 'next_greater',
  description: 'Write `next_greater(a)` that returns a new array where position `i` holds the first element to the **right** of `a[i]` that is strictly greater than it, or -1 if there is none.\n\n`a` has at most 300 elements. Checking everything to the right of each element works but is slow; a stack of indices that are still waiting for an answer does it in one pass.',
  starter: stubs('next_greater(a)'),
  solution: both(`def next_greater(a):\n    n = len(a)\n    out = [-1] * n\n    stack = [0] * n\n    top = 0\n    for i in range(n):\n        while top > 0 and a[stack[top - 1]] < a[i]:\n            out[stack[top - 1]] = a[i]\n            top = top - 1\n        stack[top] = i\n        top = top + 1\n    return out`),
  tests: [
    T('next_greater', [A([2, 1, 2, 4, 3])], A([4, 2, 4, -1, -1])),
    T('next_greater', [A([5, 4, 3])], A([-1, -1, -1]), { note: 'falling' }),
    H('next_greater', [A([])], A([])),
    H('next_greater', [A([1])], A([-1])),
    H('next_greater', [A([2, 2, 3])], A([3, 3, -1])),
    H('next_greater', [A([1, 3, 2, 4])], A([3, 4, 4, -1])),
    H('next_greater', [A(bumpy)], A(nextGreaterRef(bumpy))),
  ],
},
{
  id: 'CR-H25', mode: 'code-race', difficulty: 'hard', topic: 'memoisation',
  title: 'Dice sums',
  languages: ALL,
  functionName: 'dice_ways',
  description: 'Write `dice_ways(n, target)` that returns the number of ways `n` six-sided dice (faces 1 to 6) can land so that they add up to `target`. The dice are different, so 1 + 2 and 2 + 1 count as two ways.\n\n1 ≤ n ≤ 12 and 1 ≤ target ≤ 72. Trying all 6ⁿ rolls is far too slow: the number of ways for `k` dice and a total `t` is asked for again and again, so remember it.',
  starter: stubs('dice_ways(n, target)'),
  solution: both(`def dice_ways(n, target):\n    memo = [None] * (n + 1)\n    for i in range(n + 1):\n        memo[i] = [None] * (target + 1)\n    def ways(k, t):\n        if k == 0:\n            return 1 if t == 0 else 0\n        if t <= 0:\n            return 0\n        if memo[k][t] != None:\n            return memo[k][t]\n        total = 0\n        for face in range(1, 7):\n            if face <= t:\n                total = total + ways(k - 1, t - face)\n        memo[k][t] = total\n        return total\n    return ways(n, target)`),
  tests: [
    T('dice_ways', [2, 7], 6),
    T('dice_ways', [1, 7], 0, { note: 'one die cannot make 7' }),
    H('dice_ways', [1, 1], 1),
    H('dice_ways', [3, 3], 1),
    H('dice_ways', [2, 12], 1),
    H('dice_ways', [10, 35], diceRef(10, 35)),
    H('dice_ways', [12, 42], diceRef(12, 42)),
  ],
},
];
