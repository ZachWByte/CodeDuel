// End-of-session results.
import { h, setChildren, formatTime } from './dom.js';
import { getQuestion, LANG_LABELS, MODE_LABELS, DIFFICULTY_LABELS } from '../questions/index.js';
import { loadSessionBest, saveSessionBestIfBetter } from '../state/storage.js';

const STATUS_TEXT = { solved: '✓ Solved', timeout: '✗ Time up', skipped: '✗ Skipped' };

export function renderResults(root, { state, onPlayAgain, onHome }) {
  const { config } = state;
  const previousBest = config.practice ? null : loadSessionBest(config);
  const newBest = !config.practice && saveSessionBestIfBetter(config, state.total);
  const solved = state.results.filter((r) => r.solved).length;

  setChildren(root, h('div.results-screen', {},
    h('div.card.results-card', {},
      h('h2', {}, config.practice ? 'Practice complete' : 'Session complete'),
      h('p.muted', {}, `${MODE_LABELS[config.mode]} · ${DIFFICULTY_LABELS[config.difficulty]} · ${LANG_LABELS[config.lang]}`),
      h('div.big-score', {}, h('span', {}, state.total), h('small', {}, 'points')),
      h('p', {}, `${solved} of ${state.results.length} solved`),
      newBest
        ? h('p.new-best', {}, previousBest === null ? '★ First score for this setup!' : `★ New personal best! (previous ${previousBest})`)
        : previousBest !== null ? h('p.muted', {}, `Personal best for this setup: ${previousBest}`) : null,
      h('table.results-table', {},
        h('thead', {}, h('tr', {}, ['#', 'Question', 'Result', 'Time', 'Attempts', 'Points'].map((t) => h('th', {}, t)))),
        h('tbody', {}, state.results.map((r, i) => {
          const q = getQuestion(r.questionId);
          return h('tr', {},
            h('td', {}, i + 1),
            h('td', {}, h('span.qid', {}, q.id), ' ', q.title),
            h(`td.${r.solved ? 'ok' : 'bad'}`, {}, STATUS_TEXT[r.status]),
            h('td', {}, formatTime(r.timeSec)),
            h('td', {}, r.attempts),
            h('td.num', {}, r.points));
        })),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 5 }, 'Total'), h('td.num', {}, state.total)))),
      h('div.results-actions', {},
        h('button.btn.btn-primary#btn-again', { onclick: onPlayAgain }, 'Play again'),
        h('button.btn#btn-home', { onclick: onHome }, 'Home')))));
  root.querySelector('#btn-again')?.focus();
  return () => {};
}
