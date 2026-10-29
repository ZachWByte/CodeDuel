import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { attachDuel, validConfig, validPick } from '../server/duel.js';
import { getQuestion } from '../src/questions/index.js';
import { resolveTests } from '../src/judge/resolve.js';

const config = { lang: 'py3', difficulty: 'easy', count: 1 };
const raceLists = { mode: 'code-race', category: 'lists' };

async function setup(options = {}) {
  const http = createServer();
  const duel = attachDuel(http, { log: () => {}, countdownMs: 0, ...options });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${http.address().port}`;
  const clients = [];
  const client = (token = randomUUID()) => {
    const socket = connect(url, { auth: { token }, transports: ['websocket'], forceNew: true });
    const c = { socket, token, room: undefined, waiters: [], chat: [] };
    socket.on('duel:room', (room) => {
      c.room = room;
      c.waiters = c.waiters.filter((w) => !w(room));
    });
    socket.on('duel:chatlog', (log) => { c.chat = [...log]; });
    socket.on('duel:chat', (msg) => { c.chat.push(msg); });
    c.request = (event, msg) => socket.emitWithAck(event, msg);
    /** Resolves with the first snapshot (including the current one) that matches. */
    c.until = (pred, ms = 5000) => new Promise((resolve, reject) => {
      if (c.room !== undefined && pred(c.room)) return resolve(c.room);
      const timer = setTimeout(() => reject(new Error('timed out waiting for a room snapshot')), ms);
      c.waiters.push((room) => (pred(room) ? (clearTimeout(timer), resolve(room), true) : false));
    });
    clients.push(c);
    return c;
  };
  const close = async () => {
    clients.forEach((c) => c.socket.close());
    await duel.close();
  };
  return { client, close, duel };
}

const me = (room) => room.players.find((p) => p.id === room.youId);
/** Real test counts for a question, as the browser would report them. */
function counts(qid, lang = config.lang) {
  const tests = resolveTests(getQuestion(qid), lang);
  const visible = tests.filter((t) => !t.hidden).length;
  return { visible, total: tests.length };
}
const solve = (qid) => {
  const { visible, total } = counts(qid);
  return { questionId: qid, passedVisible: visible, passedHidden: total - visible, total, timeMs: 5 };
};
async function waitFor(pred, ms = 5000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
const named = (room, name) => room.players.find((p) => p.name === name);

/** Two players in a room, Ada hosting. */
async function pair(client) {
  const a = client();
  const b = client();
  await a.until((r) => r === null);
  const { code } = await a.request('duel:create', { name: 'Ada', config });
  assert.ok((await b.request('duel:join', { code, name: 'Bob' })).ok);
  await a.until((r) => r?.players.length === 2);
  return { a, b, code };
}

async function startRound(a, b, pick = raceLists) {
  await a.request('duel:pick', pick);
  await b.request('duel:pick', pick);
  await a.request('duel:ready', { ready: true });
  await b.request('duel:ready', { ready: true });
  return a.until((r) => r.status === 'playing');
}

test('settings and picks are validated', () => {
  assert.deepEqual(validConfig({ ...config, mode: 'x' }), config);
  assert.equal(validConfig({ ...config, lang: 'toString' }), null);
  assert.equal(validConfig({ ...config, count: 7 }), null);
  assert.equal(validConfig(null), null);
  assert.deepEqual(validPick({ mode: 'random', category: 'dp' }), { mode: 'random', category: 'dp' });
  assert.equal(validPick({ mode: 'bug-hunt', category: 'constructor' }), null);
});

test('a round starts when both have voted and are ready, and the loser picks next', async () => {
  const { client, close } = await setup();
  try {
    const { a, b } = await pair(client);
    assert.equal(a.room.pick.pickerId, null, 'the first round is a vote');

    await a.request('duel:pick', raceLists);
    await a.request('duel:ready', { ready: true });
    await b.request('duel:ready', { ready: true });
    assert.equal(a.room.status, 'lobby', 'Bob has not voted yet');
    await b.request('duel:pick', { mode: 'code-race', category: 'lists' });
    const ra = await a.until((r) => r.status === 'playing');
    assert.equal(ra.roundInfo.mode, 'code-race');
    assert.equal(ra.roundInfo.category, 'lists');
    const qid = me(ra).state.current.questionId;
    assert.equal(me(await b.until((r) => r.status === 'playing')).state.current.questionId, qid, 'same question');

    // Ada checks her tests, then solves; Bob skips.
    const { visible } = counts(qid);
    a.socket.emit('duel:action', { type: 'testRun', result: { questionId: qid, passed: 1, total: visible } });
    const seen = await b.until((r) => named(r, 'Ada').state.current.testRuns === 1);
    assert.deepEqual(named(seen, 'Ada').state.current.lastTest, { passed: 1, total: visible }, 'Bob sees Ada passing tests');
    a.socket.emit('duel:action', { type: 'submitResult', result: solve(qid) });
    b.socket.emit('duel:action', { type: 'skip' });
    a.socket.emit('duel:action', { type: 'next' });
    b.socket.emit('duel:action', { type: 'next' });
    const done = await a.until((r) => r.status === 'finished');
    assert.equal(done.lastWinnerId, named(done, 'Ada').id);
    assert.equal(done.wins[named(done, 'Ada').id], 1);
    assert.ok(a.chat.some((m) => m.fromId === null && m.text.includes('Ada wins round 1')));

    // Next round: Bob lost, so only Bob picks.
    await b.request('duel:next');
    const lobby = await a.until((r) => r.status === 'lobby');
    assert.equal(lobby.pick.pickerId, named(lobby, 'Bob').id);
    assert.match((await a.request('duel:pick', raceLists)).error, /Bob chooses/);
    await b.request('duel:pick', { mode: 'bug-hunt', category: 'random' });
    await a.request('duel:ready', { ready: true });
    await b.request('duel:ready', { ready: true });
    const round2 = await a.until((r) => r.status === 'playing' && r.round === 2);
    assert.equal(round2.roundInfo.mode, 'bug-hunt');
    assert.notEqual(round2.roundInfo.category, 'random');
  } finally {
    await close();
  }
});

test('chat reaches the other player and is rate-limited', async () => {
  const { client, close } = await setup();
  try {
    const { a, b } = await pair(client);
    for (let i = 0; i < 8; i++) a.socket.emit('duel:chat', { text: `  hello ${i}  ` });
    await waitFor(() => b.chat.filter((m) => m.fromId).length >= 5);
    await new Promise((r) => setTimeout(r, 100));
    const said = b.chat.filter((m) => m.fromId === me(a.room).id).map((m) => m.text);
    assert.deepEqual(said, ['hello 0', 'hello 1', 'hello 2', 'hello 3', 'hello 4']);
  } finally {
    await close();
  }
});

test('a reconnect with the same token gets the same seat and the chat log', async () => {
  const { client, close } = await setup();
  try {
    const a = client();
    const { code } = await a.request('duel:create', { name: 'Ada', config });
    a.socket.emit('duel:chat', { text: 'note to self' });
    await new Promise((r) => setTimeout(r, 50));
    a.socket.close();
    const again = client(a.token);
    const room = await again.until((r) => r?.code === code);
    assert.equal(me(room).name, 'Ada');
    assert.equal(room.hostId, me(room).id);
    assert.ok(again.chat.some((m) => m.text === 'note to self'));
  } finally {
    await close();
  }
});

test('a full room and a started game cannot be joined', async () => {
  const { client, close } = await setup();
  try {
    const { a, b, code } = await pair(client);
    assert.equal((await client().request('duel:join', { code, name: 'C' })).error, 'That room is full.');
    await startRound(a, b);
    assert.match((await client().request('duel:join', { code, name: 'D' })).error, /middle of a round/);
  } finally {
    await close();
  }
});

test('leaving mid-round lets the other player finish and win', async () => {
  const { client, close } = await setup();
  try {
    const { a, b } = await pair(client);
    await startRound(a, b);
    await a.request('duel:leave');
    const room = await b.until((r) => r.players.some((p) => p.left));
    assert.equal(room.hostId, me(room).id, 'host passes to the player who stayed');
    b.socket.emit('duel:action', { type: 'skip' });
    b.socket.emit('duel:action', { type: 'next' });
    const done = await b.until((r) => r.status === 'finished');
    assert.equal(done.lastWinnerId, me(done).id);
  } finally {
    await close();
  }
});

test('a bot joins, picks, plays a whole round and chats', async () => {
  const { client, close, duel } = await setup({ botSpeed: 400 });
  try {
    const a = client();
    await a.until((r) => r === null);
    await a.request('duel:create', { name: 'Ada', config: { ...config, count: 3 } });
    assert.ok((await a.request('duel:addBot', { level: 'hard' })).ok);
    const withBot = await a.until((r) => r.players.some((p) => p.bot === 'hard'));
    const bot = withBot.players.find((p) => p.bot);

    // Ada votes and readies; the bot does the same on its own.
    await a.request('duel:pick', { mode: 'random', category: 'random' });
    await a.request('duel:ready', { ready: true });
    await a.until((r) => r.status === 'playing', 10000);

    // Ada skips everything; the bot keeps playing until the round is over.
    const skipAll = (r) => {
      if (r?.status !== 'playing') return;
      const s = me(r).state;
      if (s.status !== 'playing') return;
      a.socket.emit('duel:action', { type: s.current.status === 'playing' ? 'skip' : 'next' });
    };
    a.socket.on('duel:room', skipAll);
    skipAll(a.room);
    const done = await a.until((r) => r.status === 'finished', 15000);
    const botState = done.players.find((p) => p.id === bot.id).state;
    assert.equal(botState.status, 'finished');
    assert.equal(botState.results.length, 3);
    assert.ok(botState.results.some((r) => r.solved), 'a hard bot solves something');
    assert.equal(done.lastWinnerId, bot.id);
    assert.ok(a.chat.some((m) => m.fromId === bot.id), 'the bot said something');

    // Ada lost, so Ada picks round 2; the bot gets ready by itself.
    await a.request('duel:next');
    const lobby = await a.until((r) => r.status === 'lobby');
    assert.equal(lobby.pick.pickerId, me(lobby).id);
    await a.until((r) => r.players.find((p) => p.id === bot.id).ready, 10000);

    // When the human leaves, the bot goes too and the room is gone.
    await a.request('duel:leave');
    assert.equal(duel.rooms.size, 0);
  } finally {
    await close();
  }
});

test('made-up test counts are rejected, real ones accepted', async () => {
  const { client, close } = await setup();
  try {
    const { a, b } = await pair(client);
    const room = await startRound(a, b);
    await b.until((r) => r?.status === 'playing');
    const qid = me(room).state.current.questionId;
    // A one-line "cheat": claim the question has a single test and it passes.
    a.socket.emit('duel:action', { type: 'submitResult', result: { questionId: qid, passedVisible: 1, passedHidden: 0, total: 1, timeMs: 1 }, seq: 1 });
    const after = await a.until((r) => r.yourSeq === 1);
    assert.equal(me(after).state.current.status, 'playing', 'not solved');
    assert.equal(me(after).state.current.attempts, 0, 'not even counted');
    a.socket.emit('duel:action', { type: 'submitResult', result: solve(qid), seq: 2 });
    const solved = await a.until((r) => r.yourSeq === 2);
    assert.equal(me(solved).state.current.status, 'solved');
  } finally {
    await close();
  }
});

test('in a vote, players only see that the other voted, not what', async () => {
  const { client, close } = await setup();
  try {
    const { a, b } = await pair(client);
    await a.request('duel:pick', { mode: 'bug-hunt', category: 'dp' });
    const seenByB = await b.until((r) => Object.keys(r.pick.votes).length === 1);
    assert.equal(Object.values(seenByB.pick.votes)[0], true);
    const seenByA = await a.until((r) => Object.keys(r.pick.votes).length === 1);
    assert.deepEqual(seenByA.pick.votes[me(seenByA).id], { mode: 'bug-hunt', category: 'dp' });
  } finally {
    await close();
  }
});

test('a player who stays disconnected mid-round leaves, so the other is not stuck', async () => {
  const { client, close } = await setup({ disconnectGraceMs: 300 });
  try {
    const { a, b } = await pair(client);
    await startRound(a, b);
    await b.until((r) => r?.status === 'playing');
    a.socket.close();
    const room = await b.until((r) => r.players.some((p) => p.left), 3000);
    assert.ok(b.chat.some((m) => m.text.includes('disconnected for too long')));
    b.socket.emit('duel:action', { type: 'skip' });
    b.socket.emit('duel:action', { type: 'next' });
    const done = await b.until((r) => r.status === 'finished');
    assert.equal(done.lastWinnerId, me(room).id, 'the player who stayed wins');
  } finally {
    await close();
  }
});

test('a seat opened in a second tab closes the first one', async () => {
  const { client, close } = await setup();
  try {
    const a = client();
    await a.request('duel:create', { name: 'Ada', config });
    const replaced = new Promise((resolve) => a.socket.once('duel:replaced', resolve));
    const again = client(a.token);
    await replaced;
    const room = await again.until((r) => r?.players.length === 1);
    assert.equal(me(room).name, 'Ada');
  } finally {
    await close();
  }
});

test('rounds have as many questions as asked for, even in small topics', async () => {
  const { client, close } = await setup();
  try {
    const a = client();
    const b = client();
    await a.until((r) => r === null);
    const { code } = await a.request('duel:create', { name: 'Ada', config: { lang: 'py3', difficulty: 'hard', count: 10 } });
    await b.request('duel:join', { code, name: 'Bob' });
    const room = await startRound(a, b, { mode: 'bug-hunt', category: 'puzzles' });
    assert.equal(me(room).state.questions.length, 10);
  } finally {
    await close();
  }
});

test('too many connections from one address are refused', async () => {
  const { client, close } = await setup({ maxSocketsPerIp: 2 });
  try {
    const sockets = [client(), client(), client()];
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(sockets.map((c) => c.socket.connected), [true, true, false]);
  } finally {
    await close();
  }
});
