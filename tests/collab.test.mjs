import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { createDoc, docString, docVersion, pushUpdates, updatesSince } from '../server/collab.js';
import { createCollabSession, remoteChange } from '../src/editor/collab.js';

/** A server and clients whose messages arrive in a random order and at random times. */
function world(start, seed) {
  let rnd = seed;
  const random = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  const doc = createDoc(start);
  const queue = []; // pending deliveries: () => void
  const clients = [];
  const deliver = (fn) => queue.push(fn);

  function client() {
    const c = { state: EditorState.create({ doc: start }) };
    // A stand-in for an EditorView: dispatch updates c.state.
    c.view = {
      get state() { return c.state; },
      dispatch(spec) { c.state = c.state.update(spec).state; },
    };
    c.session = createCollabSession({
      version: docVersion(doc),
      net: {
        push: (msg) => new Promise((resolve) => deliver(() => {
          const r = pushUpdates(doc, msg.version, msg.updates);
          if (r.ok) for (const other of clients) deliver(() => other.session.receive(r.from, r.updates));
          const reply = r.stale ? { stale: true, from: msg.version, updates: updatesSince(doc, msg.version) } : r;
          deliver(() => resolve(reply));
        })),
        pull: (version) => new Promise((resolve) => deliver(() => resolve({ from: version, updates: updatesSince(doc, version) }))),
      },
    });
    c.session.attach(c.view);
    c.edit = () => {
      const len = c.state.doc.length;
      const from = Math.floor(random() * (len + 1));
      const to = Math.min(len, from + Math.floor(random() * 3));
      const insert = random() < 0.7 ? 'abcxyz\n'[Math.floor(random() * 7)] : '';
      const tr = c.state.update({ changes: { from, to, insert } });
      c.state = tr.state;
      if (!tr.annotation(remoteChange)) c.session.local(tr.changes);
    };
    clients.push(c);
    return c;
  }

  async function run(steps) {
    for (let i = 0; i < steps; i++) {
      if (random() < 0.35) clients[Math.floor(random() * clients.length)].edit();
      if (queue.length && random() < 0.7) queue.splice(Math.floor(random() * queue.length), 1)[0]();
      await new Promise((r) => setImmediate(r));
    }
    // Let everything settle: deliver all messages and wait out the push delay.
    for (let i = 0; i < 400; i++) {
      while (queue.length) queue.shift()();
      await new Promise((r) => setTimeout(r, i < 50 ? 5 : 1));
      if (!queue.length && clients.every((c) => !c.session.pending())) break;
    }
  }

  return { doc, client, run };
}

for (const seed of [1, 7, 42, 2024]) {
  test(`teammates typing at once end up with the same code (seed ${seed})`, async () => {
    const w = world('def f(x):\n    return x', seed);
    const a = w.client();
    const b = w.client();
    const c = w.client();
    await w.run(400);
    const server = docString(w.doc);
    assert.ok(docVersion(w.doc) > 60, `plenty of edits went through (${docVersion(w.doc)})`);
    assert.equal(a.state.doc.toString(), server);
    assert.equal(b.state.doc.toString(), server);
    assert.equal(c.state.doc.toString(), server);
  });
}

test('the server refuses changes that do not fit, or are made on an old version', () => {
  const doc = createDoc('abc');
  const insert = (pos, text, len) => ({ clientID: 'x', changes: [pos, [0, text], len - pos] });
  assert.ok(pushUpdates(doc, 0, [insert(1, 'Z', 3)]).ok);
  assert.equal(docString(doc), 'aZbc');
  assert.ok(pushUpdates(doc, 0, [insert(0, 'Q', 3)]).stale);
  assert.ok(pushUpdates(doc, 1, [insert(0, 'Q', 3)]).error, 'length does not match');
  assert.ok(pushUpdates(doc, 1, [{ clientID: 'x', changes: 'nonsense' }]).error);
  assert.equal(docString(doc), 'aZbc');
  assert.equal(updatesSince(doc, 5), null);
});
