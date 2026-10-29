// End of a duel round: who won, the match score, and every player's result per
// question. Updates live while the other player is still playing.
import { h, setChildren, formatTime } from './dom.js';
import { getQuestion, LANG_LABELS, MODE_LABELS, DIFFICULTY_LABELS, CATEGORIES } from '../questions/index.js';
import { playerList, matchScore, displayName } from './lobby.js';

const MARK = { solved: '✓', timeout: '⏱', skipped: '✗' };

function headline(room) {
  const players = room.players.filter((p) => p.state);
  if (room.status !== 'finished') {
    const waiting = players.filter((p) => !p.left && p.state.status !== 'finished').map(displayName);
    return h('h2', {}, `Waiting for ${waiting.join(' and ')} to finish…`);
  }
  if (!room.lastWinnerId) return h('h2', {}, "🤝 It's a draw!");
  const w = room.players.find((p) => p.id === room.lastWinnerId);
  return h('h2', {}, w.id === room.youId ? '🏆 You win the round!' : `🏆 ${displayName(w)} wins the round`);
}

function cell(player, i) {
  const s = player.state;
  const r = s.results[i];
  if (r) {
    const b = r.breakdown;
    const detail = [`${r.status}`, formatTime(r.timeSec), `${r.attempts} submit${r.attempts === 1 ? '' : 's'}`, `${r.testRuns ?? 0} test runs`];
    if (r.extraLines) detail.push(`${r.extraLines} line${r.extraLines === 1 ? '' : 's'} over par`);
    if (b && r.solved) detail.push(`= ${b.base} +${b.timeBonus} −${b.submitPenalty + b.testPenalty + b.editPenalty}`);
    return h(`td.num.${r.solved ? 'ok' : 'bad'}`, { title: detail.join(' · ') }, `${MARK[r.status] ?? ''} ${r.points}`);
  }
  if (player.left) return h('td.num.muted', {}, '—');
  return h('td.num.muted', {}, s.index === i ? 'playing…' : '…');
}

/**
 * renderDuelResults(root, { room, onNext(), onLeave() }) -> { update(room), cleanup() }
 */
export function renderDuelResults(root, { room: initial, onNext, onLeave }) {
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
    const players = room.players.filter((p) => p.state);
    const questions = (players.find((p) => p.id === room.youId) ?? players[0])?.state.questions ?? [];
    const done = room.status === 'finished';
    const score = matchScore(room);
    const loser = done && room.lastWinnerId ? room.players.find((p) => !p.left && p.id !== room.lastWinnerId) : null;

    setChildren(root, h('div.results-screen', {},
      h('div.card.results-card', {},
        headline(room),
        h('p.muted', {}, `Round ${room.round} · ${info ? `${MODE_LABELS[info.mode]} · ${CATEGORIES[info.category]?.label}` : ''} · ${DIFFICULTY_LABELS[c.difficulty]} · ${LANG_LABELS[c.lang]}`),
        score && done ? h('p.match-line', {}, 'Match: ', h('strong', {}, score)) : null,
        h('div.duel-scores', {}, [...players].sort((a, b) => b.state.total - a.state.total).map((p) =>
          h(`div.duel-score${p.id === room.youId ? '.you' : ''}${done && p.id === room.lastWinnerId ? '.winner' : ''}`, {},
            h('div.big-score', {}, h('span', {}, p.state.total)),
            h('div', {}, displayName(p), p.id === room.youId ? h('span.muted', {}, ' (you)') : null),
            h('div.muted.small', {},
              `${p.state.results.filter((r) => r.solved).length} of ${questions.length} solved`,
              p.left ? ' · left' : !p.connected ? ' · offline' : '')))),
        h('table.results-table', {},
          h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Question'), players.map((p) => h('th.num', {}, displayName(p))))),
          h('tbody', {}, questions.map((meta, i) => {
            const q = getQuestion(meta.id);
            return h('tr', {},
              h('td', {}, i + 1),
              h('td', {}, h('span.qid', {}, q.id), ' ', q.title),
              players.map((p) => cell(p, i)));
          })),
          h('tfoot', {}, h('tr', {}, h('td', { colspan: 2 }, 'Total'), players.map((p) => h('td.num', {}, p.state.total))))),
        h('p.muted.small', {}, 'Hover a score to see how it was worked out.'),
        loser ? h('p', {}, loser.id === room.youId ? 'You lost this round, so you choose the next mode and topic.'
          : `${displayName(loser)} lost this round and will choose the next mode and topic.`) : null,
        error ? h('p.duel-error', {}, error) : null,
        h('div.results-actions', {},
          done ? h('button.btn.btn-primary#btn-next-round', { onclick: act(onNext) }, 'Next round ▸') : null,
          h('button.btn.btn-ghost#btn-leave', { onclick: onLeave }, 'Leave room')),
        done ? null : h('div.results-players', {}, playerList(room)))));
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
