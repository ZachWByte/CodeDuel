// Pure helpers shared by the browser judge and the Node validator.

// py3 / py4 = Source Academy Python §3 / §4 (py-slang); python = full Python (Pyodide).
// Questions store one version of each program per family.
export const LANG_FAMILY = { py3: 'sicpy', py4: 'sicpy', python: 'python' };

/**
 * Tests as they apply to one language. Per-language fields override the shared
 * ones. A test with no call for this language is skipped for it.
 * -> [{ index, hidden, note, setup, call, expect }]
 */
export function resolveTests(question, lang) {
  const fam = LANG_FAMILY[lang];
  const out = [];
  question.tests.forEach((t, index) => {
    const spec = { setup: t.setup, call: t.call, expect: t.expect, ...(t[fam] ?? {}) };
    if (!spec.call || spec.expect === undefined) return;
    out.push({ index, hidden: !!t.hidden, note: t.note, setup: spec.setup, call: spec.call, expect: spec.expect });
  });
  return out;
}

/** Starting code for a question: the stub (Code Race) or the buggy program (Bug Hunt). */
export function startingCode(question, lang) {
  const fam = LANG_FAMILY[lang];
  return (question.mode === 'bug-hunt' ? question.buggy?.[fam] : question.starter?.[fam]) ?? '';
}

/** Remove comments and string literals (Python syntax) so banned-name checks only see real code. */
export function stripCommentsAndStrings(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '#') {
      while (i < code.length && code[i] !== '\n') i++;
    } else if (code.startsWith('"""', i) || code.startsWith("'''", i)) {
      const q = code.slice(i, i + 3);
      const end = code.indexOf(q, i + 3);
      i = end === -1 ? code.length : end + 3;
      out += '""';
    } else if (c === '"' || c === "'") {
      i++;
      while (i < code.length && code[i] !== c && code[i] !== '\n') {
        if (code[i] === '\\') i++;
        i++;
      }
      i++;
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** First banned name the code uses, or null. */
export function findBanned(question, lang, code) {
  const list = question.banned?.[LANG_FAMILY[lang]] ?? [];
  if (list.length === 0) return null;
  const clean = stripCommentsAndStrings(code);
  const squashed = clean.replace(/\s+/g, '');
  for (const name of list) {
    if (IDENT.test(name)) {
      const re = new RegExp(`(?<![A-Za-z0-9_$])${name.replace(/\$/g, '\\$')}(?![A-Za-z0-9_$])`);
      if (re.test(clean)) return name;
    } else if (squashed.includes(name.replace(/\s+/g, ''))) {
      return name;
    }
  }
  return null;
}

/** Number of changed lines between two programs (a replaced line counts once). */
export function linesChanged(before, after) {
  const a = before.replace(/\s+$/gm, '').split('\n');
  const b = after.replace(/\s+$/gm, '').split('\n');
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const common = dp[0][0];
  return Math.max(a.length - common, b.length - common);
}

/** Bug Hunt "par": how many lines the reference fix changes. null for Code Race. */
export function parLines(question, lang) {
  const fam = LANG_FAMILY[lang];
  if (question.mode !== 'bug-hunt' || !question.buggy?.[fam] || !question.solution?.[fam]) return null;
  return linesChanged(question.buggy[fam], question.solution[fam]);
}
