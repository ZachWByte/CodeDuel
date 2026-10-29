import { T, H, A, P, ST, SO, SH, ALL, SICPY, PY4 } from './helpers.js';

const permsOf = (xs) => (xs.length === 0
  ? [[]]
  : xs.flatMap((x) => permsOf(xs.filter((y) => y !== x)).map((p) => [x, ...p])));
const hanoiMoves = (n, from, to, via) => (n === 0 ? [] : [
  ...hanoiMoves(n - 1, from, via, to), P(from, to), ...hanoiMoves(n - 1, via, to, from)]);
const chars = (s) => s.split('');
const both = (code) => ({ sicpy: code, python: code });

const MERGE_SORT = (second) => `def merge_sort(xs):\n    def merge(a, b):\n        if is_none(a):\n            return b\n        if is_none(b):\n            return a\n        if head(a) <= head(b):\n            return pair(head(a), merge(tail(a), b))\n        return pair(head(b), merge(a, tail(b)))\n    def take(ys, n):\n        return None if n == 0 else pair(head(ys), take(tail(ys), n - 1))\n    def drop(ys, n):\n        return ys if n == 0 else drop(tail(ys), n - 1)\n    if is_none(xs) or is_none(tail(xs)):\n        return xs\n    half = length(xs) // 2\n    return merge(merge_sort(take(xs, half)),\n                 merge_sort(${second}))`;
const MERGE_SORT_PY = (second) => `def merge_sort(xs):\n    if len(xs) <= 1:\n        return xs\n    half = len(xs) // 2\n    left = merge_sort(xs[:half])\n    right = merge_sort(${second})\n    result, i, j = [], 0, 0\n    while i < len(left) and j < len(right):\n        if left[i] <= right[j]:\n            result.append(left[i])\n            i += 1\n        else:\n            result.append(right[j])\n            j += 1\n    return result + left[i:] + right[j:]`;

const QUEENS = (diag) => `def queens(n):\n    cols = [0] * n\n    def safe(row, col):\n        for r in range(row):\n            if cols[r] == col or ${diag}:\n                return False\n        return True\n    def place(row):\n        if row == n:\n            return 1\n        count = 0\n        for col in range(n):\n            if safe(row, col):\n                cols[row] = col\n                count = count + place(row + 1)\n        return count\n    return place(0)`;

const LCS = (match) => `def lcs_length(xs, ys):\n    n = length(xs)\n    m = length(ys)\n    a = [0] * n\n    b = [0] * m\n    for i in range(n):\n        a[i] = head(xs)\n        xs = tail(xs)\n    for j in range(m):\n        b[j] = head(ys)\n        ys = tail(ys)\n    dp = [None] * (n + 1)\n    for i in range(n + 1):\n        dp[i] = [0] * (m + 1)\n    for i in range(1, n + 1):\n        for j in range(1, m + 1):\n            if a[i - 1] == b[j - 1]:\n                dp[i][j] = ${match}\n            else:\n                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])\n    return dp[n][m]`;
const LCS_PY = (match) => `def lcs_length(xs, ys):\n    n, m = len(xs), len(ys)\n    dp = [[0] * (m + 1) for _ in range(n + 1)]\n    for i in range(1, n + 1):\n        for j in range(1, m + 1):\n            if xs[i - 1] == ys[j - 1]:\n                dp[i][j] = ${match}\n            else:\n                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])\n    return dp[n][m]`;

const MONITORED = (body) => `def make_monitored(f):\n    count = 0\n    def mf(x):\n        nonlocal count\n        if x == "how many calls":\n            return count\n        if x == "reset count":\n            count = 0\n            return count\n${body}\n    return mf`;

const HAS_CYCLE = (fast) => `def has_cycle(xs):\n    slow = xs\n    fast = xs\n    while not is_none(fast) and not is_none(tail(fast)):\n        slow = tail(slow)\n        fast = ${fast}\n        if slow == fast:\n            return True\n    return False`;

const KNAP = (loop) => `def knapsack(weights, values, cap):\n    best = [0] * (cap + 1)\n    for i in range(len(weights)):\n        w = weights[i]\n        ${loop}:\n            best[c] = max(best[c], best[c - w] + values[i])\n    return best[cap]`;

const EVAL = (first, second) => `def evaluate_arith(program):\n    def ev(t):\n        if head(t) == "literal":\n            return head(tail(t))\n        op = llist_ref(t, 1)\n        a = ev(llist_ref(t, ${first}))\n        b = ev(llist_ref(t, ${second}))\n        if op == "+":\n            return a + b\n        elif op == "-":\n            return a - b\n        elif op == "*":\n            return a * b\n        else:\n            return a / b\n    return ev(parse(program))`;

const HANOI = (second) => `def hanoi(n, frm, to, via):\n    if n == 0:\n        return None\n    return append(hanoi(n - 1, frm, via, to),\n                  pair(pair(frm, to), ${second}))`;
const HANOI_PY = (second) => `def hanoi(n, frm, to, via):\n    if n == 0:\n        return []\n    return hanoi(n - 1, frm, via, to) + [(frm, to)] + ${second}`;

export default [
{
  id: 'BH-H01', mode: 'bug-hunt', difficulty: 'hard', topic: 'sorting',
  title: 'Merge sort loses the middle',
  languages: ALL,
  functionName: 'merge_sort',
  description: '`merge_sort(xs)` should return a new ascending list with all the numbers of `xs`. Some lists lose elements. Find and fix the bug.',
  buggy: { sicpy: MERGE_SORT('drop(xs, length(xs) - half)'), python: MERGE_SORT_PY('xs[len(xs) - half:]') },
  bugLines: { sicpy: [18], python: [6] },
  bugExplanation: 'The second half should start right after the first half, at index half. Skipping length − half elements only does that when the length is even; for odd lengths the middle element is dropped.',
  solution: { sicpy: MERGE_SORT('drop(xs, half)'), python: MERGE_SORT_PY('xs[half:]') },
  tests: [
    T('merge_sort', [[5, 2, 4, 1, 3]], [1, 2, 3, 4, 5]),
    T('merge_sort', [[4, 3, 2, 1]], [1, 2, 3, 4], { note: 'even length' }),
    H('merge_sort', [[]], []),
    H('merge_sort', [[1]], [1]),
    H('merge_sort', [[2, 1]], [1, 2]),
    H('merge_sort', [[3, 1, 2]], [1, 2, 3]),
    H('merge_sort', [[9, 8, 7, 6, 5, 4, 3, 2]], [2, 3, 4, 5, 6, 7, 8, 9]),
    H('merge_sort', [[1, 2, 3, 4, 5, 6]], [1, 2, 3, 4, 5, 6]),
  ],
},
{
  id: 'BH-H02', mode: 'bug-hunt', difficulty: 'hard', topic: 'sorting',
  title: 'Quicksort loses copies',
  languages: ALL,
  functionName: 'quick_sort',
  description: '`quick_sort(xs)` should return a new ascending list with all the numbers of `xs`, keeping duplicates. Lists with repeated values come out too short. Find and fix the bug.',
  buggy: {
    sicpy: `def quick_sort(xs):\n    if is_none(xs):\n        return None\n    p = head(xs)\n    smaller = filter(lambda x: x < p, tail(xs))\n    larger = filter(lambda x: x > p, tail(xs))\n    return append(quick_sort(smaller), pair(p, quick_sort(larger)))`,
    python: `def quick_sort(xs):\n    if not xs:\n        return []\n    p, rest = xs[0], xs[1:]\n    smaller = [x for x in rest if x < p]\n    larger = [x for x in rest if x > p]\n    return quick_sort(smaller) + [p] + quick_sort(larger)`,
  },
  bugLines: { sicpy: [6], python: [6] },
  bugExplanation: 'Elements equal to the pivot are neither < p nor > p, so they are dropped. One side of the partition must include them, e.g. x >= p.',
  solution: {
    sicpy: `def quick_sort(xs):\n    if is_none(xs):\n        return None\n    p = head(xs)\n    smaller = filter(lambda x: x < p, tail(xs))\n    larger = filter(lambda x: x >= p, tail(xs))\n    return append(quick_sort(smaller), pair(p, quick_sort(larger)))`,
    python: `def quick_sort(xs):\n    if not xs:\n        return []\n    p, rest = xs[0], xs[1:]\n    smaller = [x for x in rest if x < p]\n    larger = [x for x in rest if x >= p]\n    return quick_sort(smaller) + [p] + quick_sort(larger)`,
  },
  tests: [
    T('quick_sort', [[3, 6, 1, 8, 2]], [1, 2, 3, 6, 8]),
    T('quick_sort', [[2, 1, 2, 1]], [1, 1, 2, 2], { note: 'duplicates' }),
    H('quick_sort', [[]], []),
    H('quick_sort', [[7]], [7]),
    H('quick_sort', [[5, 5, 5]], [5, 5, 5]),
    H('quick_sort', [[-1, -3, 2, 0]], [-3, -1, 0, 2]),
    H('quick_sort', [[4, 1, 4, 2, 4]], [1, 2, 4, 4, 4]),
  ],
},
{
  id: 'BH-H03', mode: 'bug-hunt', difficulty: 'hard', topic: 'recursion',
  title: 'Permutations with repeats',
  languages: ALL,
  functionName: 'permutations',
  description: '`permutations(xs)` should return a list of all permutations of the list `xs` of distinct elements: for each element `x` in turn, all permutations that start with `x`. Some results contain repeated elements. Find and fix the bug.',
  buggy: {
    sicpy: `def permutations(xs):\n    if is_none(xs):\n        return llist(None)\n    def starting_with(x):\n        rest = remove(head(xs), xs)\n        return map(lambda p: pair(x, p), permutations(rest))\n    return reduce(append, None, map(starting_with, xs))`,
    python: `def permutations(xs):\n    if not xs:\n        return [[]]\n    result = []\n    for x in xs:\n        rest = xs[1:]\n        for p in permutations(rest):\n            result.append([x] + p)\n    return result`,
  },
  bugLines: { sicpy: [5], python: [6] },
  bugExplanation: 'After choosing x as the first element, the rest must be xs without x. The code always removes the first element of xs instead, so when x is not the first element it appears twice and the first element is lost.',
  solution: {
    sicpy: `def permutations(xs):\n    if is_none(xs):\n        return llist(None)\n    def starting_with(x):\n        rest = remove(x, xs)\n        return map(lambda p: pair(x, p), permutations(rest))\n    return reduce(append, None, map(starting_with, xs))`,
    python: `def permutations(xs):\n    if not xs:\n        return [[]]\n    result = []\n    for x in xs:\n        rest = [y for y in xs if y != x]\n        for p in permutations(rest):\n            result.append([x] + p)\n    return result`,
  },
  tests: [
    T('permutations', [[1, 2, 3]], permsOf([1, 2, 3])),
    T('permutations', [[]], [[]], { note: 'empty list' }),
    H('permutations', [[1]], [[1]]),
    H('permutations', [[1, 2]], [[1, 2], [2, 1]]),
    H('permutations', [['a', 'b', 'c']], permsOf(['a', 'b', 'c'])),
    H('permutations', [[4, 3, 2, 1]], permsOf([4, 3, 2, 1])),
  ],
},
{
  id: 'BH-H04', mode: 'bug-hunt', difficulty: 'hard', topic: 'backtracking',
  title: 'Queens on the diagonal',
  languages: ALL,
  functionName: 'queens',
  description: '`queens(n)` should count the ways to place n non-attacking queens on an n × n board (1 ≤ n ≤ 6 in Python §, up to 8 in full Python). It finds too many solutions. Find and fix the bug.',
  buggy: both(QUEENS('cols[r] - col == row - r')),
  bugLines: { sicpy: [5], python: [5] },
  bugExplanation: 'Two queens share a diagonal when their column difference equals their row difference in either direction. Checking only cols[r] - col misses the other diagonal; compare the absolute difference instead.',
  solution: both(QUEENS('abs(cols[r] - col) == row - r')),
  tests: [
    T('queens', [4], 2),
    T('queens', [1], 1, { note: 'one square' }),
    H('queens', [2], 0),
    H('queens', [3], 0),
    H('queens', [5], 10),
    H('queens', [6], 4),
    { python: { call: 'queens(7)', expect: '40' }, hidden: true },
    { python: { call: 'queens(8)', expect: '92' }, hidden: true },
  ],
},
{
  id: 'BH-H05', mode: 'bug-hunt', difficulty: 'hard', topic: 'state',
  title: 'Accumulator with amnesia',
  languages: ALL,
  functionName: 'make_accumulator',
  description: '`make_accumulator(start)` should return a function that adds its argument to a running total (starting at `start`) and returns the new total. The total never grows past one call. Find and fix the bug.',
  buggy: both(`def make_accumulator(start):\n    def acc(x):\n        total = start\n        total = total + x\n        return total\n    return acc`),
  bugLines: { sicpy: [3], python: [3] },
  bugExplanation: 'The total is created inside the returned function, so every call starts again from start. It has to live outside (declared once in make_accumulator, with nonlocal inside acc) so calls share it.',
  solution: both(`def make_accumulator(start):\n    total = start\n    def acc(x):\n        nonlocal total\n        total = total + x\n        return total\n    return acc`),
  tests: [
    ST({ sicpy: 'acc = make_accumulator(5)\nacc(10)', call: 'acc(10)', expect: 25 }),
    ST({ call: 'make_accumulator(0)(7)', expect: 7, note: 'first call' }),
    ST({ sicpy: 'a = make_accumulator(1)\nb = make_accumulator(100)\na(1)\nb(1)', call: 'a(1)', expect: 3, hidden: true }),
    ST({ call: 'make_accumulator(3)(0)', expect: 3, hidden: true }),
    ST({ sicpy: 'acc = make_accumulator(10)\nacc(-4)', call: 'acc(-6)', expect: 0, hidden: true }),
    ST({ sicpy: 'acc = make_accumulator(0)\nfor i in range(1, 11):\n    acc(i)', call: 'acc(0)', expect: 55, hidden: true }),
  ],
},
{
  id: 'BH-H06', mode: 'bug-hunt', difficulty: 'hard', topic: 'state',
  title: 'Unmonitored',
  languages: ALL,
  functionName: 'make_monitored',
  description: '`make_monitored(f)` should return `mf`: `mf("how many calls")` returns how many times f has been called through mf, `mf("reset count")` sets that count to 0, and any other `mf(x)` adds 1 to the count and returns `f(x)`. The count is always 0. Find and fix the bug.',
  buggy: both(MONITORED('        return f(x)\n        count = count + 1')),
  bugLines: { sicpy: [10, 11], python: [10, 11] },
  bugExplanation: 'The count is increased after the return statement, so that line is never reached. Increase the count first, then return f(x).',
  solution: both(MONITORED('        count = count + 1\n        return f(x)')),
  tests: [
    ST({ sicpy: 'mf = make_monitored(lambda x: x * x)\nmf(3)\nmf(4)', call: 'mf("how many calls")', expect: 2 }),
    ST({ sicpy: 'mf = make_monitored(lambda x: x * x)', call: 'mf(5)', expect: 25, note: 'passes through to f' }),
    ST({ sicpy: 'mf = make_monitored(lambda x: x)', call: 'mf("how many calls")', expect: 0, hidden: true }),
    ST({ sicpy: 'mf = make_monitored(lambda x: x)\nmf(1)\nmf(2)\nmf("reset count")\nmf(3)', call: 'mf("how many calls")', expect: 1, hidden: true }),
    ST({ sicpy: 'mf = make_monitored(lambda x: x + 1)', call: 'mf(10)', expect: 11, hidden: true }),
    ST({ sicpy: 'mf = make_monitored(lambda x: x)\nmf(1)\nmf("how many calls")', call: 'mf("how many calls")', expect: 1, hidden: true }),
  ],
},
{
  id: 'BH-H07', mode: 'bug-hunt', difficulty: 'hard', topic: 'mutation',
  title: 'Everything is a cycle',
  languages: SICPY,
  functionName: 'has_cycle',
  description: '`has_cycle(xs)` should return `True` if following the tails of `xs` loops back on itself (made with `set_tail`) and `False` if it reaches `None`, using a slow and a fast pointer. All elements in a test list are different. It says almost every list has a cycle. Find and fix the bug.',
  buggy: { sicpy: HAS_CYCLE('tail(fast)') },
  bugLines: { sicpy: [6] },
  bugExplanation: 'The fast pointer must move two steps for every one step of the slow pointer. Moving both one step keeps them together, so they "meet" straight away on any list with two or more elements.',
  solution: { sicpy: HAS_CYCLE('tail(tail(fast))') },
  tests: [
    SO('has_cycle(llist(1, 2, 3))', false),
    SO('has_cycle(xs)', true, { setup: 'xs = llist(1, 2, 3)\nset_tail(tail(tail(xs)), xs)', note: 'circular list' }),
    SH('has_cycle(None)', false),
    SH('has_cycle(xs)', true, { setup: 'xs = llist(1)\nset_tail(xs, xs)' }),
    SH('has_cycle(enum_llist(1, 100))', false),
    SH('has_cycle(llist(1, 2))', false),
    SH('has_cycle(xs)', true, { setup: 'xs = llist(1, 2, 3, 4, 5)\nset_tail(tail(tail(tail(tail(xs)))), tail(tail(xs)))' }),
  ],
},
{
  id: 'BH-H08', mode: 'bug-hunt', difficulty: 'hard', topic: 'streams',
  title: 'Eager stream map',
  languages: SICPY,
  functionName: 'my_stream_map',
  description: '`my_stream_map(f, s)` should return the stream of `f(x)` for each `x` in the stream `s`. It must work on infinite streams such as `integers_from(1)`. Find and fix the bug.',
  buggy: { sicpy: `def my_stream_map(f, s):\n    if is_none(s):\n        return None\n    return pair(f(head(s)), my_stream_map(f, stream_tail(s)))` },
  bugLines: { sicpy: [4] },
  bugExplanation: 'The tail of a stream must be a function that computes the rest later. Calling my_stream_map straight away computes the whole rest of the stream now, which never ends for an infinite stream. Wrap it: lambda: my_stream_map(f, stream_tail(s)).',
  solution: { sicpy: `def my_stream_map(f, s):\n    if is_none(s):\n        return None\n    return pair(f(head(s)), lambda: my_stream_map(f, stream_tail(s)))` },
  tests: [
    SO('eval_stream(my_stream_map(lambda x: x * 2, integers_from(1)), 3)', [2, 4, 6]),
    SO('my_stream_map(lambda x: x + 1, None)', null, { note: 'empty stream' }),
    SH('stream_to_llist(my_stream_map(lambda x: x * x, stream(1, 2, 3)))', [1, 4, 9]),
    SH('head(my_stream_map(lambda x: x + 1, integers_from(5)))', 6),
    SH('eval_stream(my_stream_map(lambda x: x - 1, integers_from(1)), 5)', [0, 1, 2, 3, 4]),
    SH('is_none(my_stream_map(lambda x: x, None))', true),
  ],
},
{
  id: 'BH-H09', mode: 'bug-hunt', difficulty: 'hard', topic: 'dynamic programming',
  title: 'Knapsack reuses items',
  languages: ALL,
  functionName: 'knapsack',
  description: '`knapsack(weights, values, cap)` should return the largest total value of items with total weight at most `cap`, using each item **at most once**. Item `i` has weight `weights[i]` and value `values[i]` (arrays). The answers are sometimes too high. Find and fix the bug.',
  buggy: both(KNAP('for c in range(w, cap + 1)')),
  bugLines: { sicpy: [5], python: [5] },
  bugExplanation: 'With a single 1-D table, going up through the capacities lets best[c - w] already include the current item, so it can be used again. Going down from cap to w only ever reads values from before this item was considered.',
  solution: both(KNAP('for c in range(cap, w - 1, -1)')),
  tests: [
    T('knapsack', [A([2, 3]), A([3, 4]), 6], 7),
    T('knapsack', [A([]), A([]), 10], 0, { note: 'no items' }),
    H('knapsack', [A([5]), A([10]), 4], 0),
    H('knapsack', [A([5]), A([10]), 10], 10),
    H('knapsack', [A([1, 2, 3]), A([6, 10, 12]), 5], 22),
    H('knapsack', [A([10, 20, 30]), A([60, 100, 120]), 50], 220),
    H('knapsack', [A([1, 3, 4, 5]), A([1, 4, 5, 7]), 7], 9),
  ],
},
{
  id: 'BH-H10', mode: 'bug-hunt', difficulty: 'hard', topic: 'dynamic programming',
  title: 'Common subsequence overcount',
  languages: ALL,
  functionName: 'lcs_length',
  description: '`lcs_length(xs, ys)` should return the length of the longest common subsequence of two lists. It sometimes returns a number bigger than either list could allow. Find and fix the bug.',
  buggy: { sicpy: LCS('max(dp[i - 1][j], dp[i][j - 1]) + 1'), python: LCS_PY('max(dp[i - 1][j], dp[i][j - 1]) + 1') },
  bugLines: { sicpy: [18], python: [7] },
  bugExplanation: 'When a[i − 1] matches b[j − 1], that pair extends the best answer for the prefixes without both elements: dp[i − 1][j − 1] + 1. Using the left or upper cell can reuse an element that was already matched.',
  solution: { sicpy: LCS('dp[i - 1][j - 1] + 1'), python: LCS_PY('dp[i - 1][j - 1] + 1') },
  tests: [
    T('lcs_length', [chars('ABCBDAB'), chars('BDCABA')], 4),
    T('lcs_length', [[], [1, 2]], 0, { note: 'empty list' }),
    H('lcs_length', [[1, 2, 3], [1, 2, 3]], 3),
    H('lcs_length', [[1, 2, 3], [4, 5, 6]], 0),
    H('lcs_length', [[1, 1], [1]], 1),
    H('lcs_length', [[5, 5, 5], [5]], 1),
    H('lcs_length', [chars('AGGTAB'), chars('GXTXAYB')], 4),
  ],
},
{
  id: 'BH-H11', mode: 'bug-hunt', difficulty: 'hard', topic: 'parse',
  title: 'Backwards arithmetic',
  languages: PY4,
  functionName: 'evaluate_arith',
  description: '`evaluate_arith(program)` should compute the value of a one-statement program made of number literals, `+ - * /` and brackets by walking `parse(program)`. Nodes are `llist("literal", n)` and `llist("binary_operator_combination", op, left, right)`. Some operators give wrong answers. Find and fix the bug.',
  buggy: { sicpy: EVAL(3, 2) },
  bugLines: { sicpy: [6, 7] },
  bugExplanation: 'In a binary_operator_combination node the left operand is element 2 and the right operand is element 3. Swapping them makes no difference for + and *, but - and / are not commutative.',
  solution: { sicpy: EVAL(2, 3) },
  tests: [
    SO('evaluate_arith("1 + 2 * 3")', 7),
    SO('evaluate_arith("10 - 4")', 6, { note: 'subtraction' }),
    SH('evaluate_arith("42")', 42),
    SH('evaluate_arith("(1 + 2) * 3")', 9),
    SH('evaluate_arith("100 / 4 / 5")', 5),
    SH('evaluate_arith("7 - (2 - 10)")', 15),
    SH('evaluate_arith("2 * (3 + 4)")', 14),
    SH('evaluate_arith("8 / 2")', 4),
  ],
},
{
  id: 'BH-H12', mode: 'bug-hunt', difficulty: 'hard', topic: 'recursion',
  title: 'Hanoi heads home',
  languages: ALL,
  functionName: 'hanoi',
  description: '`hanoi(n, frm, to, via)` should return the list of moves that moves n discs from peg `frm` to peg `to` using `via`, each move `pair(from_peg, to_peg)` (a tuple in full Python). The discs end up on the wrong peg. Find and fix the bug.',
  buggy: { sicpy: HANOI('hanoi(n - 1, via, frm, to)'), python: HANOI_PY('hanoi(n - 1, via, frm, to)') },
  bugLines: { sicpy: [5], python: [4] },
  bugExplanation: 'After moving the largest disc, the n − 1 smaller discs sitting on via must go onto the target peg to, using frm as the spare: hanoi(n − 1, via, to, frm). The buggy call sends them back to frm.',
  solution: { sicpy: HANOI('hanoi(n - 1, via, to, frm)'), python: HANOI_PY('hanoi(n - 1, via, to, frm)') },
  tests: [
    T('hanoi', [2, 'A', 'C', 'B'], hanoiMoves(2, 'A', 'C', 'B')),
    T('hanoi', [0, 'A', 'C', 'B'], [], { note: 'no discs' }),
    H('hanoi', [1, 'A', 'C', 'B'], hanoiMoves(1, 'A', 'C', 'B')),
    H('hanoi', [3, 'A', 'C', 'B'], hanoiMoves(3, 'A', 'C', 'B')),
    H('hanoi', [2, 'x', 'y', 'z'], hanoiMoves(2, 'x', 'y', 'z')),
    H('hanoi', [5, 'L', 'R', 'M'], hanoiMoves(5, 'L', 'R', 'M')),
  ],
},
];
