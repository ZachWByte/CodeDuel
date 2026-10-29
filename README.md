# Code Duel

A browser coding game for **Source Academy Python**. Pick **Python §3**, **Python §4**
or **Python (full)**, a mode (**Code Race** or **Bug Hunt**) and a difficulty, then
race the clock through questions from a bank of 275, or duel a friend (or a bot) online. All code runs in the browser, in
Web Workers:

- **Python §3 / §4** run on [py-slang](https://github.com/source-academy/py-slang)
  (`@sourceacademy/py-slang`), the same CSE-machine interpreter as Source Academy,
  so each chapter's rules apply exactly as in the
  [§3](https://docs.sourceacademy.org/python/python_3/) and
  [§4](https://docs.sourceacademy.org/python/python_4/) docs.
- **Python (full)** runs normal CPython via Pyodide.

## Run it

```bash
npm install        # also copies Pyodide into public/pyodide
npm run dev        # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server (with the COOP/COEP headers Pyodide needs) |
| `npm run build` / `npm start` | Production build in `dist/`, and the Node server (game + duel rooms) that Render runs |
| `npm run preview` | Vite's local server for the build |
| `npm run validate` | Checks all 275 questions: schema, reference solutions in every language (§3 and §4 through py-slang, full Python through `python3`), starters fail, buggy code fails a visible and a secret test, §4-only questions really need §4, banned names, highlighted bug lines, counts. Add id prefixes to check a subset: `npm run validate -- BH-M CR-H05` |
| `npm test` | Unit tests for the game engine, the judge helpers and the duel server (including a full match against a bot) |
| `npm run bot -- ABCD [easy\|medium\|hard]` | Joins room ABCD as a bot opponent. Options: `--url` (default `http://localhost:5173`, or your Render URL) and `--speed` (e.g. `--speed 20` to play 20× faster when testing) |

## Languages and the question bank

| Language | Questions | Notes |
|---|---|---|
| Python §4 | 275 | everything, including the 5 `parse` questions |
| Python §3 | 270 | all but the 5 `parse` questions, which need §4 |
| Python (full) | 265 | the 10 questions that need Source Academy features (`set_tail` cycles, streams, `parse`) are Python § only |

Each question stores one program per *family*: `sicpy` (Python §, written SICP-style with
`llist`, `pair`, `head`, `tail`, `None` as the empty list, `[...]` as arrays) and `python`
(normal Python lists and tuples). Tests are written once with the helpers in
`src/questions/helpers.js`, which produce `llist(1, 2)` for Python § and `[1, 2]` for full Python.

`code-race-classic*.js` and `bug-hunt-classic*.js` (five batches) add 175 classic
contest/interview problems: the ideas behind well-known LeetCode and Codeforces tasks,
written fresh. They include climbing stairs, house robber (in a line and in a circle), coin
change, Kadane, decode ways, dice sums, egg drop, integer partitions, Catalan numbers, rod
cutting, matrix-chain order, edit-style string DP, trapping rain water, largest rectangle,
sliding-window maximum, daily temperatures, Reverse Polish notation, binary search
variants, counting inversions with merge sort, fast LIS, islands, word search, spiral order,
array-stored heaps and trees, greedy scheduling, and many warm-ups. Most have a Bug Hunt
twin with a single, realistic bug. Their inputs are arrays, so one program works in Python §
and full Python.

Topics are grouped into six categories (`CATEGORIES` in `questions/index.js`), which duel
players pick from: recursion & loops, lists & arrays, sorting & searching, DP & memoisation,
trees/stacks/streams, backtracking & greedy.

## Scoring

A solved question is worth its base (100 / 200 / 300 for easy / medium / hard) plus up to
half of that again for speed, minus:

- 10% of the base for each wrong **Submit**;
- 5% for each **Run tests** after the first, which is free;
- **Bug Hunt:** 10% for each changed line beyond *par*, the number of lines the reference
  fix changes. The toolbar shows your test runs and `lines changed / par` as you type.

It never drops below 20% of the base. Unsolved questions score 0. The rules are the same in
single player and duels (`scoreBreakdown` in `state/engine.js`), and the end of each question
shows the breakdown.

## Layout

```
src/state/engine.js        pure game logic (sessions, timer, scoring), no DOM or storage
src/state/storage.js       localStorage (settings, drafts, personal bests, session in progress)
src/runners/sicpy-*.js     py-slang worker + core shared with the validator
src/runners/python.*       Pyodide worker + harness shared with the validator
src/runners/runner.js      the runner interface (one long-lived worker per engine)
src/judge/                 resolving tests per language, banned names, judging
src/questions/             the question bank
src/ui/                    home, game, results, duel lobby and duel results screens
src/duel.js, src/net/      duel flow and the Socket.IO client
server/                    duel rooms (duel.js), the bot (bot.js) and the production server (index.js)
scripts/                   Pyodide copy step, the question validator and the bot launcher
```

## Where the code differs from the spec

Each difference has a `// NOTE:` comment next to it.

- **Languages:** the spec's Source §3 / §4 (JavaScript) are replaced by Source Academy
  Python §3 / §4, as the project owner asked. Full Python stays as an extra.
- **Time limit for Python §:** py-slang stops a program after 3 million evaluation steps
  (about 3 s in Chrome). A step limit makes time-outs identical in the browser and the validator.
- **Python § sublanguage rules** come from py-slang itself: no `+=`, slices, list
  comprehensions, `in`, `.append` or tuples; `for` only over `range(...)`; Python lists
  cannot grow (use `[0] * n`). The questions are written to fit.
- **Smaller inputs where py-slang is slow:** `fib(n)` goes up to 20 (not 25); in Python §,
  `queens(n)` goes up to 6 (the n = 7 and 8 tests are full-Python only).
- **`has_cycle`:** Python § has no `is`, and `==` compares structure, so test lists have
  distinct elements (then `p == q` means "same pair").
- **Pyodide recursion limit:** 1500 instead of 5000; a limit of 3000+ overflows the
  WebAssembly stack and kills the interpreter. If it dies anyway, the runner restarts it.
- **BH-E04:** with the bug as specified, only `count_digits(0)` is wrong.
- **BH-M04:** checking the wrong list keeps the *last* copy of each element instead of the first.
- **Reloading the page** resumes the session in progress (key `cd.session`).

## View settings

**⚙ View** (home screen, duel lobby and game header) sets the editor side (left or
right), the zoom of the whole app (70–160%, also <kbd>Alt</kbd> + <kbd>=</kbd> /
<kbd>−</kbd> / <kbd>0</kbd>), the editor font size and line wrapping. Drag the bar
between the problem and the editor to resize them (double-click resets). Everything
is saved in `localStorage` (`cd.prefs`) and applied through CSS variables (`state/prefs.js`).

## Multiplayer (duels)

On the home screen, **Play a friend** creates a room (language, difficulty and questions
per round come from the settings above) and shows a 4-letter code and a link
(`/?room=CODE`). **🤖 Play a bot** creates a room with a practice bot in it.

- **Lobby:** names, who is ready, the match score and a chat. The host can change the
  room settings and add or remove a bot (easy, medium or hard).
- **Choosing the round:** the first round is a vote on the mode (Code Race, Bug Hunt or
  random) and the topic (one of six categories, or random). If the votes differ, a coin
  flip decides. After that, **the loser of each round chooses the next one**. After a
  draw, the players vote again.
- **Playing:** when everyone is ready there is a 3-second countdown, then everyone gets the
  same questions on the same clock. The header shows each opponent's question, their last
  test run (✓ 2/3), their score and your lead. Toasts warn you when they pass more tests,
  pass all the visible tests, submit, solve a question or finish.
- **Results:** the higher total wins the round and a point in the match. Anyone can start
  the next round.
- **Chat:** open in the lobby and on the results screen. During a round it folds into a
  button with an unread count and a short preview of new messages. It includes quick
  reactions and round announcements.

- `server/duel.js` runs the rooms over Socket.IO. It uses `state/engine.js` as the
  referee: it keeps every player's state and owns the clock. Code still runs in each
  browser, and the server trusts the test results the browser reports.
- `src/duel.js` follows the room snapshots and shows the lobby, the game or the duel results.
- `server/bot.js` is the practice opponent. It connects over Socket.IO like a real player
  (so it also tests the protocol) and plays from a plan. Its level sets how likely it is
  to solve each difficulty, how fast it is, and how many test runs and wrong submits it
  makes. It votes, gets ready, and chats ("nice one 👏", "gg"). It does not run code.
- Each browser tab is its own player (the seat token is in `sessionStorage`), and a
  reload rejoins the same seat.

### Try it on localhost

```bash
npm run dev        # rooms run inside the Vite dev server
```

Open http://localhost:5173 in two tabs, create a room in one and join from the other.
Or play alone against a bot: **🤖 Play a bot** on the home screen, or create a room and
run `npm run bot -- CODE hard` in a terminal.
To play someone on your Wi-Fi, run `npm run dev -- --host` and have them open your
`Network:` address. (Full Python needs `localhost` or HTTPS, so pick Python §3/§4 for that.)

To test the production build: `npm run build && npm start` (http://localhost:3000).

### Deploy to Render

`render.yaml` describes one Node web service (`npm ci && npm run build`, then
`npm start`, health check `/healthz`). Push the repo to GitHub, then in Render choose
**New → Blueprint** and pick the repo. Or create a **Web Service** by hand with the same
build and start commands.

- Rooms live in memory: a redeploy or restart ends any game in progress, and the
  service must run as a single instance. Before stopping, the server tells every room
  in the chat; players are sent back to the home screen when it is back.
- A player who is disconnected for more than 60 seconds leaves the room (and forfeits
  the round), so a closed tab never leaves the other player waiting.
- Protections for a public server: same-origin browsers only, messages of at most 16 KB,
  20 events per second per connection, 20 connections per IP address, 1000 rooms, and
  reported test counts must match the question (so a console one-liner cannot claim a
  solve). Results are still reported by the browser, so a determined player could cheat;
  it is meant for playing people you know.
- On the free plan the service sleeps after about 15 minutes idle, and the first visit
  after that takes a minute or so to wake it.
