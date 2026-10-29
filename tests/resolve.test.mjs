import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTests, findBanned, stripCommentsAndStrings, linesChanged } from '../src/judge/resolve.js';
import { getQuestion } from '../src/questions/index.js';

test('per-language test fields override shared ones', () => {
  const q = getQuestion('CR-M01');
  assert.equal(resolveTests(q, 'py3')[0].call, 'flatten(llist(1, llist(2, 3), 4))');
  assert.equal(resolveTests(q, 'py4')[0].expect, 'llist(1, 2, 3, 4)');
  assert.equal(resolveTests(q, 'python')[0].call, 'flatten([1, [2, 3], 4])');
  assert.equal(resolveTests(q, 'python').filter((t) => t.hidden).length, 5);
});

test('a test with no call for a language is skipped for it', () => {
  const q = getQuestion('CR-H01');
  assert.equal(resolveTests(q, 'python').filter((t) => t.hidden).length, 6);
  assert.equal(resolveTests(q, 'py3').filter((t) => t.hidden).length, 4);
});

test('banned names ignore comments, strings and longer identifiers', () => {
  const q = getQuestion('CR-M03');
  assert.equal(findBanned(q, 'py3', 'def my_reverse(xs):\n    return reverse(xs)'), 'reverse');
  assert.equal(findBanned(q, 'py3', 'def my_reverse(xs):\n    # reverse it\n    return "reverse"'), null);
  assert.equal(findBanned(q, 'python', 'def my_reverse(xs):\n    return xs[ :: -1 ]'), '[::-1]');
  assert.equal(findBanned(q, 'python', 'def my_reverse(xs):\n    return list(reversed(xs))'), 'reversed');
  assert.equal(findBanned(q, 'python', 'def my_reverse(xs):\n    # xs.reverse()\n    return xs'), null);
  assert.equal(findBanned(getQuestion('CR-E02'), 'py3', 'def power(b, e):\n    return b ** e'), '**');
});

test('strip comments and strings', () => {
  assert.equal(stripCommentsAndStrings('a = "x#" # c\nb = """q\nr"""').replace(/\s+/g, ' '), 'a = "" b = ""');
  assert.equal(stripCommentsAndStrings("s = 'it\\'s' + t").replace(/\s+/g, ' '), 's = "" + t');
});

test('lines changed', () => {
  assert.equal(linesChanged('a\nb\nc', 'a\nb\nc'), 0);
  assert.equal(linesChanged('a\nb\nc', 'a\nX\nc'), 1);
  assert.equal(linesChanged('a\nb\nc', 'a\nb\nc\nd'), 1);
  assert.equal(linesChanged('a\nb\nc  ', 'a\nb\nc'), 0);
});
