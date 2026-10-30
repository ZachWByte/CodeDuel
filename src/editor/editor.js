// CodeMirror 6 setup with a swappable language mode.
import { basicSetup } from 'codemirror';
import { EditorView, Decoration, keymap } from '@codemirror/view';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { indentWithTab, insertNewlineAndIndent, deleteCharBackward, indentMore, cursorCharLeft, cursorCharRight, cursorLineUp, cursorLineDown } from '@codemirror/commands';
import { indentUnit, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { python, pythonLanguage } from '@codemirror/lang-python';
import { autocompletion, acceptCompletion, completeFromList, ifNotIn } from '@codemirror/autocomplete';
import { getPrefs, onPrefs } from '../state/prefs.js';
import { remoteCursors } from './collab.js';

const bugLine = Decoration.line({ class: 'cm-bug-line' });

// Source Academy built-ins (py-slang), suggested in Python §3 / §4 besides the
// names in the code. Full Python gets Python's own built-ins from python().
const SA_FUNCTIONS = [
  'pair', 'head', 'tail', 'is_pair', 'is_none', 'set_head', 'set_tail',
  'llist', 'is_llist', 'length', 'map', 'filter', 'reduce', 'append', 'reverse', 'member', 'remove', 'remove_all',
  'enum_llist', 'build_llist', 'for_each', 'llist_ref', 'llist_to_string', 'print_llist',
  'stream', 'stream_tail', 'is_stream', 'stream_map', 'stream_filter', 'stream_ref', 'stream_append', 'stream_length',
  'stream_member', 'stream_remove', 'stream_remove_all', 'stream_reverse', 'stream_for_each', 'stream_to_llist',
  'llist_to_stream', 'build_stream', 'enum_stream', 'eval_stream', 'integers_from',
  'print', 'error', 'len', 'str', 'repr', 'abs', 'max', 'min', 'round', 'arity',
  'is_number', 'is_integer', 'is_float', 'is_string', 'is_boolean', 'is_function', 'is_list',
  'math_sqrt', 'math_floor', 'math_ceil', 'math_pow', 'math_log', 'math_log2', 'math_log10', 'math_exp',
  'math_fabs', 'math_trunc', 'math_isqrt', 'math_gcd', 'math_lcm', 'math_factorial', 'math_comb', 'math_perm',
  'math_sin', 'math_cos', 'math_tan', 'math_atan2', 'math_fmod', 'math_isnan', 'math_isinf', 'random_random',
];
const SA_EXTRA = { py4: ['parse', 'tokenize'] };
const builtinsFor = (lang) => pythonLanguage.data.of({
  autocomplete: ifNotIn(['String', 'FormatString', 'Comment'], completeFromList(
    [...SA_FUNCTIONS, ...(SA_EXTRA[lang] ?? [])].map((label) => ({ label, type: 'function', boost: -1 })))),
});

// Every language in the game (Python §3, §4 and full Python) uses Python syntax.
const languageFor = (lang) => (lang === 'python' ? python() : [python(), builtinsFor(lang)]);

// On: suggestions as you type, and Tab takes the highlighted one (it indents when
// none is open). Off: they only open on Ctrl + Space, and Tab always indents.
const completing = (on) => (on
  ? Prec.high(keymap.of([{ key: 'Tab', run: acceptCompletion }]))
  : autocompletion({ activateOnTyping: false }));

const wrapping = (on) => (on ? EditorView.lineWrapping : []);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font, 14px)', color: 'var(--code-ink)', backgroundColor: 'var(--code-bg)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--buff)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--buff)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--code-select)' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: 'var(--code-gutter)', border: 'none', paddingLeft: '6px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--g8)' },
  '.cm-activeLine': { backgroundColor: 'var(--code-line)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--code-select)', outline: '1px solid var(--g6)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--g4)', border: 'none', color: 'var(--g8)' },
  '.cm-tooltip': { backgroundColor: 'var(--g3)', border: '1px solid var(--g5)', color: 'var(--ink)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--buff)', color: 'var(--g1)' },
  '.cm-panels': { backgroundColor: 'var(--g2)', color: 'var(--ink)' },
  '.cm-searchMatch': { backgroundColor: 'rgba(217, 164, 65, 0.25)' },
}, { dark: true });

// Board-green syntax: buff names, brass keywords, mint strings, clay numbers.
const highlight = syntaxHighlighting(HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.operatorKeyword, t.moduleKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.function(t.variableName), t.function(t.definition(t.variableName))], color: 'var(--syn-fn)' },
  { tag: [t.definition(t.variableName)], color: 'var(--code-ink)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--syn-punct)' },
  { tag: [t.className, t.typeName], color: 'var(--syn-fn)' },
  { tag: [t.propertyName], color: 'var(--code-ink)' },
  { tag: [t.self], color: 'var(--syn-keyword)' },
]));

// Keys the on-screen keyboard can press besides characters (Mouse keys power-up).
const KEY_COMMANDS = {
  Enter: insertNewlineAndIndent,
  Backspace: deleteCharBackward,
  Tab: indentMore,
  ArrowLeft: cursorCharLeft,
  ArrowRight: cursorCharRight,
  ArrowUp: cursorLineUp,
  ArrowDown: cursorLineDown,
};
// Edits that come from the keyboard (or the clipboard), as CodeMirror labels them.
const KEYBOARD_EVENTS = ['input', 'delete', 'undo', 'redo', 'move.drop'];

/**
 * createEditor(parent, { doc, lang, onRun, onSubmit, onChange, onUpdate })
 *   -> { view, getCode, setCode, load, replace, setLocked, setKeyboardLock, pressKey, setLanguage, focus, destroy }
 * onUpdate(update): every editor update (team editing listens for local changes).
 * load(key, doc): show another document (one per question), keeping each one's
 * undo history and cursor; `doc` is only used the first time a key is shown.
 */
export function createEditor(parent, { doc = '', lang = 'py3', onRun, onSubmit, onChange, onUpdate } = {}) {
  const language = new Compartment();
  const wrap = new Compartment();
  const complete = new Compartment();
  const lock = new Compartment();
  const locking = (on) => (on ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []);
  let locked = false;

  // Mouse keys: edits from the keyboard are dropped; only pressKey (the on-screen
  // keyboard) may type. Moving the cursor, and teammates' edits, still work.
  const keyLock = new Compartment();
  let keyboardLocked = false;
  let onScreen = false; // pressKey is typing
  let onBlocked = null;
  const keyLocking = (on) => (on ? EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || onScreen || !KEYBOARD_EVENTS.some((e) => tr.isUserEvent(e))) return tr;
    queueMicrotask(() => onBlocked?.());
    return [];
  }) : []);

  const shortcuts = Prec.highest(keymap.of([
    { key: 'Mod-Enter', run: () => { onRun?.(); return true; } },
    { key: 'Mod-Shift-Enter', run: () => { onSubmit?.(); return true; } },
  ]));

  const extensions = [
    shortcuts,
    basicSetup,
    keymap.of([indentWithTab]),
    indentUnit.of('    '),
    EditorState.tabSize.of(4),
    language.of(languageFor(lang)),
    wrap.of(wrapping(getPrefs().wrap)),
    complete.of(completing(getPrefs().autocomplete)),
    lock.of(locking(false)),
    keyLock.of(keyLocking(false)),
    theme,
    highlight,
    remoteCursors,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange?.();
      onUpdate?.(u);
    }),
  ];
  const makeState = (text) => EditorState.create({ doc: text, extensions });
  const view = new EditorView({ parent, state: makeState(doc) });
  const states = new Map(); // key -> EditorState of documents not on screen
  let key = null;

  // Font size comes from a CSS variable; wrapping and autocomplete need a reconfigure.
  const prefEffects = (p) => [wrap.reconfigure(wrapping(p.wrap)), complete.reconfigure(completing(p.autocomplete)),
    lock.reconfigure(locking(locked)), keyLock.reconfigure(keyLocking(keyboardLocked))];
  const offPrefs = onPrefs((p) => {
    view.dispatch({ effects: prefEffects(p) });
    view.requestMeasure();
  });

  return {
    view,
    getCode: () => view.state.doc.toString(),
    setCode(code) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
    },
    load(next, text, { fresh = false } = {}) {
      if (key !== null) states.set(key, view.state);
      key = next;
      view.setState((!fresh && states.get(next)) || makeState(text));
      view.dispatch({ effects: prefEffects(getPrefs()) });
    },
    /** Replaces a document's text with no undo back to what it was (a wipe). */
    replace(k, text) {
      if (k !== key) {
        states.set(k, makeState(text));
        return;
      }
      view.setState(makeState(text));
      view.dispatch({ effects: prefEffects(getPrefs()) });
    },
    /** Locked: nobody can type (the document still takes changes from the code). */
    setLocked(on) {
      locked = on;
      view.dispatch({ effects: lock.reconfigure(locking(on)) });
      if (on) view.contentDOM.blur();
    },
    /** Mouse keys: the keyboard cannot edit; onBlockedKey() runs when it tries. */
    setKeyboardLock(on, onBlockedKey = null) {
      keyboardLocked = on;
      onBlocked = onBlockedKey;
      view.dispatch({ effects: keyLock.reconfigure(keyLocking(on)) });
    },
    /** Presses a key of the on-screen keyboard: a character, or a KEY_COMMANDS name. */
    pressKey(key) {
      if (locked) return;
      onScreen = true;
      try {
        const command = KEY_COMMANDS[key];
        if (command) command(view);
        else view.dispatch({ ...view.state.replaceSelection(key), scrollIntoView: true, userEvent: 'input.type' });
      } finally {
        onScreen = false;
      }
      if (!view.hasFocus) view.focus();
    },
    /** The code of a document, on screen or not (undefined if it was never shown). */
    codeOf: (k) => (k === key ? view.state.doc.toString() : states.get(k)?.doc.toString()),
    setLanguage(lang) {
      view.dispatch({ effects: language.reconfigure(languageFor(lang)) });
    },
    focus: () => view.focus(),
    destroy: () => {
      offPrefs();
      view.destroy();
    },
  };
}

/** Read-only, syntax-highlighted code block (solutions, original buggy code). */
export function createViewer(parent, { doc, lang, highlightLines = [] }) {
  const lines = new Set(highlightLines);
  const bugLines = EditorView.decorations.of((view) => {
    const builder = [];
    for (const n of lines) {
      if (n >= 1 && n <= view.state.doc.lines) {
        builder.push(bugLine.range(view.state.doc.line(n).from));
      }
    }
    return Decoration.set(builder, true);
  });
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        languageFor(lang),
        wrapping(getPrefs().wrap),
        theme,
        highlight,
        bugLines,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ],
    }),
  });
}
