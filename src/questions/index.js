import codeRaceEasy from './code-race-easy.js';
import codeRaceMedium from './code-race-medium.js';
import codeRaceHard from './code-race-hard.js';
import bugHuntEasy from './bug-hunt-easy.js';
import bugHuntMedium from './bug-hunt-medium.js';
import bugHuntHard from './bug-hunt-hard.js';
import codeRaceClassic from './code-race-classic.js';
import bugHuntClassic from './bug-hunt-classic.js';
import codeRaceClassic2 from './code-race-classic-2.js';
import bugHuntClassic2 from './bug-hunt-classic-2.js';
import codeRaceClassic3 from './code-race-classic-3.js';
import bugHuntClassic3 from './bug-hunt-classic-3.js';
import codeRaceClassic4 from './code-race-classic-4.js';
import bugHuntClassic4 from './bug-hunt-classic-4.js';
import codeRaceClassic5 from './code-race-classic-5.js';
import bugHuntClassic5 from './bug-hunt-classic-5.js';
import codeRaceClassic6 from './code-race-classic-6.js';
import bugHuntClassic6 from './bug-hunt-classic-6.js';
import codeRaceClassic7 from './code-race-classic-7.js';
import bugHuntClassic7 from './bug-hunt-classic-7.js';
import codeRaceClassic8 from './code-race-classic-8.js';
import bugHuntClassic8 from './bug-hunt-classic-8.js';
import codeRaceClassic9 from './code-race-classic-9.js';
import bugHuntClassic9 from './bug-hunt-classic-9.js';
import codeRaceClassic10 from './code-race-classic-10.js';
import bugHuntClassic10 from './bug-hunt-classic-10.js';
import codeRaceClassic11 from './code-race-classic-11.js';
import bugHuntClassic11 from './bug-hunt-classic-11.js';

export const ALL_QUESTIONS = [
  ...codeRaceEasy, ...codeRaceMedium, ...codeRaceHard,
  ...bugHuntEasy, ...bugHuntMedium, ...bugHuntHard,
  ...codeRaceClassic, ...bugHuntClassic,
  ...codeRaceClassic2, ...bugHuntClassic2,
  ...codeRaceClassic3, ...bugHuntClassic3,
  ...codeRaceClassic4, ...bugHuntClassic4,
  ...codeRaceClassic5, ...bugHuntClassic5,
  ...codeRaceClassic6, ...bugHuntClassic6,
  ...codeRaceClassic7, ...bugHuntClassic7,
  ...codeRaceClassic8, ...bugHuntClassic8,
  ...codeRaceClassic9, ...bugHuntClassic9,
  ...codeRaceClassic10, ...bugHuntClassic10,
  ...codeRaceClassic11, ...bugHuntClassic11,
];

const byId = new Map(ALL_QUESTIONS.map((q) => [q.id, q]));
export const getQuestion = (id) => byId.get(id);

/**
 * A fingerprint of the bank (ids, tests, solutions). A duel needs the browser and
 * the server to agree on every question, so a page loaded before an update (or
 * a dev server that was not restarted) is told to reload instead of having its
 * solves rejected.
 */
export const BANK_VERSION = (() => {
  let h = 2166136261;
  const add = (s) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  };
  for (const q of ALL_QUESTIONS) add(JSON.stringify([q.id, q.languages, q.tests, q.solution, q.buggy, q.starter, q.banned]));
  return (h >>> 0).toString(36);
})();

/** Broad groups of topics, for picking a duel round's theme. */
export const CATEGORIES = {
  basics: { label: 'Recursion & loops', topics: ['recursion', 'loops', 'conditionals', 'math'] },
  lists: { label: 'Lists & arrays', topics: ['lists', 'arrays', 'mutation', 'higher-order', 'two pointers', 'prefix sums'] },
  sorting: { label: 'Sorting & searching', topics: ['sorting', 'searching'] },
  dp: { label: 'DP & memoisation', topics: ['dynamic programming', 'memoisation'] },
  structures: { label: 'Trees, stacks & streams', topics: ['trees', 'stacks', 'streams', 'parse', 'state'] },
  puzzles: { label: 'Backtracking & greedy', topics: ['backtracking', 'greedy'] },
};
const categoryOfTopic = new Map(Object.entries(CATEGORIES).flatMap(([key, c]) => c.topics.map((t) => [t, key])));
export const categoryOf = (q) => categoryOfTopic.get(q.topic);

/** difficulty may be 'mixed'; category is optional (a CATEGORIES key). */
export function filterQuestions({ lang, mode, difficulty, category }) {
  return ALL_QUESTIONS.filter((q) =>
    (!lang || q.languages.includes(lang)) &&
    (!mode || q.mode === mode) &&
    (!difficulty || difficulty === 'mixed' || q.difficulty === difficulty) &&
    (!category || categoryOf(q) === category));
}

export const LANG_LABELS = { py3: 'Python §3', py4: 'Python §4', python: 'Python (full)' };

/** Source Academy reference pages for the Python § chapters. */
export const LANG_DOCS = {
  py3: 'https://docs.sourceacademy.org/python/python_3/',
  py4: 'https://docs.sourceacademy.org/python/python_4/',
};
export const MODE_LABELS = { 'code-race': 'Code Race', 'bug-hunt': 'Bug Hunt' };
export const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard', mixed: 'Mixed' };
