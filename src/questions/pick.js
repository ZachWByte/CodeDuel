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

// A level per question slot in a duel room (difficulty 'custom'); 'mixed' = any level.
export const SLOT_LEVELS = ['easy', 'medium', 'hard', 'mixed'];

/**
 * One question per slot, in slot order: { lang, mode, category, levels }. Each slot
 * takes a question of its level from the topic, else from the mode's other topics,
 * else of any level, never the same question twice.
 */
export function pickSlots({ lang, mode, category, levels }) {
  const picked = [];
  for (const level of levels) {
    const tries = [{ category, difficulty: level }, { difficulty: level }, { category, difficulty: 'mixed' }, { difficulty: 'mixed' }];
    for (const t of tries) {
      const pool = shuffle(filterQuestions({ lang, mode, ...t }).filter((q) => !picked.includes(q)));
      if (pool.length) {
        picked.push(pool[0]);
        break;
      }
    }
  }
  return picked;
}

/** config: { lang, mode, difficulty, count } -> questions in play order */
export function pickQuestions(config) {
  const picked = shuffle(filterQuestions(config)).slice(0, config.count);
  if (config.difficulty === 'mixed') picked.sort((a, b) => ORDER[a.difficulty] - ORDER[b.difficulty]);
  return picked;
}
