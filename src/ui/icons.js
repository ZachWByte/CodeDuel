// Authored line icons: 24 x 24 grid, 1.75 stroke, round caps. icon('gear') -> <span class="icon">.
import { h } from './dom.js';

const PATHS = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.4"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  play: '<path d="M7 5.5v13l11-6.5z"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01M6 12.5h.01M9 12.5h.01M12 12.5h.01M15 12.5h.01M18 12.5h.01M8 15.5h8"/>',
  bolt: '<path d="M13.5 3L5.5 13.5h6L10.5 21l8-10.5h-6z"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  eraser: '<path d="M9 20h11M4.7 14.8l9.6-9.6a2 2 0 0 1 2.8 0l2.7 2.7a2 2 0 0 1 0 2.8L12 18.5a2 2 0 0 1-1.4.5H8.9a2 2 0 0 1-1.4-.6l-2.8-2.8a1.1 1.1 0 0 1 0-1.6zM9.5 10l5.5 5.5"/>',
  bulb: '<path d="M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.75" r=".6" fill="currentColor"/>',
  user: '<circle cx="12" cy="8.5" r="3.75"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  tests: '<path d="M4 7.5l2.5 2.5L11 5.5M4 16.5l2.5 2.5 4.5-4.5M14 8h6M14 17h6"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
  skip: '<path d="M5 6l8 6-8 6zM18 6v12"/>',
  bot: '<rect x="4.5" y="8" width="15" height="11" rx="2.5"/><path d="M12 4.5V8M9.5 13v1.5M14.5 13v1.5M2.5 12.5v3M21.5 12.5v3"/>',
  duel: '<path d="M4 4l9.5 9.5M20 4l-9.5 9.5M6.5 15.5L4 18l2 2 2.5-2.5M17.5 15.5L20 18l-2 2-2.5-2.5M3 13l8 8M21 13l-8 8"/>',
  chat: '<path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5h-2.5z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 5.5l6.5 6.5L9 18.5"/>',
  dice: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><circle cx="9" cy="9" r=".9" fill="currentColor"/><circle cx="15" cy="15" r=".9" fill="currentColor"/><circle cx="15" cy="9" r=".9" fill="currentColor"/><circle cx="9" cy="15" r=".9" fill="currentColor"/>',
  trophy: '<path d="M8 4.5h8v5a4 4 0 0 1-8 0zM8 6.5H5a3 3 0 0 0 3 4M16 6.5h3a3 3 0 0 1-3 4M12 13.5v3.5M8.5 19.5h7"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  external: '<path d="M10 5H5.5v13.5H19V14M13.5 4.5h6v6M19.5 4.5l-8 8"/>',
  pencil: '<path d="M15.5 4.5l4 4L9 19H5v-4z"/>',
  bug: '<path d="M8.5 9.5a3.5 3.5 0 0 1 7 0v5a3.5 3.5 0 0 1-7 0zM12 9.5v9M8.5 12.5H4.5M15.5 12.5h4M5.5 7.5l3 2M18.5 7.5l-3 2M5.5 18l3-2M18.5 18l-3-2M10 6.5L9 4.5M14 6.5l1-2"/>',
  clock: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M10 3.5h4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  cross: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.75"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3M12 14.5v2"/>',
};

export function icon(name, label = null) {
  const svg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;
  return h('span.icon', label ? { html: svg, role: 'img', 'aria-label': label } : { html: svg });
}

/** The Code Duel mark: a 2 x 2 corner of the board. */
export const brandMark = () => h('span.brand-mark', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));

/** A clock case: faces are [label, value, { lit, className }] triples. */
export function clockCase(faces, className = '') {
  return h(`div.clock-case${className}`, {},
    faces.map(([label, value, opts = {}]) => h(`div.face${opts.lit ? '.face-lit' : ''}${opts.className ?? ''}`, {},
      h('span.label', {}, label),
      value instanceof Node ? value : h('span.numeral', {}, value),
      opts.flag ? h('span.flag', { 'aria-hidden': 'true' }) : null)));
}
