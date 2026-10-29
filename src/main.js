// Boots the app and switches between the home, game and results screens.
import './styles.css';
import { renderHome } from './ui/home.js';
import { renderGame } from './ui/game.js';
import { renderResults } from './ui/results.js';
import { getQuestion, LANG_LABELS } from './questions/index.js';
import { pickQuestions } from './questions/pick.js';
import { createSession, reduce } from './state/engine.js';
import { loadActiveSession, saveActiveSession, clearActiveSession } from './state/storage.js';
import { warmUp } from './runners/runner.js';
import { createDuel } from './duel.js';
import { applyPrefs } from './state/prefs.js';
import { installViewSettings } from './ui/view-settings.js';

applyPrefs();
installViewSettings();

const root = document.getElementById('app');
let cleanup = () => {};

function mount(render) {
  cleanup();
  window.scrollTo(0, 0);
  cleanup = render() ?? (() => {});
}

/** A tiny store around the pure engine. The UI only sends actions. */
function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    getState: () => state,
    dispatch(action) {
      const prev = state;
      state = reduce(state, action);
      if (state === prev) return;
      saveActiveSession(state);
      listeners.forEach((fn) => fn(state, prev));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function startSession(config, questionIds) {
  const questions = questionIds ? questionIds.map(getQuestion) : pickQuestions(config);
  if (questions.length === 0) return;
  const state = createSession({ config, questions, now: Date.now() });
  saveActiveSession(state);
  showGame(state, false);
}

function showGame(state, resumed) {
  warmUp(state.config.lang);
  const store = createStore(state);
  mount(() => renderGame(root, {
    store,
    resumed,
    onFinished: (finished) => {
      clearActiveSession();
      showResults(finished);
    },
    onQuit: () => {
      clearActiveSession();
      showHome();
    },
  }));
}

function showResults(state) {
  mount(() => renderResults(root, {
    state,
    onPlayAgain: () => {
      const ids = state.config.practice ? state.questions.map((q) => q.id) : null;
      startSession(state.config, ids);
    },
    onHome: showHome,
  }));
}

function showHome() {
  const roomCode = (new URLSearchParams(location.search).get('room') ?? '').toUpperCase().slice(0, 4);
  mount(() => renderHome(root, {
    onStart: (config) => startSession(config),
    onPractice: (config, id) => startSession(config, [id]),
    onCreateDuel: (config, name) => duel.create(config, name),
    onBotDuel: (config, name) => duel.createWithBot(config, name),
    onJoinDuel: (code, name) => duel.join(code, name),
    roomCode,
  }));
}

const duel = createDuel({ root, mount, showHome });

// Resume a duel or a session that was in progress when the page was reloaded.
const saved = loadActiveSession();
const valid = saved?.status === 'playing' && saved.config?.lang in LANG_LABELS &&
  saved.questions?.every((q) => getQuestion(q.id)?.languages.includes(saved.config.lang));
if (duel.wasInDuel()) duel.resume();
else if (valid) showGame(saved, true);
else {
  clearActiveSession();
  showHome();
}
// Python § is needed by most sessions; start loading py-slang straight away.
warmUp('py3');
