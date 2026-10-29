// localStorage helpers. Every access is wrapped so the game still works when
// storage is unavailable (private mode, quota, disabled cookies).

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
export const saveSettings = (s) => write('cd.settings', s);

export const loadDraft = (qid, lang) => read(`cd.draft.${qid}.${lang}`);
export const saveDraft = (qid, lang, code) => write(`cd.draft.${qid}.${lang}`, code);
export const clearDraft = (qid, lang) => remove(`cd.draft.${qid}.${lang}`);

export const loadBest = (qid, lang) => read(`cd.best.${qid}.${lang}`);
/** Saves { points, timeSec, attempts, date } if it beats the stored best. Returns true if it did. */
export function saveBestIfBetter(qid, lang, entry) {
  const prev = loadBest(qid, lang);
  if (prev && (prev.points > entry.points || (prev.points === entry.points && prev.timeSec <= entry.timeSec))) {
    return false;
  }
  write(`cd.best.${qid}.${lang}`, entry);
  return true;
}

const sessionKey = ({ lang, mode, difficulty, count }) => `cd.sessionBest.${lang}.${mode}.${difficulty}.${count}`;
export const loadSessionBest = (config) => read(sessionKey(config));
export function saveSessionBestIfBetter(config, total) {
  const prev = loadSessionBest(config);
  if (prev !== null && prev >= total) return false;
  write(sessionKey(config), total);
  return true;
}

// The session in progress, so reloading the page resumes it.
export const loadActiveSession = () => read('cd.session');
export const saveActiveSession = (state) => write('cd.session', state);
export const clearActiveSession = () => remove('cd.session');

// Name shown to the other player in a duel.
export const loadName = () => read('cd.name', '') ?? '';
export const saveName = (name) => write('cd.name', name);

// View preferences (editor side, zoom, font size...). Validated in state/prefs.js.
export const loadPrefs = () => read('cd.prefs', {}) ?? {};
export const savePrefs = (prefs) => write('cd.prefs', prefs);
