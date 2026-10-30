# Code Duel

A browser coding game for **Source Academy Python**. Pick **Python §3**, **Python §4**
or **Python (full)**, a mode (**Code Race** or **Bug Hunt**) and a difficulty, then
race the clock through questions from a bank of 542, or duel a friend (or a bot) online. All code runs in the browser, in
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
| `npm run validate` | Checks all 542 questions: schema, reference solutions in every language (§3 and §4 through py-slang, full Python through `python3`), starters fail, buggy code fails a visible and a secret test, §4-only questions really need §4, banned names, highlighted bug lines, counts. Add id prefixes to check a subset: `npm run validate -- BH-M CR-H05` |
| `npm test` | Unit tests for the solo and round engines, the judge helpers, team editing (concurrent edits converge) and the duel server (including teams and a full match against a bot) |
| `npm run bot -- ABCD [easy\|medium\|hard]` | Joins room ABCD as a bot opponent. Options: `--url` (default `http://localhost:5173`, or your Render URL) and `--speed` (e.g. `--speed 20` to play 20× faster when testing) |

## Languages and the question bank

| Language | Questions | Notes |
|---|---|---|
| Python §4 | 542 | everything, including the 5 `parse` questions |
| Python §3 | 537 | all but the 5 `parse` questions, which need §4 |
| Python (full) | 532 | the 10 questions that need Source Academy features (`set_tail` cycles, streams, `parse`) are Python § only |

Each question stores one program per *family*: `sicpy` (Python §, written SICP-style with
`llist`, `pair`, `head`, `tail`, `None` as the empty list, `[...]` as arrays) and `python`
(normal Python lists and tuples). Tests are written once with the helpers in
`src/questions/helpers.js`, which produce `llist(1, 2)` for Python § and `[1, 2]` for full Python.

`code-race-classic*.js` and `bug-hunt-classic*.js` (seven batches) add 279 classic
contest/interview problems: the ideas behind well-known LeetCode and Codeforces tasks,
written fresh. They include climbing stairs, house robber (in a line and in a circle), coin
change, Kadane, decode ways, dice sums, egg drop, integer partitions, Catalan numbers, rod
cutting, matrix-chain order, edit-style string DP, trapping rain water, largest rectangle,
sliding-window maximum, daily temperatures, Reverse Polish notation, binary search
variants, counting inversions with merge sort, fast LIS, islands, word search, spiral order,
array-stored heaps and trees, greedy scheduling, Pascal's triangle, and over a hundred warm-ups
(fizz buzz, factorial, digit puzzles, letter arrays, matrix diagonals). Most have a Bug Hunt
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
src/ui/                    home, solo game, duel round (round-game.js), results, lobby and duel results screens
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

- **Lobby:** up to 6 players, who is ready, the match score and a chat. The host sets
  the language, difficulty, number of questions and three round options, and can add
  or remove bots (easy, medium or hard). Everyone sees the same settings; only the host
  can change them:
  - **Round time** (5–60 minutes): one clock for the whole round. Every question is
    open at once, and players move between them freely with the tabs along the bottom.
  - **Secret tests:** only a solve scores, or each secret test passed earns points
    (up to half the question) without a solve. The best submit counts.
  - **Reveal a failed test:** off, or allowed for 10%, 25% or 50% of the question's
    base points each. A revealed secret test shows its call and expected value (and what
    your code gave) and lowers the most the question can score.
- **Teams:** each player plays on their own or picks red, green or blue. Teammates are
  one side: one score, one state, and one live editor per question, with each other's
  cursors. A submit from any teammate counts for the team. A Room / Team switch by the
  chat box sends messages to the team only.
- **Choosing the round:** the first round is a vote on the mode (Code Race, Bug Hunt or
  random) and the topic (one of six categories, or random). If the votes differ, a coin
  flip decides. After that, **the last-placed side chooses the next one**. After a
  draw, everyone votes again.
- **Start now:** the host can start the round without waiting for everyone to be ready.
  The host's shown pick counts as their vote; a missing vote is skipped (a coin flip
  between the votes cast), and if last place has not chosen yet the round is random.
- **Power-ups** (off unless the host turns them on; everyone gets the same uses, every round),
  from the ⚡ Power-ups button in the round header. Blackout and Wipe hit **every opponent at
  once**, so they are short and few:
  - **Blackout** (1–3 uses): every opponent's editor goes dark for 15 seconds; then a
    3-minute cooldown. The server holds their runs and submits until it is over.
  - **Wipe** (1–2 uses): every opponent's code on the question they have open goes back to
    the starter (a team's shared document too), with no undo. Not on questions already
    solved, and not bots.
  - **Mouse keys** (1–3 uses, on one opponent you pick): for 30 seconds their keyboard
    cannot change their code; an on-screen keyboard appears over the output area and they
    type by clicking it (Shift, Caps, Tab, Enter, Backspace and arrows included). Moving
    the cursor with the arrow keys, Run / Submit shortcuts and the chat still work.
  - **Hints** (1, 2, 3 or 5): for a question of yours, pseudo-code (the solution's loops and
    conditions, with what it assigns and returns blanked out) or the next 3 lines of a
    solution. In Bug Hunt: which line the bug is on, or the fixed line. They show in the
    problem panel, and teammates share them.
- **Playing:** when everyone is ready (or the host starts) there is a 3-second countdown, then every side gets
  the same questions on the same clock. Under each question's title, "Worth up to N now"
  shows the most it can still score and what wrong submits, test runs, reveals and
  extra lines have cost. A side's round ends when the clock runs out, when it has solved
  everything, or when it presses Finish.
- **Leaderboard:** the side panel ranks every side live (rows slide when the order
  changes), with what each is working on; the header shows your place and the gap.
  Toasts announce other sides' solves.
- **Watching:** Watch (in the header, or after a solve) turns the work area into a view
  of the other players' code, following the question each one has open. It is
  scrambled (same lines and indentation, every character replaced) until your side has
  solved that question or your round is over; the server never sends the real code
  before then. On the results screen you can watch the others finish.
- **Results:** final standings, and every side's score per question. The top side wins
  the round, and each of its players gets a point in the match.
- **Chat:** open in the lobby and on the results screen. During a round it folds into a
  side panel (with the leaderboard) behind a button with an unread count. The mic
  button records a voice message (up to 15 seconds; Send sends it, × or Escape throws it
  away). The server checks it is WebM, Ogg or MP4 audio and keeps the last 10 clips per
  room; older ones show as no longer available.

- **Admin:** **Log in** (top right of the home screen) with the admin account to see
  everyone playing, live: solo players (their question, tests, time left, score) and
  every duel room, and the code of whoever you pick. The account comes from the
  `ADMIN_USERNAME` / `ADMIN_PASSWORD` environment variables (default `admin` /
  `123456`, so set your own on a public server). Wrong passwords are limited to 5 per
  5 minutes per address.
- **Solutions:** the admin's Solutions tab shows the code that solved each question, solo
  and duel, with who solved it and their points. They are saved in SQLite
  (`server/solutions.js`, Node's built-in `node:sqlite`) at `SOLUTIONS_DB` (default
  `data/solutions.db`). Each question keeps its newest 10, and when all of them pass
  `SOLUTIONS_MAX_MB` (default 50) or the disk is full, the oldest are deleted first.
  Solo solves are reported by the browser and not re-checked. On Render's free plan the
  disk is wiped on every deploy and restart, so point `SOLUTIONS_DB` at a persistent disk
  to keep them.

- `server/duel.js` runs the rooms over Socket.IO. It uses `state/round.js` as the
  referee: it keeps every side's state and owns the clock. Code still runs in each
  browser, and the server trusts the test results the browser reports (claimed solves
  in Python § are spot-checked).
- `server/collab.js` keeps each team's shared documents; `src/editor/collab.js` is the
  browser side (local edits are rebased on teammates', as in `@codemirror/collab`).
- `src/duel.js` follows the room snapshots and shows the lobby, the round
  (`ui/round-game.js`) or the duel results.
- `server/bot.js` is the practice opponent. It connects over Socket.IO like a real player
  (so it also tests the protocol) and plays the round's questions in order from a plan.
  Its level sets how likely it is to solve each difficulty, how fast it is, and how many
  test runs and wrong submits it makes. It votes, gets ready, and chats ("nice one 👏",
  "gg"). It does not run code.
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
- Protections for a public server: same-origin browsers only, messages of at most 64 KB,
  20 events per second per connection, 20 connections per IP address, 1000 rooms, and
  reported test counts must match the question.
- **Solves are spot-checked on the server** (`server/verify.js`). In Python §3/§4 a
  submit that claims every test passes must include the code; the server re-runs 2 of
  the tests (secret ones first) with py-slang in a worker thread and turns the solve
  into a wrong submit if any fail. py-slang cannot touch files, the network or the
  machine, and the worker has the same 3-million-step limit as the browser, a 128 MB
  memory cap and a 45-second budget, so infinite loops and memory bombs only fail the
  submit. The player's clock pauses during the check. Bug Hunt "lines changed" is
  counted from the code too. Full Python is not re-run (untrusted CPython on the server
  would not be safe), so there the browser's result is still trusted.
- On the free plan the service sleeps after about 15 minutes idle, and the first visit
  after that takes a minute or so to wake it.
# CodeDuel
