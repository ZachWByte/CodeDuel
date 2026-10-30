// The live leaderboard of a duel round: every side (a team, or a player on their
// own) ranked by points as the round goes. Rows slide to their new place when the
// order changes, and a score that just changed lights up for a moment.
import { h, setChildren } from './dom.js';
import { icon } from './icons.js';
import { rankSides, solvedCount } from '../state/round.js';
import { getQuestion } from '../questions/index.js';

const ORDINAL = ['1st', '2nd', '3rd'];
export const ordinal = (n) => ORDINAL[n - 1] ?? `${n}th`;

/** The room's sides with their state and players, ranked. */
export function standings(room) {
  const sides = (room.sides ?? []).map((s) => {
    const players = room.players.filter((p) => s.memberIds.includes(p.id));
    return { ...s, players, state: players.find((p) => p.state)?.state };
  }).filter((s) => s.state);
  return rankSides(sides);
}

/** The side you play for. */
export const mySide = (room) => room.players.find((p) => p.id === room.youId)?.side ?? null;

/** A side's name as an element: a team swatch, or the player (with the bot icon). */
export function sideLabel(side, room) {
  const you = side.key === mySide(room);
  if (side.team) {
    const names = side.players.map((p) => p.name).join(', ');
    return h('span.side-name', {}, h(`i.swatch.swatch-${side.team}`, { 'aria-hidden': 'true' }),
      h('strong', {}, side.name), h('span.muted', {}, ` ${names}${you ? ' (you)' : ''}`));
  }
  const p = side.players[0];
  return h('span.side-name', {}, p?.bot ? icon('bot', 'Bot') : null, h('strong', {}, p?.name ?? side.name),
    you ? h('span.muted', {}, ' (you)') : null);
}

/** "on Q2 · Title" for a side's players (teammates may be on different questions). */
function whereLine(side) {
  const s = side.state;
  if (s.status === 'finished') return 'finished';
  if (side.players.every((p) => p.left)) return 'left';
  const on = [...new Set(side.players.filter((p) => !p.left).map((p) => p.viewing ?? s.questions[0].id))];
  return on.map((id) => {
    const i = s.questions.findIndex((q) => q.id === id);
    const q = s.qs[i];
    const tests = q?.lastTest ? ` · ${q.lastTest.passed}/${q.lastTest.total} tests` : '';
    return `on Q${i + 1}${q?.status === 'solved' ? ' (solved)' : tests}`;
  }).join(', ');
}

/** createLeaderboard({ compact? }) -> { el, update(room) } */
export function createLeaderboard({ compact = false } = {}) {
  const list = h('ol.leaderboard', { 'aria-label': 'Leaderboard' });
  const rows = new Map(); // side key -> { li, total }

  function update(room) {
    const ranked = standings(room);
    const me = mySide(room);
    // FLIP: remember where each row was, redraw, then slide from there.
    const before = new Map([...rows].map(([k, r]) => [k, r.li.getBoundingClientRect().top]));
    const next = ranked.map((s) => {
      const old = rows.get(s.key);
      const li = old?.li ?? h('li.lb-row', {});
      li.className = `lb-row${s.key === me ? ' lb-you' : ''}${s.team ? ` lb-${s.team}` : ''}`;
      setChildren(li,
        h('span.lb-rank.numeral', {}, s.rank),
        h('span.lb-main', {},
          sideLabel(s, room),
          compact ? null : h('span.lb-where', {}, `${solvedCount(s.state)}/${s.state.qs.length} solved · ${whereLine(s)}`)),
        h('span.lb-points.numeral', {}, s.state.total));
      if (old && old.total !== s.state.total) {
        li.classList.remove('lb-flash');
        void li.offsetWidth;
        li.classList.add('lb-flash');
      }
      rows.set(s.key, { li, total: s.state.total });
      return li;
    });
    for (const k of [...rows.keys()]) if (!ranked.some((s) => s.key === k)) rows.delete(k);
    setChildren(list, next);
    for (const [k, r] of rows) {
      const was = before.get(k);
      if (was === undefined) continue;
      const dy = was - r.li.getBoundingClientRect().top;
      if (!dy) continue;
      r.li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
        { duration: 380, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
  }

  return { el: list, update };
}

/** "2nd of 4 · 40 behind Red team" for the header. */
export function standingText(room) {
  const ranked = standings(room);
  const i = ranked.findIndex((s) => s.key === mySide(room));
  if (i < 0 || ranked.length < 2) return '';
  const me = ranked[i];
  if (me.rank === 1) {
    const lead = me.state.total - ranked.find((s) => s.key !== me.key).state.total;
    return lead > 0 ? `1st · ${lead} ahead` : '1st · tied';
  }
  const above = ranked[i - 1];
  return `${ordinal(me.rank)} of ${ranked.length} · ${above.state.total - me.state.total} behind ${above.name}`;
}

/** Titles of questions for toasts. */
export const titleOf = (id) => getQuestion(id)?.title ?? 'a question';
