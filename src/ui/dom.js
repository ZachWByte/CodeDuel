// Tiny DOM helpers shared by the screens.

/** h('div.card#id', { onclick, disabled, ... }, ...children) */
export function h(tag, props = {}, ...children) {
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || 'div');
  for (const part of rest) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

/** Row of toggle buttons; options are [value, label] pairs. */
export function segmented(name, options, value, onChange) {
  return h('div.segmented', { role: 'radiogroup', 'aria-label': name },
    options.map(([v, label]) => h('button.seg', {
      type: 'button',
      role: 'radio',
      'aria-checked': String(v === value),
      class: v === value ? 'active' : undefined,
      onclick: () => onChange(v),
    }, label)));
}

/** Replace an element's children, skipping null / false / undefined. */
export function setChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Minimal markdown: paragraphs, "- " lists, `code`, **bold**. */
export function markdown(text) {
  const inline = (s) => escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return text.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => l.startsWith('- '))) {
      return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

export function formatTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** In-page confirmation dialog (never window.confirm). Resolves true / false. */
export function confirmDialog(message, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const close = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Enter') { e.preventDefault(); close(true); }
    };
    const okBtn = h(`button.btn${danger ? '.btn-danger' : '.btn-primary'}`, { onclick: () => close(true) }, ok);
    const overlay = h('div.modal-overlay', { onclick: (e) => { if (e.target === overlay) close(false); } },
      h('div.modal', { role: 'dialog', 'aria-modal': 'true' },
        h('p.modal-message', {}, message),
        h('div.modal-actions', {},
          h('button.btn', { onclick: () => close(false) }, cancel),
          okBtn)));
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    okBtn.focus();
  });
}

let toastStack = null;

/** Small transient message at the bottom of the screen. kind: 'warn' | 'bad' | 'good' for a coloured edge. */
export function toast(message, ms = 3500, kind = null) {
  if (!toastStack?.isConnected) {
    toastStack = h('div.toast-stack', { 'aria-live': 'polite' });
    document.body.append(toastStack);
  }
  const el = h(`div.toast${kind ? `.toast-${kind}` : ''}`, {}, message);
  toastStack.append(el);
  // Keep at most four on screen.
  while (toastStack.children.length > 4) toastStack.firstChild.remove();
  setTimeout(() => el.classList.add('toast-hide'), ms);
  setTimeout(() => el.remove(), ms + 400);
}
