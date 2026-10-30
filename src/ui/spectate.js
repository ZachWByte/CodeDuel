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
      c = {
        section: h('section.spectate-card', { 'aria-label': `${p.name}'s code` }),
        head: h('div.spectate-head', {}),
        picker: h('div.spectate-picker', { hidden: true, role: 'group', 'aria-label': 'Which question' }),
        body: h('div.spectate-body', {}),
        mode: null, viewer: null, pre: null, pick: null, viewerQid: null, redraw: null,
      };
      c.section.append(c.head, c.picker, c.body);
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

  /** The question tabs on a card: the one they have open, and others you may read. */
  function drawPicker(c, p, liveQid, others, shown) {
    if (!others.length) {
      c.picker.hidden = true;
      return;
    }
    c.picker.hidden = false;
    const tab = (qid, text) => h(`button.spectate-q${qid === shown ? '.active' : ''}`, {
      type: 'button',
      'aria-pressed': String(qid === shown),
      onclick: () => {
        c.pick = qid;
        c.redraw?.();
      },
    }, text);
    const solvedByThem = (qid) => p.state.qs.find((x) => x.questionId === qid)?.status === 'solved';
    setChildren(c.picker,
      tab(liveQid, `${questionLabel(p.state, liveQid)} · now`),
      others.map((o) => tab(o.questionId, `${questionLabel(p.state, o.questionId)}${solvedByThem(o.questionId) ? ' ✓' : ''}`)));
  }

  function draw(room, p, watch, teamName) {
    const c = card(p);
    const liveQid = p.viewing ?? watch?.questionId ?? p.state.questions[0].id;
    // A watch for another question is stale: they have moved on and not typed yet.
    const w = watch?.questionId === liveQid ? watch : null;
    const others = watch?.others ?? [];
    const mine = room.players.find((x) => x.id === room.youId)?.state;
    const done = room.status === 'finished' || mine?.status === 'finished' ||
      mine?.qs.some((q) => q.questionId === liveQid && q.status === 'solved');
    const liveLocked = w ? w.locked : !done;
    // Which question to show: the one picked, else the live one, unless that is
    // scrambled and they have code on a question you have solved.
    const valid = (qid) => qid === liveQid || others.some((o) => o.questionId === qid);
    if (c.pick && !valid(c.pick)) c.pick = null;
    const shown = c.pick ?? (liveLocked && others.length ? others[0].questionId : liveQid);
    drawPicker(c, p, liveQid, others, shown);
    const other = shown === liveQid ? null : others.find((o) => o.questionId === shown);
    const code = other ? other.code : w?.code ?? null;
    const locked = other ? false : liveLocked;
    const label = questionLabel(p.state, shown);
    const theirs = p.state.qs.find((q) => q.questionId === shown);
    const theirsOver = p.left || p.state.status === 'finished' || theirs?.status === 'solved' || !!other;
    const name = displayName(p);

    setChildren(c.head,
      icon(locked ? 'lock' : 'eye'),
      h('span.spectate-title', {}, nameEl(p, 'strong'), teamName ? h('span.muted', {}, ` · ${teamName}`) : null),
      h('span.muted', {}, `${label} · ${getQuestion(shown)?.title ?? ''}`),
      h(`span.spectate-state${locked ? '.is-locked' : theirsOver ? '' : '.is-live'}`, {},
        locked ? 'scrambled' : other ? (theirs?.status === 'solved' ? 'solved' : 'earlier') : theirsOver ? 'final' : 'live'));

    if (code === null) {
      setMode(c, 'empty', () => h('p.muted.spectate-empty', {}));
      c.body.firstChild.textContent = p.left ? `${name} left the room.` : `${name} hasn't typed anything yet.`;
      return !liveLocked || others.length > 0;
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
      if (c.pre.textContent !== code) c.pre.textContent = code;
      return others.length > 0;
    }
    // A new viewer per question shown, so switching tabs never mixes documents.
    if (c.viewerQid !== shown) setMode(c, null, () => null);
    c.viewerQid = shown;
    setMode(c, 'live', () => h('div.viewer.spectate-viewer', {}));
    if (!c.viewer) c.viewer = createViewer(c.body.firstChild, { doc: code, lang: room.config.lang });
    else if (c.viewer.state.doc.toString() !== code) {
      c.viewer.dispatch({ changes: { from: 0, to: c.viewer.state.doc.length, insert: code } });
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
      live = opponents.map((p) => {
        // Picking a question tab redraws just that card, with what we last had.
        card(p).redraw = () => draw(room, p, watches.get(p.id), teamOf(p));
        return draw(room, p, watches.get(p.id), teamOf(p));
      }).some(Boolean);
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
