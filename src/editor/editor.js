// CodeMirror 6 setup with a swappable language mode.
import { basicSetup } from 'codemirror';
import { EditorView, Decoration, keymap } from '@codemirror/view';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { getPrefs, onPrefs } from '../state/prefs.js';

const bugLine = Decoration.line({ class: 'cm-bug-line' });

// Every language in the game (Python §3, §4 and full Python) uses Python syntax.
const languageFor = () => python();

const wrapping = (on) => (on ? EditorView.lineWrapping : []);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font, 14px)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
  '.cm-content': { padding: '8px 0' },
});

/**
 * createEditor(parent, { doc, lang, onRun, onSubmit, onChange })
 *   -> { getCode, setCode, setLanguage, focus, destroy }
 */
export function createEditor(parent, { doc = '', lang = 'py3', onRun, onSubmit, onChange } = {}) {
  const language = new Compartment();
  const wrap = new Compartment();

  const shortcuts = Prec.highest(keymap.of([
    { key: 'Mod-Enter', run: () => { onRun?.(); return true; } },
    { key: 'Mod-Shift-Enter', run: () => { onSubmit?.(); return true; } },
  ]));

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        shortcuts,
        basicSetup,
        keymap.of([indentWithTab]),
        indentUnit.of('    '),
        EditorState.tabSize.of(4),
        language.of(languageFor(lang)),
        wrap.of(wrapping(getPrefs().wrap)),
        oneDark,
        theme,
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange?.(); }),
      ],
    }),
  });

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
  const highlight = EditorView.decorations.of((view) => {
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
        oneDark,
        theme,
        highlight,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ],
    }),
  });
}
