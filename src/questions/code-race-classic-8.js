import { T, H, A, ST, ALL, stubs, toSicpy, toPy } from './helpers.js';

// Classic problems, eighth batch: a robot in a maze. A maze is a 2-D array of
// one-letter strings: "#" is a wall, "." is an empty cell and "G" is the goal
// (some mazes also have a key "K"). Row 0 is the north edge, column 0 the west.

const both = (code) => ({ sicpy: code, python: code });

// ---- mazes, written as one string per row
const grid = (rows) => rows.map((r) => r.split(''));
const maze = (rows) => A(grid(rows).map((r) => A(r)));
const mat = (rows) => A(rows.map((r) => A(r)));

/** Test that fn(m, ...args) leaves the maze m exactly as it was. */
const unchanged = (fn, rows, args, opts = {}) => ST({
  sicpy: `m0 = ${toSicpy(maze(rows))}\nr0 = ${fn}(m0, ${args.join(', ')})`,
  py: `m0 = ${toPy(maze(rows))}\nr0 = ${fn}(m0, ${args.join(', ')})`,
  call: 'm0', expect: maze(rows), ...opts,
});

// ---- plain-JS references
const D4 = [[-1, 0], [1, 0], [0, 1], [0, -1]];
const inside = (g, r, c) => r >= 0 && r < g.length && c >= 0 && c < g[0].length;
const open = (g, r, c) => inside(g, r, c) && g[r][c] !== '#';
const find = (g, ch) => { for (let r = 0; r < g.length; r++) for (let c = 0; c < g[0].length; c++) if (g[r][c] === ch) return [r, c]; return null; };
const bfs = (g, sr, sc) => { const d = g.map((row) => row.map(() => -1)); d[sr][sc] = 0; const q = [[sr, sc]]; for (let i = 0; i < q.length; i++) { const [r, c] = q[i]; for (const [dr, dc] of D4) { const nr = r + dr; const nc = c + dc; if (open(g, nr, nc) && d[nr][nc] === -1) { d[nr][nc] = d[r][c] + 1; q.push([nr, nc]); } } } return d; };
const wallsRef = (rows) => rows.join('').split('').filter((ch) => ch === '#').length;
const deadEndsRef = (rows) => { const g = grid(rows); let n = 0; for (let r = 0; r < g.length; r++) for (let c = 0; c < g[0].length; c++) if (g[r][c] !== '#' && D4.filter(([dr, dc]) => open(g, r + dr, c + dc)).length === 1) n++; return n; };
const roomRef = (rows, r, c) => bfs(grid(rows), r, c).flat().filter((d) => d >= 0).length;
const reachRef = (rows, r, c) => { const g = grid(rows); const [gr, gc] = find(g, 'G'); return bfs(g, r, c)[gr][gc] >= 0; };
const distRef = (rows, r, c) => mat(bfs(grid(rows), r, c));
const walksRef = (rows, r, c, k) => {
  const g = grid(rows);
  let w = g.map((row) => row.map(() => 0));
  w[r][c] = 1;
  for (let s = 0; s < k; s++) {
    const n = g.map((row) => row.map(() => 0));
    for (let i = 0; i < g.length; i++) for (let j = 0; j < g[0].length; j++) for (const [dr, dc] of D4) if (open(g, i + dr, j + dc)) n[i + dr][j + dc] += w[i][j];
    w = n;
  }
  const [gr, gc] = find(g, 'G');
  return w[gr][gc];
};
const pathsRef = (rows, r, c) => { const g = grid(rows); const go = (r, c) => { if (!open(g, r, c)) return 0; if (g[r][c] === 'G') return 1; const was = g[r][c]; g[r][c] = '#'; const n = D4.reduce((s, [dr, dc]) => s + go(r + dr, c + dc), 0); g[r][c] = was; return n; }; return go(r, c); };
const longestRef = (rows, r, c) => { const g = grid(rows); const go = (r, c) => { if (!open(g, r, c)) return -1; if (g[r][c] === 'G') return 0; const was = g[r][c]; g[r][c] = '#'; let best = -1; for (const [dr, dc] of D4) { const rest = go(r + dr, c + dc); if (rest >= 0) best = Math.max(best, rest + 1); } g[r][c] = was; return best; }; return go(r, c); };
const keyRef = (rows, r, c) => { const g = grid(rows); const [kr, kc] = find(g, 'K'); const [gr, gc] = find(g, 'G'); const a = bfs(g, r, c)[kr][kc]; const b = bfs(g, kr, kc)[gr][gc]; return a < 0 || b < 0 ? -1 : a + b; };
const breaksRef = (rows, r, c) => {
  const g = grid(rows);
  const cost = g.map((row) => row.map(() => Infinity));
  cost[r][c] = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < g.length; i++) for (let j = 0; j < g[0].length; j++) for (const [dr, dc] of D4) {
      if (!inside(g, i + dr, j + dc)) continue;
      const v = cost[i + dr][j + dc] + (g[i][j] === '#' ? 1 : 0);
      if (v < cost[i][j]) { cost[i][j] = v; changed = true; }
    }
  }
  const [gr, gc] = find(g, 'G');
  return cost[gr][gc];
};

// ---- the mazes
const M1 = ['.#.#', '.##.', '...G', '.#..', '...#'];
const M2 = ['.#...', '.#.#.', '...#G', '##...'];
const M3 = ['......', '.####.', '.#..#.', '.#G.#.', '.##.#.', '......'];
const SEALED = ['..#..', '..#.G', '###..', '.....'];
const OPEN4 = ['....', '....', '....', '...G'];
const BIG = ['.....#..', '.###.#.#', '...#...#', '##.###.#', '.......G', '.#####.#', '........'];
const LOOPS = ['.....', '.#.#.', '.....', '.#.#.', '....G'];
const LONG = ['G.....', '#####.', '......', '.#####', '......'];
const SPIRAL = ['..........', '.########.', '.#......#.', '.#.####.#.', '.#.#G..#.#', '.#.#####.#', '.#.......#', '.#########', '..........', '##########'];

// Shared with bug-hunt-classic-8.js.
export const mazeKit = { maze, mat, unchanged, wallsRef, roomRef, walksRef, pathsRef, longestRef, distRef, keyRef, breaksRef, M1, M2, M3, SEALED, OPEN4, BIG, LOOPS, LONG, SPIRAL };

export default [
// ------------------------------------------------------------------ easy
{
  id: 'CR-E114', mode: 'code-race', difficulty: 'easy', topic: 'arrays',
  title: 'Count the walls',
  languages: ALL,
  functionName: 'count_walls',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. Write `count_walls(maze)` that returns how many walls the maze has.\n\nMazes are not always square.',
  starter: stubs('count_walls(maze)'),
  solution: both(`def count_walls(maze):\n    count = 0\n    for r in range(len(maze)):\n        for c in range(len(maze[0])):\n            if maze[r][c] == "#":\n                count = count + 1\n    return count`),
  tests: [
    T('count_walls', [maze(M1)], wallsRef(M1)),
    T('count_walls', [maze(['..G'])], 0, { note: 'no walls' }),
    H('count_walls', [maze(['#'])], 1),
    H('count_walls', [maze(M2)], wallsRef(M2)),
    H('count_walls', [maze(BIG)], wallsRef(BIG)),
    H('count_walls', [maze(['#.', '##', '.G'])], 3),
  ],
},
{
  id: 'CR-E115', mode: 'code-race', difficulty: 'easy', topic: 'searching',
  title: 'Where is the goal?',
  languages: ALL,
  functionName: 'find_goal',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. Write `find_goal(maze)` that returns the position of the goal as an array `[row, column]`. There is exactly one goal.',
  starter: stubs('find_goal(maze)'),
  solution: both(`def find_goal(maze):\n    for r in range(len(maze)):\n        for c in range(len(maze[0])):\n            if maze[r][c] == "G":\n                return [r, c]\n    return None`),
  tests: [
    T('find_goal', [maze(M1)], A([2, 3])),
    T('find_goal', [maze(['G'])], A([0, 0]), { note: 'one cell' }),
    H('find_goal', [maze(M2)], A([2, 4])),
    H('find_goal', [maze(M3)], A([3, 2])),
    H('find_goal', [maze(BIG)], A([4, 7])),
    H('find_goal', [maze(['...', '...', '.G.', '...'])], A([2, 1])),
  ],
},
{
  id: 'CR-E116', mode: 'code-race', difficulty: 'easy', topic: 'conditionals',
  title: 'Can the robot stand there?',
  languages: ALL,
  functionName: 'can_stand',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. Write `can_stand(maze, r, c)` that returns `True` if row `r`, column `c` is inside the maze and is not a wall, and `False` otherwise. `r` and `c` may be negative or too big.',
  starter: stubs('can_stand(maze, r, c)'),
  solution: both(`def can_stand(maze, r, c):\n    if r < 0 or r >= len(maze) or c < 0 or c >= len(maze[0]):\n        return False\n    return maze[r][c] != "#"`),
  tests: [
    T('can_stand', [maze(M1), 0, 0], true),
    T('can_stand', [maze(M1), 0, 1], false, { note: 'a wall' }),
    T('can_stand', [maze(M1), -1, 0], false, { note: 'off the north edge' }),
    H('can_stand', [maze(M1), 2, 3], true),
    H('can_stand', [maze(M1), 5, 0], false),
    H('can_stand', [maze(M1), 0, 4], false),
    H('can_stand', [maze(M1), 4, -1], false),
    H('can_stand', [maze(M1), 4, 3], false),
  ],
},
{
  id: 'CR-E117', mode: 'code-race', difficulty: 'easy', topic: 'arrays',
  title: 'Open doors',
  languages: ALL,
  functionName: 'open_neighbours',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. The robot moves north, south, east or west, never diagonally. Write `open_neighbours(maze, r, c)` that returns how many of the four cells next to row `r`, column `c` the robot could move to: inside the maze and not a wall.',
  starter: stubs('open_neighbours(maze, r, c)'),
  solution: both(`def open_neighbours(maze, r, c):\n    rows = len(maze)\n    cols = len(maze[0])\n    dr = [-1, 1, 0, 0]\n    dc = [0, 0, 1, -1]\n    count = 0\n    for i in range(4):\n        nr = r + dr[i]\n        nc = c + dc[i]\n        if nr >= 0 and nr < rows and nc >= 0 and nc < cols and maze[nr][nc] != "#":\n            count = count + 1\n    return count`),
  tests: [
    T('open_neighbours', [maze(M1), 2, 1], 2),
    T('open_neighbours', [maze(M1), 0, 0], 1, { note: 'a corner' }),
    H('open_neighbours', [maze(['G']), 0, 0], 0),
    H('open_neighbours', [maze(OPEN4), 1, 1], 4),
    H('open_neighbours', [maze(M1), 3, 2], 3),
    H('open_neighbours', [maze(M2), 1, 2], 2),
    H('open_neighbours', [maze(M3), 3, 3], 3),
  ],
},
{
  id: 'CR-E118', mode: 'code-race', difficulty: 'easy', topic: 'loops',
  title: 'Walled in',
  languages: ALL,
  functionName: 'walled_in',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. Write `walled_in(maze)` that returns `True` if every cell on the outside edge of the maze (first and last row, first and last column) is a wall, and `False` otherwise.',
  starter: stubs('walled_in(maze)'),
  solution: both(`def walled_in(maze):\n    rows = len(maze)\n    cols = len(maze[0])\n    for r in range(rows):\n        for c in range(cols):\n            on_edge = r == 0 or r == rows - 1 or c == 0 or c == cols - 1\n            if on_edge and maze[r][c] != "#":\n                return False\n    return True`),
  tests: [
    T('walled_in', [maze(['####', '#.G#', '####'])], true),
    T('walled_in', [maze(['####', '#.G.', '####'])], false, { note: 'a gap in the east wall' }),
    H('walled_in', [maze(['#'])], true),
    H('walled_in', [maze(['G'])], false),
    H('walled_in', [maze(['#####', '#...#', '.#G.#', '#####'])], false),
    H('walled_in', [maze(['###', '#G#', '#.#', '##.'])], false),
    H('walled_in', [maze(['###', '#G#', '#.#', '###'])], true),
  ],
},
{
  id: 'CR-E119', mode: 'code-race', difficulty: 'easy', topic: 'state',
  title: 'Follow the moves',
  languages: ALL,
  functionName: 'follow_moves',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. Row 0 is the north edge and column 0 the west edge.\n\nThe robot starts at row `r`, column `c` and is given `moves`, an array of `"N"`, `"S"`, `"E"` and `"W"`. It does each move in turn, but a move that would take it into a wall or off the maze is skipped. Write `follow_moves(maze, r, c, moves)` that returns where it ends up, as `[row, column]`.',
  starter: stubs('follow_moves(maze, r, c, moves)'),
  solution: both(`def follow_moves(maze, r, c, moves):\n    for i in range(len(moves)):\n        m = moves[i]\n        nr = r\n        nc = c\n        if m == "N":\n            nr = r - 1\n        elif m == "S":\n            nr = r + 1\n        elif m == "E":\n            nc = c + 1\n        else:\n            nc = c - 1\n        if nr >= 0 and nr < len(maze) and nc >= 0 and nc < len(maze[0]) and maze[nr][nc] != "#":\n            r = nr\n            c = nc\n    return [r, c]`),
  tests: [
    T('follow_moves', [maze(M1), 0, 0, A(['S', 'S', 'E', 'E'])], A([2, 2])),
    T('follow_moves', [maze(M1), 0, 0, A(['E', 'N', 'W'])], A([0, 0]), { note: 'every move is blocked' }),
    H('follow_moves', [maze(M1), 4, 0, A([])], A([4, 0])),
    H('follow_moves', [maze(M1), 2, 0, A(['E', 'E', 'E', 'E', 'N'])], A([1, 3])),
    H('follow_moves', [maze(M1), 4, 2, A(['E', 'N', 'E', 'S'])], A([3, 3])),
    H('follow_moves', [maze(OPEN4), 3, 3, A(['W', 'W', 'W', 'W', 'N', 'N', 'N', 'N', 'E'])], A([0, 1])),
  ],
},
{
  id: 'CR-E120', mode: 'code-race', difficulty: 'easy', topic: 'arrays',
  title: 'Dead ends',
  languages: ALL,
  functionName: 'count_dead_ends',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. The robot moves north, south, east or west.\n\nA **dead end** is a cell that is not a wall and has exactly one neighbour the robot could move to (inside the maze and not a wall). Write `count_dead_ends(maze)` that returns how many dead ends the maze has. The goal can be a dead end too.',
  starter: stubs('count_dead_ends(maze)'),
  solution: both(`def count_dead_ends(maze):\n    rows = len(maze)\n    cols = len(maze[0])\n    count = 0\n    for r in range(rows):\n        for c in range(cols):\n            if maze[r][c] != "#":\n                open_count = 0\n                if r > 0 and maze[r - 1][c] != "#":\n                    open_count = open_count + 1\n                if r < rows - 1 and maze[r + 1][c] != "#":\n                    open_count = open_count + 1\n                if c > 0 and maze[r][c - 1] != "#":\n                    open_count = open_count + 1\n                if c < cols - 1 and maze[r][c + 1] != "#":\n                    open_count = open_count + 1\n                if open_count == 1:\n                    count = count + 1\n    return count`),
  tests: [
    T('count_dead_ends', [maze(M1)], deadEndsRef(M1)),
    T('count_dead_ends', [maze(['.#G'])], 0, { note: 'cells with no way out are not dead ends' }),
    H('count_dead_ends', [maze(['.G'])], 2),
    H('count_dead_ends', [maze(OPEN4)], 0),
    H('count_dead_ends', [maze(M2)], deadEndsRef(M2)),
    H('count_dead_ends', [maze(BIG)], deadEndsRef(BIG)),
    H('count_dead_ends', [maze(['.#.', '#.#', '.#G'])], 0),
  ],
},
// ------------------------------------------------------------------ medium
{
  id: 'CR-M66', mode: 'code-race', difficulty: 'medium', topic: 'arrays',
  title: 'Check the route',
  languages: ALL,
  functionName: 'is_valid_route',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. The robot moves one cell north, south, east or west at a time.\n\n`route` is an array of positions `[row, column]`. Write `is_valid_route(maze, route)` that returns `True` if the robot could follow it: the route is not empty, every position is inside the maze and not a wall, each position is exactly one move from the one before, and the last position is the goal. Otherwise return `False`.',
  starter: stubs('is_valid_route(maze, route)'),
  solution: both(`def is_valid_route(maze, route):\n    if len(route) == 0:\n        return False\n    for i in range(len(route)):\n        r = route[i][0]\n        c = route[i][1]\n        if r < 0 or r >= len(maze) or c < 0 or c >= len(maze[0]) or maze[r][c] == "#":\n            return False\n        if i > 0:\n            step = abs(r - route[i - 1][0]) + abs(c - route[i - 1][1])\n            if step != 1:\n                return False\n    last = route[len(route) - 1]\n    return maze[last[0]][last[1]] == "G"`),
  tests: [
    T('is_valid_route', [maze(M1), mat([[1, 0], [2, 0], [2, 1], [2, 2], [2, 3]])], true),
    T('is_valid_route', [maze(M1), mat([[1, 0], [2, 1], [2, 2], [2, 3]])], false, { note: 'a diagonal step' }),
    H('is_valid_route', [maze(M1), A([])], false),
    H('is_valid_route', [maze(M1), mat([[2, 3]])], true),
    H('is_valid_route', [maze(M1), mat([[2, 1], [2, 2], [2, 2], [2, 3]])], false),
    H('is_valid_route', [maze(M1), mat([[0, 0], [0, 1], [0, 2]])], false),
    H('is_valid_route', [maze(M1), mat([[3, 3], [2, 3], [2, 2]])], false),
    H('is_valid_route', [maze(M1), mat([[2, 4], [2, 3]])], false),
    H('is_valid_route', [maze(M1), mat([[4, 2], [3, 2], [3, 3], [2, 3]])], true),
  ],
},
{
  id: 'CR-M67', mode: 'code-race', difficulty: 'medium', topic: 'recursion',
  title: 'Is there a way?',
  languages: ALL,
  functionName: 'can_reach',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. The robot moves north, south, east or west, onto any cell that is not a wall.\n\nWrite `can_reach(maze, r, c)` that returns `True` if the robot can get from row `r`, column `c` (never a wall) to the goal, and `False` otherwise.\n\nMazes are at most 8 by 8. Keep your own grid of visited cells so you never search a cell twice. `maze` must be left unchanged.',
  starter: stubs('can_reach(maze, r, c)'),
  solution: both(`def can_reach(maze, r, c):\n    rows = len(maze)\n    cols = len(maze[0])\n    seen = [None] * rows\n    for i in range(rows):\n        seen[i] = [False] * cols\n    def search(r, c):\n        if r < 0 or r >= rows or c < 0 or c >= cols:\n            return False\n        if maze[r][c] == "#" or seen[r][c]:\n            return False\n        if maze[r][c] == "G":\n            return True\n        seen[r][c] = True\n        return search(r - 1, c) or search(r + 1, c) or search(r, c + 1) or search(r, c - 1)\n    return search(r, c)`),
  tests: [
    T('can_reach', [maze(M1), 0, 0], true),
    T('can_reach', [maze(M1), 0, 2], false, { note: 'boxed in' }),
    H('can_reach', [maze(M1), 2, 3], true),
    H('can_reach', [maze(SEALED), 0, 0], reachRef(SEALED, 0, 0)),
    H('can_reach', [maze(SEALED), 3, 0], reachRef(SEALED, 3, 0)),
    H('can_reach', [maze(M3), 0, 0], reachRef(M3, 0, 0)),
    H('can_reach', [maze(['........', '........', '........', '........', '......##', '......#G']), 0, 0], false),
    H('can_reach', [maze(BIG), 6, 0], true),
    unchanged('can_reach', M2, [0, 0], { hidden: true, note: 'the maze is unchanged' }),
  ],
},
{
  id: 'CR-M68', mode: 'code-race', difficulty: 'medium', topic: 'recursion',
  title: 'How big is the room?',
  languages: ALL,
  functionName: 'room_size',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. The robot moves north, south, east or west, onto any cell that is not a wall (the goal included).\n\nWrite `room_size(maze, r, c)` that returns how many cells the robot can reach from row `r`, column `c` (never a wall), counting the cell it starts on.\n\nMazes are at most 8 by 8. Mark the cells you visit in a grid of your own and leave `maze` unchanged.',
  starter: stubs('room_size(maze, r, c)'),
  solution: both(`def room_size(maze, r, c):\n    rows = len(maze)\n    cols = len(maze[0])\n    seen = [None] * rows\n    for i in range(rows):\n        seen[i] = [False] * cols\n    def fill(r, c):\n        if r < 0 or r >= rows or c < 0 or c >= cols:\n            return 0\n        if maze[r][c] == "#" or seen[r][c]:\n            return 0\n        seen[r][c] = True\n        return 1 + fill(r - 1, c) + fill(r + 1, c) + fill(r, c + 1) + fill(r, c - 1)\n    return fill(r, c)`),
  tests: [
    T('room_size', [maze(M1), 0, 2], 1),
    T('room_size', [maze(M1), 0, 0], roomRef(M1, 0, 0), { note: 'the goal is part of the room' }),
    H('room_size', [maze(['G']), 0, 0], 1),
    H('room_size', [maze(SEALED), 0, 0], 4),
    H('room_size', [maze(SEALED), 1, 4], roomRef(SEALED, 1, 4)),
    H('room_size', [maze(M3), 2, 2], roomRef(M3, 2, 2)),
    H('room_size', [maze(BIG), 0, 0], roomRef(BIG, 0, 0)),
    H('room_size', [maze(['........', '........', '........', '........', '........', '........', '........', '.......G']), 4, 4], 64),
    unchanged('room_size', M2, [0, 0], { hidden: true, note: 'the maze is unchanged' }),
  ],
},
{
  id: 'CR-M69', mode: 'code-race', difficulty: 'medium', topic: 'dynamic programming',
  title: 'Walks of exactly k moves',
  languages: ALL,
  functionName: 'count_walks',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. Each move takes the robot north, south, east or west onto a cell that is not a wall.\n\nWrite `count_walks(maze, r, c, k)` that returns how many different sequences of exactly `k` moves take the robot from row `r`, column `c` to the goal. Cells may be visited more than once, and the robot may pass over the goal before the end.\n\n`k` is at most 14, so trying every sequence is too slow. Keep a grid of how many walks end at each cell after each number of moves.',
  starter: stubs('count_walks(maze, r, c, k)'),
  solution: both(`def count_walks(maze, r, c, k):\n    rows = len(maze)\n    cols = len(maze[0])\n    ways = [None] * rows\n    for i in range(rows):\n        ways[i] = [0] * cols\n    ways[r][c] = 1\n    for step in range(k):\n        nxt = [None] * rows\n        for i in range(rows):\n            nxt[i] = [0] * cols\n        for i in range(rows):\n            for j in range(cols):\n                if ways[i][j] > 0:\n                    if i > 0 and maze[i - 1][j] != "#":\n                        nxt[i - 1][j] = nxt[i - 1][j] + ways[i][j]\n                    if i < rows - 1 and maze[i + 1][j] != "#":\n                        nxt[i + 1][j] = nxt[i + 1][j] + ways[i][j]\n                    if j > 0 and maze[i][j - 1] != "#":\n                        nxt[i][j - 1] = nxt[i][j - 1] + ways[i][j]\n                    if j < cols - 1 and maze[i][j + 1] != "#":\n                        nxt[i][j + 1] = nxt[i][j + 1] + ways[i][j]\n        ways = nxt\n    total = 0\n    for i in range(rows):\n        for j in range(cols):\n            if maze[i][j] == "G":\n                total = total + ways[i][j]\n    return total`),
  tests: [
    T('count_walks', [maze(['.G']), 0, 0, 3], 1),
    T('count_walks', [maze(['...', '.G.']), 0, 0, 2], 2),
    T('count_walks', [maze(['.G']), 0, 0, 2], 0, { note: 'back where it started' }),
    H('count_walks', [maze(['G']), 0, 0, 0], 1),
    H('count_walks', [maze(M1), 2, 0, 3], walksRef(M1, 2, 0, 3)),
    H('count_walks', [maze(M1), 0, 0, 9], walksRef(M1, 0, 0, 9)),
    H('count_walks', [maze(LOOPS), 0, 0, 12], walksRef(LOOPS, 0, 0, 12)),
    H('count_walks', [maze(OPEN4), 0, 0, 14], walksRef(OPEN4, 0, 0, 14)),
    H('count_walks', [maze(M1), 0, 2, 4], 0),
  ],
},
// ------------------------------------------------------------------ hard
{
  id: 'CR-H52', mode: 'code-race', difficulty: 'hard', topic: 'backtracking',
  title: 'Every way to the goal',
  languages: ALL,
  functionName: 'count_paths',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. The robot moves north, south, east or west, onto any cell that is not a wall.\n\nWrite `count_paths(maze, r, c)` that returns how many different paths go from row `r`, column `c` to the goal **without visiting any cell twice**. A path ends as soon as it reaches the goal; starting on the goal counts as one path.\n\nYou may change `maze` while you search (for example, turn the cells on the current path into walls), but you must put it back exactly as it was before you return.',
  starter: stubs('count_paths(maze, r, c)'),
  solution: both(`def count_paths(maze, r, c):\n    if r < 0 or r >= len(maze) or c < 0 or c >= len(maze[0]):\n        return 0\n    cell = maze[r][c]\n    if cell == "G":\n        return 1\n    if cell == "#":\n        return 0\n    maze[r][c] = "#"\n    total = count_paths(maze, r - 1, c) + count_paths(maze, r + 1, c) + count_paths(maze, r, c + 1) + count_paths(maze, r, c - 1)\n    maze[r][c] = cell\n    return total`),
  tests: [
    T('count_paths', [maze(['..', '.G']), 0, 0], 2),
    T('count_paths', [maze(M1), 0, 2], 0, { note: 'no way out' }),
    H('count_paths', [maze(M1), 2, 3], 1),
    H('count_paths', [maze(M1), 0, 0], pathsRef(M1, 0, 0)),
    H('count_paths', [maze(OPEN4), 0, 0], pathsRef(OPEN4, 0, 0)),
    H('count_paths', [maze(LOOPS), 0, 0], pathsRef(LOOPS, 0, 0)),
    H('count_paths', [maze(M2), 3, 4], pathsRef(M2, 3, 4)),
    unchanged('count_paths', LOOPS, [2, 2], { hidden: true, note: 'the maze is put back' }),
  ],
},
{
  id: 'CR-H53', mode: 'code-race', difficulty: 'hard', topic: 'backtracking',
  title: 'The long way round',
  languages: ALL,
  functionName: 'longest_path',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. The robot moves north, south, east or west, onto any cell that is not a wall.\n\nWrite `longest_path(maze, r, c)` that returns the number of moves in the **longest** path from row `r`, column `c` to the goal that never visits a cell twice, or -1 if the goal cannot be reached. A path ends as soon as it reaches the goal.\n\nYou may change `maze` while you search, but you must put it back exactly as it was before you return.',
  starter: stubs('longest_path(maze, r, c)'),
  solution: both(`def longest_path(maze, r, c):\n    if r < 0 or r >= len(maze) or c < 0 or c >= len(maze[0]):\n        return -1\n    cell = maze[r][c]\n    if cell == "G":\n        return 0\n    if cell == "#":\n        return -1\n    maze[r][c] = "#"\n    best = -1\n    dr = [-1, 1, 0, 0]\n    dc = [0, 0, 1, -1]\n    for i in range(4):\n        rest = longest_path(maze, r + dr[i], c + dc[i])\n        if rest >= 0:\n            best = max(best, rest + 1)\n    maze[r][c] = cell\n    return best`),
  tests: [
    T('longest_path', [maze(['..', '.G']), 0, 0], 2),
    T('longest_path', [maze(['...', '...', '..G']), 0, 0], 8, { note: 'through every cell' }),
    T('longest_path', [maze(M1), 0, 2], -1, { note: 'no way out' }),
    H('longest_path', [maze(['G']), 0, 0], 0),
    H('longest_path', [maze(M1), 0, 0], longestRef(M1, 0, 0)),
    H('longest_path', [maze(SEALED), 0, 0], -1),
    H('longest_path', [maze(LOOPS), 0, 0], longestRef(LOOPS, 0, 0)),
    H('longest_path', [maze(M2), 0, 0], longestRef(M2, 0, 0)),
    H('longest_path', [maze(LONG), 4, 0], longestRef(LONG, 4, 0)),
    unchanged('longest_path', M1, [0, 0], { hidden: true, note: 'the maze is put back' }),
  ],
},
{
  id: 'CR-H54', mode: 'code-race', difficulty: 'hard', topic: 'searching',
  title: 'Distance map',
  languages: ALL,
  functionName: 'distance_map',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. The robot moves north, south, east or west, onto any cell that is not a wall.\n\nWrite `distance_map(maze, r, c)` that returns a new 2-D array the same size as `maze`, holding for each cell the fewest moves from row `r`, column `c` to that cell, or -1 for walls and cells that cannot be reached.\n\nMazes are up to 10 by 10. Search outwards in rings: keep a queue (an array with a front and a back position) of cells whose distance is known.',
  starter: stubs('distance_map(maze, r, c)'),
  solution: both(`def distance_map(maze, r, c):\n    rows = len(maze)\n    cols = len(maze[0])\n    dist = [None] * rows\n    for i in range(rows):\n        dist[i] = [-1] * cols\n    queue = [0] * (rows * cols)\n    front = 0\n    back = 1\n    queue[0] = r * cols + c\n    dist[r][c] = 0\n    dr = [-1, 1, 0, 0]\n    dc = [0, 0, 1, -1]\n    while front < back:\n        cr = queue[front] // cols\n        cc = queue[front] % cols\n        front = front + 1\n        for i in range(4):\n            nr = cr + dr[i]\n            nc = cc + dc[i]\n            if nr >= 0 and nr < rows and nc >= 0 and nc < cols and maze[nr][nc] != "#" and dist[nr][nc] == -1:\n                dist[nr][nc] = dist[cr][cc] + 1\n                queue[back] = nr * cols + nc\n                back = back + 1\n    return dist`),
  tests: [
    T('distance_map', [maze(['..', '#G']), 0, 0], mat([[0, 1], [-1, 2]])),
    T('distance_map', [maze(['.#G']), 0, 0], mat([[0, -1, -1]]), { note: 'cut off' }),
    H('distance_map', [maze(['G']), 0, 0], mat([[0]])),
    H('distance_map', [maze(M1), 0, 0], distRef(M1, 0, 0)),
    H('distance_map', [maze(M3), 3, 2], distRef(M3, 3, 2)),
    H('distance_map', [maze(BIG), 6, 0], distRef(BIG, 6, 0)),
    H('distance_map', [maze(SPIRAL), 8, 9], distRef(SPIRAL, 8, 9)),
  ],
},
{
  id: 'CR-H55', mode: 'code-race', difficulty: 'hard', topic: 'searching',
  title: 'Fetch the key first',
  languages: ALL,
  functionName: 'key_then_goal',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell, `"K"` is a key and `"G"` is the goal (exactly one of each). The robot moves north, south, east or west, onto any cell that is not a wall.\n\nThe goal only opens once the robot has stood on the key, but the robot may walk over the goal before that. Write `key_then_goal(maze, r, c)` that returns the fewest moves to go from row `r`, column `c` to the key and then to the goal, or -1 if that cannot be done.\n\nMazes are up to 10 by 10. A search that finds the fewest moves from one cell to every other (a queue of cells, outwards in rings) is useful twice.',
  starter: stubs('key_then_goal(maze, r, c)'),
  solution: both(`def key_then_goal(maze, r, c):\n    rows = len(maze)\n    cols = len(maze[0])\n    def distances(sr, sc):\n        dist = [None] * rows\n        for i in range(rows):\n            dist[i] = [-1] * cols\n        queue = [0] * (rows * cols)\n        front = 0\n        back = 1\n        queue[0] = sr * cols + sc\n        dist[sr][sc] = 0\n        dr = [-1, 1, 0, 0]\n        dc = [0, 0, 1, -1]\n        while front < back:\n            cr = queue[front] // cols\n            cc = queue[front] % cols\n            front = front + 1\n            for i in range(4):\n                nr = cr + dr[i]\n                nc = cc + dc[i]\n                if nr >= 0 and nr < rows and nc >= 0 and nc < cols and maze[nr][nc] != "#" and dist[nr][nc] == -1:\n                    dist[nr][nc] = dist[cr][cc] + 1\n                    queue[back] = nr * cols + nc\n                    back = back + 1\n        return dist\n    kr = 0\n    kc = 0\n    gr = 0\n    gc = 0\n    for i in range(rows):\n        for j in range(cols):\n            if maze[i][j] == "K":\n                kr = i\n                kc = j\n            if maze[i][j] == "G":\n                gr = i\n                gc = j\n    to_key = distances(r, c)[kr][kc]\n    if to_key == -1:\n        return -1\n    to_goal = distances(kr, kc)[gr][gc]\n    if to_goal == -1:\n        return -1\n    return to_key + to_goal`),
  tests: [
    T('key_then_goal', [maze(['K.G']), 0, 1], 3),
    T('key_then_goal', [maze(['K.#G']), 0, 1], -1, { note: 'the goal is cut off' }),
    T('key_then_goal', [maze(['K..#.', '.#.#.', '...#G', '.....']), 0, 2], keyRef(['K..#.', '.#.#.', '...#G', '.....'], 0, 2)),
    H('key_then_goal', [maze(['.G.K']), 0, 0], 5),
    H('key_then_goal', [maze(['K#.', '##.', '..G']), 2, 0], -1),
    H('key_then_goal', [maze(['.....#..', '.###.#K#', '...#...#', '##.###.#', '.......G', '.#####.#', '........']), 6, 0], keyRef(['.....#..', '.###.#K#', '...#...#', '##.###.#', '.......G', '.#####.#', '........'], 6, 0)),
    H('key_then_goal', [maze(['K.....', '#####.', 'G.....', '.#####', '......']), 4, 0], keyRef(['K.....', '#####.', 'G.....', '.#####', '......'], 4, 0)),
    H('key_then_goal', [maze(['G...', '....', '...K']), 0, 0], 10),
  ],
},
{
  id: 'CR-H56', mode: 'code-race', difficulty: 'hard', topic: 'searching',
  title: 'Smash through the walls',
  languages: ALL,
  functionName: 'fewest_breaks',
  description: 'A maze is a 2-D array of one-letter strings: `"#"` is a wall, `"."` is an empty cell and `"G"` is the goal. This robot can smash through walls: moving north, south, east or west onto a wall costs one break, and onto any other cell costs nothing.\n\nWrite `fewest_breaks(maze, r, c)` that returns the fewest breaks needed to get from row `r`, column `c` (never a wall) to the goal.\n\nMazes are up to 8 by 8. One approach: keep the best cost known for each cell and keep sweeping over the grid, improving cells from their neighbours, until a whole sweep changes nothing.',
  starter: stubs('fewest_breaks(maze, r, c)'),
  solution: both(`def fewest_breaks(maze, r, c):\n    rows = len(maze)\n    cols = len(maze[0])\n    big = rows * cols + 1\n    cost = [None] * rows\n    for i in range(rows):\n        cost[i] = [big] * cols\n    cost[r][c] = 0\n    dr = [-1, 1, 0, 0]\n    dc = [0, 0, 1, -1]\n    changed = True\n    while changed:\n        changed = False\n        for i in range(rows):\n            for j in range(cols):\n                step = 0\n                if maze[i][j] == "#":\n                    step = 1\n                for d in range(4):\n                    ni = i + dr[d]\n                    nj = j + dc[d]\n                    if ni >= 0 and ni < rows and nj >= 0 and nj < cols and cost[ni][nj] + step < cost[i][j]:\n                        cost[i][j] = cost[ni][nj] + step\n                        changed = True\n    for i in range(rows):\n        for j in range(cols):\n            if maze[i][j] == "G":\n                return cost[i][j]\n    return -1`),
  tests: [
    T('fewest_breaks', [maze(['.#G']), 0, 0], 1),
    T('fewest_breaks', [maze(M1), 0, 0], 0, { note: 'no need to break anything' }),
    T('fewest_breaks', [maze(['G#.', '##.', '...']), 2, 2], breaksRef(['G#.', '##.', '...'], 2, 2), { note: 'heading north-west' }),
    H('fewest_breaks', [maze(['G']), 0, 0], 0),
    H('fewest_breaks', [maze(['.##G']), 0, 0], 2),
    H('fewest_breaks', [maze(SEALED), 0, 0], breaksRef(SEALED, 0, 0)),
    H('fewest_breaks', [maze(['G#....', '.#.##.', '.#.#..', '...#.#', '####..', '.....#']), 5, 0], breaksRef(['G#....', '.#.##.', '.#.#..', '...#.#', '####..', '.....#'], 5, 0)),
    H('fewest_breaks', [maze(['G.#.....', '###.###.', '....#...', '.####.#.', '.#....#.', '.#.####.', '.#......', '.######.']), 7, 7], breaksRef(['G.#.....', '###.###.', '....#...', '.####.#.', '.#....#.', '.#.####.', '.#......', '.######.'], 7, 7)),
  ],
},
];
