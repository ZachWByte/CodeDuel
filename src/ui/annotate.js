// Scoresheet annotation: every finished question gets a chess-style mark,
// worked out from its score breakdown, with a plain-words meaning.
import { h } from './dom.js';

export const MARKS = [
  { mark: '!!', kind: 'brilliant', label: 'Brilliant', text: 'solved with no penalties and at least half the speed bonus' },
  { mark: '!', kind: 'good', label: 'Clean', text: 'solved with no penalties' },
  { mark: '!?', kind: 'dubious', label: 'Solved with penalties', text: 'extra test runs, wrong submits, reveals or lines over par cost points' },
  { mark: '?', kind: 'miss', label: 'Not solved', text: 'time ran out, or it was skipped or left' },
];

/** result: { solved, breakdown? } (an engine result, or the current question once it has ended). */
export function annotation(result) {
  if (!result?.solved) return MARKS[3];
  const b = result.breakdown;
  if (!b) return MARKS[1];
  const penalties = b.submitPenalty + b.testPenalty + b.editPenalty + (b.revealPenalty ?? 0);
  if (penalties > 0) return MARKS[2];
  return b.timeBonus >= b.base / 4 ? MARKS[0] : MARKS[1];
}

/** The mark as an element, with its meaning as a tooltip and for screen readers. */
export function markEl(result, extraClass = '') {
  const a = annotation(result);
  return h(`span.mark-glyph.mark-${a.kind}${extraClass}`, { title: `${a.label}: ${a.text}`, 'aria-label': a.label }, a.mark);
}

/** Legend row for results screens. */
export function markLegend() {
  return h('dl.mark-legend', {}, MARKS.map((m) => [
    h('dt', {}, h(`span.mark-glyph.mark-${m.kind}`, { 'aria-hidden': 'true' }, m.mark)),
    h('dd', {}, h('strong', {}, m.label), ` · ${m.text}`),
  ]));
}
