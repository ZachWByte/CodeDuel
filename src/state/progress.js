// A player's saved progress, the same in the browser and on the server (their account,
// server/accounts.js): { name, settings, prefs, bests, sessions }.
// bests: 'questionId.lang' -> { points, timeSec, attempts, date }
// sessions: 'lang.mode.difficulty.count' -> the best total for that setup.
// Merging keeps the better score, so two devices never overwrite each other's bests.

const BEST_KEY = /^[A-Za-z0-9-]{1,30}\.[a-z0-9]{1,10}$/;
const SESSION_KEY = /^[a-z0-9-]{1,10}(\.[a-z0-9-]{1,12}){3}$/;
const MAX_ENTRIES = 5000;
const MAX_OBJECT_CHARS = 2000; // settings and prefs are small

export const emptyProgress = () => ({ name: null, settings: null, prefs: null, bests: {}, sessions: {} });

/** Does this best beat the one before it: more points, then less time. */
export const isBetter = (prev, entry) => !prev ||
  entry.points > prev.points || (entry.points === prev.points && entry.timeSec < prev.timeSec);

/** The later values win for name, settings and prefs; the better score wins for the rest. */
export function mergeProgress(base, patch) {
  const out = { ...emptyProgress(), ...base, bests: { ...base?.bests }, sessions: { ...base?.sessions } };
  for (const key of ['name', 'settings', 'prefs']) {
    if (patch?.[key] !== null && patch?.[key] !== undefined) out[key] = patch[key];
  }
  for (const [key, entry] of Object.entries(patch?.bests ?? {})) {
    if (isBetter(out.bests[key], entry)) out.bests[key] = entry;
  }
  for (const [key, total] of Object.entries(patch?.sessions ?? {})) {
    if (!(out.sessions[key] >= total)) out.sessions[key] = total;
  }
  return out;
}

const count = (n) => Number.isFinite(n) && n >= 0 && n <= 1e7;
const smallObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) && JSON.stringify(v).length <= MAX_OBJECT_CHARS ? v : null);

/** What the server keeps of a patch from a browser: anything malformed is dropped. */
export function cleanProgress(patch) {
  const out = emptyProgress();
  if (!patch || typeof patch !== 'object') return out;
  if (typeof patch.name === 'string') out.name = patch.name.replace(/\s+/g, ' ').trim().slice(0, 20) || null;
  out.settings = smallObject(patch.settings);
  out.prefs = smallObject(patch.prefs);
  for (const [key, e] of Object.entries(patch.bests ?? {}).slice(0, MAX_ENTRIES)) {
    if (!BEST_KEY.test(key) || !count(e?.points) || !count(e?.timeSec)) continue;
    out.bests[key] = { points: e.points, timeSec: e.timeSec, attempts: count(e.attempts) ? e.attempts : 0, date: String(e.date ?? '').slice(0, 30) };
  }
  for (const [key, total] of Object.entries(patch.sessions ?? {}).slice(0, MAX_ENTRIES)) {
    if (SESSION_KEY.test(key) && count(total)) out.sessions[key] = total;
  }
  return out;
}
