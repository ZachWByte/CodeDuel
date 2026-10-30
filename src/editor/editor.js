// CodeMirror 6 setup with a swappable language mode.
import { basicSetup } from 'codemirror';
import { EditorView, Decoration, keymap } from '@codemirror/view';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { indentUnit, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { python } from '@codemirror/lang-python';
import { getPrefs, onPrefs } from '../state/prefs.js';
import { remoteCursors } from './collab.js';

const bugLine = Decoration.line({ class: 'cm-bug-line' });

// Every language in the game (Python §3, §4 and full Python) uses Python syntax.
const languageFor = () => python();

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

/**
 * createEditor(parent, { doc, lang, onRun, onSubmit, onChange, onUpdate })
 *   -> { view, getCode, setCode, load, setLanguage, focus, destroy }
 * onUpdate(update): every editor update (team editing listens for local changes).
 * load(key, doc): show another document (one per question), keeping each one's
 * undo history and cursor; `doc` is only used the first time a key is shown.
 */
export function createEditor(parent, { doc = '', lang = 'py3', onRun, onSubmit, onChange, onUpdate } = {}) {
  const language = new Compartment();
  const wrap = new Compartment();

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

  // Font size comes from a CSS variable; wrapping needs a reconfigure.
  const offPrefs = onPrefs((p) => {
    view.dispatch({ effects: wrap.reconfigure(wrapping(p.wrap)) });
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
      view.dispatch({ effects: wrap.reconfigure(wrapping(getPrefs().wrap)) });
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
