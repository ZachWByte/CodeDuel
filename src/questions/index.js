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

export const ALL_QUESTIONS = [
  ...codeRaceEasy, ...codeRaceMedium, ...codeRaceHard,
  ...bugHuntEasy, ...bugHuntMedium, ...bugHuntHard,
  ...codeRaceClassic, ...bugHuntClassic,
  ...codeRaceClassic2, ...bugHuntClassic2,
  ...codeRaceClassic3, ...bugHuntClassic3,
  ...codeRaceClassic4, ...bugHuntClassic4,
  ...codeRaceClassic5, ...bugHuntClassic5,
];

const byId = new Map(ALL_QUESTIONS.map((q) => [q.id, q]));
export const getQuestion = (id) => byId.get(id);

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
