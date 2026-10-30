// Time extension in a duel round (server/duel.js): a "+Time" button to ask for more
// minutes, and a prompt at the bottom of the screen while everyone answers. The
// prompt shows on the round and on the results screen, so players who finished
// can answer too.
import { h, setChildren, toast } from './dom.js';
import { icon } from './icons.js';
import { EXTEND_MINUTES, MAX_EXTENSIONS } from '../state/round.js';

/**
 * createExtension({ onAsk(minutes), onVote(yes) }) — the callbacks return a promise
 * of the server's reply. -> { button, update(room | null), destroy() }
 * update(room): the latest snapshot (extension.until on our clock), or null when
 * not in a room.
 */
export function createExtension({ onAsk, onVote }) {
  let room = null;
  let menu = null;
  let busy = false;
  let timer = 0;

  const button = h('button.btn.ext-toggle#btn-extend', {
    type: 'button',
    hidden: true,
    title: 'Ask everyone for more time',
    'aria-expanded': 'false',
    onclick: () => (menu ? closeMenu() : openMenu()),
  }, icon('clock'), h('span', {}, '+Time'));
  const prompt = h('div.ext-prompt', { hidden: true, role: 'alertdialog', 'aria-label': 'Time extension' });

  async function act(fn) {
    if (busy) return;
    busy = true;
    draw();
    const res = await fn();
    busy = false;
    if (res?.error) toast(res.error, 3500, 'bad');
    draw();
  }

  const me = () => room?.players.find((p) => p.id === room.youId);
  const nameOf = (id) => room?.players.find((p) => p.id === id)?.name ?? 'Someone';

  function openMenu() {
    const left = MAX_EXTENSIONS - (room?.extensions ?? 0);
    menu = h('div.ext-menu', { role: 'menu' },
      h('p.muted.small', {}, `Everyone has to agree. ${left} of ${MAX_EXTENSIONS} left this round.`),
      h('div.ext-options', {}, EXTEND_MINUTES.map((m) => h('button.btn.btn-small', {
        type: 'button',
        role: 'menuitem',
        disabled: left <= 0 || !!room?.extension,
        onclick: () => {
          closeMenu();
          act(() => onAsk(m));
        },
      }, `+${m} min`))));
    const r = button.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, r.left)}px`;
    document.body.append(menu);
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
  }

  function closeMenu() {
    menu?.remove();
    menu = null;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
  }

  const onOutside = (e) => {
    if (menu && !menu.contains(e.target) && !button.contains(e.target)) closeMenu();
  };

  function draw() {
    const ext = room?.status === 'playing' ? room.extension : null;
    const self = me();
    button.hidden = !(room?.status === 'playing' && self?.state?.status === 'playing');
    if (button.hidden) closeMenu();
    if (!ext) {
      prompt.hidden = true;
      clearInterval(timer);
      timer = 0;
      return;
    }
    const left = Math.max(0, Math.ceil((ext.until - Date.now()) / 1000));
    const waiting = ext.voters.filter((id) => !ext.votes[id]).map(nameOf);
    const mustAnswer = ext.voters.includes(room.youId) && !ext.votes[room.youId];
    const asker = ext.byId === room.youId ? 'You ask' : `${ext.byName} asks`;
    setChildren(prompt,
      icon('clock'),
      h('span.ext-text', {}, h('strong', {}, `${asker} for ${ext.minutes} more minutes.`), ' ',
        mustAnswer ? 'Everyone has to agree.' : h('span.muted', {}, waiting.length ? `Waiting for ${waiting.join(', ')}…` : 'Waiting…')),
      mustAnswer ? h('div.ext-actions', {},
        h('button.btn.btn-primary.btn-small', { type: 'button', disabled: busy, onclick: () => act(() => onVote(true)) }, 'Agree'),
        h('button.btn.btn-small', { type: 'button', disabled: busy, onclick: () => act(() => onVote(false)) }, 'No')) : null,
      h('span.numeral.ext-time', {}, `0:${String(left).padStart(2, '0')}`));
    if (!prompt.isConnected) document.body.append(prompt);
    prompt.hidden = false;
    timer ||= setInterval(draw, 1000);
  }

  return {
    button,
    update(next) {
      room = next;
      draw();
    },
    destroy() {
      room = null;
      closeMenu();
      clearInterval(timer);
      timer = 0;
      prompt.remove();
    },
  };
}
