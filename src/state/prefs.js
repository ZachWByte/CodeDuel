// View preferences. They apply through CSS variables on <html>, so every screen
// picks them up; the editor also listens for line wrapping and autocomplete.
import { loadPrefs, savePrefs } from './storage.js';

export const LIMITS = {
  zoom: { min: 70, max: 160, step: 10 }, // % of normal size, whole app
  editorFont: { min: 11, max: 24, step: 1 }, // px
  problemWidth: { min: 24, max: 62 }, // % of the game area
};
export const DEFAULT_PREFS = { editorSide: 'right', zoom: 100, editorFont: 14, wrap: false, autocomplete: true, problemWidth: 38 };

const clamp = (v, { min, max }, fallback) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

function clean(p) {
  return {
    editorSide: p.editorSide === 'left' ? 'left' : 'right',
    zoom: Math.round(clamp(p.zoom, LIMITS.zoom, DEFAULT_PREFS.zoom)),
    editorFont: Math.round(clamp(p.editorFont, LIMITS.editorFont, DEFAULT_PREFS.editorFont)),
    wrap: p.wrap === true,
    autocomplete: p.autocomplete !== false,
    problemWidth: Math.round(clamp(p.problemWidth, LIMITS.problemWidth, DEFAULT_PREFS.problemWidth) * 10) / 10,
  };
}

let prefs = clean({ ...DEFAULT_PREFS, ...loadPrefs() });
const listeners = new Set();

export const getPrefs = () => prefs;

export function applyPrefs() {
  const root = document.documentElement;
  root.style.setProperty('--ui-zoom', String(prefs.zoom / 100));
  root.style.setProperty('--editor-font', `${prefs.editorFont}px`);
  root.style.setProperty('--problem-width', `${prefs.problemWidth}%`);
  root.dataset.editorSide = prefs.editorSide;
}

/** setPrefs(patch, { save = true }) — save: false while dragging the divider. */
export function setPrefs(patch, { save = true } = {}) {
  const next = clean({ ...prefs, ...patch });
  const changed = Object.keys(next).some((k) => next[k] !== prefs[k]);
  prefs = next;
  if (save) savePrefs(prefs);
  if (!changed) return;
  applyPrefs();
  listeners.forEach((fn) => fn(prefs));
}

/** Steps zoom or editorFont by +1 / -1 steps. */
export function stepPref(key, dir) {
  setPrefs({ [key]: prefs[key] + dir * LIMITS[key].step });
}

export function onPrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
