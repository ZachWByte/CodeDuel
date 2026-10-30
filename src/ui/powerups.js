// Power-ups in a duel round (server/duel.js): a header button with what you have
// left, and a panel to use them. Blackout and Wipe hit every opponent at once (one
// click to choose, one to confirm); Mouse keys hits the opponent you pick; Hint works
// on the question you have open.
import { h, setChildren, toast } from './dom.js';
import { icon } from './icons.js';
import { getQuestion } from '../questions/index.js';
import { displayName } from './lobby.js';

const BLACKOUT_S = 15;

/**
 * createPowerups({ onPower(type, targetId?), onHint(questionId, kind), questionId() })
 * The callbacks return a promise of the server's reply. -> { button, update(room), destroy() }
 * update(room): the latest snapshot (timestamps on our clock). The button hides when
 * the room has no power-ups on.
 */
export function createPowerups({ onPower, onHint, questionId }) {
  let room = null;
  let picking = null; // 'blackout' | 'wipe': waiting for the confirm; 'keyboard': picking whom
  let busy = false;
  let panel = null;

  const count = h('span.power-count', {});
  const button = h('button.btn.power-toggle#btn-power', {
    type: 'button',
    hidden: true,
    title: 'Power-ups',
    'aria-expanded': 'false',
    onclick: () => (panel ? close() : open()),
  }, icon('bolt'), h('span', {}, 'Power-ups'), count);

  const me = () => room?.players.find((p) => p.id === room.youId);
  const NONE = { blackout: 0, wipe: 0, keyboard: 0, hints: 0 };
  const powers = () => ({ ...NONE, blackoutReadyAt: 0, ...room?.powers });
  const config = () => ({ ...NONE, ...room?.config.powerups });
  const usesLeft = (pw) => pw.blackout + pw.wipe + pw.keyboard + pw.hints;
  const cooldown = () => Math.max(0, Math.ceil((powers().blackoutReadyAt - Date.now()) / 1000));

  /** Opponents still playing (not on your side): who a blackout or wipe hits. */
  function targets(type) {
    const self = me();
    return room.players.filter((p) => p.side && p.side !== self?.side && !p.left && p.state?.status === 'playing' && !(type !== 'blackout' && p.bot));
  }

  /** Mouse keys: one button per opponent. */
  function pickRow() {
    const list = targets('keyboard');
    return h('div.power-targets', {},
      list.length ? list.map((p) => {
        const has = p.keyboardUntil > Date.now();
        return h('button.btn.btn-small', {
          type: 'button',
          disabled: busy || has,
          title: has ? 'They already have Mouse keys' : undefined,
          onclick: () => act(() => onPower('keyboard', p.id)),
        }, displayName(p));
      }) : h('span.muted.small', {}, 'Nobody to use it on.'),
      h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: () => { picking = null; draw(); } }, 'Cancel'));
  }

  async function act(fn) {
    if (busy) return;
    busy = true;
    draw();
    const res = await fn();
    busy = false;
    if (res?.error) toast(res.error, 3500, 'bad');
    else picking = null;
    draw();
  }

  function item(key, iconName, title, text, left, { disabled = false, note = null, onclick }) {
    return h(`button.power-item${picking === key ? '.active' : ''}`, { type: 'button', disabled: disabled || busy, onclick },
      h('span.power-icon', {}, icon(iconName)),
      h('span.power-text', {}, h('strong', {}, title), h('span.muted', {}, text)),
      h('span.power-left', {}, note ?? `${left} left`));
  }

  /** The confirm row: who it hits, and the button that does it. */
  function confirmRow(type, label) {
    const list = targets(type);
    return h('div.power-targets', {},
      list.length
        ? [h('button.btn.btn-small.btn-danger', { type: 'button', disabled: busy, onclick: () => act(() => onPower(type)) }, label),
          h('span.muted.small.power-who', {}, `Hits ${list.map(displayName).join(', ')}`)]
        : h('span.muted.small', {}, 'Nobody to use it on.'),
      h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: () => { picking = null; draw(); } }, 'Cancel'));
  }

  function draw() {
    if (!panel || !room) return;
    const pw = powers();
    const cfg = config();
    const qid = questionId();
    const q = qid ? getQuestion(qid) : null;
    const bug = q?.mode === 'bug-hunt';
    const solved = me()?.state?.qs.find((x) => x.questionId === qid)?.status === 'solved';
    const hint = room.hints?.[qid] ?? {};
    const cd = cooldown();
    const rows = [];
    if (cfg.blackout) {
      rows.push(item('blackout', 'moon', 'Blackout', `Turn every opponent’s editor off for ${BLACKOUT_S} s. 3 min cooldown.`, pw.blackout, {
        disabled: !pw.blackout || cd > 0,
        note: pw.blackout && cd ? `ready in ${Math.floor(cd / 60)}:${String(cd % 60).padStart(2, '0')}` : null,
        onclick: () => { picking = picking === 'blackout' ? null : 'blackout'; draw(); },
      }));
      if (picking === 'blackout') rows.push(confirmRow('blackout', 'Black out everyone'));
    }
    if (cfg.wipe) {
      rows.push(item('wipe', 'eraser', 'Wipe', 'Delete every opponent’s code on the question they have open.', pw.wipe, {
        disabled: !pw.wipe,
        onclick: () => { picking = picking === 'wipe' ? null : 'wipe'; draw(); },
      }));
      if (picking === 'wipe') rows.push(confirmRow('wipe', 'Wipe everyone'));
    }
    if (cfg.keyboard) {
      rows.push(item('keyboard', 'keyboard', 'Mouse keys', 'Take one opponent’s keyboard for 30 s: they type by clicking an on-screen one.', pw.keyboard, {
        disabled: !pw.keyboard,
        onclick: () => { picking = picking === 'keyboard' ? null : 'keyboard'; draw(); },
      }));
      if (picking === 'keyboard') rows.push(pickRow());
    }
    if (cfg.hints) {
      const can = pw.hints > 0 && q && !solved;
      rows.push(h('div.power-item.power-static', {},
        h('span.power-icon', {}, icon('bulb')),
        h('span.power-text', {}, h('strong', {}, 'Hint'), h('span.muted', {}, q ? (solved ? `You solved ${q.title}.` : `For ${q.title}:`) : 'Open a question first.')),
        h('span.power-left', {}, `${pw.hints} left`)));
      rows.push(h('div.power-targets', {},
        h('button.btn.btn-small', {
          type: 'button',
          disabled: !can || busy || !!hint.outline,
          onclick: () => act(() => onHint(qid, 'outline')),
        }, bug ? 'Which line is the bug on?' : 'Pseudo-code'),
        h('button.btn.btn-small', {
          type: 'button',
          disabled: !can || busy || (bug ? !!hint.lines : hint.more === false && !!hint.lines),
          onclick: () => act(() => onHint(qid, 'lines')),
        }, bug ? 'Show the fix' : hint.lines ? 'More lines' : 'First lines of a solution')));
    }
    setChildren(panel,
      h('div.view-head', {}, h('strong', {}, 'Power-ups'),
        h('button.btn.btn-ghost.btn-small', { type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))),
      rows,
      h('p.muted.small', {}, 'Uses reset every round. Hints show in the problem panel.'));
  }

  function drawButton() {
    const cfg = config();
    // Hidden for a player the host left without power-ups.
    const on = room?.status === 'playing' && usesLeft(cfg) > 0 && me()?.powerups !== false;
    button.hidden = !on;
    if (!on) {
      close();
      return;
    }
    const pw = powers();
    count.textContent = String(usesLeft(pw));
    button.classList.toggle('is-empty', usesLeft(pw) === 0);
  }

  const onOutside = (e) => {
    if (panel && !panel.contains(e.target) && !button.contains(e.target)) close();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  // The cooldown counts down while the panel is open.
  let timer = 0;

  function open() {
    panel = h('div.view-panel.power-panel', { role: 'dialog', 'aria-label': 'Power-ups' });
    document.body.append(panel);
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey);
    timer = setInterval(() => { if (cooldown() > 0) draw(); }, 1000);
    draw();
  }

  function close() {
    if (!panel) return;
    panel.remove();
    panel = null;
    picking = null;
    clearInterval(timer);
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey);
  }

  return {
    button,
    update(next) {
      room = next;
      drawButton();
      draw();
    },
    destroy: close,
  };
}
