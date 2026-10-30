---
name: Code Duel
description: Timed Source Academy Python practice, solo or 1v1, played like a rated game on a tournament board.
colors:
  g0: "#0d110b"
  g1: "#12170f"
  g2: "#182015"
  g3: "#1f291b"
  g4: "#283523"
  g5: "#36462f"
  g6: "#5b6d50"
  g7: "#9fae8f"
  g8: "#cdd6c1"
  ink: "#f0f2e8"
  case: "#050604"
  buff: "#ecdfbf"
  buff-hi: "#f7eed6"
  buff-ink: "#161b0f"
  buff-mute: "#5a6156"
  flag: "#e2553f"
  flag-text: "#ff8a74"
  flag-bg: "rgba(226, 85, 63, 0.13)"
  brass: "#dcab4c"
  brass-bg: "rgba(220, 171, 76, 0.13)"
  mint: "#8ddca6"
  mint-bg: "rgba(141, 220, 166, 0.1)"
  code-bg: "#0f140c"
  code-ink: "#e6eadc"
  code-gutter: "#7d8c6f"
  code-line: "rgba(236, 223, 191, 0.04)"
  code-select: "rgba(236, 223, 191, 0.17)"
  syn-keyword: "#e3b25c"
  syn-fn: "#ecdfbf"
  syn-string: "#8ddca6"
  syn-number: "#f0957c"
  syn-comment: "#93a183"
  syn-punct: "#b5bfa7"
typography:
  display:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 850
    lineHeight: 1.1
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 112"
  headline:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  column-title:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 850
    lineHeight: 1.1
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 112"
  title:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 750
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  label:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.09em"
    fontVariation: "'wdth' 118"
  numeral:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.005em"
    fontFeature: "'tnum' 1"
    fontVariation: "'wdth' 62"
  mark:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 900
    letterSpacing: "0.02em"
    fontVariation: "'wdth' 80"
  code:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, SF Mono, Menlo, Consolas, monospace"
    fontSize: "14px"
    lineHeight: 1.6
    fontFeature: "'liga' 0, 'calt' 0"
rounded:
  tiny: "4px"
  sm: "5px"
  face: "6px"
  md: "8px"
  case: "10px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "18px"
  xl: "24px"
  page: "28px"
components:
  button:
    backgroundColor: "{colors.g4}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "6px 13px"
  button-hover:
    backgroundColor: "{colors.g5}"
  button-primary:
    backgroundColor: "{colors.buff}"
    textColor: "{colors.buff-ink}"
    rounded: "{rounded.sm}"
    padding: "6px 13px"
  button-primary-hover:
    backgroundColor: "{colors.buff-hi}"
  button-danger:
    backgroundColor: "{colors.flag}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.g8}"
  button-ghost-hover:
    backgroundColor: "{colors.g3}"
    textColor: "{colors.ink}"
  button-large:
    padding: "11px 24px"
  button-small:
    padding: "3px 9px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.g8}"
    rounded: "{rounded.sm}"
    size: "30px"
  input:
    backgroundColor: "{colors.g1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "7px 10px"
  segmented:
    backgroundColor: "{colors.g1}"
    rounded: "{rounded.md}"
    padding: "3px"
  segmented-option:
    backgroundColor: "transparent"
    textColor: "{colors.g8}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  segmented-option-active:
    backgroundColor: "{colors.buff}"
    textColor: "{colors.buff-ink}"
  card:
    backgroundColor: "{colors.g2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "22px 24px"
  tag:
    backgroundColor: "{colors.g4}"
    textColor: "{colors.g8}"
    rounded: "{rounded.pill}"
    padding: "1px 9px"
  difficulty-easy:
    backgroundColor: "{colors.mint-bg}"
    textColor: "{colors.mint}"
    rounded: "{rounded.pill}"
  difficulty-medium:
    backgroundColor: "{colors.brass-bg}"
    textColor: "{colors.brass}"
    rounded: "{rounded.pill}"
  difficulty-hard:
    backgroundColor: "{colors.flag-bg}"
    textColor: "{colors.flag-text}"
    rounded: "{rounded.pill}"
  clock-case:
    backgroundColor: "{colors.case}"
    rounded: "{rounded.case}"
    padding: "4px"
  clock-face:
    backgroundColor: "{colors.g3}"
    textColor: "{colors.ink}"
    typography: "{typography.numeral}"
    rounded: "{rounded.face}"
    padding: "6px 14px 5px"
  clock-face-lit:
    backgroundColor: "{colors.buff}"
    textColor: "{colors.buff-ink}"
  clock-face-low:
    backgroundColor: "#f6d6c9"
    textColor: "#8f1f10"
  clock-face-fallen:
    backgroundColor: "{colors.flag}"
    textColor: "#ffffff"
  scoresheet:
    backgroundColor: "{colors.g0}"
    textColor: "{colors.ink}"
    height: "40px"
  scoresheet-move-now:
    backgroundColor: "{colors.g2}"
    textColor: "{colors.buff}"
    padding: "0 16px"
  chat-message:
    backgroundColor: "{colors.g3}"
    textColor: "{colors.ink}"
    padding: "5px 10px"
  chat-message-mine:
    backgroundColor: "{colors.buff}"
    textColor: "{colors.buff-ink}"
  modal:
    backgroundColor: "{colors.g2}"
    rounded: "{rounded.lg}"
    padding: "22px 24px"
    width: "420px"
---

# Design System: Code Duel

## Overview

**Creative North Star: "The Tournament Hall"**

Every round is a rated game. The app is a tournament table seen from above: board-green vinyl under everything, buff light squares where you act, a black clock case with a red flag at the centre of play, and a scoresheet along the bottom that notates every question with a chess annotation mark. It refuses the grey IDE-with-a-blue-accent shell of a practice site; nothing here is grey and nothing is blue.

The system is dense and operational. Students read, code, run and submit under time pressure, so the surfaces stay flat, the colour stays quiet, and the few saturated notes carry meaning: buff means "this is the move", flag red means time and failure, brass means identity and personal record, mint means a test passed. Every scoring rule sits beside its live number; nothing is explained in a paragraph that a number can show.

Type is one variable family (Archivo) stretched across its width axis to do three jobs: condensed heavy numerals for anything counted against the clock, normal width for UI, expanded small caps for labels. JetBrains Mono appears only where code and test data live, with ligatures off so students see the characters they typed.

**Key Characteristics:**
- One nine-step board-green ramp (g0 to g8) supplies every neutral surface, border and muted text.
- Buff is the light square: primary action, lit clock face, selected option, own chat message, focus ring, cursor.
- The black clock case with buff faces is the one container that matters; its flag lifts at 30 s and falls at 0.
- Condensed numerals (62% width, 800, tabular) are one system for clock, scores, room codes and countdown.
- Scoresheet annotation marks (!!, !, !?, ?) grade every finished question, each with a plain-words tooltip and a legend.
- Authored line icons on a 24 grid, 1.75 stroke, round caps; nothing from an icon font.

## Colors

A dark board-green field with four meaningful notes: buff, flag red, brass and mint.

### Primary
- **Light Square Buff** (buff): The single action colour. Primary buttons (Submit, Start, Ready), the lit clock face, the active segmented option, the active console tab underline, the current scoresheet move's top rule, the editor cursor, text selection, the focus outline, links and console return values. **Buff Highlight** (buff-hi) is its hover state only. **Square Ink** (buff-ink) is the text on any buff surface; **Square Mute** (buff-mute) is the label tone on a lit face.

### Secondary
- **Flag Red** (flag): Time pressure and failure. The pennant on the clock, the fallen clock face, failed-test marks, the danger button, unread chat badges, a departed player's dot. **Flag Text** (flag-text) is the lighter red for red text on green (costs, errors, Hard difficulty, failed summaries), and **Flag Wash** (flag-bg) tints failed rows, the bug notice and timeout end cards.

### Tertiary
- **Tournament Brass** (brass): Identity and record. Question ids, personal bests, "new best", opponent and player scores, chat names, Medium difficulty, the reconnecting banner, toast warnings. **Brass Wash** (brass-bg) is its tint.
- **Pass Mint** (mint): A test passed or a question solved. Passing test rows and marks, Easy difficulty, gain values in the scoring rules, solved points, the !! mark, the online dot, ready tags, the opponent's test squares. **Mint Wash** (mint-bg) is its tint.

### Neutral
- **Board Green ramp** (g0 to g8): g0 is the header, scoresheet and lobby bar (the table edge); g1 is the page, inputs, console and segmented wells; g2 is panels, cards, the problem column, modals and the chat side panel; g3 is raised fills (unlit clock faces, chat bubbles, hover rows, inline code); g4 is default borders, dividers and default buttons; g5 is strong borders, button hover, scrollbar thumb; g6 is hover borders and link underlines; g7 is muted text and labels; g8 is secondary text.
- **Vinyl Ink** (ink): Primary text on any green surface.
- **Clock Case Black** (case): Only the clock case and its family (modal and countdown scrims are this black at 66% and 82%).
- **Code surfaces** (code-bg, code-ink, code-gutter, code-line, code-select): The editor's own slightly deeper green, with a buff-tinted active line and selection.
- **Syntax** (syn-keyword brass-gold, syn-fn buff, syn-string mint, syn-number soft flag, syn-comment green-grey italic, syn-punct pale green): syntax colours echo the world's notes rather than a stock theme.

### Named Rules
**The One Ramp Rule.** Every neutral is a step of the board-green ramp. No off-ramp greys, no cool slate, no pure black outside the clock case.

**The Light Square Rule.** Buff marks the move the student can make or has made: one primary action per toolbar or form, one lit face per clock case. If two things are buff side by side, one of them is wrong.

**The Meaning-Only Colour Rule.** Flag, brass and mint never decorate. Red is time or failure, brass is an id, a score or a record, mint is a pass. Red text on green uses flag-text, never flag.

## Typography

**Display Font:** Archivo Variable (width axis 62% to 125%), with system-ui fallback
**Body Font:** Archivo Variable at normal width
**Label/Mono Font:** JetBrains Mono Variable for code, test data, console output and point values on the scoresheet

**Character:** One sturdy grotesque stretched to fit the job: tall and condensed like clock digits when counting, plain when reading, wide and spaced when labelling. The mono is strictly functional.

### Hierarchy
- **Display** (850, 30px, wdth 112%, -0.02em): The app title on Home and Lobby; results and duel headings run 30 to 32px at 850, wdth 108%.
- **Headline** (800, 26px, 1.12): The problem title.
- **Column title** (850, 22px, wdth 112%): Lobby column heads and the chat panel head (20px in the side panel).
- **Title** (750, 18px): Card titles; end-card titles run 21px at 800.
- **Body** (400, 15px, 1.5): Problem text, capped at 68ch. Secondary copy and rules run 13 to 14px.
- **Control** (600, 14px): Buttons, fields, segmented options, field labels. Primary buttons step up to 800.
- **Label** (700, 11px, wdth 118%, 0.09em, uppercase): Clock face names, table headers, select-field names, "Scoresheet", "Signature", "Examples". Clock face labels run at 10px.
- **Numeral** (800, wdth 62%, tabular, line-height 1): Clock, score and question faces (26 to 28px in the header, 52 to 56px on results and room plates, 120px in the countdown), room codes, end-card points (40px), live rule totals (24px).
- **Mark** (900, wdth 80%): Annotation glyphs, 13 to 17px inline and 44px stamped on the end card.
- **Code** (JetBrains Mono, 14px editor default, 13px console, line-height 1.6, ligatures off).

### Named Rules
**The One Numeral Rule.** Anything counted (time, score, question number, room code, countdown, points) uses the condensed numeral: wdth 62%, weight 800, tabular figures. Never a second numeral style.

**The Width Axis Rule.** Hierarchy comes from Archivo's width and weight, not from a second display family: condensed to count, normal to read, expanded to label.

**The Code Is Mono Rule.** Mono is for code, tests and console output only, with ligatures disabled. UI text never borrows it for flavour.

## Layout

The game screen is a full-height tool: a three-column header (brand and crumb left, clock case centred, opponents, View and Home right) on g0, a resizable split of problem column (38% default, 260px minimum, on g2) and work column (editor, toolbar, console in a 1fr / auto / 34% grid), and the scoresheet strip (40px) along the bottom. A 5px g4 splitter turns buff on hover and drag; the editor can sit on either side.

Home is a centred 1120px column with 28px page padding and a 1.25fr / 1fr grid of setup and duel cards, collapsing to one column under 900px. The lobby is three ruled columns (Room, Players, Chat; 1.1fr / 1fr / minmax(280px, 0.95fr)) over a g0 action bar; under 900px chat drops below the first two, under 760px everything stacks and the bar becomes sticky. Results sit in a 900px column.

During a duel the chat opens as a fixed right side panel (clamp(300px, 30vw, 440px)); the page makes room for it rather than hiding beneath it, and the game header, toolbar meters and toasts respond through container queries (work column at 820, 700 and 520px; game at 860 and 760px) rather than viewport breakpoints.

Spacing is a tight rhythm of 4, 8, 14, 18, 24 and 28px; control gaps are 6 to 10px, card gaps 14 to 20px. A View setting scales the whole app with CSS zoom, so full-height layouts divide vh by the zoom factor.

**The Rule Beside Its Number Rule.** Every scoring rule is a row with its live value right-aligned in tabular figures; the explanation is a short line under the rule's name, never a paragraph.

## Elevation & Depth

Flat tonal layering by default: depth comes from stepping up the green ramp (g0 table edge, g1 page, g2 panel, g3 raised fill) and from 1px g4/g5 borders. Shadows appear only on things that physically sit above the table: the clock case and floating layers.

### Shadow Vocabulary
- **Clock case** (`box-shadow: 0 1px 0 rgba(255,255,255,0.05) inset, 0 6px 18px rgba(0,0,0,0.45)`): The one resting shadow in the system; the case sits on the board.
- **Floating panel** (`box-shadow: 0 18px 50px rgba(0,0,0,0.55)`): Modals and the View panel.
- **Toast** (`box-shadow: 0 8px 24px rgba(0,0,0,0.45)`): Toasts and the chat preview.
- **Side panel** (`box-shadow: -12px 0 32px rgba(0,0,0,0.35)`): The chat side panel's left edge.
- **Opponent flash** (`box-shadow: 0 0 0 3px rgba(220,171,76,0.3)`): A brass ring that pulses twice on an opponent chip at a milestone.

### Named Rules
**The Only the Case Rule.** At rest, the clock case is the only shadowed object on the board. Cards, panels and buttons stay flat; elevation is for overlays.

## Shapes

Gently rounded and small-cornered: controls at 5px, segmented wells and toasts at 8px, cards, modals and end cards at 12px. The clock case is 10px with 6px faces inset 4px, reading as one moulded object. Pills (999px) are reserved for tags, difficulty chips, ready tags and quick-chat chips. Chat bubbles round three corners at 10px and pinch the speaker's corner to 3px. The brand mark is a 2x2 corner of the board (two buff squares, two g5) at 3 to 4px radius; opponent test progress is drawn as 9px board squares at 2px radius, mint when passing.

## Components

### Buttons
Solid, compact and quiet until it is the move.
- **Shape:** small radius (5px), 1px border, 600 weight, 14px, icon gap 7px.
- **Default:** g4 fill with g5 border and ink text; hover steps to g5 / g6; press nudges down 1px.
- **Primary:** buff fill and border, buff-ink text at 800; hover lightens to buff-hi. One per group.
- **Danger:** flag fill, white text, for destructive confirmations only.
- **Ghost:** transparent with g8 text; hover fills g3 with a g4 border. Used for Home, View and secondary header actions.
- **Sizes:** small (3px 9px, 13px), large (11px 24px, 16px, 18px icons). Disabled drops to 42% opacity.
- **Icon button:** 30px square, transparent, g8 icon; hover fills g4.

### Chips
- **Tag:** g4 pill, g8 text, 12px 600.
- **Difficulty:** pill tinted by meaning: mint on mint wash (Easy), brass on brass wash (Medium), flag-text on flag wash (Hard).
- **Quick chat chip:** g1 pill with g4 border; hover borders buff.
- **Ready tag:** g3 pill with g7 text, turning mint on mint wash when ready.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** g2 on the g1 page; nested wells (examples, opponent cards, meters) drop back to g1.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px g4.
- **Internal Padding:** 22px 24px.

### Inputs / Fields
- **Style:** g1 fill, 1px g5 border, 5px radius, 7px 10px padding, buff caret, g7 placeholder. Selects are native with a drawn g7 chevron.
- **Focus:** 2px buff outline at zero offset; the border goes transparent.
- **Room code input:** condensed numeral face, 18px, 0.18em tracking, uppercase.
- **Segmented control:** a g1 well (8px radius, 3px padding) whose selected option is the light square: buff fill, buff-ink text.

### Navigation
- **Game header:** g0 bar with a 1px g4 bottom rule; ghost buttons for Home and View, a g8 crumb that hides under 860px container width.
- **Console tabs:** 13px 650 g7 text; the active tab turns ink with a 2px buff inset underline.
- **Brand:** the board-corner mark plus "Code Duel" at 800, wdth 112%.

### Clock Case (signature)
A black case (case colour, 10px radius, 4px padding and gap) holding labelled faces: label above, condensed numeral below. Unlit faces are g3; the active Clock face is lit buff. A flag stands at the lit face's right edge: its red pennant hangs low at rest, rises to the top of the pole in the last 30 s while the face blinks between buff and a pale flag tint (#f6d6c9, numerals #8f1f10) once a second, and when time runs out the whole flag rotates 90 degrees and the face turns flag red with white text. The same case frames scores on results (56px numerals), room codes in the lobby (52px, 0.14em tracking), the "available" count on Home and the 120px countdown, which presses in (scale 0.82 to 1, 0.45s ease-out) on each tick.

### Scoresheet and Annotation Marks (signature)
A 40px g0 strip under the game, opening with a "Scoresheet" label cell, then one ruled cell per question: move number in g7, question id in brass mono, points in mono, and the annotation mark. The current move is g2 with a 2px buff top rule and a buff "playing" state. Marks are computed from the score breakdown: **!!** mint (solved, no penalties, half the speed bonus or more), **!** buff (clean), **!?** brass (solved with penalties), **?** flag-text (not solved). Each mark carries its plain-words meaning as a tooltip and accessible name; results screens add a legend. On the end card the mark is stamped at 44px (scale 1.7 to 1, 0.45s).

### Test Rows
g2 rows at 5px radius with a 20px round mark; passing rows wash mint with a mint check, failing rows wash flag with a flag cross. Call / expected / got sit in a two-column mono grid.

### Chat
Bubbles in g3 with brass speaker names; your own messages are buff with buff-ink text and sit right. System lines are centred 12px g7 with no bubble. The side panel slides in 24px over 0.28s ease-out; above the conversation it shows opponent cards (g1, 8px radius) with their question, test squares, lines changed and their own scoresheet.

### Toasts and Modals
Toasts are g3 with a g5 border at 8px radius and a small coloured square before the text (brass warn, flag bad, mint good). Modals are g2 cards at 12px radius over a 66% case-black scrim, actions right-aligned.

### Motion
One easing, `cubic-bezier(0.16, 1, 0.3, 1)`, for the clock press, flag movement, mark stamp, chevron turn and panel slide. Colour transitions run 0.15s. Reduced motion collapses all animation and transition to near zero.

## Do's and Don'ts

### Do:
- **Do** take every neutral from the g0 to g8 ramp; use ink for primary text and g7 / g8 for muted and secondary text.
- **Do** make the student's next move the single buff element in its group (Submit, Start, Ready, the selected option).
- **Do** set every counted value in the condensed numeral (Archivo wdth 62%, 800, tabular-nums).
- **Do** put a live number beside every scoring rule, right-aligned in tabular figures.
- **Do** give every annotation mark its plain-words meaning as a tooltip and accessible name, and show the legend wherever marks are summarised.
- **Do** draw new icons on the 24px grid with a 1.75 stroke, round caps and joins, `currentColor`.
- **Do** use flag-text, brass and mint for text on green, and their washes (13% / 13% / 10%) for tinted rows.
- **Do** keep the clock case black with buff faces wherever time, score or a room code is the point of the screen.

### Don't:
- **Don't** introduce greys, slates or blues; the grey IDE-with-blue-accent shell is the explicit anti-reference.
- **Don't** use flag red, brass or mint as decoration; each colour means one thing.
- **Don't** shadow cards, panels or buttons at rest; the clock case is the only resting object with a shadow.
- **Don't** use JetBrains Mono for UI text, and don't enable code ligatures.
- **Don't** add a second display family or a second numeral style.
- **Don't** use pill radius for buttons; pills are for tags and chips.
- **Don't** use icon fonts, emoji or text glyphs as icons; the !! / ! / !? / ? marks are notation, not icons.
