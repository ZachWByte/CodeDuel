import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { attachDuel, validConfig, validPick, audioType } from '../server/duel.js';
import { createSolutionStore } from '../server/solutions.js';
import { getQuestion } from '../src/questions/index.js';
import { resolveTests, startingCode } from '../src/judge/resolve.js';

const config = { lang: 'py3', difficulty: 'easy', count: 1 };
const raceLists = { mode: 'code-race', category: 'lists' };

async function setup(options = {}) {
  const http = createServer();
  const solutions = createSolutionStore({ file: ':memory:' });
  const duel = attachDuel(http, { log: process.env.DUEL_LOG ? console.log : () => {}, countdownMs: 0, solutions, ...options });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${http.address().port}`;
  const clients = [];
  const client = (token = randomUUID()) => {
    const socket = connect(url, { auth: { token }, transports: ['websocket'], forceNew: true });
    const c = { socket, token, room: undefined, waiters: [], chat: [], watch: [] };
    socket.on('duel:room', (room) => {
      c.room = room;
      c.waiters = c.waiters.filter((w) => !w(room));
    });
    socket.on('duel:chatlog', (log) => { c.chat = [...log]; });
    socket.on('duel:chat', (msg) => { c.chat.push(msg); });
    socket.on('duel:watch', (w) => { c.watch.push(w); });
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
  return { client, close, duel, solutions };
}

const me = (room) => room.players.find((p) => p.id === room.youId);
/** The round's first question, and a question's state for whoever's snapshot this is. */
const firstQ = (room) => me(room).state.questions[0].id;
const qOf = (room, qid, player = me(room)) => player.state.qs.find((q) => q.questionId === qid);
/** Real test counts for a question, as the browser would report them. */
function counts(qid, lang = config.lang) {
  const tests = resolveTests(getQuestion(qid), lang);
  const visible = tests.filter((t) => !t.hidden).length;
  return { visible, total: tests.length };
}
/** A solve claim as the browser sends it; the code defaults to the reference solution. */
const solve = (qid, code = getQuestion(qid).solution.sicpy) => {
  const { visible, total } = counts(qid);
  return { questionId: qid, passedVisible: visible, passedHidden: total - visible, total, timeMs: 5, code };
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
  const off = { blackout: 0, wipe: 0, keyboard: 0, hints: 0 };
  const full = { ...config, minutes: 15, partial: false, revealCost: 0, powerups: off };
  assert.deepEqual(validConfig({ ...config, mode: 'x' }), full, 'round options take their defaults');
  assert.deepEqual(validConfig({ ...config, minutes: 20, partial: true, revealCost: 0.25 }), { ...full, minutes: 20, partial: true, revealCost: 0.25 });
  assert.equal(validConfig({ ...config, minutes: 7 }), null);
  assert.equal(validConfig({ ...config, revealCost: 0.3 }), null);
  assert.equal(validConfig({ ...config, lang: 'toString' }), null);
  assert.equal(validConfig({ ...config, count: 7 }), null);
  assert.equal(validConfig(null), null);
  assert.deepEqual(validPick({ mode: 'random', category: 'dp' }), { mode: 'random', category: 'dp' });
  assert.equal(validPick({ mode: 'bug-hunt', category: 'constructor' }), null);
  assert.deepEqual(validConfig({ ...config, powerups: { blackout: 2, wipe: 2 } }).powerups, { blackout: 2, wipe: 2, keyboard: 0, hints: 0 });
  assert.equal(validConfig({ ...config, powerups: { blackout: 5 } }), null);
  assert.equal(validConfig({ ...config, powerups: { wipe: 3 } }), null);
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
    const qid = firstQ(ra);
    assert.equal(firstQ(await b.until((r) => r.status === 'playing')), qid, 'same question');
    assert.equal(me(ra).state.durationSec, 15 * 60, 'one clock for the round');

    // Ada checks her tests, then solves (that is every question, so she is done); Bob stops.
    const { visible } = counts(qid);
    a.socket.emit('duel:action', { type: 'testRun', result: { questionId: qid, passed: 1, total: visible } });
    const seen = await b.until((r) => qOf(r, qid, named(r, 'Ada')).testRuns === 1);
    assert.deepEqual(qOf(seen, qid, named(seen, 'Ada')).lastTest, { passed: 1, total: visible }, 'Bob sees Ada passing tests');
    a.socket.emit('duel:action', { type: 'submitResult', result: solve(qid) });
    await a.until((r) => me(r).state.status === 'finished');
    b.socket.emit('duel:action', { type: 'finish' });
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

test('the host can start the round without waiting for everyone to be ready', async () => {
  const { client, close } = await setup();
  try {
    const { a, b } = await pair(client);
    assert.match((await b.request('duel:start', {})).error, /Only the host/);
    // Bob has not voted or readied up; Ada's shown pick becomes her vote and the round starts.
    assert.ok((await a.request('duel:start', { pick: raceLists })).ok);
    const ra = await a.until((r) => r.status === 'playing');
    assert.equal(ra.roundInfo.mode, 'code-race');
    assert.equal(ra.roundInfo.category, 'lists');
    assert.match(ra.roundInfo.note, /Ada's vote, the only one cast; Ada \(host\) started it without waiting/);
    assert.equal((await b.until((r) => r.status === 'playing')).round, 1);

    // After the round, Bob (last) picks; if he has not, the host's start makes it random.
    a.socket.emit('duel:action', { type: 'submitResult', result: solve(firstQ(ra)) });
    b.socket.emit('duel:action', { type: 'finish' });
    await a.until((r) => r.status === 'finished');
    await a.request('duel:next');
    const lobby = await a.until((r) => r.status === 'lobby');
    assert.equal(lobby.pick.pickerId, named(lobby, 'Bob').id);
    assert.ok((await a.request('duel:start', { pick: raceLists })).ok);
    const r2 = await a.until((r) => r.status === 'playing' && r.round === 2);
    assert.match(r2.roundInfo.note, /^random/);
  } finally {
    await close();
  }
});

test('a duel solve is saved with its code', async () => {
  const { client, close, solutions } = await setup();
  try {
    const { a, b, code } = await pair(client);
    const ra = await startRound(a, b);
    const qid = firstQ(ra);
    a.socket.emit('duel:action', { type: 'submitResult', result: solve(qid) });
    await a.until((r) => qOf(r, qid).status === 'solved');
    const [saved] = solutions.forQuestion(qid);
    assert.equal(saved.name, 'Ada');
    assert.equal(saved.kind, 'duel');
    assert.equal(saved.room, code);
    assert.equal(saved.code, getQuestion(qid).solution.sicpy);
    assert.ok(saved.points > 0);
  } finally {
    await close();
  }
});

const withPowers = { ...config, count: 3, powerups: { blackout: 2, wipe: 2, keyboard: 1, hints: 2 } };

/** Ada, Bob and Cy (each on their own) in a round with power-ups on. */
async function powerRound(client) {
  const a = client();
  const b = client();
  const c = client();
  await a.until((r) => r === null);
  const { code } = await a.request('duel:create', { name: 'Ada', config: withPowers });
  await b.request('duel:join', { code, name: 'Bob' });
  await c.request('duel:join', { code, name: 'Cy' });
  await a.until((r) => r?.players.length === 3);
  for (const x of [a, b, c]) await x.request('duel:pick', raceLists);
  for (const x of [a, b, c]) await x.request('duel:ready', { ready: true });
  const ra = await a.until((r) => r.status === 'playing');
  await b.until((r) => r.status === 'playing');
  await c.until((r) => r.status === 'playing');
  return { a, b, c, ra };
}

test('blackout hits every opponent for 15 seconds, then a cooldown; their submits wait for it', async () => {
  const { client, close } = await setup();
  try {
    const { a, b, c, ra } = await powerRound(client);
    assert.deepEqual(ra.powers, { blackout: 2, wipe: 2, keyboard: 1, hints: 2, blackoutReadyAt: 0 });
    assert.ok((await a.request('duel:power', { type: 'blackout' })).ok);
    for (const x of [b, c]) {
      const seen = await x.until((r) => me(r).blackedUntil);
      const left = me(seen).blackedUntil - Date.now();
      assert.ok(left > 12_000 && left <= 15_000, `about 15 s (${left})`);
      assert.equal(me(seen).blackedBy, 'Ada');
    }
    const after = await a.until((r) => r.powers.blackout === 1);
    assert.equal(me(after).blackedUntil, null, 'not yourself');
    assert.ok(after.powers.blackoutReadyAt - Date.now() > 170_000, 'three minutes before the next one');
    assert.match((await a.request('duel:power', { type: 'blackout' })).error, /cooling down/);
    assert.ok(b.chat.some((m) => m.text.includes('Ada blacked out everyone (Bob, Cy)')));

    // Bob's submit while blacked out is held back (not applied yet).
    const qid = firstQ(ra);
    b.socket.emit('duel:action', { type: 'submitResult', result: solve(qid), seq: 1 });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(qOf(b.room, qid).status, 'open');
  } finally {
    await close();
  }
});

test('wipe: every opponent’s open question goes back to its starting code, except solved ones', async () => {
  const { client, close } = await setup();
  try {
    const { a, b, c, ra } = await powerRound(client);
    const wiped = { b: [], c: [], a: [] };
    b.socket.on('duel:wipe', (w) => wiped.b.push(w));
    c.socket.on('duel:wipe', (w) => wiped.c.push(w));
    a.socket.on('duel:wipe', (w) => wiped.a.push(w));
    const qid = firstQ(ra);
    assert.ok((await a.request('duel:power', { type: 'wipe' })).ok);
    await waitFor(() => wiped.b.length === 1 && wiped.c.length === 1);
    assert.equal(wiped.a.length, 0, 'not yourself');
    assert.equal(wiped.b[0].questionId, qid);
    assert.equal(wiped.b[0].by, 'Ada');
    assert.equal(wiped.b[0].code, startingCode(getQuestion(qid), 'py3'));

    // Bob solves the question he has open: the next wipe only hits Cy.
    b.socket.emit('duel:action', { type: 'submitResult', result: solve(qid), seq: 1 });
    await b.until((r) => qOf(r, qid).status === 'solved');
    assert.ok((await a.request('duel:power', { type: 'wipe' })).ok);
    await waitFor(() => wiped.c.length === 2);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(wiped.b.length, 1);
    assert.match((await a.request('duel:power', { type: 'wipe' })).error, /no wipes left/);
  } finally {
    await close();
  }
});

test('mouse keys: one opponent you pick types on an on-screen keyboard for 30 seconds', async () => {
  const { client, close } = await setup();
  try {
    const { a, b, c, ra } = await powerRound(client);
    const bobId = named(ra, 'Bob').id;
    assert.match((await a.request('duel:power', { type: 'keyboard', targetId: me(ra).id })).error, /Pick an opponent/);
    assert.match((await a.request('duel:power', { type: 'keyboard' })).error, /Pick an opponent/);
    assert.ok((await a.request('duel:power', { type: 'keyboard', targetId: bobId })).ok);
    const seen = await b.until((r) => me(r).keyboardUntil);
    const left = me(seen).keyboardUntil - Date.now();
    assert.ok(left > 27_000 && left <= 30_000, `about 30 s (${left})`);
    assert.equal(me(seen).keyboardBy, 'Ada');
    assert.equal(me(c.room).keyboardUntil, null, 'only Bob');
    assert.equal((await a.until((r) => r.powers.keyboard === 0)).powers.keyboard, 0);
    assert.match((await a.request('duel:power', { type: 'keyboard', targetId: bobId })).error, /no Mouse keys left/);
    assert.ok(b.chat.some((m) => m.text.includes("Ada took Bob's keyboard")));
  } finally {
    await close();
  }
});

test('hints: pseudo-code or lines of a solution, for your side only', async () => {
  const { client, close } = await setup();
  try {
    const { a, b, ra } = await powerRound(client);
    const qid = firstQ(ra);
    const one = await a.request('duel:hint', { questionId: qid, kind: 'outline' });
    assert.ok(one.ok);
    assert.match(one.hint.outline, /^def /);
    assert.ok(one.hint.outline.includes('…'));
    assert.match((await a.request('duel:hint', { questionId: qid, kind: 'outline' })).error, /already have/, 'not charged twice');
    const two = await a.request('duel:hint', { questionId: qid, kind: 'lines' });
    assert.equal(two.hint.lines, getQuestion(qid).solution.sicpy.split('\n').slice(0, 3).join('\n'));
    assert.match((await a.request('duel:hint', { questionId: qid, kind: 'lines' })).error, /no hints left/);
    const seenA = await a.until((r) => r.hints[qid]?.lines);
    assert.equal(seenA.powers.hints, 0);
    assert.deepEqual(b.room.hints, {}, 'Bob does not see Ada’s hints');
  } finally {
    await close();
  }
});

test('a team is wiped through its shared document', async () => {
  const { client, close } = await setup();
  try {
    const { a, b, ra, bobId } = await (async () => {
      const x = client();
      const y = client();
      const z = client();
      await x.until((r) => r === null);
      const { code } = await x.request('duel:create', { name: 'Ada', config: withPowers });
      await y.request('duel:join', { code, name: 'Bob' });
      await z.request('duel:join', { code, name: 'Cy' });
      await y.request('duel:team', { team: 'red' });
      await z.request('duel:team', { team: 'red' });
      for (const c of [x, y, z]) await c.request('duel:pick', raceLists);
      for (const c of [x, y, z]) await c.request('duel:ready', { ready: true });
      const r = await x.until((s) => s.status === 'playing');
      return { a: x, b: y, ra: r, bobId: named(r, 'Bob').id };
    })();
    const qid = firstQ(ra);
    const opened = await b.request('team:open', { questionId: qid });
    await b.request('team:push', { questionId: qid, version: opened.version, updates: [{ clientID: 'b', changes: [opened.doc.length, [0, '# mine\n']] }] });
    const updates = [];
    b.socket.on('team:updates', (u) => updates.push(u));
    assert.ok((await a.request('duel:power', { type: 'wipe' })).ok);
    await waitFor(() => updates.some((u) => u.updates.some((x) => x.clientID === 'wipe')));
    const again = await b.request('team:open', { questionId: qid });
    assert.equal(again.doc, startingCode(getQuestion(qid), 'py3'));
    assert.ok(a.chat.some((m) => m.text.includes("Ada wiped everyone's code (Bob, Cy)")));
  } finally {
    await close();
  }
});

test('the host cannot start alone', async () => {
  const { client, close } = await setup();
  try {
    const a = client();
    await a.until((r) => r === null);
    await a.request('duel:create', { name: 'Ada', config });
    assert.match((await a.request('duel:start', { pick: raceLists })).error, /someone to join/);
  } finally {
    await close();
  }
});

/** A fake clip that starts like a WebM file. */
const webm = (bytes = 2000) => {
  const buf = Buffer.alloc(bytes, 7);
  buf.writeUInt32BE(0x1a45dfa3, 0);
  return buf;
};

test('voice messages reach the room (or the team), are checked and rate-limited', async () => {
  const { client, close } = await setup();
  try {
    assert.equal(audioType(webm()), 'audio/webm');
    assert.equal(audioType(Buffer.from('OggS\0\0\0\0\0\0\0\0')), 'audio/ogg');
    assert.equal(audioType(Buffer.from('\0\0\0\x20ftypM4A \0\0')), 'audio/mp4');
    assert.equal(audioType(Buffer.from('<html><script>alert(1)</script>')), null);

    const { a, b } = await pair(client);
    assert.ok((await a.request('duel:voice', { audio: webm(), seconds: 2.34 })).ok);
    await waitFor(() => b.chat.some((m) => m.voice));
    const msg = b.chat.find((m) => m.voice);
    assert.equal(msg.fromId, me(a.room).id);
    assert.equal(msg.voice.mime, 'audio/webm');
    assert.equal(msg.voice.seconds, 2.3);
    assert.equal(Buffer.from(msg.voice.audio).length, 2000);

    assert.ok((await a.request('duel:voice', { audio: Buffer.from('not audio at all'), seconds: 1 })).error, 'not audio');
    assert.ok((await a.request('duel:voice', { audio: webm(), seconds: 40 })).error, 'too long');
    assert.ok((await a.request('duel:voice', { audio: webm(100 * 1024), seconds: 5 })).error, 'too big');
    assert.ok((await a.request('duel:voice', { audio: 'text', seconds: 1 })).error, 'not binary');
    assert.ok((await a.request('duel:voice', { audio: webm(), seconds: 1, team: true })).error, 'Ada has no team');

    assert.ok((await a.request('duel:voice', { audio: webm(), seconds: 1 })).ok);
    assert.ok((await a.request('duel:voice', { audio: webm(), seconds: 1 })).ok);
    assert.match((await a.request('duel:voice', { audio: webm(), seconds: 1 })).error, /Too many/);
  } finally {
    await close();
  }
});

test('a room keeps the audio of its last ten voice clips only', async () => {
  const { client, close, duel } = await setup();
  try {
    const players = [];
    const a = client();
    await a.until((r) => r === null);
    const { code } = await a.request('duel:create', { name: 'P0', config });
    players.push(a);
    for (let i = 1; i < 4; i++) {
      const p = client();
      await p.until((r) => r === null);
      await p.request('duel:join', { code, name: `P${i}` });
      players.push(p);
    }
    // Three clips each (the voice limit), twelve in all.
    for (const p of players) for (let i = 0; i < 3; i++) assert.ok((await p.request('duel:voice', { audio: webm(), seconds: 1 })).ok);
    const clips = duel.rooms.get(code).chat.filter((m) => m.voice);
    assert.equal(clips.length, 12);
    assert.deepEqual(clips.map((m) => m.voice.audio !== null), [false, false, ...Array(10).fill(true)]);
  } finally {
    await close();
  }
});

test('line counts reach the other player, at most every few seconds and only for questions of the round', async () => {
  const { client, close } = await setup();
  try {
    const { a, b } = await pair(client);
    await startRound(a, b);
    const ra = await a.until((r) => r.status === 'playing');
    const qid = firstQ(ra);

    a.socket.emit('duel:progress', { questionId: 'XX-E99', lines: 5 });
    a.socket.emit('duel:progress', { questionId: qid, lines: 7.9 });
    const seen = await b.until((r) => named(r, 'Ada').progress !== null);
    assert.deepEqual(named(seen, 'Ada').progress, { questionId: qid, lines: 7 }, 'a stale question is ignored');

    a.socket.emit('duel:progress', { questionId: qid, lines: 12 });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(named(b.room, 'Ada').progress.lines, 7, 'a second update within the window is dropped');
  } finally {
    await close();
  }
});

test('spectators see scrambled code until they finish the question, then the real code', async () => {
  const { client, close } = await setup();
  try {
    const { a, b } = await pair(client);
    await startRound(a, b);
    const ra = await a.until((r) => r.status === 'playing');
    const qid = firstQ(ra);
    const ada = named(ra, 'Ada').id;
    const code = 'def secret_name(xs):\n    return 42';

    a.socket.emit('duel:code', { questionId: 'XX-E99', code: 'nope' });
    a.socket.emit('duel:code', { questionId: qid, code });
    await waitFor(() => b.watch.some((w) => w.playerId === ada && w.code !== null));
    const locked = b.watch.findLast((w) => w.playerId === ada);
    assert.equal(locked.locked, true, 'Bob has not finished the question');
    assert.equal(locked.questionId, qid);
    assert.equal(locked.code.length, code.length);
    assert.equal(locked.code.replace(/\S/g, 'x'), code.replace(/\S/g, 'x'), 'same shape: spaces and line breaks kept');
    assert.ok(!locked.code.includes('secret') && !locked.code.includes('return') && !locked.code.includes('42'), 'none of the text shows');
    assert.ok(a.watch.every((w) => w.playerId !== ada), 'nobody is sent their own code');

    const bob = named(ra, 'Bob').id;
    b.socket.emit('duel:code', { questionId: qid, code: 'def bobs_answer(): pass' });
    await waitFor(() => a.watch.some((w) => w.playerId === bob && w.code !== null));

    b.socket.emit('duel:action', { type: 'submitResult', result: solve(qid), seq: 1 });
    await waitFor(() => b.watch.findLast((w) => w.playerId === ada)?.locked === false);
    assert.equal(b.watch.findLast((w) => w.playerId === ada).code, code, 'after solving, the real code');
    // Ada has not finished the question, so Bob's code stays scrambled for her.
    const forAda = a.watch.filter((w) => w.playerId === bob && w.code !== null);
    assert.ok(forAda.length > 0 && forAda.every((w) => w.locked && !w.code.includes('bobs_answer')), 'Ada is still locked out');
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
    const extra = [];
    for (const name of ['C', 'D', 'E', 'F']) {
      const c = client();
      assert.ok((await c.request('duel:join', { code, name })).ok, `${name} gets a seat`);
      extra.push(c);
    }
    assert.equal((await client().request('duel:join', { code, name: 'G' })).error, 'That room is full.');
    for (const c of extra) await c.request('duel:leave');
    await a.until((r) => r.players.length === 2);
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
    b.socket.emit('duel:action', { type: 'finish' });
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

    // Ada stops straight away; the bot plays its round and then stops too.
    a.socket.emit('duel:action', { type: 'finish' });
    const done = await a.until((r) => r.status === 'finished', 15000);
    const botState = done.players.find((p) => p.id === bot.id).state;
    assert.equal(botState.status, 'finished');
    assert.equal(botState.qs.length, 3);
    assert.ok(botState.qs.some((q) => q.status === 'solved'), 'a hard bot solves something');
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
    const qid = firstQ(room);
    // A one-line "cheat": claim the question has a single test and it passes.
    a.socket.emit('duel:action', { type: 'submitResult', result: { questionId: qid, passedVisible: 1, passedHidden: 0, total: 1, timeMs: 1 }, seq: 1 });
    const after = await a.until((r) => r.yourSeq === 1);
    assert.equal(qOf(after, qid).status, 'open', 'not solved');
    assert.equal(qOf(after, qid).attempts, 0, 'not even counted');
    // Nor a question that is not in the round.
    a.socket.emit('duel:action', { type: 'submitResult', result: solve('CR-E01'), seq: 2 });
    await a.until((r) => r.yourSeq === 2);
    a.socket.emit('duel:action', { type: 'submitResult', result: solve(qid), seq: 3 });
    const solved = await a.until((r) => r.yourSeq === 3);
    assert.equal(qOf(solved, qid).status, 'solved');
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
    b.socket.emit('duel:action', { type: 'finish' });
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

test('the server re-runs claimed solves (Python §) and rejects wrong code', async () => {
  const { client, close } = await setup();
  try {
    const { a, b } = await pair(client);
    const room = await startRound(a, b);
    await b.until((r) => r?.status === 'playing');
    const qid = firstQ(room);
    const verdicts = [];
    a.socket.on('duel:verify', (v) => verdicts.push(v));

    // Claims every test passes, but the code is just the starter stub.
    const stub = getQuestion(qid).starter.sicpy;
    a.socket.emit('duel:action', { type: 'submitResult', result: solve(qid, stub), seq: 1 });
    const rejected = await a.until((r) => r.yourSeq === 1, 15000);
    assert.equal(qOf(rejected, qid).status, 'open');
    assert.equal(qOf(rejected, qid).failedSubmits, 1, 'counts as a wrong submit');
    assert.match(verdicts[0]?.message ?? '', /re-ran your code/);

    // No code at all is not accepted either.
    a.socket.emit('duel:action', { type: 'submitResult', result: { ...solve(qid), code: undefined }, seq: 2 });
    const noCode = await a.until((r) => r.yourSeq === 2, 15000);
    assert.equal(qOf(noCode, qid).status, 'open');

    // The real solution passes the check.
    a.socket.emit('duel:action', { type: 'submitResult', result: solve(qid), seq: 3 });
    const solved = await a.until((r) => r.yourSeq === 3, 15000);
    assert.equal(qOf(solved, qid).status, 'solved');
  } finally {
    await close();
  }
});

test('an infinite loop in a claimed solve only fails the submit', async () => {
  const { client, close } = await setup();
  try {
    const { a, b } = await pair(client);
    const room = await startRound(a, b);
    const qid = firstQ(room);
    const fn = getQuestion(qid).functionName;
    const loop = `def ${fn}(*args):\n    while True:\n        x = 1`;
    a.socket.emit('duel:action', { type: 'submitResult', result: solve(qid, loop), seq: 1 });
    const after = await a.until((r) => r.yourSeq === 1, 30000);
    assert.equal(qOf(after, qid).status, 'open');
    // The server still answers.
    assert.ok((await b.request('duel:ready', { ready: true })).error);
  } finally {
    await close();
  }
});

test('code that blows the memory limit on the server counts as a wrong submit', async () => {
  const { client, close } = await setup();
  try {
    const { a, b } = await pair(client);
    const room = await startRound(a, b);
    const qid = firstQ(room);
    const sig = getQuestion(qid).starter.sicpy.split('\n')[0];
    const bomb = `${sig}\n    a = [0] * 2000000000\n    return None`;
    a.socket.emit('duel:action', { type: 'submitResult', result: solve(qid, bomb), seq: 1 });
    const after = await a.until((r) => r.yourSeq === 1, 30000);
    assert.equal(qOf(after, qid).status, 'open');
    assert.equal(qOf(after, qid).failedSubmits, 1);
    // The next honest solve is still checked and accepted.
    a.socket.emit('duel:action', { type: 'submitResult', result: solve(qid), seq: 2 });
    const solved = await a.until((r) => r.yourSeq === 2, 30000);
    assert.equal(qOf(solved, qid).status, 'solved');
  } finally {
    await close();
  }
});

/** Ada (host), Bob and Cy in a room. */
async function trio(client, cfg = config) {
  const a = client();
  const b = client();
  const c = client();
  await a.until((r) => r === null);
  const { code } = await a.request('duel:create', { name: 'Ada', config: cfg });
  await b.request('duel:join', { code, name: 'Bob' });
  await c.request('duel:join', { code, name: 'Cy' });
  await a.until((r) => r?.players.length === 3);
  return { a, b, c };
}

test('teammates share one score, one live editor and a team chat', async () => {
  const { client, close } = await setup();
  try {
    const { a, b, c } = await trio(client);
    assert.ok((await a.request('duel:team', { team: 'red' })).ok);
    assert.ok((await b.request('duel:team', { team: 'red' })).ok);
    assert.match((await b.request('duel:team', { team: 'red', playerId: named(b.room, 'Cy').id })).error, /own team/);
    for (const x of [a, b, c]) await x.request('duel:pick', raceLists);
    for (const x of [a, b, c]) await x.request('duel:ready', { ready: true });
    const room = await c.until((r) => r.status === 'playing');
    assert.equal(room.sides.length, 2, 'Red team and Cy');
    const red = room.sides.find((s) => s.team === 'red');
    assert.deepEqual(red.memberIds.sort(), [named(room, 'Ada').id, named(room, 'Bob').id].sort());
    const qid = firstQ(room);

    // Ada and Bob edit one document: Ada's change reaches Bob.
    const opened = await a.request('team:open', { questionId: qid });
    assert.equal(opened.version, 0);
    assert.equal(opened.doc, getQuestion(qid).starter.sicpy);
    const bobUpdates = [];
    b.socket.on('team:updates', (u) => bobUpdates.push(u));
    const insert = '# plan: loop over the list\n';
    const pushed = await a.request('team:push', { questionId: qid, version: 0, updates: [{ clientID: 'ada1', changes: [[0, insert], opened.doc.length] }] });
    assert.ok(pushed.ok);
    await waitFor(() => bobUpdates.length === 1);
    assert.equal(bobUpdates[0].from, 0);
    assert.equal((await b.request('team:open', { questionId: qid })).doc, insert + opened.doc);
    // An edit made on an old version is turned away, with what was missed.
    const stale = await b.request('team:push', { questionId: qid, version: 0, updates: [{ clientID: 'bob1', changes: [[0, 'x'], opened.doc.length] }] });
    assert.ok(stale.stale);
    assert.equal(stale.updates.length, 1);
    // Cy is not in a team.
    assert.ok((await c.request('team:open', { questionId: qid })).error);

    // Cy watches Ada: the team's document, scrambled.
    await waitFor(() => c.watch.some((w) => w.playerId === named(room, 'Ada').id && w.code !== null));
    const seen = c.watch.findLast((w) => w.playerId === named(room, 'Ada').id);
    assert.equal(seen.locked, true);
    assert.equal(seen.code.length, (insert + opened.doc).length);
    assert.ok(!seen.code.includes('plan'));

    // Team chat stays in the team.
    a.socket.emit('duel:chat', { text: 'I take the loop', team: true });
    await waitFor(() => b.chat.some((m) => m.text === 'I take the loop'));
    assert.equal(b.chat.find((m) => m.text === 'I take the loop').team, 'red');
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(!c.chat.some((m) => m.text === 'I take the loop'), 'Cy does not see it');

    // Bob's solve counts for Ada too, and ends their round (one question).
    b.socket.emit('duel:action', { type: 'submitResult', result: solve(qid), seq: 1 });
    const solvedForAda = await a.until((r) => qOf(r, qid)?.status === 'solved');
    assert.equal(me(solvedForAda).state.total, named(solvedForAda, 'Bob').state.total);
    // Cy loses, so Cy picks next.
    c.socket.emit('duel:action', { type: 'finish' });
    const done = await a.until((r) => r.status === 'finished');
    assert.equal(done.lastWinnerSide, 'team:red');
    assert.equal(done.wins[named(done, 'Ada').id], 1);
    assert.equal(done.wins[named(done, 'Bob').id], 1);
    await a.request('duel:next');
    const lobby = await a.until((r) => r.status === 'lobby');
    assert.equal(lobby.pick.pickerId, named(lobby, 'Cy').id);
  } finally {
    await close();
  }
});

test('the host\'s round options reach everyone; reveals only when allowed and only secret tests', async () => {
  const { client, close } = await setup();
  try {
    const { a, b } = await pair(client);
    assert.ok((await b.request('duel:config', { config: { ...config, minutes: 5 } })).error, 'only the host');
    assert.ok((await a.request('duel:config', { config: { ...config, minutes: 20, partial: true, revealCost: 0.25 } })).ok);
    const seen = await b.until((r) => r.config.minutes === 20);
    assert.deepEqual(seen.config, { ...config, minutes: 20, partial: true, revealCost: 0.25, powerups: { blackout: 0, wipe: 0, keyboard: 0, hints: 0 } });

    const room = await startRound(a, b);
    const qid = firstQ(room);
    const tests = resolveTests(getQuestion(qid), config.lang);
    const secret = tests.find((t) => t.hidden).index;
    const visible = tests.find((t) => !t.hidden).index;
    a.socket.emit('duel:action', { type: 'reveal', result: { questionId: qid, testIndex: visible }, seq: 1 });
    a.socket.emit('duel:action', { type: 'reveal', result: { questionId: qid, testIndex: secret }, seq: 2 });
    const after = await a.until((r) => r.yourSeq === 2);
    assert.deepEqual(qOf(after, qid).reveals, [secret]);

    // Partial credit: half the secret tests passing earns points without a solve.
    const { visible: v, total } = counts(qid);
    const half = Math.floor((total - v) / 2);
    b.socket.emit('duel:action', { type: 'submitResult', result: { ...solve(qid), passedHidden: half }, seq: 1 });
    const partial = await b.until((r) => r.yourSeq === 1);
    assert.equal(qOf(partial, qid).status, 'open');
    assert.ok(me(partial).state.total > 0, 'secret tests passed earn points');
  } finally {
    await close();
  }
});
