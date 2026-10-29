// Picks a session's questions. Shared by single player and the duel server.
import { filterQuestions } from './index.js';

const ORDER = { easy: 0, medium: 1, hard: 2 };

function shuffle(xs) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** config: { lang, mode, difficulty, count } -> questions in play order */
export function pickQuestions(config) {
  const picked = shuffle(filterQuestions(config)).slice(0, config.count);
  if (config.difficulty === 'mixed') picked.sort((a, b) => ORDER[a.difficulty] - ORDER[b.difficulty]);
  return picked;
}
