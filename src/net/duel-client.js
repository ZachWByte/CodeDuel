// Socket.IO connection to the duel server (same origin: Vite in dev, server/index.js in production).
import { io } from 'socket.io-client';

const TOKEN_KEY = 'cd.duel.token';
const ACTIVE_KEY = 'cd.duel.active';

// Per tab (sessionStorage), so two tabs on one computer are two players and a
// reload keeps the same seat.
function session(key, value) {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
  return null;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function token() {
  let t = session(TOKEN_KEY);
  if (!t || t.length < 16) {
    t = randomToken();
    session(TOKEN_KEY, t);
  }
  return t;
}

/** True when this tab was in a room before a reload. */
export const wasInDuel = () => session(ACTIVE_KEY) === '1';
export const markInDuel = (on) => session(ACTIVE_KEY, on ? '1' : null);

let socket = null;
const statusListeners = new Set();

function connection() {
  // After the server closed the connection (see duel:replaced) reconnect only when used.
  if (socket && !socket.active) socket.connect();
  if (!socket) {
    socket = io({ auth: { token: token() } });
    const emitStatus = (status) => statusListeners.forEach((fn) => fn(status));
    socket.on('connect', () => emitStatus('connected'));
    // The server gave this seat to another tab with the same token (a duplicated
    // tab copies sessionStorage). Take a new identity, so this tab never fights it.
    socket.on('duel:replaced', () => {
      const fresh = randomToken();
      session(TOKEN_KEY, fresh);
      socket.auth = { token: fresh };
      emitStatus('replaced');
    });
    socket.on('disconnect', () => emitStatus('disconnected'));
    socket.on('connect_error', () => emitStatus('disconnected'));
  }
  return socket;
}

export const isConnected = () => socket?.connected ?? false;

/** Sends a request and resolves with the server's reply ({ ok } or { error }). */
export function request(event, payload = {}) {
  return new Promise((resolve) => {
    connection().timeout(8000).emit(event, payload, (err, reply) => {
      resolve(err ? { error: "Can't reach the game server. Check your connection and try again." } : reply);
    });
  });
}

export const send = (event, payload = {}) => connection().emit(event, payload);

/** fn(payload) for every `event` from the server. -> stop() */
export function on(event, fn) {
  const s = connection();
  s.on(event, fn);
  return () => s.off(event, fn);
}

export function onRoom(fn) {
  const s = connection();
  s.on('duel:room', fn);
  return () => s.off('duel:room', fn);
}

/** fn('connected' | 'disconnected' | 'replaced') */
export function onConnection(fn) {
  connection();
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/** fn(message) for each new chat message; fnLog(messages) when the server sends the whole log. */
export function onChat(fn, fnLog) {
  const s = connection();
  s.on('duel:chat', fn);
  s.on('duel:chatlog', fnLog);
  return () => {
    s.off('duel:chat', fn);
    s.off('duel:chatlog', fnLog);
  };
}

/** fn({ questionId, message }) when the server rejected a solve after re-running the code. */
export function onVerify(fn) {
  const s = connection();
  s.on('duel:verify', fn);
  return () => s.off('duel:verify', fn);
}

/** fn({ playerId, questionId, locked, code }) when what you can see of an opponent's code changes. */
export function onWatch(fn) {
  const s = connection();
  s.on('duel:watch', fn);
  return () => s.off('duel:watch', fn);
}

/** fn({ questionId, from, updates }) for teammates' edits to a shared document. -> stop() */
export function onTeamUpdates(fn) {
  const s = connection();
  s.on('team:updates', fn);
  return () => s.off('team:updates', fn);
}

/** fn({ playerId, name, team, questionId, pos }) when a teammate's cursor moves. -> stop() */
export function onTeamCursor(fn) {
  const s = connection();
  s.on('team:cursor', fn);
  return () => s.off('team:cursor', fn);
}
