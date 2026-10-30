// Spectating the other sides' code during a duel round. The server decides what we
// may see: an opponent's real code once our side has solved the question they have
// open (or our round is over), and until then the same code scrambled (lines,
// indentation and lengths kept, every character replaced), so you can watch them
// type but not read it.
import { h, setChildren } from './dom.js';
import { icon } from './icons.js';
import { createViewer } from '../editor/editor.js';
import { getQuestion } from '../questions/index.js';
import { nameEl, displayName } from './lobby.js';

/** "Q2" for a question, numbered as in the round. */
function questionLabel(state, questionId) {
  const i = state.questions.findIndex((q) => q.id === questionId);
  return i >= 0 ? `Q${i + 1}` : 'this question';
}

/**
 * createSpectator() -> { el, update(room, watches), isLive(), destroy() }
 * watches: Map playerId -> { playerId, questionId, locked, code } from the server.
 */
export function createSpectator() {
  const el = h('div.spectate', {});
  const cards = new Map(); // playerId -> { section, head, body, mode, viewer, pre }
  let live = false;

  function card(p) {
    let c = cards.get(p.id);
    if (!c) {
      c = { section: h('section.spectate-card', { 'aria-label': `${p.name}'s code` }), head: h('div.spectate-head', {}), body: h('div.spectate-body', {}), mode: null, viewer: null, pre: null };
      c.section.append(c.head, c.body);
      el.append(c.section);
      cards.set(p.id, c);
    }
    return c;
  }

  function setMode(c, mode, build) {
    if (c.mode === mode) return false;
    c.viewer?.destroy();
    c.viewer = null;
    c.pre = null;
    c.mode = mode;
    setChildren(c.body, build());
    return true;
  }

  function draw(room, p, watch, teamName) {
    const c = card(p);
    const qid = p.viewing ?? watch?.questionId ?? p.state.questions[0].id;
    // A watch for another question is stale: they have moved on and not typed yet.
    const w = watch?.questionId === qid ? watch : null;
    const mine = room.players.find((x) => x.id === room.youId)?.state;
    const done = room.status === 'finished' || mine?.status === 'finished' ||
      mine?.qs.some((q) => q.questionId === qid && q.status === 'solved');
    const locked = w ? w.locked : !done;
    const label = questionLabel(p.state, qid);
    const theirs = p.state.qs.find((q) => q.questionId === qid);
    const theirsOver = p.left || p.state.status === 'finished' || theirs?.status === 'solved';
    const name = displayName(p);

    setChildren(c.head,
      icon(locked ? 'lock' : 'eye'),
      h('span.spectate-title', {}, nameEl(p, 'strong'), teamName ? h('span.muted', {}, ` · ${teamName}`) : null),
      h('span.muted', {}, `${label} · ${getQuestion(qid)?.title ?? ''}`),
      h(`span.spectate-state${locked ? '.is-locked' : theirsOver ? '' : '.is-live'}`, {},
        locked ? 'scrambled' : theirsOver ? 'final' : 'live'));

    if (!w || w.code === null) {
      setMode(c, 'empty', () => h('p.muted.spectate-empty', {}));
      c.body.firstChild.textContent = p.left ? `${name} left the room.` : `${name} hasn't typed anything yet.`;
      return !locked;
    }
    if (locked) {
      setMode(c, 'locked', () => {
        c.pre = h('pre.spectate-scramble', { 'aria-hidden': 'true' });
        return h('div.spectate-locked', {},
          c.pre,
          h('div.spectate-lock', {},
            icon('lock'),
            h('span', {}, `Solve ${label} to read ${name}'s code. Until then you only see them type.`)));
      });
      if (c.pre.textContent !== w.code) c.pre.textContent = w.code;
      return false;
    }
    setMode(c, 'live', () => h('div.viewer.spectate-viewer', {}));
    if (!c.viewer) c.viewer = createViewer(c.body.firstChild, { doc: w.code, lang: room.config.lang });
    else if (c.viewer.state.doc.toString() !== w.code) {
      c.viewer.dispatch({ changes: { from: 0, to: c.viewer.state.doc.length, insert: w.code } });
    }
    return true;
  }

  return {
    el,
    update(room, watches) {
      const mine = room.players.find((p) => p.id === room.youId)?.side;
      const opponents = room.players.filter((p) => p.side !== mine && p.state);
      const teamOf = (p) => room.sides?.find((s) => s.key === p.side && s.team)?.name ?? null;
      for (const [id, c] of cards) {
        if (opponents.some((p) => p.id === id)) continue;
        c.viewer?.destroy();
        c.section.remove();
        cards.delete(id);
      }
      live = opponents.map((p) => draw(room, p, watches.get(p.id), teamOf(p))).some(Boolean);
      if (!opponents.length) setChildren(el, h('p.muted.spectate-empty', {}, 'Nobody else to watch: everyone here is on your team.'));
    },
    /** True when at least one opponent's code is readable. */
    isLive: () => live,
    destroy() {
      for (const c of cards.values()) c.viewer?.destroy();
      cards.clear();
    },
  };
}
