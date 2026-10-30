// The on-screen keyboard for the Mouse keys power-up: while an opponent has taken
// your keyboard, you type in the editor by clicking these keys. They never take the
// focus from the editor, so the cursor stays where it was.
import { h, setChildren } from './dom.js';
import { icon } from './icons.js';

// Each key: [normal, with Shift] or a special { key, label, wide }.
const ROWS = [
  [['`', '~'], ['1', '!'], ['2', '@'], ['3', '#'], ['4', '$'], ['5', '%'], ['6', '^'], ['7', '&'], ['8', '*'], ['9', '('], ['0', ')'], ['-', '_'], ['=', '+'], { key: 'Backspace', label: '⌫', wide: 2 }],
  [{ key: 'Tab', label: 'Tab', wide: 1.5 }, ...'qwertyuiop'.split('').map((c) => [c, c.toUpperCase()]), ['[', '{'], [']', '}'], ['\\', '|']],
  [{ key: 'Caps', label: 'Caps', wide: 1.75 }, ...'asdfghjkl'.split('').map((c) => [c, c.toUpperCase()]), [';', ':'], ["'", '"'], { key: 'Enter', label: 'Enter ↵', wide: 2 }],
  [{ key: 'Shift', label: 'Shift ⇧', wide: 2.25 }, ...'zxcvbnm'.split('').map((c) => [c, c.toUpperCase()]), [',', '<'], ['.', '>'], ['/', '?'], { key: 'ArrowUp', label: '↑' }],
  [{ key: ' ', label: 'Space', wide: 9 }, { key: 'ArrowLeft', label: '←' }, { key: 'ArrowDown', label: '↓' }, { key: 'ArrowRight', label: '→' }],
];

/** createScreenKeyboard({ onKey(key) }) -> { el, setTitle(text), setTime(text), nudge() } */
export function createScreenKeyboard({ onKey }) {
  let shift = false; // for one key
  let caps = false;
  const title = h('span.sk-title', {});
  const time = h('span.numeral.sk-time', {});
  const keys = h('div.sk-keys', {});
  const el = h('div.screen-keys', { role: 'group', 'aria-label': 'On-screen keyboard' },
    h('div.sk-head', {}, icon('keyboard'), title, h('span.muted.small', {}, 'Click the keys to type'), time),
    keys);

  // Pressing a key must not move the focus out of the editor.
  el.addEventListener('mousedown', (e) => e.preventDefault());

  function press(spec) {
    if (!Array.isArray(spec)) {
      if (spec.key === 'Shift') shift = !shift;
      else if (spec.key === 'Caps') caps = !caps;
      else onKey(spec.key);
      draw();
      return;
    }
    const [normal, shifted] = spec;
    const letter = /^[a-z]$/.test(normal);
    const upper = letter ? shift !== caps : shift;
    onKey(upper ? shifted : normal);
    if (shift) {
      shift = false;
      draw();
    }
  }

  function draw() {
    setChildren(keys, ROWS.map((row) => h('div.sk-row', {}, row.map((spec) => {
      if (!Array.isArray(spec)) {
        const on = (spec.key === 'Shift' && shift) || (spec.key === 'Caps' && caps);
        return h(`button.sk-key.sk-special${on ? '.on' : ''}`, {
          type: 'button', tabindex: -1, style: `flex-grow: ${spec.wide ?? 1}`, 'aria-pressed': spec.key === 'Shift' || spec.key === 'Caps' ? String(on) : undefined,
          onclick: () => press(spec),
        }, spec.label);
      }
      const [normal, shifted] = spec;
      const letter = /^[a-z]$/.test(normal);
      const label = letter ? (shift !== caps ? shifted : normal) : (shift ? shifted : normal);
      return h('button.sk-key', { type: 'button', tabindex: -1, onclick: () => press(spec) }, label);
    }))));
  }
  draw();

  return {
    el,
    setTitle(text) { title.textContent = text; },
    setTime(text) { time.textContent = text; },
    /** The physical keyboard was used: shake, so it is clear why nothing happened. */
    nudge() {
      el.classList.remove('nudge');
      void el.offsetWidth;
      el.classList.add('nudge');
    },
  };
}
