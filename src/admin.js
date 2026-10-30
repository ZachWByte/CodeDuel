// Admin login and the live view of everyone playing (server/admin.js). The login
// token is kept per tab (sessionStorage), so a reload stays logged in.
import { h, toast } from './ui/dom.js';
import { renderAdmin } from './ui/admin.js';
import { request, send, on } from './net/duel-client.js';

const TOKEN_KEY = 'cd.admin.token';

function stored(value) {
  try {
    if (value === undefined) return sessionStorage.getItem(TOKEN_KEY);
    if (value === null) sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, value);
  } catch { /* storage unavailable */ }
  return null;
}

/** The login dialog. Resolves true once logged in, false if closed. */
function loginDialog(login) {
  return new Promise((resolve) => {
    const user = h('input#admin-user', { name: 'username', autocomplete: 'username', required: true, maxlength: 64 });
    const pass = h('input#admin-pass', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, maxlength: 128 });
    const error = h('p.login-error', { role: 'alert' });
    const submit = h('button.btn.btn-primary', { type: 'submit' }, 'Log in');
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
    const form = h('form.modal.login-form', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'login-title',
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        error.textContent = '';
        const res = await login(user.value.trim(), pass.value);
        submit.disabled = false;
        if (res?.error) {
          error.textContent = res.error;
          pass.select();
          return;
        }
        close(true);
      },
    },
      h('h2.login-title#login-title', {}, 'Log in'),
      h('label.login-field', { for: 'admin-user' }, 'Username', user),
      h('label.login-field', { for: 'admin-pass' }, 'Password', pass),
      error,
      h('div.modal-actions', {}, h('button.btn', { type: 'button', onclick: () => close(false) }, 'Cancel'), submit));
    const overlay = h('div.modal-overlay', { onclick: (e) => { if (e.target === overlay) close(false); } }, form);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    user.focus();
  });
}

/** createAdmin({ root, mount, showHome }) -> { loggedIn(), login(), show(), logout() } */
export function createAdmin({ root, mount, showHome }) {
  let token = stored();

  async function login() {
    const ok = await loginDialog(async (username, password) => {
      const res = await request('admin:login', { username, password });
      if (res?.ok) {
        token = res.token;
        stored(token);
      }
      return res;
    });
    if (ok) show();
  }

  async function logout() {
    const t = token;
    token = null;
    stored(null);
    showHome();
    await request('admin:logout', { token: t });
  }

  function show() {
    mount(() => {
      let view = null;
      const screen = renderAdmin(root, {
        onBack: showHome,
        onLogout: logout,
        onWatch: (watch) => send('admin:watch', watch ?? {}),
        loadSolutions: () => request('admin:solutions'),
        loadSolution: (questionId) => request('admin:solution', { questionId }),
      });
      const off = on('admin:view', (v) => {
        view = v;
        screen.update(view);
      });
      // Also signs this connection in after a reload or a reconnect.
      const resume = async () => {
        const res = await request('admin:resume', { token });
        if (res?.error) {
          token = null;
          stored(null);
          toast(res.error, 4000, 'bad');
          showHome();
          return;
        }
        screen.resubscribe();
      };
      const offConnect = on('connect', resume);
      resume();
      return () => {
        off();
        offConnect();
        screen.cleanup();
        send('admin:leave');
      };
    });
  }

  return { loggedIn: () => token !== null, login, show, logout };
}
