// End of a duel round: the final standings, the match score, and every side's
// result per question. Updates live while others are still playing, with their
// code to watch.
import { h, setChildren, formatTime } from './dom.js';
import { getQuestion, LANG_LABELS, MODE_LABELS, CATEGORIES, difficultyText } from '../questions/index.js';
import { playerList, matchScore } from './lobby.js';
import { standings, mySide, sideLabel, ordinal } from './leaderboard.js';
import { solvedCount, spentSec } from '../state/round.js';
import { icon } from './icons.js';
import { markEl } from './annotate.js';

function headline(room, ranked) {
  if (room.status !== 'finished') {
    const waiting = ranked.filter((s) => s.state.status !== 'finished' && s.players.some((p) => !p.left)).map((s) => s.name);
    return h('h2', {}, `Waiting for ${waiting.join(' and ') || 'the others'} to finish…`);
  }
  if (!room.lastWinnerSide) return h('h2', {}, "It's a draw");
  const w = ranked.find((s) => s.key === room.lastWinnerSide);
  return h('h2', {}, icon('trophy'), w?.key === mySide(room) ? (w.team ? 'Your team wins the round' : 'You win the round') : `${w?.name ?? 'Someone'} wins the round`);
}

function cell(side, i) {
  const q = side.state.qs[i];
  if (q.status === 'solved') {
    const b = q.breakdown;
    const detail = [`solved in ${formatTime(spentSec(q, q.solvedAt))}`,
      `${q.attempts} submit${q.attempts === 1 ? '' : 's'}`, `${q.testRuns} test runs`, `= ${b.base} −${b.lost}`];
    return h('td.num.ok', { title: detail.join(' · ') }, markEl({ solved: true, breakdown: b }), ` ${q.points}`);
  }
  if (q.points) return h('td.num.partial', { title: `${q.bestHidden}/${q.hiddenTotal} secret tests passed` }, q.points);
  if (side.state.status !== 'finished') return h('td.num.muted', {}, q.attempts ? 'trying…' : '…');
  return h('td.num.muted', {}, markEl({ solved: false }), ' 0');
}

/**
 * renderDuelResults(root, { room, onNext(), onLeave(), onKick?(playerId), chatToggle?, watch?, review? }) -> { update(room), cleanup() }
 * watch: { el, update(room) }, the others' code to spectate while you wait
 * review: { el, update(room) }, the questions and everyone's answers, to look back at
 */
export function renderDuelResults(root, { room: initial, onNext, onLeave, onKick = null, chatToggle = null, watch = null, review = null }) {
  let room = initial;
  let error = '';
  let alive = true; // a reply can arrive after the next screen has replaced this one

  const act = (fn) => async () => {
    const res = await fn();
    error = res?.error ?? '';
    if (alive) draw();
  };

  function draw() {
    const c = room.config;
    const info = room.roundInfo;
    const ranked = standings(room);
    const questions = ranked[0]?.state.questions ?? [];
    const done = room.status === 'finished';
    const score = matchScore(room);
    watch?.update(room);
    review?.update(room);
    // While you wait, the others' code comes first; after the round, below the table.
    const watching = watch ? h('div.results-watch', {}, h('h3.section-title', {}, done ? 'Their code' : 'Watch them finish'), watch.el) : null;

    setChildren(root, h('div.results-screen', {},
      h('div.card.results-card', {},
        h('div.duel-head', {},
          headline(room, ranked),
          h('p.muted', {}, `Round ${room.round} · ${info ? `${MODE_LABELS[info.mode]} · ${CATEGORIES[info.category]?.label}` : ''} · ${difficultyText(c)} · ${LANG_LABELS[c.lang]}`),
          score && done ? h('p.match-line', {}, 'Match: ', h('strong', {}, score)) : null),
        h('ol.final-standings', {}, ranked.map((s) =>
          h(`li.final-row${s.key === mySide(room) ? '.you' : ''}${done && s.key === room.lastWinnerSide ? '.winner' : ''}${s.team ? `.lb-${s.team}` : ''}`, {},
            h('span.final-rank', {}, ordinal(s.rank)),
            sideLabel(s, room),
            h('span.muted.small', {}, `${solvedCount(s.state)} of ${questions.length} solved${s.players.every((p) => p.left) ? ' · left' : ''}`),
            h('span.numeral.final-points', {}, s.state.total)))),
        done ? null : watching,
        h('table.results-table', {},
          h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Question'), ranked.map((s) => h('th.num', {}, s.name)))),
          h('tbody', {}, questions.map((meta, i) => {
            const q = getQuestion(meta.id);
            return h('tr', {},
              h('td', {}, i + 1),
              h('td', {}, h('span.qid', {}, q.id), ' ', q.title),
              ranked.map((s) => cell(s, i)));
          })),
          h('tfoot', {}, h('tr', {}, h('td', { colspan: 2 }, 'Total'), ranked.map((s) => h('td.num', {}, s.state.total))))),
        review?.el ?? null,
        done ? watching : null,
        error ? h('p.duel-error', {}, error) : null,
        h('div.results-actions', {},
          done ? h('button.btn.btn-primary#btn-next-round', { onclick: act(onNext) }, 'Next round', icon('chevron')) : null,
          h('button.btn.btn-ghost#btn-leave', { onclick: onLeave }, 'Leave room'),
          h('span.spacer', {}), chatToggle),
        // Still waiting: the host can remove someone who is holding the round up.
        done ? null : h('div.results-players', {}, playerList(room, { onKick: onKick && ((id) => act(() => onKick(id))()) })))));
  }

  draw();
  return {
    update(next) {
      room = next;
      draw();
    },
    cleanup() {
      alive = false;
    },
  };
}
