import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { attachDuel } from '../server/duel.js';
import { createSolutionStore } from '../server/solutions.js';
import { createSession } from '../src/state/engine.js';
import { getQuestion } from '../src/questions/index.js';

const admin = { username: 'admin', password: 'test-password' };

async function setup() {
  const http = createServer();
  const solutions = createSolutionStore({ file: ':memory:' });
  const duel = attachDuel(http, { log: () => {}, countdownMs: 0, admin, solutions });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${http.address().port}`;
  const sockets = [];
  const client = () => {
    const socket = connect(url, { auth: { token: randomUUID() }, transports: ['websocket'], forceNew: true });
    const c = { socket, views: [], request: (e, m) => socket.emitWithAck(e, m) };
    socket.on('admin:view', (v) => c.views.push(v));
    sockets.push(socket);
    return c;
  };
  const close = async () => {
    sockets.forEach((s) => s.close());
    await duel.close();
  };
  return { client, close, duel, solutions };
}

async function until(pred, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = pred();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('admin login: wrong passwords are refused and limited, the right one gives a session', async () => {
  const { client, close } = await setup();
  try {
    const a = client();
    assert.match((await a.request('admin:login', { username: 'admin', password: 'nope' })).error, /Wrong/);
    const ok = await a.request('admin:login', admin);
    assert.ok(ok.ok && ok.token.length >= 32);
    await until(() => a.views.length > 0);

    // A new connection resumes with the token; a made-up token does not work.
    const b = client();
    assert.ok((await b.request('admin:resume', { token: ok.token })).ok);
    assert.ok((await b.request('admin:resume', { token: 'x'.repeat(48) })).error);
    // Not logged in: no view at all.
    const c = client();
    c.socket.emit('admin:watch', { kind: 'solo', id: 'x' });
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(c.views.length, 0);

    for (let i = 0; i < 5; i++) await c.request('admin:login', { username: 'admin', password: `bad${i}` });
    assert.match((await c.request('admin:login', admin)).error, /Too many/, 'five wrong tries from one address');
    // Logging out ends the session.
    await b.request('admin:logout', { token: ok.token });
    assert.ok((await client().request('admin:resume', { token: ok.token })).error);
  } finally {
    await close();
  }
});

test('the admin sees solo players live, with their code, and duel rooms', async () => {
  const { client, close } = await setup();
  try {
    const q = getQuestion('CR-E01') ?? getQuestion((await import('../src/questions/index.js')).ALL_QUESTIONS[0].id);
    const state = createSession({ config: { lang: 'py3', mode: q.mode, difficulty: q.difficulty, count: 1 }, questions: [q], now: Date.now() });
    const player = client();
    player.socket.emit('solo:update', { name: 'Solo Sam', state, now: Date.now() });
    player.socket.emit('solo:code', { questionId: q.id, code: 'def f():\n    return 42' });

    const host = client();
    const { code } = await host.request('duel:create', { name: 'Ada', config: { lang: 'py3', difficulty: 'easy', count: 1 } });

    const a = client();
    await a.request('admin:login', admin);
    let v = await until(() => a.views.find((x) => x.solos.length && x.rooms.length));
    const sam = v.solos[0];
    assert.equal(sam.name, 'Solo Sam');
    assert.equal(sam.current.questionId, q.id);
    assert.equal(sam.current.title, q.title);
    assert.ok(sam.current.endsAt > Date.now());
    assert.equal(v.rooms[0].code, code);
    assert.equal(v.rooms[0].players[0].name, 'Ada');

    a.socket.emit('admin:watch', { kind: 'solo', id: sam.id });
    v = await until(() => a.views.find((x) => x.watched));
    assert.equal(v.watched.code, 'def f():\n    return 42');

    // Back home: gone from the list.
    player.socket.emit('solo:end');
    await until(() => a.views.at(-1).solos.length === 0);
    // Junk is ignored.
    player.socket.emit('solo:update', { name: 'x', state: { questions: [{ id: 'nope' }], config: {} } });
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(a.views.at(-1).solos.length, 0);
  } finally {
    await close();
  }
});

test('solution store: newest 10 per question, oldest dropped when space runs out', () => {
  const store = createSolutionStore({ file: ':memory:', maxBytes: 2000 });
  const add = (questionId, i, size = 10) => store.add({ questionId, lang: 'py3', name: `p${i}`, kind: 'solo', code: `# ${i}`.padEnd(size, '.') });
  for (let i = 0; i < 14; i++) add('A', i);
  assert.deepEqual(store.forQuestion('A').map((x) => x.name), ['p13', 'p12', 'p11', 'p10', 'p9', 'p8', 'p7', 'p6', 'p5', 'p4']);
  // 2000 bytes in all: big ones push the oldest out, whatever their question.
  for (let i = 0; i < 4; i++) add('B', i, 600);
  assert.ok(store.stats().bytes <= 2000);
  assert.deepEqual(store.forQuestion('B').map((x) => x.name), ['p3', 'p2', 'p1']);
  assert.equal(store.forQuestion('A').length, 0, 'the older question went first');
  assert.equal(store.add({ questionId: 'C', lang: 'py3', kind: 'solo', code: '   ' }), false, 'empty code is not saved');
  assert.equal(store.add({ questionId: 'C', lang: 'py3', kind: 'hacker', code: 'x' }), false);
  store.close();
});

test('a solo solve is saved once, only for the question the session says was solved', async () => {
  const { client, close, solutions } = await setup();
  try {
    const q = getQuestion('CR-E01') ?? getQuestion((await import('../src/questions/index.js')).ALL_QUESTIONS[0].id);
    const now = Date.now();
    let state = createSession({ config: { lang: 'py3', mode: q.mode, difficulty: q.difficulty, count: 1 }, questions: [q], now });
    const p = client();
    p.socket.emit('solo:update', { name: 'Sam', state, now });
    p.socket.emit('solo:solved', { questionId: q.id, code: 'not solved yet' });
    state = { ...state, current: { ...state.current, status: 'solved', points: 120 } };
    p.socket.emit('solo:update', { name: 'Sam', state, now });
    p.socket.emit('solo:solved', { questionId: 'BH-E01', code: 'wrong question' });
    p.socket.emit('solo:solved', { questionId: q.id, code: 'def f(): return 1' });
    p.socket.emit('solo:solved', { questionId: q.id, code: 'again' });
    await until(() => solutions.forQuestion(q.id).length > 0);
    await new Promise((r) => setTimeout(r, 200));
    const saved = solutions.forQuestion(q.id);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].code, 'def f(): return 1');
    assert.equal(saved[0].points, 120);
    assert.equal(solutions.forQuestion('BH-E01').length, 0);

    // The admin reads them; others may not.
    assert.ok((await p.request('admin:solutions')).error);
    const a = client();
    await a.request('admin:login', admin);
    const list = await a.request('admin:solutions');
    assert.deepEqual(list.questions.map((x) => [x.questionId, x.title, x.count]), [[q.id, q.title, 1]]);
    const one = await a.request('admin:solution', { questionId: q.id });
    assert.equal(one.solutions[0].name, 'Sam');
  } finally {
    await close();
  }
});
