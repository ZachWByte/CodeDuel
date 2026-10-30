// Hint power-up (server/duel.js): help on one question, made from its reference
// solution. Two kinds:
//   outline  Code Race: pseudo-code, the solution's shape: defs, loops and conditions
//            as they are, but what gets assigned, called or returned blanked out.
//            Bug Hunt: which line the bug is on.
//   lines    Code Race: the next LINES_PER_HINT lines of the solution (more each time).
//            Bug Hunt: the fixed line(s).
import { LANG_FAMILY } from '../src/judge/resolve.js';

export const HINT_KINDS = ['outline', 'lines'];
export const LINES_PER_HINT = 3;
const BLANK = '…';
const SIMPLE = /^(-?\d+(\.\d+)?|None|True|False|[A-Za-z_]\w*)$/;

/** One line of the outline, or null to leave it out (comments). */
function outlineLine(line) {
  const [, ind, raw] = /^(\s*)(.*)$/.exec(line);
  const body = raw.replace(/\s+#.*$/, '').trimEnd();
  if (body.startsWith('#')) return null;
  if (!body) return '';
  let m;
  if (/^def\s/.test(body) || /^(else|try|finally):$/.test(body) || /^(break|continue|pass)$/.test(body)) return ind + body;
  if (/^(if|elif|while|for)\b.*:$/.test(body)) return ind + body;
  if ((m = /^return\b\s*(.*)$/.exec(body))) return `${ind}return${m[1] ? ` ${SIMPLE.test(m[1]) ? m[1] : BLANK}` : ''}`;
  if ((m = /^([A-Za-z_][\w.[\], ]*?)\s*(=|\+=|-=|\*=|\/\/=|\/=|%=)\s*(?!=)(.+)$/.exec(body))) return `${ind}${m[1]} ${m[2]} ${BLANK}`;
  if ((m = /^([A-Za-z_][\w.]*)\(/.exec(body))) return `${ind}${m[1]}(${BLANK})`;
  return ind + BLANK;
}

/** The solution's shape: control flow and names kept, expressions blanked out. */
export function outline(code) {
  return code.split('\n').map(outlineLine).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Lines of `after` that are not in `before` (by longest common subsequence). */
function addedLines(before, after) {
  const a = before.split('\n').map((l) => l.trimEnd());
  const b = after.split('\n').map((l) => l.trimEnd());
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < a.length && dp[i + 1][j] >= dp[i][j + 1]) i++;
    else out.push({ line: j + 1, text: b[j++] });
  }
  return out;
}

/**
 * The next hint of `kind` for a question, given what the side has already seen
 * (`seen`: { outline, lines, linesShown }). -> { text, linesShown, more } | null when
 * there is nothing more of that kind.
 */
export function nextHint(question, lang, kind, seen = {}) {
  const fam = LANG_FAMILY[lang];
  const solution = question.solution?.[fam];
  if (!solution || !HINT_KINDS.includes(kind)) return null;

  if (question.mode === 'bug-hunt') {
    const buggy = question.buggy?.[fam] ?? '';
    if (kind === 'outline') {
      if (seen.outline) return null;
      const lines = question.bugLines?.[fam] ?? [];
      if (lines.length === 0) return null;
      return { text: `The bug is on line${lines.length === 1 ? '' : 's'} ${lines.join(' and ')}.`, more: false };
    }
    if (seen.lines) return null;
    const fixed = addedLines(buggy, solution);
    if (fixed.length === 0) return null;
    return { text: fixed.map((f) => `line ${f.line}:  ${f.text.trim()}`).join('\n'), more: false };
  }

  if (kind === 'outline') return seen.outline ? null : { text: outline(solution), more: false };
  const all = solution.replace(/\s+$/, '').split('\n');
  const shown = seen.linesShown ?? 0;
  if (shown >= all.length) return null;
  const linesShown = Math.min(all.length, shown + LINES_PER_HINT);
  return { text: all.slice(0, linesShown).join('\n'), linesShown, more: linesShown < all.length };
}
