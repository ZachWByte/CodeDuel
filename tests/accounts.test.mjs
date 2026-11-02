import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect } from 'socket.io-client';
import { attachDuel } from '../server/duel.js';
import { createAccountStore, hashPassword, verifyPassword } from '../server/accounts.js';
import { createSolutionStore } from '../server/solutions.js';
import { createVerifier } from '../server/verify.js';
import { cleanProgress, mergeProgress } from '../src/state/progress.js';

const PASSWORD = 'correct horse battery';
const config = { lang: 'py3', difficulty: 'easy', count: 1 };

async function setup(accounts = createAccountStore({ file: ':memory:' })) {
  const http = createServer();
  const duel = attachDuel(http, {
    log: () => {}, countdownMs: 0, accounts, admin: { username: 'boss', password: 'adminpass' },
    solutions: createSolutionStore({ file: ':memory:' }), verifier: createVerifier({ prewarm: false }),
  });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${http.address().port}`;
  const sockets = [];
  const client = async () => {
    const socket = connect(url, { auth: { token: randomUUID() }, transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    await new Promise((r) => socket.once('connect', r));
    socket.request = (event, msg) => socket.emitWithAck(event, msg);
    return socket;
  };
  return { client, accounts, close: async () => { sockets.forEach((s) => s.close()); await duel.close(); } };
}

test('a hash has a salt and its cost, and only the right password matches it', async () => {
  const one = await hashPassword(PASSWORD);
  const two = await hashPassword(PASSWORD);
  assert.match(one, /^scrypt\$32768\$8\$3\$/);
  assert.notEqual(one, two, 'a new salt each time');
  assert.ok(!one.includes(PASSWORD));
  assert.equal(await verifyPassword(PASSWORD, one), true);
  assert.equal(await verifyPassword(`${PASSWORD}x`, one), false);
  assert.equal(await verifyPassword(PASSWORD, 'not a hash'), false);
});

test('the database never holds a password or a login token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'accounts-'));
  const file = join(dir, 'accounts.db');
  const { client, close } = await setup(createAccountStore({ file }));
  try {
    const c = await client();
    const res = await c.request('account:signup', { username: 'ada', password: PASSWORD });
    assert.ok(res.ok);
    await close();
    for (const name of readdirSync(dir)) {
      const bytes = readFileSync(join(dir, name)).toString('latin1');
      assert.ok(bytes.includes('scrypt$') || name !== 'accounts.db', 'the hash is what is stored');
      assert.ok(!bytes.includes(PASSWORD), `no password in ${name}`);
      assert.ok(!bytes.includes(res.token), `no token in ${name}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('signing up: names are checked, unique whatever the case, and the admin’s is taken', async () => {
  const { client, close } = await setup();
  try {
    const c = await client();
    assert.match((await c.request('account:signup', { username: 'a b', password: PASSWORD })).error, /letters/);
    assert.match((await c.request('account:signup', { username: 'ada', password: 'short' })).error, /at least 8/);
    assert.match((await c.request('account:signup', { username: 'ada', password: 'x'.repeat(129) })).error, /at most/);
    assert.match((await c.request('account:signup', { username: 'adalovelace', password: 'AdaLovelace' })).error, /cannot be your username/);
    assert.match((await c.request('account:signup', { username: 'BOSS', password: PASSWORD })).error, /taken/);
    assert.match((await c.request('account:signup', { username: 'admin', password: PASSWORD })).error, /taken/);
    assert.ok((await c.request('account:signup', { username: 'Ada', password: PASSWORD })).ok);
    assert.match((await c.request('account:signup', { username: 'ADA', password: PASSWORD })).error, /taken/);
  } finally {
    await close();
  }
});

test('logging in, loading from a token, logging out', async () => {
  const { client, close } = await setup();
  try {
    const c = await client();
    await c.request('account:signup', { username: 'Ada', password: PASSWORD });
    const wrong = await c.request('account:login', { username: 'ada', password: 'wrong password' });
    const nobody = await c.request('account:login', { username: 'nobody', password: PASSWORD });
    assert.equal(wrong.error, 'Wrong username or password.');
    assert.equal(nobody.error, wrong.error, 'an unknown name gets the same answer');
    const res = await c.request('account:login', { username: 'ada', password: PASSWORD });
    assert.equal(res.username, 'Ada');
    assert.equal(res.passwordHash, undefined);

    const other = await client();
    assert.equal((await other.request('account:load', { token: res.token })).username, 'Ada');
    assert.equal((await other.request('account:load', { token: 'f'.repeat(64) })).expired, true);
    await other.request('account:logout', { token: res.token });
    assert.equal((await other.request('account:load', { token: res.token })).expired, true);
  } finally {
    await close();
  }
});

test('too many wrong passwords lock that username for a while', async () => {
  const { client, close } = await setup();
  try {
    const c = await client();
    await c.request('account:signup', { username: 'ada', password: PASSWORD });
    for (let i = 0; i < 10; i++) await c.request('account:login', { username: 'ada', password: 'wrong password' });
    assert.match((await c.request('account:login', { username: 'ADA', password: PASSWORD })).error, /Too many/);
  } finally {
    await close();
  }
});

test('progress is saved and merged: the better score wins', async () => {
  const { client, close } = await setup();
  try {
    const c = await client();
    const { token } = await c.request('account:signup', { username: 'ada', password: PASSWORD });
    const best = (points, timeSec) => ({ points, timeSec, attempts: 1, date: '2026-11-02' });
    assert.ok((await c.request('account:save', { token, patch: { name: 'Ada', settings: { lang: 'py4' }, bests: { 'CR-E01.py3': best(150, 40) }, sessions: { 'py3.code-race.easy.3': 300 } } })).ok);
    await c.request('account:save', { token, patch: { bests: { 'CR-E01.py3': best(90, 10), 'CR-E02.py3': best(100, 20) }, sessions: { 'py3.code-race.easy.3': 100 } } });
    const { progress } = await c.request('account:load', { token });
    assert.equal(progress.name, 'Ada');
    assert.deepEqual(progress.settings, { lang: 'py4' });
    assert.equal(progress.bests['CR-E01.py3'].points, 150, 'a worse score does not replace it');
    assert.equal(progress.bests['CR-E02.py3'].points, 100);
    assert.equal(progress.sessions['py3.code-race.easy.3'], 300);
    assert.equal((await c.request('account:save', { token: 'bad', patch: {} })).expired, true);
  } finally {
    await close();
  }
});

test('malformed progress is dropped', () => {
  const clean = cleanProgress({
    name: '  Ada   L  ',
    settings: [1],
    bests: JSON.parse('{"__proto__": {"points": 1, "timeSec": 1}, "constructor": {"points": 1, "timeSec": 1}, "CR-E01.py3": {"points": -1, "timeSec": 1}, "CR-E02.py3": {"points": 5, "timeSec": 2, "extra": "x"}}'),
    sessions: { nope: 5, 'py3.code-race.easy.3': 'lots', 'py3.bug-hunt.easy.3': 7 },
  });
  assert.equal(clean.name, 'Ada L');
  assert.equal(clean.settings, null);
  assert.deepEqual(Object.keys(clean.bests), ['CR-E02.py3']);
  assert.equal(clean.bests['CR-E02.py3'].extra, undefined);
  assert.deepEqual(clean.sessions, { 'py3.bug-hunt.easy.3': 7 });
  assert.equal(({}).points, undefined);
  assert.equal(mergeProgress(null, null).name, null);
});

test('the admin sees last online and recent games, never a password', async () => {
  const { client, accounts, close } = await setup();
  try {
    const ada = await client();
    const bob = await client();
    const { token } = await ada.request('account:signup', { username: 'ada', password: PASSWORD });
    const admin = await client();
    assert.match((await admin.request('admin:accounts', {})).error, /Log in as admin/);
    assert.match((await admin.request('admin:account', { id: 1 })).error, /Log in as admin/);
    assert.ok((await admin.request('admin:login', { username: 'boss', password: 'adminpass' })).ok);

    // A duel: Ada is logged in, Bob is a guest.
    const { code } = await ada.request('duel:create', { name: 'Ada', config });
    await bob.request('duel:join', { code, name: 'Bob' });
    await ada.request('duel:start');
    ada.emit('duel:action', { type: 'finish' });
    bob.emit('duel:action', { type: 'finish' });
    let list;
    for (let i = 0; i < 100; i++) {
      list = (await admin.request('admin:accounts', {})).accounts;
      if (list[0].gamesPlayed === 1) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(list.length, 1, 'guests have no account');
    assert.equal(list[0].username, 'ada');
    assert.equal(list[0].online, true);
    assert.equal(list[0].passwordHash, undefined);
    assert.ok(!JSON.stringify(list).includes('scrypt'));
    const { games } = await admin.request('admin:account', { id: list[0].id });
    assert.equal(games[0].kind, 'duel');
    assert.equal(games[0].result, 'draw');
    assert.equal(games[0].opponents, 'Bob');
    assert.equal(games[0].mode, 'code-race');

    // A finished solo session counts once.
    const state = (status) => ({ status, total: 120, config: { lang: 'py3', mode: 'bug-hunt', difficulty: 'easy' }, questions: [{ id: 'CR-E01' }], results: [{ status: 'solved' }], current: {} });
    ada.emit('solo:update', { name: 'Ada', state: state('playing'), now: Date.now() });
    ada.emit('solo:update', { name: 'Ada', state: state('finished'), now: Date.now() });
    ada.emit('solo:update', { name: 'Ada', state: state('finished'), now: Date.now() });
    await ada.request('account:load', { token }); // after those, in order
    const after = (await admin.request('admin:account', { id: list[0].id })).games;
    assert.equal(after.length, 2);
    assert.deepEqual([after[0].kind, after[0].mode, after[0].points, after[0].solved], ['solo', 'bug-hunt', 120, 1]);

    // Going offline stops "online", and only the newest games are kept.
    ada.close();
    for (let i = 0; i < 100; i++) {
      list = (await admin.request('admin:accounts', {})).accounts;
      if (!list[0].online) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(list[0].online, false);
    assert.ok(Date.now() - list[0].lastSeenAt < 5000);
    for (let i = 0; i < 60; i++) accounts.recordGame(list[0].id, { kind: 'solo', questions: 1, solved: 0, points: 0 });
    assert.equal(accounts.games(list[0].id).length, 50);
    assert.equal(accounts.list()[0].gamesPlayed, 62, 'the total keeps counting');
  } finally {
    await close();
  }
});
