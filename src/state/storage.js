// localStorage helpers. Every access is wrapped so the game still works when
// storage is unavailable (private mode, quota, disabled cookies). A logged-in player's
// progress is also kept on the server (src/account.js), which hears of changes here.
import { emptyProgress, isBetter } from './progress.js';

let progressChanged = () => {};
/** fn(patch): a part of the player's progress changed (see state/progress.js). */
export const onProgressChange = (fn) => { progressChanged = fn; };

function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage unavailable */ }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch { /* storage unavailable */ }
}

const DEFAULT_SETTINGS = { lang: 'py3', mode: 'code-race', difficulty: 'easy', count: 3 };
const VALID = {
  lang: ['py3', 'py4', 'python'],
  mode: ['code-race', 'bug-hunt'],
  difficulty: ['easy', 'medium', 'hard', 'mixed'],
  count: [1, 3, 5, 10],
};

/** Saved settings, with anything unknown (e.g. an old 'source3' language) replaced by the default. */
export function loadSettings() {
  const saved = read('cd.settings', {}) ?? {};
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(VALID)) {
    if (VALID[key].includes(saved[key])) out[key] = saved[key];
  }
  return out;
}
export function saveSettings(s) {
  write('cd.settings', s);
  progressChanged({ settings: s });
}

export const loadDraft = (qid, lang) => read(`cd.draft.${qid}.${lang}`);
export const saveDraft = (qid, lang, code) => write(`cd.draft.${qid}.${lang}`, code);
export const clearDraft = (qid, lang) => remove(`cd.draft.${qid}.${lang}`);

export const loadBest = (qid, lang) => read(`cd.best.${qid}.${lang}`);
/** Saves { points, timeSec, attempts, date } if it beats the stored best. Returns true if it did. */
export function saveBestIfBetter(qid, lang, entry) {
  if (!isBetter(loadBest(qid, lang), entry)) return false;
  write(`cd.best.${qid}.${lang}`, entry);
  progressChanged({ bests: { [`${qid}.${lang}`]: entry } });
  return true;
}

const SESSION_PREFIX = 'cd.sessionBest.';
const BEST_PREFIX = 'cd.best.';
const sessionKey = ({ lang, mode, difficulty, count }) => `${SESSION_PREFIX}${lang}.${mode}.${difficulty}.${count}`;
export const loadSessionBest = (config) => read(sessionKey(config));
export function saveSessionBestIfBetter(config, total) {
  const prev = loadSessionBest(config);
  if (prev !== null && prev >= total) return false;
  write(sessionKey(config), total);
  progressChanged({ sessions: { [sessionKey(config).slice(SESSION_PREFIX.length)]: total } });
  return true;
}

// The session in progress, so reloading the page resumes it.
export const loadActiveSession = () => read('cd.session');
export const saveActiveSession = (state) => write('cd.session', state);
export const clearActiveSession = () => remove('cd.session');

// Name shown to the other player in a duel.
export const loadName = () => read('cd.name', '') ?? '';
export function saveName(name) {
  write('cd.name', name);
  progressChanged({ name });
}

// View preferences (editor side, zoom, font size...). Validated in state/prefs.js.
export const loadPrefs = () => read('cd.prefs', {}) ?? {};
export function savePrefs(prefs) {
  write('cd.prefs', prefs);
  progressChanged({ prefs });
}

// ---------------------------------------------------------------- accounts

function storedKeys() {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
  }
}

/** Everything on this browser that an account keeps. */
export function localProgress() {
  const out = emptyProgress();
  out.name = loadName() || null;
  out.settings = read('cd.settings');
  out.prefs = read('cd.prefs');
  for (const key of storedKeys()) {
    if (key.startsWith(BEST_PREFIX)) out.bests[key.slice(BEST_PREFIX.length)] = read(key);
    if (key.startsWith(SESSION_PREFIX)) out.sessions[key.slice(SESSION_PREFIX.length)] = read(key);
  }
  return out;
}

/** Replaces what is on this browser with an account's progress (without reporting it back). */
export function writeProgress(p) {
  if (p.name) write('cd.name', p.name);
  if (p.settings) write('cd.settings', p.settings);
  if (p.prefs) write('cd.prefs', p.prefs);
  for (const [key, entry] of Object.entries(p.bests)) write(BEST_PREFIX + key, entry);
  for (const [key, total] of Object.entries(p.sessions)) write(SESSION_PREFIX + key, total);
}

/** Logging out: the next person on this browser does not get this player's progress. */
export function clearProgress() {
  remove('cd.name');
  remove('cd.settings');
  for (const key of storedKeys()) {
    if (key.startsWith(BEST_PREFIX) || key.startsWith(SESSION_PREFIX)) remove(key);
  }
}

// The logged-in account on this browser: { token, username }. Every tab shares it.
export const loadAccount = () => read('cd.account');
export const saveAccount = (account) => write('cd.account', account);
export const clearAccount = () => remove('cd.account');
