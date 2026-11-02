// Scoresheet annotation: every finished question gets a chess-style mark,
// worked out from its score breakdown, with a plain-words meaning.
import { h } from './dom.js';
import { SPEED_SHARE } from '../state/engine.js';
import { TIME_PENALTY_SHARE } from '../state/round.js';

export const MARKS = [
  { mark: '!!', kind: 'brilliant', label: 'Brilliant', text: 'solved quickly, with no penalties' },
  { mark: '!', kind: 'good', label: 'Clean', text: 'solved with no penalties' },
  { mark: '!?', kind: 'dubious', label: 'Solved with penalties', text: 'wrong submits, reveals or lines over par cost points' },
  { mark: '?', kind: 'miss', label: 'Not solved', text: 'time ran out, or it was skipped or left' },
];

/** result: { solved, breakdown? } (an engine result, or the current question once it has ended). */
export function annotation(result) {
  if (!result?.solved) return MARKS[3];
  const b = result.breakdown;
  if (!b) return MARKS[1];
  // testPenalty: runs scored before "Run tests" became free (saved bests).
  const penalties = b.submitPenalty + (b.testPenalty ?? 0) + b.editPenalty + (b.revealPenalty ?? 0);
  if (penalties > 0) return MARKS[2];
  // A solo score has a speed bonus; a duel question has a time penalty.
  const quick = b.timePenalty === undefined ? b.timeBonus >= (b.base * SPEED_SHARE) / 2 : b.timePenalty <= (b.base * TIME_PENALTY_SHARE) / 2;
  return quick ? MARKS[0] : MARKS[1];
}

/** The mark as an element, with its meaning as a tooltip and for screen readers. */
export function markEl(result, extraClass = '') {
  const a = annotation(result);
  return h(`span.mark-glyph.mark-${a.kind}${extraClass}`, { title: `${a.label}: ${a.text}`, 'aria-label': a.label }, a.mark);
}
