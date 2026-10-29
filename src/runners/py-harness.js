// Python helpers shared by the Pyodide worker and the Node validator, so a
// question is judged the same way in both places.
//
// NOTE: the spec asks for sys.setrecursionlimit(5000). In Pyodide (tested in
// Chrome, Oct 2026) reaching a limit of 3000 or more overflows the WebAssembly
// stack and kills the interpreter, so we use 1500: deep enough for every
// question, and runaway recursion still ends in a normal RecursionError.
export const PY_HARNESS = String.raw`
import sys, traceback
sys.setrecursionlimit(1500)

def _cd_fmt_error(e):
    line = None
    if isinstance(e, SyntaxError) and e.filename == '<player>':
        line = e.lineno
    for fr in traceback.extract_tb(e.__traceback__):
        if fr.filename == '<player>':
            line = fr.lineno
    msg = traceback.format_exception_only(type(e), e)[-1].strip()
    return ('Line %d: ' % line if line else '') + msg

def _cd_run(code):
    ns = {'__name__': '__main__'}
    try:
        exec(compile(code, '<player>', 'exec'), ns)
        return ['ok', None]
    except KeyboardInterrupt:
        return ['timeout', 'Time limit exceeded']
    except BaseException as e:
        return ['error', _cd_fmt_error(e)]

def _cd_test(code, setup, call, expect):
    ns = {'__name__': '__main__'}
    try:
        exec(compile(code, '<player>', 'exec'), ns)
        if setup:
            exec(compile(setup, '<setup>', 'exec'), ns)
        got = eval(compile(call, '<test>', 'eval'), ns)
        exp = eval(compile(expect, '<test>', 'eval'), ns)
        return ['ok', bool(got == exp), repr(got), repr(exp)]
    except KeyboardInterrupt:
        return ['timeout', 'Time limit exceeded']
    except BaseException as e:
        return ['error', _cd_fmt_error(e)]
`;
