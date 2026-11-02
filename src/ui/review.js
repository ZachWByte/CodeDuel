// Looking back at a duel round's questions once your round is over: a tab per
// question with its statement, every side's final code and result, and the
// reference solution. Lives on the results screen; it reloads from the server
// (duel:review) when someone's result changes, so it fills in as others finish.
import { h, setChildren } from './dom.js';
import { icon } from './icons.js';
import { createViewer } from '../editor/editor.js';
import { getQuestion } from '../questions/index.js';
import { LANG_FAMILY, startingCode } from '../judge/resolve.js';
import { problemView } from './play-parts.js';

/** What would change the answers: anyone's question results, and the round's status. */
function fingerprint(room) {
  const sides = room.players.filter((p) => p.state).map((p) => `${p.side}:${p.state.status}:${p.state.qs.map((q) => q.status[0]).join('')}`);
  return `${room.round}|${room.status}|${[...new Set(sides)].sort().join(',')}`;
}

/**
 * A question's reference solution (and, in Bug Hunt, the bug). view(code, lang, lines?)
 * makes a code viewer and returns its element.
 */
export function solutionView(q, lang, view) {
  const fam = LANG_FAMILY[lang];
  return [
    q.mode === 'bug-hunt' ? h('p.bug-explanation', {}, h('strong', {}, 'The bug: '), q.bugExplanation) : null,
    q.mode === 'bug-hunt' ? [h('p.muted.small', {}, 'Original code, bug highlighted:'), view(startingCode(q, lang), lang, q.bugLines?.[fam] ?? [])] : null,
    view(q.solution[fam], lang),
  ];
}

/** createReview({ load() -> Promise<{ questions } | { error }> }) -> { el, update(room), destroy() } */
export function createReview({ load }) {
  const el = h('section.review', { 'aria-label': 'Review the questions' });
  let room = null;
  let data = null; // { questions: [{ id, answers }] }
  let index = 0;
  let loadedFor = null;
  let loading = false;
  let viewers = [];
  let retry = 0; // timer: the server had not seen us finish yet

  const clearViewers = () => {
    viewers.forEach((v) => v.destroy());
    viewers = [];
  };

  async function reload() {
    if (loading) return;
    loading = true;
    const key = fingerprint(room);
    const res = await load();
    loading = false;
    if (res?.error) {
      // We show the results as soon as we finish, a moment before the server has
      // seen it: ask again shortly.
      clearTimeout(retry);
      if (room) retry = setTimeout(reload, 1500);
      return;
    }
    data = res;
    loadedFor = key;
    draw();
    // Results changed while we were loading: load again.
    if (room && fingerprint(room) !== loadedFor) reload();
  }

  function viewer(code, lang, highlightLines) {
    const host = h('div.viewer.review-code', {});
    queueMicrotask(() => viewers.push(createViewer(host, { doc: code, lang, highlightLines })));
    return host;
  }

  function answerCard(a, lang) {
    const state = a.status === 'solved' ? h('span.review-state.ok', {}, icon('check'), `solved +${a.points}`)
      : a.playing ? h('span.review-state.live', {}, 'still playing')
        : a.points ? h('span.review-state.partial', {}, `not solved · ${a.points} from secret tests`)
          : h('span.review-state.bad', {}, icon('cross'), 'not solved');
    return h(`article.review-answer${a.you ? '.you' : ''}${a.team ? `.lb-${a.team}` : ''}`, {},
      h('header.review-head', {},
        a.bot ? icon('bot', 'Bot') : null,
        h('strong', {}, a.name), a.you ? h('span.muted', {}, '(you)') : null,
        state),
      a.code !== null ? viewer(a.code, lang) : h('p.muted.review-empty', {}, 'No code for this question.'));
  }

  function draw() {
    clearViewers();
    if (!data || !room) {
      setChildren(el, h('h3.section-title', {}, 'Review the questions'), h('p.muted', {}, 'Loading…'));
      return;
    }
    const lang = room.config.lang;
    index = Math.min(index, data.questions.length - 1);
    const item = data.questions[index];
    const q = getQuestion(item.id);

    setChildren(el,
      h('div.review-top', {}, h('h3.section-title', {}, 'Review the questions')),
      h('div.review-tabs', { role: 'tablist' }, data.questions.map((x, i) => {
        const you = x.answers.find((a) => a.you);
        return h(`button.review-tab${i === index ? '.active' : ''}`, {
          type: 'button',
          role: 'tab',
          'aria-selected': String(i === index),
          onclick: () => { index = i; draw(); },
        }, h('span.n', {}, `Q${i + 1}`), getQuestion(x.id)?.title, you?.status === 'solved' ? icon('check') : null);
      })),
      h('div.review-body', {},
        h('div.review-problem', {}, ...problemView(q, lang)),
        h('div.review-answers', {},
          h('h4.review-label', {}, `Answers · ${item.answers.filter((a) => a.status === 'solved').length} of ${item.answers.length} solved`),
          // Yours first, then the others.
          [...item.answers].sort((a, b) => Number(b.you) - Number(a.you)).map((a) => answerCard(a, lang)),
          h('article.review-answer.review-reference', {},
            h('header.review-head', {}, icon('eye'), h('strong', {}, 'Solution')),
            solutionView(q, lang, viewer)))));
  }

  return {
    el,
    update(next) {
      room = next;
      if (!data) draw();
      if (!loading && fingerprint(room) !== loadedFor) reload();
    },
    destroy() {
      clearTimeout(retry);
      clearViewers();
      room = null;
    },
  };
}
