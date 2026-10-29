// Duel chat: a dock in the bottom-right corner while you are in a room.
// Open in the lobby and on the results screen, folded during a round (with an
// unread count and a short preview of new messages).
import { h, setChildren } from './dom.js';

const QUICK = ['gg', '👏', '🔥', '😅', 'nice one', 'good luck!'];
const PREVIEW_MS = 4000;

/** createChatDock({ onSend(text) }) -> { el, setLog, add, setYou, setOpen, destroy } */
export function createChatDock({ onSend }) {
  let youId = null;
  let open = true;
  let unread = 0;
  let previewTimer = 0;

  const list = h('div.chat-list', { role: 'log', 'aria-live': 'polite' });
  const badge = h('span.chat-badge', { hidden: true });
  const preview = h('div.chat-preview', { hidden: true });
  const input = h('input.chat-input', {
    maxlength: 200,
    placeholder: 'Say something…',
    'aria-label': 'Chat message',
    onkeydown: (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') send(input.value);
      if (e.key === 'Escape') setOpen(false);
    },
  });
  const toggle = h('button.chat-toggle', {
    type: 'button',
    onclick: () => setOpen(!open),
  }, h('span', {}, '💬 Chat'), badge);
  const body = h('div.chat-body', {},
    list,
    h('div.chat-quick', {}, QUICK.map((q) => h('button.chat-chip', { type: 'button', onclick: () => send(q) }, q))),
    h('div.chat-row', {}, input, h('button.btn.btn-small.btn-primary', { type: 'button', onclick: () => send(input.value) }, 'Send')));
  const el = h('aside.chat-dock', { 'aria-label': 'Chat' }, preview, toggle, body);

  function send(text) {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    input.value = '';
    input.focus();
  }

  function line(msg) {
    const time = new Date(msg.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (msg.fromId === null) return h('div.chat-msg.chat-system', { title: time }, msg.text);
    const mine = msg.fromId === youId;
    return h(`div.chat-msg${mine ? '.chat-mine' : ''}`, { title: time },
      mine ? null : h('span.chat-name', {}, msg.bot ? `🤖 ${msg.name}` : msg.name),
      h('span.chat-text', {}, msg.text));
  }

  const scrollDown = () => { list.scrollTop = list.scrollHeight; };

  function updateBadge() {
    badge.hidden = open || unread === 0;
    badge.textContent = String(unread);
  }

  function showPreview(msg) {
    setChildren(preview, msg.fromId === null ? msg.text : [h('strong', {}, `${msg.name}: `), msg.text]);
    preview.hidden = false;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { preview.hidden = true; }, PREVIEW_MS);
  }

  function setOpen(value) {
    open = value;
    el.classList.toggle('chat-open', open);
    // Lets the lobby and results screens make room for the open dock.
    document.body.classList.toggle('chat-open-side', open && el.isConnected);
    if (open) {
      unread = 0;
      preview.hidden = true;
      scrollDown();
    }
    updateBadge();
  }

  setOpen(true);
  return {
    el,
    setYou(id) { youId = id; },
    setLog(messages) {
      setChildren(list, messages.map(line));
      scrollDown();
    },
    add(msg) {
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      list.append(line(msg));
      while (list.children.length > 100) list.firstChild.remove();
      if (atBottom || msg.fromId === youId) scrollDown();
      if (!open && msg.fromId !== youId) {
        unread += 1;
        updateBadge();
        showPreview(msg);
      }
    },
    setOpen,
    isOpen: () => open,
    detach() {
      document.body.classList.remove('chat-open-side');
      el.remove();
    },
    destroy() {
      clearTimeout(previewTimer);
      this.detach();
    },
  };
}
