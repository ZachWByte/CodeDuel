import { T, H, R, A, P, ST, SO, SH, ALL, SICPY, PY4, stubs, stub } from './helpers.js';

// ---- plain-JS reference helpers used to compute expected answers
const chars = (s) => s.split('');
const lcs = (a, b) => {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
};
const knap = (w, v, cap) => {
  const best = new Array(cap + 1).fill(0);
  w.forEach((wi, i) => { for (let c = cap; c >= wi; c--) best[c] = Math.max(best[c], best[c - wi] + v[i]); });
  return best[cap];
};
const primes = (n) => {
  const out = [];
  for (let k = 2; out.length < n; k++) if (out.every((p) => k % p !== 0)) out.push(k);
  return out;
};
const hanoiMoves = (n, from, to, via) => (n === 0 ? [] : [
  ...hanoiMoves(n - 1, from, via, to), P(from, to), ...hanoiMoves(n - 1, via, to, from)]);
const matmul = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((s, x, k) => s + x * b[k][j], 0)));
const mat = (rows) => A(rows.map((r) => A(r)));
const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const fn = (src) => R(src);

/** Converting a linked list into an array: the same opening lines in several solutions. */
const TO_ARRAY = (name, list) => `    ${name} = [0] * length(${list})\n    p = ${list}\n    for i in range(len(${name})):\n        ${name}[i] = head(p)\n        p = tail(p)`;

export default [
{
  id: 'CR-H01', mode: 'code-race', difficulty: 'hard', topic: 'backtracking',
  title: 'N queens',
  languages: ALL,
  functionName: 'queens',
  description: 'Write `queens(n)` that returns the number of ways to place `n` queens on an n × n chessboard so that no two queens attack each other (no two share a row, a column or a diagonal).\n\n`n` is an integer: 1 ≤ n ≤ 6 in Python §, 1 ≤ n ≤ 8 in full Python.',
  // NOTE: the spec allows n ≤ 8. The textbook list-based queens(7) needs about
  // 2.9 million py-slang steps (right at the time limit), so the n = 7 and n = 8
  // secret tests are full-Python only.
  starter: stubs('queens(n)'),
  solution: {
    sicpy: `def queens(n):\n    cols = [0] * n\n    def safe(row, col):\n        for r in range(row):\n            if cols[r] == col or abs(cols[r] - col) == row - r:\n                return False\n        return True\n    def place(row):\n        if row == n:\n            return 1\n        count = 0\n        for col in range(n):\n            if safe(row, col):\n                cols[row] = col\n                count = count + place(row + 1)\n        return count\n    return place(0)`,
    python: `def queens(n):\n    cols = []\n    def safe(row, col):\n        for r in range(row):\n            if cols[r] == col or abs(cols[r] - col) == row - r:\n                return False\n        return True\n    def place(row):\n        if row == n:\n            return 1\n        count = 0\n        for col in range(n):\n            if safe(row, col):\n                cols.append(col)\n                count += place(row + 1)\n                cols.pop()\n        return count\n    return place(0)`,
  },
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
  id: 'CR-H02', mode: 'code-race', difficulty: 'hard', topic: 'mutation',
  title: 'Detect a cycle',
  languages: SICPY,
  functionName: 'has_cycle',
  description: 'Write `has_cycle(xs)` that returns `True` if following the tails of `xs` eventually loops back (the list was made circular with `set_tail`), and `False` if it reaches `None`.\n\nUse only O(1) extra memory: no arrays, no lists of visited pairs. (Hint: two pointers moving at different speeds.) The tests only check that the answer is correct.\n\nAll elements in a test list are different, so two pointers are at the same pair exactly when `p == q`.',
  starter: { sicpy: stub('has_cycle(xs)') },
  solution: {
    sicpy: `def has_cycle(xs):\n    slow = xs\n    fast = xs\n    while not is_none(fast) and not is_none(tail(fast)):\n        slow = tail(slow)\n        fast = tail(tail(fast))\n        if slow == fast:\n            return True\n    return False`,
  },
  tests: [
    SO('has_cycle(llist(1, 2, 3))', false),
    SO('has_cycle(xs)', true, { setup: 'xs = llist(1, 2, 3)\nset_tail(tail(tail(xs)), xs)', note: 'last pair points back to the start' }),
    SH('has_cycle(None)', false),
    SH('has_cycle(xs)', true, { setup: 'xs = llist(1)\nset_tail(xs, xs)' }),
    SH('has_cycle(xs)', true, { setup: 'xs = llist(1, 2, 3, 4, 5)\nset_tail(tail(tail(tail(tail(xs)))), tail(tail(xs)))' }),
    SH('has_cycle(enum_llist(1, 100))', false),
    SH('has_cycle(llist(1, 2))', false),
    SH('has_cycle(xs)', true, { setup: 'xs = llist(1, 2)\nset_tail(tail(xs), tail(xs))' }),
  ],
},
{
  id: 'CR-H03', mode: 'code-race', difficulty: 'hard', topic: 'streams',
  title: 'First n primes',
  languages: SICPY,
  functionName: 'first_primes',
  description: 'Write `first_primes(n)` that returns a list of the first `n` prime numbers, in increasing order.\n\nSuggested approach: the sieve of Eratosthenes as a stream. Start from `integers_from(2)`; the head is prime, and the rest is the sieve of the tail with all multiples of the head removed (`stream_filter`). Then take `n` elements with `eval_stream`.\n\n`n` is an integer, 0 ≤ n ≤ 30.',
  starter: { sicpy: stub('first_primes(n)') },
  solution: {
    sicpy: `def sieve(s):\n    return pair(head(s),\n                lambda: sieve(stream_filter(lambda x: x % head(s) != 0, stream_tail(s))))\n\ndef first_primes(n):\n    return eval_stream(sieve(integers_from(2)), n)`,
  },
  tests: [
    SO('first_primes(5)', [2, 3, 5, 7, 11]),
    SO('first_primes(0)', [], { note: 'n = 0' }),
    SH('first_primes(1)', [2]),
    SH('first_primes(2)', [2, 3]),
    SH('first_primes(10)', primes(10)),
    SH('first_primes(30)', primes(30)),
  ],
},
{
  id: 'CR-H04', mode: 'code-race', difficulty: 'hard', topic: 'streams',
  title: 'Partial sums',
  languages: SICPY,
  functionName: 'partial_sums',
  description: 'Write `partial_sums(s)` that takes a stream of numbers `s0, s1, s2, …` and returns the stream `s0, s0 + s1, s0 + s1 + s2, …`.\n\nIt must work for infinite streams: `eval_stream(partial_sums(integers_from(1)), 5)` is `llist(1, 3, 6, 10, 15)`. It must also work for finite streams, including the empty stream `None`.',
  starter: { sicpy: stub('partial_sums(s)') },
  solution: {
    sicpy: `def partial_sums(s):\n    def sums(s, acc):\n        if is_none(s):\n            return None\n        total = acc + head(s)\n        return pair(total, lambda: sums(stream_tail(s), total))\n    return sums(s, 0)`,
  },
  tests: [
    SO('eval_stream(partial_sums(integers_from(1)), 5)', [1, 3, 6, 10, 15]),
    SO('stream_to_llist(partial_sums(stream(5, -2, 4)))', [5, 3, 7], { note: 'finite stream' }),
    SH('partial_sums(None)', null),
    SH('eval_stream(partial_sums(integers_from(1)), 1)', [1]),
    SH('eval_stream(partial_sums(integers_from(0)), 6)', [0, 1, 3, 6, 10, 15]),
    SH('eval_stream(partial_sums(stream_map(lambda x: 2 * x, integers_from(1))), 4)', [2, 6, 12, 20]),
    SH('stream_to_llist(partial_sums(stream(1, 1, 1, 1)))', [1, 2, 3, 4]),
    SH('llist_ref(eval_stream(partial_sums(integers_from(1)), 100), 99)', 5050),
  ],
},
{
  id: 'CR-H05', mode: 'code-race', difficulty: 'hard', topic: 'dynamic programming',
  title: 'Longest common subsequence',
  languages: ALL,
  functionName: 'lcs_length',
  description: 'Write `lcs_length(xs, ys)` that returns the length of the longest common subsequence of the lists `xs` and `ys`. A subsequence keeps the order of the elements but may skip some.\n\nExample: for the letters of `"ABCBDAB"` and `"BDCABA"` the answer is 4 (e.g. B, C, B, A).\n\nEach list has at most 40 elements.',
  starter: stubs('lcs_length(xs, ys)'),
  solution: {
    sicpy: `def lcs_length(xs, ys):\n${TO_ARRAY('a', 'xs')}\n${TO_ARRAY('b', 'ys')}\n    n = len(a)\n    m = len(b)\n    dp = [None] * (n + 1)\n    for i in range(n + 1):\n        dp[i] = [0] * (m + 1)\n    for i in range(1, n + 1):\n        for j in range(1, m + 1):\n            if a[i - 1] == b[j - 1]:\n                dp[i][j] = dp[i - 1][j - 1] + 1\n            else:\n                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])\n    return dp[n][m]`,
    python: `def lcs_length(xs, ys):\n    n, m = len(xs), len(ys)\n    dp = [[0] * (m + 1) for _ in range(n + 1)]\n    for i in range(1, n + 1):\n        for j in range(1, m + 1):\n            if xs[i - 1] == ys[j - 1]:\n                dp[i][j] = dp[i - 1][j - 1] + 1\n            else:\n                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])\n    return dp[n][m]`,
  },
  tests: [
    T('lcs_length', [chars('ABCBDAB'), chars('BDCABA')], 4),
    T('lcs_length', [[], [1, 2]], 0, { note: 'empty list' }),
    H('lcs_length', [[1, 2, 3], [1, 2, 3]], 3),
    H('lcs_length', [[1, 2, 3], [4, 5, 6]], 0),
    H('lcs_length', [[1], [1]], 1),
    H('lcs_length', [[1, 3, 5, 7, 9], [1, 2, 3, 4, 5, 6, 7, 8, 9]], 5),
    H('lcs_length', [chars('AGGTAB'), chars('GXTXAYB')], 4),
    H('lcs_length', [seq(40, (i) => (i * 7) % 11), seq(40, (i) => (i * 5) % 13)],
      lcs(seq(40, (i) => (i * 7) % 11), seq(40, (i) => (i * 5) % 13))),
  ],
},
{
  id: 'CR-H06', mode: 'code-race', difficulty: 'hard', topic: 'dynamic programming',
  title: '0/1 knapsack',
  languages: ALL,
  functionName: 'knapsack',
  description: 'Write `knapsack(weights, values, cap)` that returns the largest total value of a set of items whose total weight is at most `cap`. Item `i` has weight `weights[i]` and value `values[i]`, and each item can be used **at most once**.\n\n`weights` and `values` are arrays (lists written `[...]`) of the same length (at most 30) of positive integers. `cap` is an integer, 0 ≤ cap ≤ 1000.',
  starter: stubs('knapsack(weights, values, cap)'),
  solution: {
    sicpy: `def knapsack(weights, values, cap):\n    best = [0] * (cap + 1)\n    for i in range(len(weights)):\n        w = weights[i]\n        for c in range(cap, w - 1, -1):\n            best[c] = max(best[c], best[c - w] + values[i])\n    return best[cap]`,
    python: `def knapsack(weights, values, cap):\n    best = [0] * (cap + 1)\n    for w, v in zip(weights, values):\n        for c in range(cap, w - 1, -1):\n            best[c] = max(best[c], best[c - w] + v)\n    return best[cap]`,
  },
  tests: [
    T('knapsack', [A([1, 3, 4, 5]), A([1, 4, 5, 7]), 7], 9),
    T('knapsack', [A([]), A([]), 10], 0, { note: 'no items' }),
    H('knapsack', [A([5]), A([10]), 4], 0),
    H('knapsack', [A([5]), A([10]), 5], 10),
    H('knapsack', [A([1, 2, 3]), A([6, 10, 12]), 5], 22),
    H('knapsack', [A([2, 2, 2]), A([3, 3, 3]), 0], 0),
    H('knapsack', [A([10, 20, 30]), A([60, 100, 120]), 50], 220),
    H('knapsack', [A([1, 1, 1]), A([5, 5, 5]), 10], 15),
    H('knapsack', [A(seq(30, (i) => (i * 37) % 23 + 1)), A(seq(30, (i) => (i * 53) % 31 + 1)), 100],
      knap(seq(30, (i) => (i * 37) % 23 + 1), seq(30, (i) => (i * 53) % 31 + 1), 100)),
  ],
},
{
  id: 'CR-H07', mode: 'code-race', difficulty: 'hard', topic: 'dynamic programming',
  title: 'Edit distance',
  languages: ALL,
  functionName: 'edit_distance',
  description: 'Write `edit_distance(xs, ys)` that returns the smallest number of single-element edits (insert an element, delete an element, or replace one element with another) that turn the list `xs` into the list `ys`.\n\nExample: the letters of `"kitten"` → `"sitting"` take 3 edits.\n\nEach list has at most 40 elements.',
  starter: stubs('edit_distance(xs, ys)'),
  solution: {
    sicpy: `def edit_distance(xs, ys):\n${TO_ARRAY('a', 'xs')}\n${TO_ARRAY('b', 'ys')}\n    n = len(a)\n    m = len(b)\n    dp = [None] * (n + 1)\n    for i in range(n + 1):\n        dp[i] = [0] * (m + 1)\n        for j in range(m + 1):\n            if i == 0:\n                dp[i][j] = j\n            elif j == 0:\n                dp[i][j] = i\n            elif a[i - 1] == b[j - 1]:\n                dp[i][j] = dp[i - 1][j - 1]\n            else:\n                dp[i][j] = 1 + min(dp[i - 1][j], min(dp[i][j - 1], dp[i - 1][j - 1]))\n    return dp[n][m]`,
    python: `def edit_distance(xs, ys):\n    n, m = len(xs), len(ys)\n    dp = [[0] * (m + 1) for _ in range(n + 1)]\n    for i in range(n + 1):\n        for j in range(m + 1):\n            if i == 0:\n                dp[i][j] = j\n            elif j == 0:\n                dp[i][j] = i\n            elif xs[i - 1] == ys[j - 1]:\n                dp[i][j] = dp[i - 1][j - 1]\n            else:\n                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])\n    return dp[n][m]`,
  },
  tests: [
    T('edit_distance', [chars('kitten'), chars('sitting')], 3),
    T('edit_distance', [[], [1, 2, 3]], 3, { note: 'from empty' }),
    H('edit_distance', [[1, 2, 3], [1, 2, 3]], 0),
    H('edit_distance', [[1], [2]], 1),
    H('edit_distance', [[], []], 0),
    H('edit_distance', [chars('sunday'), chars('saturday')], 3),
    H('edit_distance', [chars('abc'), []], 3),
    H('edit_distance', [chars('intention'), chars('execution')], 5),
  ],
},
{
  id: 'CR-H08', mode: 'code-race', difficulty: 'hard', topic: 'arrays',
  title: 'Matrix multiplication',
  languages: ALL,
  functionName: 'matrix_multiply',
  description: 'Write `matrix_multiply(a, b)` that returns a **new** 2-D array, the matrix product of `a` and `b`. Entry `[i][j]` of the result is the sum over `k` of `a[i][k] * b[k][j]`.\n\n`a` is n × k and `b` is k × m, with 1 ≤ n, k, m ≤ 10. Entries are integers.',
  starter: stubs('matrix_multiply(a, b)'),
  solution: {
    sicpy: `def matrix_multiply(a, b):\n    n = len(a)\n    k = len(b)\n    m = len(b[0])\n    c = [None] * n\n    for i in range(n):\n        c[i] = [0] * m\n        for j in range(m):\n            total = 0\n            for t in range(k):\n                total = total + a[i][t] * b[t][j]\n            c[i][j] = total\n    return c`,
    python: `def matrix_multiply(a, b):\n    return [[sum(a[i][t] * b[t][j] for t in range(len(b)))\n             for j in range(len(b[0]))]\n            for i in range(len(a))]`,
  },
  tests: [
    T('matrix_multiply', [mat([[1, 2], [3, 4]]), mat([[5, 6], [7, 8]])], mat([[19, 22], [43, 50]])),
    T('matrix_multiply', [mat([[1, 2, 3]]), mat([[4], [5], [6]])], mat([[32]]), { note: '1×3 times 3×1' }),
    H('matrix_multiply', [mat([[2]]), mat([[3]])], mat([[6]])),
    H('matrix_multiply', [mat([[1, 0], [0, 1]]), mat([[9, -8], [7, 6]])], mat([[9, -8], [7, 6]])),
    H('matrix_multiply', [mat([[1], [2]]), mat([[3, 4]])], mat([[3, 4], [6, 8]])),
    H('matrix_multiply', [mat([[1, 2], [3, 4], [5, 6]]), mat([[1, 0, -1, 2], [2, 1, 0, -3]])],
      mat(matmul([[1, 2], [3, 4], [5, 6]], [[1, 0, -1, 2], [2, 1, 0, -3]]))),
    H('matrix_multiply', [mat([[0, 0], [0, 0]]), mat([[5, 5], [5, 5]])], mat([[0, 0], [0, 0]])),
  ],
},
{
  id: 'CR-H09', mode: 'code-race', difficulty: 'hard', topic: 'dynamic programming',
  title: 'Paths through a grid',
  languages: ALL,
  functionName: 'grid_paths',
  description: 'Write `grid_paths(grid)` that returns the number of paths from the top-left cell to the bottom-right cell of `grid`, moving only **right** or **down**. A cell containing 1 is blocked; 0 is open. If the start or end cell is blocked the answer is 0.\n\n`grid` is a 2-D array with between 1 and 12 rows and columns.',
  starter: stubs('grid_paths(grid)'),
  solution: {
    sicpy: `def grid_paths(grid):\n    rows = len(grid)\n    cols = len(grid[0])\n    ways = [None] * rows\n    for r in range(rows):\n        ways[r] = [0] * cols\n        for c in range(cols):\n            if grid[r][c] == 1:\n                ways[r][c] = 0\n            elif r == 0 and c == 0:\n                ways[r][c] = 1\n            else:\n                up = ways[r - 1][c] if r > 0 else 0\n                left = ways[r][c - 1] if c > 0 else 0\n                ways[r][c] = up + left\n    return ways[rows - 1][cols - 1]`,
    python: `def grid_paths(grid):\n    rows, cols = len(grid), len(grid[0])\n    ways = [[0] * cols for _ in range(rows)]\n    for r in range(rows):\n        for c in range(cols):\n            if grid[r][c] == 1:\n                ways[r][c] = 0\n            elif r == 0 and c == 0:\n                ways[r][c] = 1\n            else:\n                ways[r][c] = (ways[r - 1][c] if r > 0 else 0) + (ways[r][c - 1] if c > 0 else 0)\n    return ways[rows - 1][cols - 1]`,
  },
  tests: [
    T('grid_paths', [mat([[0, 0, 0], [0, 0, 0], [0, 0, 0]])], 6),
    T('grid_paths', [mat([[0, 1], [0, 0]])], 1, { note: 'one blocked cell' }),
    H('grid_paths', [mat([[0]])], 1),
    H('grid_paths', [mat([[1]])], 0),
    H('grid_paths', [mat([[0, 0], [0, 1]])], 0),
    H('grid_paths', [mat([[0, 0, 0], [0, 1, 0], [0, 0, 0]])], 2),
    H('grid_paths', [mat([[0, 0, 0, 0]])], 1),
    H('grid_paths', [mat(seq(10, () => seq(10, () => 0)))], 48620),
    H('grid_paths', [mat([[0, 0, 1], [1, 1, 0], [0, 0, 0]])], 0),
  ],
},
{
  id: 'CR-H10', mode: 'code-race', difficulty: 'hard', topic: 'trees',
  title: 'Deep map',
  languages: ALL,
  functionName: 'deep_map',
  description: 'Write `deep_map(f, tree)` that returns a new nested list with the same shape as `tree`, where every non-list element `x` is replaced by `f(x)`.',
  starter: stubs('deep_map(f, tree)'),
  solution: {
    sicpy: `def deep_map(f, tree):\n    return map(lambda x: deep_map(f, x) if is_llist(x) else f(x), tree)`,
    python: `def deep_map(f, tree):\n    return [deep_map(f, x) if isinstance(x, list) else f(x) for x in tree]`,
  },
  tests: [
    T('deep_map', [fn('lambda x: x * 10'), [1, [2, 3], 4]], [10, [20, 30], 40]),
    T('deep_map', [fn('lambda x: x + 1'), []], [], { note: 'empty list' }),
    H('deep_map', [fn('lambda x: x + 1'), [[[]]]], [[[]]]),
    H('deep_map', [fn('lambda x: x * x'), [[1], [[2]]]], [[1], [[4]]]),
    H('deep_map', [fn('lambda x: x + "!"'), ['a', ['b']]], ['a!', ['b!']]),
    H('deep_map', [fn('lambda x: -x'), [1, 2, 3]], [-1, -2, -3]),
    H('deep_map', [fn('lambda x: 2 * x'), [[[[[5]]]], 1]], [[[[[10]]]], 2]),
  ],
},
{
  id: 'CR-H11', mode: 'code-race', difficulty: 'hard', topic: 'sorting',
  title: 'Merge sort',
  languages: ALL,
  functionName: 'merge_sort',
  description: 'Write `merge_sort(xs)` that returns a **new** list with the numbers of `xs` in ascending order, using merge sort: split the list into two halves, sort each half, and merge the results.\n\nIn full Python you may **not** use `sort` or `sorted`.\n\n`xs` has at most 200 elements.',
  starter: stubs('merge_sort(xs)'),
  solution: {
    sicpy: `def merge_sort(xs):\n    def merge(a, b):\n        if is_none(a):\n            return b\n        if is_none(b):\n            return a\n        if head(a) <= head(b):\n            return pair(head(a), merge(tail(a), b))\n        return pair(head(b), merge(a, tail(b)))\n    def take(ys, n):\n        return None if n == 0 else pair(head(ys), take(tail(ys), n - 1))\n    def drop(ys, n):\n        return ys if n == 0 else drop(tail(ys), n - 1)\n    if is_none(xs) or is_none(tail(xs)):\n        return xs\n    half = length(xs) // 2\n    return merge(merge_sort(take(xs, half)), merge_sort(drop(xs, half)))`,
    python: `def merge_sort(xs):\n    if len(xs) <= 1:\n        return list(xs)\n    mid = len(xs) // 2\n    a, b = merge_sort(xs[:mid]), merge_sort(xs[mid:])\n    result, i, j = [], 0, 0\n    while i < len(a) and j < len(b):\n        if a[i] <= b[j]:\n            result.append(a[i])\n            i += 1\n        else:\n            result.append(b[j])\n            j += 1\n    return result + a[i:] + b[j:]`,
  },
  banned: { python: ['sort', 'sorted'] },
  tests: [
    T('merge_sort', [[5, 2, 4, 1, 3]], [1, 2, 3, 4, 5]),
    T('merge_sort', [[]], [], { note: 'empty list' }),
    H('merge_sort', [[1]], [1]),
    H('merge_sort', [[2, 1]], [1, 2]),
    H('merge_sort', [[3, 1, 3, 1, 2]], [1, 1, 2, 3, 3]),
    H('merge_sort', [[-4, 10, 0, -7, 3]], [-7, -4, 0, 3, 10]),
    H('merge_sort', [[1, 2, 3, 4]], [1, 2, 3, 4]),
    H('merge_sort', [seq(200, (i) => (i * 73) % 200)], seq(200, (i) => i)),
  ],
},
{
  id: 'CR-H12', mode: 'code-race', difficulty: 'hard', topic: 'sorting',
  title: 'Quicksort',
  languages: ALL,
  functionName: 'quick_sort',
  description: 'Write `quick_sort(xs)` that returns a **new** list with the numbers of `xs` in ascending order, using quicksort: pick a pivot, split the other elements into those smaller than the pivot and the rest, sort both parts and join them. Duplicates must be kept.\n\nIn full Python you may **not** use `sort` or `sorted`.\n\n`xs` has at most 100 elements.',
  starter: stubs('quick_sort(xs)'),
  solution: {
    sicpy: `def quick_sort(xs):\n    if is_none(xs):\n        return None\n    p = head(xs)\n    rest = tail(xs)\n    return append(quick_sort(filter(lambda x: x < p, rest)),\n                  pair(p, quick_sort(filter(lambda x: x >= p, rest))))`,
    python: `def quick_sort(xs):\n    if not xs:\n        return []\n    p, rest = xs[0], xs[1:]\n    return quick_sort([x for x in rest if x < p]) + [p] + quick_sort([x for x in rest if x >= p])`,
  },
  banned: { python: ['sort', 'sorted'] },
  tests: [
    T('quick_sort', [[3, 6, 1, 8, 2]], [1, 2, 3, 6, 8]),
    T('quick_sort', [[2, 1, 2, 1]], [1, 1, 2, 2], { note: 'duplicates' }),
    H('quick_sort', [[]], []),
    H('quick_sort', [[7]], [7]),
    H('quick_sort', [[5, 5, 5]], [5, 5, 5]),
    H('quick_sort', [[-1, -3, 2, 0]], [-3, -1, 0, 2]),
    H('quick_sort', [seq(100, (i) => 100 - i)], seq(100, (i) => i + 1)),
    H('quick_sort', [seq(60, (i) => (i * 17) % 10)], seq(60, (i) => (i * 17) % 10).sort((a, b) => a - b)),
  ],
},
{
  id: 'CR-H13', mode: 'code-race', difficulty: 'hard', topic: 'state',
  title: 'Accumulator',
  languages: ALL,
  functionName: 'make_accumulator',
  description: 'Write `make_accumulator(start)` that returns a function `acc`. Each call `acc(x)` adds `x` to a running total (which starts at `start`) and returns the new total.\n\nExample: after `acc = make_accumulator(5)`, `acc(10)` returns 15, then `acc(10)` returns 25. Different accumulators keep separate totals. (Hint: `nonlocal`.)',
  starter: stubs('make_accumulator(start)'),
  solution: {
    sicpy: `def make_accumulator(start):\n    total = start\n    def acc(x):\n        nonlocal total\n        total = total + x\n        return total\n    return acc`,
    python: `def make_accumulator(start):\n    total = start\n    def acc(x):\n        nonlocal total\n        total += x\n        return total\n    return acc`,
  },
  tests: [
    ST({ sicpy: 'acc = make_accumulator(5)\nacc(10)', call: 'acc(10)', expect: 25 }),
    ST({ call: 'make_accumulator(0)(7)', expect: 7, note: 'first call' }),
    ST({ sicpy: 'a = make_accumulator(1)\nb = make_accumulator(100)\na(1)\nb(1)', call: 'a(1)', expect: 3, hidden: true }),
    ST({ call: 'make_accumulator(3)(0)', expect: 3, hidden: true }),
    ST({ sicpy: 'acc = make_accumulator(10)\nacc(-4)', call: 'acc(-6)', expect: 0, hidden: true }),
    ST({ sicpy: 'acc = make_accumulator(0)\nfor i in range(1, 11):\n    acc(i)', call: 'acc(0)', expect: 55, hidden: true }),
    ST({ sicpy: 'a = make_accumulator(1)\nb = make_accumulator(100)\na(1)\nb(1)', call: 'b(0)', expect: 101, hidden: true }),
  ],
},
{
  id: 'CR-H14', mode: 'code-race', difficulty: 'hard', topic: 'state',
  title: 'Monitored function',
  languages: ALL,
  functionName: 'make_monitored',
  description: 'Write `make_monitored(f)` where `f` takes one argument. It returns a function `mf` that keeps count of how many times it has been called:\n\n- `mf("how many calls")` returns the count (and does not change it)\n- `mf("reset count")` sets the count back to 0\n- any other argument `x`: adds 1 to the count and returns `f(x)`',
  starter: stubs('make_monitored(f)'),
  solution: {
    sicpy: `def make_monitored(f):\n    count = 0\n    def mf(x):\n        nonlocal count\n        if x == "how many calls":\n            return count\n        elif x == "reset count":\n            count = 0\n            return count\n        else:\n            count = count + 1\n            return f(x)\n    return mf`,
    python: `def make_monitored(f):\n    count = 0\n    def mf(x):\n        nonlocal count\n        if x == "how many calls":\n            return count\n        if x == "reset count":\n            count = 0\n            return count\n        count += 1\n        return f(x)\n    return mf`,
  },
  tests: [
    ST({ sicpy: 'mf = make_monitored(lambda x: x * x)\nmf(3)\nmf(4)', call: 'mf("how many calls")', expect: 2 }),
    ST({ sicpy: 'mf = make_monitored(lambda x: x * x)', call: 'mf(5)', expect: 25, note: 'passes through to f' }),
    ST({ sicpy: 'mf = make_monitored(lambda x: x)', call: 'mf("how many calls")', expect: 0, hidden: true }),
    ST({ sicpy: 'mf = make_monitored(lambda x: x)\nmf(1)\nmf(2)\nmf("reset count")\nmf(3)', call: 'mf("how many calls")', expect: 1, hidden: true }),
    ST({ sicpy: 'mf = make_monitored(lambda x: x + 1)', call: 'mf(10)', expect: 11, hidden: true }),
    ST({ sicpy: 'mf = make_monitored(lambda x: x)\nmf(1)\nmf("how many calls")', call: 'mf("how many calls")', expect: 1, hidden: true }),
    ST({ sicpy: 'm1 = make_monitored(lambda x: x)\nm2 = make_monitored(lambda x: x)\nm1(1)\nm1(1)\nm2(1)', call: 'm2("how many calls")', expect: 1, hidden: true }),
  ],
},
{
  id: 'CR-H15', mode: 'code-race', difficulty: 'hard', topic: 'recursion',
  title: 'Towers of Hanoi',
  languages: ALL,
  functionName: 'hanoi',
  description: 'Write `hanoi(n, frm, to, via)` that returns the list of moves that solves Towers of Hanoi: move `n` discs from peg `frm` to peg `to`, using peg `via` as the spare. Pegs are strings. (`from` is a Python keyword, hence `frm`.)\n\nEach move is `pair(from_peg, to_peg)` in Python § and a tuple `(from_peg, to_peg)` in full Python.\n\nUse the standard recursive solution (n − 1 discs out of the way, move the largest, n − 1 discs back on top); the moves must come out in that order.\n\n`n` is an integer, 0 ≤ n ≤ 8.',
  starter: stubs('hanoi(n, frm, to, via)'),
  solution: {
    sicpy: `def hanoi(n, frm, to, via):\n    if n == 0:\n        return None\n    return append(hanoi(n - 1, frm, via, to),\n                  pair(pair(frm, to), hanoi(n - 1, via, to, frm)))`,
    python: `def hanoi(n, frm, to, via):\n    if n == 0:\n        return []\n    return hanoi(n - 1, frm, via, to) + [(frm, to)] + hanoi(n - 1, via, to, frm)`,
  },
  tests: [
    T('hanoi', [2, 'A', 'C', 'B'], hanoiMoves(2, 'A', 'C', 'B')),
    T('hanoi', [0, 'A', 'C', 'B'], [], { note: 'no discs' }),
    H('hanoi', [1, 'A', 'C', 'B'], hanoiMoves(1, 'A', 'C', 'B')),
    H('hanoi', [3, 'A', 'C', 'B'], hanoiMoves(3, 'A', 'C', 'B')),
    H('hanoi', [2, 'x', 'y', 'z'], hanoiMoves(2, 'x', 'y', 'z')),
    H('hanoi', [5, 'L', 'R', 'M'], hanoiMoves(5, 'L', 'R', 'M')),
    H('hanoi', [8, 'A', 'B', 'C'], hanoiMoves(8, 'A', 'B', 'C')),
  ],
},
{
  id: 'CR-H16', mode: 'code-race', difficulty: 'hard', topic: 'dynamic programming',
  title: 'Longest increasing subsequence',
  languages: ALL,
  functionName: 'lis_length',
  description: 'Write `lis_length(xs)` that returns the length of the longest **strictly** increasing subsequence of the list of numbers `xs`. A subsequence keeps the order but may skip elements.\n\nExample: `10, 9, 2, 5, 3, 7, 101, 18` → 4 (e.g. 2, 3, 7, 18).\n\n`xs` has at most 100 elements.',
  starter: stubs('lis_length(xs)'),
  solution: {
    sicpy: `def lis_length(xs):\n${TO_ARRAY('a', 'xs')}\n    n = len(a)\n    best = [1] * n\n    answer = 0\n    for i in range(n):\n        for j in range(i):\n            if a[j] < a[i] and best[j] + 1 > best[i]:\n                best[i] = best[j] + 1\n        answer = max(answer, best[i])\n    return answer`,
    python: `def lis_length(xs):\n    best = []\n    for i, x in enumerate(xs):\n        best.append(1 + max([best[j] for j in range(i) if xs[j] < x], default=0))\n    return max(best, default=0)`,
  },
  tests: [
    T('lis_length', [[10, 9, 2, 5, 3, 7, 101, 18]], 4),
    T('lis_length', [[]], 0, { note: 'empty list' }),
    H('lis_length', [[5]], 1),
    H('lis_length', [[1, 2, 3, 4]], 4),
    H('lis_length', [[4, 3, 2, 1]], 1),
    H('lis_length', [[2, 2, 2]], 1),
    H('lis_length', [[0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15]], 6),
    H('lis_length', [[3, 10, 2, 1, 20]], 3),
    H('lis_length', [seq(100, (i) => i)], 100),
  ],
},
{
  id: 'CR-H17', mode: 'code-race', difficulty: 'hard', topic: 'parse',
  title: 'Count the literals',
  languages: PY4,
  functionName: 'count_literals',
  description: 'Write `count_literals(program)` where `program` is a string of Python code. Return the number of `"literal"` nodes in `parse(program)`, counting at every depth.\n\nA literal node looks like `llist("literal", 5)`. Numbers, strings, `True`, `False` and `None` written in the program are all literals.\n\nTip: try `print(parse("1 + 2"))` to see the shape of the tree.',
  starter: { sicpy: stub('count_literals(program)') },
  solution: {
    sicpy: `def count_literals(program):\n    def walk(t):\n        if not is_pair(t):\n            return 0\n        if is_string(head(t)):\n            if head(t) == "literal":\n                return 1\n            return reduce(lambda child, acc: walk(child) + acc, 0, tail(t))\n        return reduce(lambda child, acc: walk(child) + acc, 0, t)\n    return walk(parse(program))`,
  },
  tests: [
    SO('count_literals("1 + 2")', 2),
    SO('count_literals("x")', 0, { note: 'no literals' }),
    SH('count_literals("x = 5")', 1),
    SH('count_literals("f(1, 2, 3)")', 3),
    SH('count_literals("def f(x):\\n    return x * 2 + 1")', 2),
    SH('count_literals("True")', 1),
    SH('count_literals("\'hello\'")', 1),
    SH('count_literals("a = 1\\nb = a + 2\\na * b")', 2),
    SH('count_literals("None")', 1),
  ],
},
{
  id: 'CR-H18', mode: 'code-race', difficulty: 'hard', topic: 'parse',
  title: 'Count the function calls',
  languages: PY4,
  functionName: 'count_applications',
  description: 'Write `count_applications(program)` where `program` is a string of Python code. Return the number of `"application"` nodes (function calls) in `parse(program)`, counting at every depth. Operators such as `+` are **not** applications.\n\nTip: try `print(parse("f(g(1))"))`.',
  starter: { sicpy: stub('count_applications(program)') },
  solution: {
    sicpy: `def count_applications(program):\n    def walk(t):\n        if not is_pair(t):\n            return 0\n        if is_string(head(t)):\n            here = 1 if head(t) == "application" else 0\n            return here + reduce(lambda child, acc: walk(child) + acc, 0, tail(t))\n        return reduce(lambda child, acc: walk(child) + acc, 0, t)\n    return walk(parse(program))`,
  },
  tests: [
    SO('count_applications("f(1)")', 1),
    SO('count_applications("1 + 2")', 0, { note: 'operators are not calls' }),
    SH('count_applications("f(g(1), h(2))")', 3),
    SH('count_applications("x = f(1) + g(2)")', 2),
    SH('count_applications("def f(x):\\n    return f(x - 1)")', 1),
    SH('count_applications("max(1, 2)\\nprint(3)")', 2),
    SH('count_applications("lambda x: x(1)")', 1),
    SH('count_applications("y = 3")', 0),
  ],
},
{
  id: 'CR-H19', mode: 'code-race', difficulty: 'hard', topic: 'parse',
  title: 'Declared names',
  languages: PY4,
  functionName: 'declared_names',
  description: 'Write `declared_names(program)` where `program` is a string of Python code. Return a list of the names bound at the **top level** of the program by assignment (`x = …`) or `def`, in the order they appear. Each test program binds each name once.\n\nCareful: `parse` returns a single statement directly when the program has one statement, but `llist("sequence", llist(stmt1, stmt2, …))` when it has two or more (or none). Handle both.\n\nThe tags are `"assignment"` and `"function_definition"`; the second element of each is a `llist("name", …)` node.',
  starter: { sicpy: stub('declared_names(program)') },
  solution: {
    sicpy: `def declared_names(program):\n    p = parse(program)\n    stmts = head(tail(p)) if head(p) == "sequence" else llist(p)\n    decls = filter(lambda s: head(s) == "assignment" or head(s) == "function_definition", stmts)\n    return map(lambda s: head(tail(head(tail(s)))), decls)`,
  },
  tests: [
    SO('declared_names("x = 1\\ny = 2")', ['x', 'y']),
    SO('declared_names("x + 1")', [], { note: 'no declarations' }),
    SH('declared_names("a = 1")', ['a']),
    SH('declared_names("def f(a):\\n    inner = a\\n    return inner")', ['f']),
    SH('declared_names("z = 0\\nprint(z)\\ndef g():\\n    return z\\nw = g()")', ['z', 'g', 'w']),
    SH('declared_names("print(1)\\nq = 2")', ['q']),
    SH('declared_names("")', []),
  ],
},
{
  id: 'CR-H20', mode: 'code-race', difficulty: 'hard', topic: 'parse',
  title: 'Evaluate arithmetic',
  languages: PY4,
  functionName: 'evaluate_arith',
  description: 'Write `evaluate_arith(program)` where `program` is a one-statement Python program made only of number literals, the operators `+ - * /` and brackets. Return its value by walking the tree from `parse(program)`.\n\nNodes are `llist("literal", n)` and `llist("binary_operator_combination", op, left, right)`. You may **not** use `eval` or `apply_in_underlying_python`.',
  starter: { sicpy: stub('evaluate_arith(program)') },
  solution: {
    sicpy: `def evaluate_arith(program):\n    def ev(t):\n        if head(t) == "literal":\n            return head(tail(t))\n        op = llist_ref(t, 1)\n        a = ev(llist_ref(t, 2))\n        b = ev(llist_ref(t, 3))\n        if op == "+":\n            return a + b\n        elif op == "-":\n            return a - b\n        elif op == "*":\n            return a * b\n        else:\n            return a / b\n    return ev(parse(program))`,
  },
  banned: { sicpy: ['eval', 'apply_in_underlying_python'] },
  tests: [
    SO('evaluate_arith("1 + 2 * 3")', 7),
    SO('evaluate_arith("42")', 42, { note: 'just a number' }),
    SH('evaluate_arith("(1 + 2) * 3")', 9),
    SH('evaluate_arith("10 - 4 - 3")', 3),
    SH('evaluate_arith("100 / 4 / 5")', 5),
    SH('evaluate_arith("2 * (3 + 4) - 5")', 9),
    SH('evaluate_arith("8 / (2 + 2) * 3")', 6),
    SH('evaluate_arith("7 - (2 - 10)")', 15),
  ],
},
];
