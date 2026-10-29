// Small helpers for writing tests once and getting the Python § and full Python text.
//
//                       Python §3/§4 (sicpy)        full Python
//   JS array [1, 2]  -> llist(1, 2)                 [1, 2]
//   A([1, 2])        -> [1, 2]  (array)             [1, 2]
//   P(1, 2)          -> pair(1, 2)                  (1, 2)
//   R(sicpy, py)     -> raw text per language
//   true / null      -> True / None                 True / None
//   []               -> None (the empty llist)      []

class Arr { constructor(items) { this.items = items; } }
class Pair { constructor(a, b) { this.a = a; this.b = b; } }
class Raw { constructor(sicpy, py) { this.sicpy = sicpy; this.py = py; } }

export const A = (items) => new Arr(items);
export const P = (a, b) => new Pair(a, b);
export const R = (sicpy, py = sicpy) => new Raw(sicpy, py);

const scalar = (v) => {
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
};

export function toSicpy(v) {
  if (v instanceof Raw) return v.sicpy;
  if (v instanceof Arr) return `[${v.items.map(toSicpy).join(', ')}]`;
  if (v instanceof Pair) return `pair(${toSicpy(v.a)}, ${toSicpy(v.b)})`;
  if (Array.isArray(v)) return v.length === 0 ? 'None' : `llist(${v.map(toSicpy).join(', ')})`;
  return scalar(v);
}

export function toPy(v) {
  if (v instanceof Raw) return v.py;
  if (v instanceof Arr) return `[${v.items.map(toPy).join(', ')}]`;
  if (v instanceof Pair) return `(${toPy(v.a)}, ${toPy(v.b)})`;
  if (Array.isArray(v)) return `[${v.map(toPy).join(', ')}]`;
  return scalar(v);
}

/** Visible test: fn(...args) should equal expected. */
export function T(fn, args, expected, opts = {}) {
  return {
    sicpy: { call: `${fn}(${args.map(toSicpy).join(', ')})`, expect: toSicpy(expected) },
    python: { call: `${fn}(${args.map(toPy).join(', ')})`, expect: toPy(expected) },
    ...opts,
  };
}

/** Secret test. */
export const H = (fn, args, expected, opts = {}) => T(fn, args, expected, { ...opts, hidden: true });

/**
 * Test with setup code and a call per language and one expected value.
 * ST({ sicpy: setup, py: setup, call, pyCall?, expect, hidden?, note? })
 */
export function ST({ sicpy, py, call, pyCall, expect, hidden, note }) {
  const t = {
    sicpy: { setup: sicpy, call, expect: toSicpy(expect) },
    python: { setup: py ?? sicpy, call: pyCall ?? call, expect: toPy(expect) },
  };
  if (hidden) t.hidden = true;
  if (note) t.note = note;
  return t;
}

/** Python §-only test (for questions without a full Python version). */
export const SO = (call, expect, { setup, ...opts } = {}) => ({ sicpy: { setup, call, expect: toSicpy(expect) }, ...opts });
export const SH = (call, expect, opts = {}) => SO(call, expect, { ...opts, hidden: true });

/** In-place array test: setup runs fn on an array `a`, then the test checks `a`. */
export const inPlace = (fn, arr, expected, opts = {}) => ({
  sicpy: { setup: `a = ${toSicpy(new Arr(arr))}\n${fn}(a)`, call: 'a', expect: toSicpy(new Arr(expected)) },
  python: { setup: `a = ${toPy(new Arr(arr))}\n${fn}(a)`, call: 'a', expect: toPy(new Arr(expected)) },
  ...opts,
});

export const ALL = ['py3', 'py4', 'python'];
export const SICPY = ['py3', 'py4'];
export const PY4 = ['py4'];

export const stub = (sig) => `def ${sig}:\n    # your code here\n    return None`;
/** Starter stubs: the same Python header in both families. */
export const stubs = (sig) => ({ sicpy: stub(sig), python: stub(sig) });
