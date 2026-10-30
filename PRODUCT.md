# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Intro CS students taking a Source Academy course (CS1101S-style), practising on their own: before exams, mastery checks, or just to get faster. They play solo against the clock, or in rooms of up to six against classmates (alone or in teams) and practice bots. They are early programmers: comfortable with recursion and lists in Python §3/§4, still building fluency, and often playing on a laptop.

## Product Purpose

Code Duel turns practice on the course's own language into a timed game. A session serves questions in one of two modes:

- **Code Race:** write a function from scratch that passes every test.
- **Bug Hunt:** each program has exactly one bug; find and fix it with as few changed lines as possible.

Success is a student choosing to drill here instead of re-reading notes, coming back for personal bests, and pulling a friend into a duel.

## Positioning

It runs the actual Source Academy Python sublanguages (§3 and §4 through py-slang, the same CSE-machine interpreter Source Academy uses), so a solution that passes here obeys the same chapter rules as coursework. Generic Python practice sites cannot claim that. Full Python (Pyodide) is offered as an extra.

## Operating Context

- **Solo session:** pick language, mode, difficulty and question count on the home screen, then race through questions; reloading resumes the session in progress. A question browser lets a player practise one question on its own.
- **Duel:** create a room (4-letter code and `/?room=CODE` link) or play a bot. Up to six players; each plays alone or joins the red, green or blue team (teammates share one score and one live editor per question). The host sets language, difficulty, question count, the round's length, whether secret tests passed earn points without a solve, and whether a failed secret test can be revealed (and its cost); everyone sees these settings. Round one is a vote on mode and topic (coin flip if votes differ); after that the last-placed side picks. After a 3-second countdown every side gets the same questions under one clock and can do them in any order. A live leaderboard ranks the sides; after a solve a player can move on or watch the others (their code stays scrambled until you solve the question they are on). The duel results screen shows final standings and awards a match point to the winning side's players.
- **In a round:** the player reads a problem, edits in CodeMirror, runs tests (`Ctrl/⌘ + Enter`) and submits (`Ctrl/⌘ + Shift + Enter`). Scoring is base (100/200/300) plus a speed bonus, minus penalties for wrong submits, extra test runs, revealed tests and (Bug Hunt) lines changed beyond par. Each question shows what it is still worth and what has been lost; the breakdown is shown after a solve.
- **View settings** (⚙ View): editor side, whole-app zoom (70–160%), editor font size, line wrapping, and a draggable split. All stored locally.

## Capabilities and Constraints

- All player code runs in the browser in Web Workers. Python §3/§4 use py-slang with a 3-million-step limit; full Python uses Pyodide, which needs COOP/COEP headers and therefore `localhost` or HTTPS.
- 542 questions across six topic categories (recursion & loops, lists & arrays, sorting & searching, DP & memoisation, trees/stacks/streams, backtracking & greedy) and three difficulties.
- Duel server: Node + Socket.IO on a single Render instance (free plan sleeps when idle; first visit after that takes about a minute). Rooms live in memory. A player disconnected for 60 s forfeits. Python § solves are spot-checked server-side.
- Bots play from a plan at easy, medium or hard level; they do not run code.
- Progress, settings, drafts and personal bests live in `localStorage`; no accounts.
- **Terminology:** "Python §3", "Python §4", "Python (full)"; "Code Race", "Bug Hunt"; "Run tests", "Submit"; "par"; "room", "round", "match", "side", "team", "Watch".

## Brand Commitments

- Name: **Code Duel**. Tagline in use: "Race the clock. Write it, or find the bug."
- **Source Academy fidelity is binding:** language rules, chapter names (§3 / §4) and links to the official Source Academy docs must match Source Academy exactly. Design or copy must never imply a feature the sublanguage lacks, or rename its concepts.
- Current voice: short, plain, direct sentences addressed to the player ("Find it and fix it."); light playful touches in duels (bot chat like "gg", "nice one 👏").

## Evidence on Hand

- The question bank itself (`src/questions/`), validated by `npm run validate`.
- No user counts, testimonials, course endorsement or official Source Academy affiliation exist. Future work must not claim or imply any of these.

## Product Principles

1. **The course's language, exactly.** What passes here passes under Source Academy's rules; never blur that.
2. **The clock is the game.** Every screen in a round serves reading, coding and testing fast; nothing competes with the editor and the problem.
3. **Rules are visible.** Scoring, penalties and par are shown as they accrue, so a student always knows why they got their score.
4. **A duel is social, not hostile.** Rivalry should feel like friendly practice between classmates: show progress, cheer milestones, make a rematch effortless.
5. **Built for learners.** Explain modes and errors in plain words; never assume knowledge beyond the chapter being played.
