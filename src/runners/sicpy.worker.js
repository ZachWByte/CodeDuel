// Source Academy Python §3 / §4 runner, backed by py-slang. One long-lived
// instance per page; every run / test is evaluated from scratch.
import { chapterOf, runSicpy, runSicpyTest } from './sicpy-core.js';

self.onmessage = async ({ data }) => {
  const { id, kind, lang, code } = data;
  const chapter = chapterOf(lang);
  try {
    if (kind === 'run') {
      self.postMessage({ id, done: true, result: await runSicpy(chapter, code) });
    } else if (kind === 'tests') {
      for (const t of data.tests) {
        self.postMessage({ id, start: t.index });
        const r = await runSicpyTest(chapter, code, t);
        self.postMessage({ id, progress: { index: t.index, ...r } });
      }
      self.postMessage({ id, done: true });
    }
  } catch (e) {
    self.postMessage({ id, done: true, fatal: String(e?.message ?? e) });
  }
};

self.postMessage({ ready: true });
