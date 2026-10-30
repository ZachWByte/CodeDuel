// The View panel (editor side, zoom, font size, wrapping, autocomplete), its keyboard
// shortcuts, and the draggable divider between the problem and the editor.
import { h, setChildren, segmented, toast } from './dom.js';
import { getPrefs, setPrefs, stepPref, onPrefs, LIMITS, DEFAULT_PREFS } from '../state/prefs.js';
import { icon } from './icons.js';

let panel = null;

function stepper(label, value, onStep, { atMin, atMax, unit }) {
  return h('div.stepper', { role: 'group', 'aria-label': label },
    h('button.btn.btn-small', { type: 'button', disabled: atMin, 'aria-label': `Smaller ${label}`, onclick: () => onStep(-1) }, '−'),
    h('span.stepper-value', {}, `${value}${unit}`),
    h('button.btn.btn-small', { type: 'button', disabled: atMax, 'aria-label': `Larger ${label}`, onclick: () => onStep(1) }, '+'));
}

function drawPanel() {
  const p = getPrefs();
  const { zoom, editorFont } = LIMITS;
  setChildren(panel,
    h('div.view-head', {},
      h('strong', {}, 'View'),
      h('button.btn.btn-ghost.btn-small', { type: 'button', 'aria-label': 'Close', onclick: closePanel }, icon('close'))),
    h('div.view-row', {}, h('span', {}, 'Editor side'),
      segmented('Editor side', [['left', 'Left'], ['right', 'Right']], p.editorSide, (editorSide) => setPrefs({ editorSide }))),
    h('div.view-row', {}, h('span', {}, 'Zoom'),
      stepper('zoom', p.zoom, (d) => stepPref('zoom', d), { atMin: p.zoom <= zoom.min, atMax: p.zoom >= zoom.max, unit: '%' })),
    h('div.view-row', {}, h('span', {}, 'Editor font'),
      stepper('editor font', p.editorFont, (d) => stepPref('editorFont', d),
        { atMin: p.editorFont <= editorFont.min, atMax: p.editorFont >= editorFont.max, unit: 'px' })),
    h('div.view-row', {}, h('label', { for: 'pref-wrap' }, 'Wrap long lines'),
      h('input#pref-wrap', { type: 'checkbox', checked: p.wrap, onchange: (e) => setPrefs({ wrap: e.target.checked }) })),
    h('div.view-row', {}, h('label', { for: 'pref-complete', title: 'Suggest names as you type; Tab or Enter picks the highlighted one' }, 'Autocomplete'),
      h('input#pref-complete', { type: 'checkbox', checked: p.autocomplete, onchange: (e) => setPrefs({ autocomplete: e.target.checked }) })),
    h('div.view-row', {}, h('span', {}, 'Problem panel'),
      h('button.btn.btn-small', {
        type: 'button',
        disabled: p.problemWidth === DEFAULT_PREFS.problemWidth,
        onclick: () => setPrefs({ problemWidth: DEFAULT_PREFS.problemWidth }),
      }, 'Reset width')),
    h('p.muted.small.view-help', {}, p.autocomplete ? ['Suggestions appear as you type: ', h('kbd', {}, 'Tab'), ' or ', h('kbd', {}, 'Enter'), ' picks one, ', h('kbd', {}, 'Esc'), ' hides them. '] : null,
      'Drag the bar between the problem and the editor to resize. ',
      h('kbd', {}, 'Alt + ='), ' / ', h('kbd', {}, 'Alt + −'), ' zoom, ', h('kbd', {}, 'Alt + 0'), ' reset.'),
    h('div.view-foot', {},
      h('button.btn.btn-small', { type: 'button', onclick: () => setPrefs({ ...DEFAULT_PREFS }) }, 'Reset all')));
}

function onOutside(e) {
  if (panel && !panel.contains(e.target) && !e.target.closest?.('.btn-view')) closePanel();
}
function onEscape(e) {
  if (e.key === 'Escape') closePanel();
}

export function closePanel() {
  if (!panel) return;
  panel.remove();
  panel = null;
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onEscape);
}

function openPanel() {
  panel = h('div.view-panel', { role: 'dialog', 'aria-label': 'View settings' });
  drawPanel();
  document.body.append(panel);
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onEscape);
  panel.querySelector('.seg')?.focus();
}

/** The View button that opens and closes the panel. */
export function viewButton({ compact = false } = {}) {
  return h('button.btn.btn-ghost.btn-small.btn-view', {
    type: 'button',
    title: 'View settings: editor side, zoom, font size',
    'aria-label': compact ? 'View settings' : undefined,
    onclick: () => (panel ? closePanel() : openPanel()),
  }, icon('gear'), compact ? null : 'View');
}

/** Keeps the panel in sync and adds the Alt zoom shortcuts. Call once at boot. */
export function installViewSettings() {
  onPrefs(() => { if (panel) drawPanel(); });
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    // e.code, because Alt changes the character on macOS.
    const dir = { Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1 }[e.code];
    if (dir) stepPref('zoom', dir);
    else if (e.code === 'Digit0' || e.code === 'Numpad0') setPrefs({ zoom: DEFAULT_PREFS.zoom });
    else return;
    e.preventDefault();
    toast(`Zoom ${getPrefs().zoom}%`, 900);
  });
}

/**
 * Draggable bar between the problem and work panels of `main`.
 * Width is the problem panel's share of `main`, whichever side it is on.
 */
export function splitter(main) {
  const bar = h('div.splitter', {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': 'Resize the problem panel',
    tabindex: 0,
    title: 'Drag to resize · double-click to reset',
  });
  const widthAt = (clientX) => {
    const r = main.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    return (getPrefs().editorSide === 'left' ? 1 - x : x) * 100;
  };
  // mousedown too: in Chrome only that one stops the drag from selecting text.
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    main.classList.add('resizing');
    const move = (ev) => setPrefs({ problemWidth: widthAt(ev.clientX) }, { save: false });
    const up = () => {
      main.classList.remove('resizing');
      bar.removeEventListener('pointermove', move);
      setPrefs({}); // save once at the end
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up, { once: true });
    bar.addEventListener('pointercancel', up, { once: true });
  });
  bar.addEventListener('dblclick', () => setPrefs({ problemWidth: DEFAULT_PREFS.problemWidth }));
  bar.addEventListener('keydown', (e) => {
    const toProblem = getPrefs().editorSide === 'left' ? -1 : 1;
    const dir = { ArrowRight: toProblem, ArrowLeft: -toProblem }[e.key];
    if (!dir) return;
    e.preventDefault();
    setPrefs({ problemWidth: getPrefs().problemWidth + dir * 2 });
  });
  return bar;
}
