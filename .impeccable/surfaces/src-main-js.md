---
version: 1
slug: "src-main-js"
primary_target: "src/main.js"
related_targets: ["src/styles.css","src/ui/game.js","src/ui/home.js","src/ui/lobby.js","src/ui/results.js","src/ui/duel-results.js","src/ui/chat.js","src/ui/view-settings.js"]
---

# Surface: Code Duel app (all screens)

Scope: the whole web app: home/setup, question browser, game (solo and duel), session results, duel lobby, duel results, chat dock, view settings, modals, toasts, countdown. Mode: Operate, game-first (user: "Game first"; must not feel childish; nothing visual pinned).

Audience and job: intro CS students practising Source Academy Python against the clock, solo or 1v1. Task: read a problem, code, run tests, submit, see why they scored what they scored. Constraints: every existing function, id, shortcut and copy fact stays; Source Academy names and links exact.

Chosen direction: Tournament Hall (the roll's assigned direction, chosen by the user). Memorable moment: the clock case with its red flag, and every question notated on a scoresheet with an annotation mark.

## Direction contract

THESIS: Every round is a rated game: a clock with a flag, a scoresheet, and an annotation mark on every move. Refuses the grey IDE-with-blue-accent practice-site shell.

OWN-WORLD: Tournament vinyl and clock. Nine-step board-green ramp for every neutral (no off-ramp greys); buff light-square for primary actions, clock faces and selection; flag red for time pressure and failure; brass for ids and personal bests; mint for passing tests. Archivo variable: condensed heavy numerals (clock, score, room code, countdown), normal width for UI, expanded caps for small labels; JetBrains Mono only for code and test data. Black clock case with buff faces is the one container that matters; authored SVG icons in one stroke.

STORY: A student sees the board, sets up a game, plays against the clock, and reads their scoresheet: what they solved, how cleanly (!!, !, !?, ?), and why each point was won or lost.

FIRST VIEWPORT: Game screen. Header: brand mark and crumb left; centre the clock case (Clock face and Score face, condensed numerals, red flag lifts at 30 s, falls at 0); right: opponents (duel), View, Home. Problem panel left (id in brass, title, tags, rule rows with live numbers), editor right with Run, Run tests, buff Submit, meters; console below. Bottom: the scoresheet strip notating each question. Cited adaptations: Home sits far left (back-navigation convention, next to the brand); the clock case adds a Question face because session progress belongs with the clock. Duel (user request, 2026-10-29): the lobby is three columns, Room | Players | Chat, over a bar with Leave, who you are, status and Ready, using selects instead of button grids; in a round the Chat button opens a right side panel (about 30% wide) whose top shows each opponent's question, tests passing (as board squares), lines written or changed (reported every 5 s at most) and their scoresheet.

FORM: Tournament Hall, position 3 on the ordered list of seven. seed:988b8434696ad46b
Raised from Grid Specimen: clock, score and room-code numerals share one condensed numeral system. Raised from Exposure Record: neutrals snap to one ramp. Raised from Monochrome Product: every rule beside its live number. Raised from Title Card Wall: browser rows reveal detail on focus.
Signature interaction: the clock case (flag lift and fall; countdown presses the clock) plus scoresheet annotation marks with plain-words tooltips and a legend. Motion grammar: one clock-press move (short scale and settle, ease-out), reduced-motion safe.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
