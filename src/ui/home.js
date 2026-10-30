// Home / setup screen and the question browser.
import { h, setChildren, segmented } from './dom.js';
import { filterQuestions, LANG_LABELS, LANG_DOCS, MODE_LABELS, DIFFICULTY_LABELS, ALL_QUESTIONS } from '../questions/index.js';
import { loadSettings, saveSettings, loadBest, loadSessionBest, loadName, saveName } from '../state/storage.js';
import { warmUp } from '../runners/runner.js';
import { viewButton } from './view-settings.js';
import { icon, brandMark, clockCase } from './icons.js';

export const COUNTS = [1, 3, 5, 10];

/**
 * renderHome(root, { onStart(config), onPractice(config, questionId),
 *   onCreateDuel(config, name), onBotDuel(config, name), onJoinDuel(code, name), roomCode? })
 * The duel callbacks resolve with { error } when they fail.
 */
export function renderHome(root, { onStart, onPractice, onCreateDuel, onBotDuel, onJoinDuel, roomCode = '' }) {
  let settings = loadSettings();
  const browser = { open: false, text: '', mode: 'all', difficulty: 'all' };
  const duel = { name: loadName(), code: roomCode, error: '', busy: false };

  function update(patch) {
    settings = { ...settings, ...patch };
    saveSettings(settings);
    if (patch.lang === 'python') warmUp('python');
    draw();
  }

  function draw() {
    const available = filterQuestions(settings);
    const n = available.length;
    const best = loadSessionBest(settings);

    setChildren(root, h('div.home', {},
      h('header.home-header', {},
        h('h1.brand', {}, brandMark(), h('span.brand-name', {}, 'Code Duel')),
        h('p.tagline', {}, 'Race the clock. Write it, or find the bug.'),
        viewButton()),

      h('div.home-grid', {},
        h('section.setup.card', { 'aria-label': 'Solo game' },
          h('h2.card-title', {}, icon('clock'), 'Play solo'),
          h('div.field', {}, h('label', {}, 'Language'),
            segmented('Language', Object.entries(LANG_LABELS), settings.lang, (lang) => update({ lang }))),
          h('div.mode-help', {}, LANG_DOCS[settings.lang]
            ? ['Source Academy ', LANG_LABELS[settings.lang], ' · ', h('a', { href: LANG_DOCS[settings.lang], target: '_blank', rel: 'noopener' }, 'language reference', icon('external'))]
            : 'Standard Python 3 (runs with Pyodide).'),
          h('div.field', {}, h('label', {}, 'Mode'),
            segmented('Mode', Object.entries(MODE_LABELS), settings.mode, (mode) => update({ mode }))),
          h('div.mode-help', {}, settings.mode === 'code-race'
            ? 'Code Race: write a function from scratch that passes every test.'
            : 'Bug Hunt: each program has exactly one bug. Find it and fix it.'),
          h('div.field', {}, h('label', {}, 'Difficulty'),
            segmented('Difficulty', Object.entries(DIFFICULTY_LABELS), settings.difficulty, (difficulty) => update({ difficulty }))),
          h('div.field', {}, h('label', {}, 'Questions'),
            segmented('Questions per session', COUNTS.map((c) => [c, String(c)]), settings.count, (count) => update({ count }))),
          h('div.start-row', {},
            h('div.available', {},
              clockCase([
                ['available', String(n), { lit: true }],
                ['best', best !== null ? String(best) : '—'],
              ]),
              n > 0 && n < settings.count ? h('span.note', {}, `The session will use all ${n}.`) : null),
            h('button.btn.btn-primary.btn-large#start', {
              disabled: n === 0,
              onclick: () => onStart({ ...settings }),
            }, 'Start', icon('chevron')))),

        drawDuel()),

      h('section.card.browser', {},
        h('button.browser-toggle', {
          type: 'button',
          'aria-expanded': String(browser.open),
          onclick: () => { browser.open = !browser.open; draw(); },
        }, icon('chevron'), 'Question browser', h('span.muted', {}, LANG_LABELS[settings.lang])),
        browser.open ? drawBrowser() : null),

      h('footer.home-footer', {},
        'Shortcuts: ', h('kbd', {}, 'Ctrl/⌘ + Enter'), ' run · ',
        h('kbd', {}, 'Ctrl/⌘ + Shift + Enter'), ' submit')));
  }

  function drawDuel() {
    const errorEl = h('p.duel-error', { role: 'alert' }, duel.error);
    const buttons = [];
    const act = async (fn) => {
      if (duel.busy) return;
      const name = duel.name.trim();
      if (!name) {
        errorEl.textContent = 'Enter your name first.';
        root.querySelector('#duel-name')?.focus();
        return;
      }
      saveName(name);
      duel.busy = true;
      duel.error = '';
      errorEl.textContent = '';
      buttons.forEach((b) => { b.disabled = true; });
      const res = await fn(name);
      duel.busy = false;
      // On success the app moves to the lobby; otherwise show why.
      if (res?.error && root.contains(errorEl)) {
        duel.error = res.error;
        errorEl.textContent = res.error;
        buttons.forEach((b) => { b.disabled = false; });
      }
    };
    const createBtn = h('button.btn.btn-primary#duel-create', {
      disabled: filterQuestions(settings).length === 0,
      onclick: () => act((name) => onCreateDuel({ ...settings }, name)),
    }, 'Create room');
    const botBtn = h('button.btn#duel-bot', {
      title: 'A room with a medium practice bot in it (you can change its level in the room)',
      onclick: () => act((name) => onBotDuel({ ...settings }, name)),
    }, icon('bot'), 'Play a bot');
    const joinBtn = h('button.btn#duel-join', {
      onclick: () => act((name) => onJoinDuel(duel.code, name)),
    }, 'Join');
    buttons.push(createBtn, botBtn, joinBtn);

    return h('section.card.duel-card', { 'aria-label': 'Play a friend' },
      h('h2.card-title', {}, icon('duel'), 'Play a friend'),
      h('p.duel-intro', {}, 'Create a room with your Play solo language, difficulty and question count, and send your friend the code. You vote on the mode and topic, play the same questions on the same clock, and chat. The loser of each round picks the next one.'),
      h('div.duel-fields', {},
        h('label', { for: 'duel-name' }, 'Your name'),
        h('input#duel-name', {
          maxlength: 20,
          placeholder: 'Name',
          value: duel.name,
          oninput: (e) => { duel.name = e.target.value; },
        }),
        h('label', { for: 'duel-code' }, 'Room code'),
        h('div.join-row', {},
          h('input#duel-code.code-input', {
            maxlength: 4,
            placeholder: 'ABCD',
            autocomplete: 'off',
            value: duel.code,
            oninput: (e) => { duel.code = e.target.value.toUpperCase(); e.target.value = duel.code; },
            onkeydown: (e) => { if (e.key === 'Enter') joinBtn.click(); },
          }),
          joinBtn)),
      h('div.duel-actions', {}, createBtn, botBtn),
      errorEl);
  }

  function drawBrowser() {
    const listEl = h('div.browser-list', {});
    const countEl = h('p.muted.small', { 'aria-live': 'polite' });

    const fill = () => {
      const text = browser.text.trim().toLowerCase();
      const list = ALL_QUESTIONS.filter((q) =>
        q.languages.includes(settings.lang) &&
        (browser.mode === 'all' || q.mode === browser.mode) &&
        (browser.difficulty === 'all' || q.difficulty === browser.difficulty) &&
        (!text || `${q.id} ${q.title} ${q.topic} ${q.functionName}`.toLowerCase().includes(text)));
      countEl.textContent = `${list.length} question${list.length === 1 ? '' : 's'} · pick one to practise it on its own`;
      setChildren(listEl, ...(list.length ? list.map((q) => {
        const best = loadBest(q.id, settings.lang);
        return h('button.browser-item', {
          type: 'button',
          onclick: () => onPractice({ ...settings, mode: q.mode, difficulty: q.difficulty, count: 1, practice: true }, q.id),
        },
          h('span.qid', {}, q.id),
          h('span.qtitle', {}, q.title),
          h('span.tag', {}, q.topic),
          h(`span.diff.diff-${q.difficulty}`, {}, DIFFICULTY_LABELS[q.difficulty]),
          h('span.best', { title: best ? 'Your best score on this question' : undefined }, best ? `Best ${best.points}` : ''));
      }) : [h('p.muted', {}, 'No questions match.')]));
    };

    const select = (value, options, onChange) => h('select', { onchange: (e) => { onChange(e.target.value); fill(); } },
      options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));

    const body = h('div.browser-body', {},
      h('div.browser-filters', {},
        h('input.search', {
          type: 'search',
          placeholder: 'Filter by id, title or topic…',
          value: browser.text,
          oninput: (e) => { browser.text = e.target.value; fill(); },
        }),
        select(browser.mode, [['all', 'All modes'], ...Object.entries(MODE_LABELS)], (v) => { browser.mode = v; }),
        select(browser.difficulty, [['all', 'All difficulties'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']],
          (v) => { browser.difficulty = v; })),
      countEl,
      listEl);
    fill();
    return body;
  }

  if (settings.lang === 'python') warmUp('python');
  draw();
  if (roomCode) root.querySelector(duel.name ? '#duel-join' : '#duel-name')?.focus();
  return () => {};
}
