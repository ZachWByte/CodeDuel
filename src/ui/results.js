// End-of-session results.
import { h, setChildren, formatTime } from './dom.js';
import { getQuestion, LANG_LABELS, MODE_LABELS, DIFFICULTY_LABELS } from '../questions/index.js';
import { loadSessionBest, saveSessionBestIfBetter } from '../state/storage.js';
import { icon, clockCase } from './icons.js';
import { markEl, markLegend } from './annotate.js';

const STATUS_TEXT = { solved: 'Solved', timeout: 'Time up', skipped: 'Skipped' };

export function renderResults(root, { state, onPlayAgain, onHome }) {
  const { config } = state;
  const previousBest = config.practice ? null : loadSessionBest(config);
  const newBest = !config.practice && saveSessionBestIfBetter(config, state.total);
  const solved = state.results.filter((r) => r.solved).length;

  setChildren(root, h('div.results-screen', {},
    h('div.card.results-card', {},
      h('div.results-top', {},
        h('div', {},
          h('h2', {}, config.practice ? 'Practice complete' : 'Session complete'),
          h('p.muted', {}, `${MODE_LABELS[config.mode]} · ${DIFFICULTY_LABELS[config.difficulty]} · ${LANG_LABELS[config.lang]}`),
          newBest
            ? h('p.new-best', {}, icon('trophy'), previousBest === null ? 'First score for this setup' : `New personal best (previous ${previousBest})`)
            : previousBest !== null ? h('p.muted', {}, `Personal best for this setup: ${previousBest}`) : null),
        clockCase([
          ['points', String(state.total), { lit: true }],
          ['solved', `${solved}/${state.results.length}`],
        ])),
      h('table.results-table', {},
        h('thead', {}, h('tr', {}, ['#', 'Question', 'Result', 'Time', 'Attempts', 'Points'].map((t, i) => h(`th${i === 5 ? '.num' : ''}`, {}, t)))),
        h('tbody', {}, state.results.map((r, i) => {
          const q = getQuestion(r.questionId);
          return h('tr', {},
            h('td', {}, i + 1),
            h('td', {}, h('span.qid', {}, q.id), ' ', q.title, ' ', markEl(r)),
            h(`td.${r.solved ? 'ok' : 'bad'}`, {}, STATUS_TEXT[r.status]),
            h('td', {}, formatTime(r.timeSec)),
            h('td', {}, r.attempts),
            h('td.num', {}, r.points));
        })),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 5 }, 'Total'), h('td.num', {}, state.total)))),
      markLegend(),
      h('div.results-actions', {},
        h('button.btn.btn-primary#btn-again', { onclick: onPlayAgain }, 'Play again'),
        h('button.btn#btn-home', { onclick: onHome }, 'Home')))));
  root.querySelector('#btn-again')?.focus();
  return () => {};
}
