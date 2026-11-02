// A player's account: log in or sign up, and keep their progress on the server
// (server/accounts.js). The game still reads and writes localStorage; this copies
// changes up, and on logging in merges the account into this browser. Passwords only
// go to the server, which hashes them; the browser keeps a login token.
import { h, segmented, setChildren, toast } from './ui/dom.js';
import { request, send, on } from './net/duel-client.js';
import { loadAccount, saveAccount, clearAccount, loadPrefs, localProgress, writeProgress, clearProgress, onProgressChange } from './state/storage.js';
import { mergeProgress, emptyProgress } from './state/progress.js';
import { setPrefs } from './state/prefs.js';

const SAVE_AFTER_MS = 1500;
const RETRY_AFTER_MS = 30_000;
const UPLOAD_CHUNK = 300; // entries per message: the server takes small messages only
const PASSWORD_MIN = 8;

/** The log in / sign up dialog. login(username, password), signup(...) -> { error? }. Resolves when closed. */
function accountDialog({ login, signup, onAdmin }) {
  return new Promise((resolve) => {
    let mode = 'login';
    const user = h('input#account-user', { name: 'username', autocomplete: 'username', required: true, maxlength: 20 });
    const pass = h('input#account-pass', { name: 'password', type: 'password', required: true, maxlength: 128 });
    const again = h('input#account-pass2', { name: 'password2', type: 'password', autocomplete: 'new-password', maxlength: 128 });
    const error = h('p.login-error', { role: 'alert' });
    const submit = h('button.btn.btn-primary#account-submit', { type: 'submit' });
    const title = h('h2.login-title#login-title');
    const switcher = h('div.login-switch');
    const signupOnly = h('div.login-form', {},
      h('label.login-field', { for: 'account-pass2' }, 'Password again', again),
      h('p.login-note', {}, `At least ${PASSWORD_MIN} characters. A forgotten password can't be reset. The admin can see when you were last online and the games you played.`));
    const close = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      }
    };
    function setMode(next) {
      mode = next;
      const creating = mode === 'signup';
      title.textContent = creating ? 'Create an account' : 'Log in';
      submit.textContent = creating ? 'Create account' : 'Log in';
      pass.setAttribute('autocomplete', creating ? 'new-password' : 'current-password');
      signupOnly.hidden = !creating;
      error.textContent = '';
      setChildren(switcher, segmented('Log in or create an account', [['login', 'Log in'], ['signup', 'Create account']], mode, setMode));
    }
    const form = h('form.modal.login-form', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'login-title',
      onsubmit: async (e) => {
        e.preventDefault();
        if (mode === 'signup' && pass.value !== again.value) {
          error.textContent = 'Those passwords do not match.';
          return;
        }
        submit.disabled = true;
        error.textContent = '';
        const res = await (mode === 'signup' ? signup : login)(user.value.trim(), pass.value);
        submit.disabled = false;
        if (res?.error) {
          error.textContent = res.error;
          pass.select();
          return;
        }
        close(true);
      },
    },
      title,
      switcher,
      h('label.login-field', { for: 'account-user' }, 'Username', user),
      h('label.login-field', { for: 'account-pass' }, 'Password', pass),
      signupOnly,
      error,
      h('div.modal-actions', {}, h('button.btn', { type: 'button', onclick: () => close(false) }, 'Cancel'), submit),
      onAdmin ? h('button.login-admin#account-admin', { type: 'button', onclick: () => { close(false); onAdmin(); } }, 'Admin login') : null);
    const overlay = h('div.modal-overlay', { onclick: (e) => { if (e.target === overlay) close(false); } }, form);
    setMode('login');
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    user.focus();
  });
}

/** createAccount({ admin, onChanged() }) -> { username(), open(), logout(), resume() } */
export function createAccount({ admin = null, onChanged }) {
  let account = loadAccount(); // { token, username } or null
  let pending = null; // progress not on the server yet
  let timer = 0;
  let listening = false;

  function dropLogin(message) {
    account = null;
    pending = null;
    clearTimeout(timer);
    clearAccount();
    if (message) toast(message, 4000, 'warn');
    onChanged();
  }

  async function flush() {
    clearTimeout(timer);
    if (!pending || !account) return;
    const patch = pending;
    pending = null;
    const res = await request('account:save', { token: account.token, patch });
    if (res?.expired) dropLogin(res.error);
    else if (res?.error) {
      // Not saved (the server is unreachable): keep it for the next try.
      pending = mergeProgress(patch, pending ?? emptyProgress());
      timer = setTimeout(flush, RETRY_AFTER_MS);
    }
  }

  onProgressChange((patch) => {
    if (!account) return;
    pending = mergeProgress(pending ?? emptyProgress(), patch);
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_AFTER_MS);
  });
  // Closing the tab: no time to wait for a reply.
  window.addEventListener('pagehide', () => {
    if (pending && account) send('account:save', { token: account.token, patch: pending });
  });

  /** Sends this browser's progress up, a bit at a time. */
  async function upload(local, server) {
    const fresh = (kind) => Object.entries(local[kind]).filter(([key, value]) => JSON.stringify(server[kind]?.[key]) !== JSON.stringify(value));
    const entries = [...fresh('bests').map((e) => ['bests', e]), ...fresh('sessions').map((e) => ['sessions', e])];
    const own = { name: server.name ? null : local.name, settings: server.settings ? null : local.settings, prefs: server.prefs ? null : local.prefs };
    if (!entries.length && !own.name && !own.settings && !own.prefs) return;
    for (let i = 0; i === 0 || i < entries.length; i += UPLOAD_CHUNK) {
      const patch = { ...emptyProgress(), ...(i === 0 ? own : null) };
      for (const [kind, [key, value]] of entries.slice(i, i + UPLOAD_CHUNK)) patch[kind][key] = value;
      const res = await request('account:save', { token: account.token, patch });
      if (res?.error) return;
    }
  }

  /** This browser and the account become the same: the account's name and settings, and the better scores. */
  async function arrive(server) {
    const local = localProgress();
    const merged = mergeProgress(local, server);
    merged.name ||= account.username;
    writeProgress(merged);
    setPrefs(loadPrefs(), { save: false });
    onChanged();
    await upload({ ...local, name: merged.name }, server);
  }

  function listen() {
    if (listening) return;
    listening = true;
    // After a dropped connection: this connection counts as them again.
    on('connect', () => { if (account) request('account:load', { token: account.token }); });
  }

  async function resume() {
    if (!account) return;
    listen();
    const res = await request('account:load', { token: account.token });
    if (res?.expired) dropLogin(res.error);
    else if (res?.ok) await arrive(res.progress);
  }

  /** A login or signup reply. */
  async function signedIn(res) {
    if (res?.error) return res;
    account = { token: res.token, username: res.username };
    saveAccount(account);
    listen();
    await arrive(res.progress);
    toast(`Logged in as ${res.username}.`);
    return res;
  }

  return {
    username: () => account?.username ?? null,
    async open() {
      const done = await accountDialog({
        login: async (username, password) => signedIn(await request('account:login', { username, password })),
        signup: async (username, password) => signedIn(await request('account:signup', { username, password })),
        onAdmin: admin ? () => admin.login() : null,
      });
      if (done) onChanged();
    },
    async logout() {
      await flush();
      const { token } = account;
      account = null;
      pending = null;
      clearTimeout(timer);
      clearAccount();
      clearProgress();
      await request('account:logout', { token });
      onChanged();
    },
    resume,
  };
}
