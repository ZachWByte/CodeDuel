// Duel chat: one panel, placed two ways. In the lobby it is the third column; in a
// round and on the results screen it is a side panel on the right (about a third of
// the screen) that the Chat button opens and closes. While it is closed, new
// messages show a short preview and an unread count on the button. In a team, a
// switch by the message box sends to the whole room or to your team only.
import { h, setChildren } from './dom.js';
import { icon } from './icons.js';

const QUICK = ['gg', '👏', '🔥', '😅', 'nice one', 'good luck!'];
const PREVIEW_MS = 4000;

/** createChatDock({ onSend(text, toTeam) }) -> { el, toggle, place, setTop, setLog, add, setYou, setTeam, setOpen, isOpen, detach, destroy } */
export function createChatDock({ onSend }) {
  let youId = null;
  let team = null; // your team colour, if any
  let toTeam = false;
  let open = true;
  let mode = 'side'; // 'column' (lobby) | 'side' (round, results)
  let unread = 0;
  let previewTimer = 0;

  const list = h('div.chat-list', { role: 'log', 'aria-live': 'polite' });
  const badge = h('span.chat-badge', { hidden: true });
  const preview = h('button.chat-preview', { type: 'button', hidden: true, onclick: () => setOpen(true) });
  const top = h('div.chat-top', { hidden: true });
  const input = h('input.chat-input', {
    maxlength: 200,
    placeholder: 'Say something…',
    'aria-label': 'Chat message',
    onkeydown: (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') send(input.value);
      if (e.key === 'Escape' && mode === 'side') setOpen(false);
    },
  });
  const channel = h('div.chat-channel', { hidden: true, role: 'radiogroup', 'aria-label': 'Send to' });
  function drawChannel() {
    channel.hidden = !team;
    if (!team) toTeam = false;
    const opt = (value, label) => h(`button.chat-chan${toTeam === value ? '.active' : ''}${value ? `.team-${team}` : ''}`, {
      type: 'button', role: 'radio', 'aria-checked': String(toTeam === value),
      onclick: () => { toTeam = value; drawChannel(); input.focus(); },
    }, label);
    setChildren(channel, opt(false, 'Room'), opt(true, 'Team'));
    input.placeholder = toTeam ? 'Message your team…' : 'Say something…';
  }
  const close = h('button.icon-btn.chat-close', { type: 'button', title: 'Close the chat', 'aria-label': 'Close the chat', onclick: () => setOpen(false) }, icon('close'));
  const toggle = h('button.btn.chat-toggle', {
    type: 'button',
    'aria-expanded': 'false',
    title: 'Chat and your opponent’s progress',
    onclick: () => setOpen(!open),
  }, icon('chat'), h('span', {}, 'Chat'), badge);
  const el = h('aside.chat-panel', { 'aria-label': 'Chat' },
    h('div.chat-head', {}, h('h2.col-title', {}, 'Chat'), close),
    top,
    list,
    h('div.chat-quick', {}, QUICK.map((q) => h('button.chat-chip', { type: 'button', onclick: () => send(q) }, q))),
    h('div.chat-row', {}, channel, input, h('button.btn.btn-primary', { type: 'button', onclick: () => send(input.value) }, 'Send')));

  function send(text) {
    const t = text.trim();
    if (!t) return;
    onSend(t, toTeam);
    input.value = '';
    input.focus();
  }

  function line(msg) {
    const time = new Date(msg.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const mine = msg.fromId === youId;
    const teamTag = msg.team ? h(`span.chat-team.team-${msg.team}`, {}, 'team') : null;
    if (msg.fromId === null) return h(`div.chat-msg.chat-system${msg.team ? '.chat-to-team' : ''}`, { title: time }, teamTag, msg.text);
    return h(`div.chat-msg${mine ? '.chat-mine' : ''}${msg.team ? `.chat-to-team.team-${msg.team}` : ''}`, { title: time },
      mine ? null : h('span.chat-name', {}, msg.bot ? icon('bot', 'Bot') : null, msg.name, teamTag),
      mine && teamTag ? h('span.chat-name', {}, teamTag) : null,
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

  function sync() {
    const shown = mode === 'column' || open;
    el.classList.toggle('chat-column', mode === 'column');
    el.classList.toggle('chat-side', mode === 'side');
    el.hidden = !shown;
    toggle.setAttribute('aria-expanded', String(shown));
    toggle.classList.toggle('active', mode === 'side' && open);
    // The screens make room for the side panel.
    document.body.classList.toggle('chat-side-open', mode === 'side' && open && el.isConnected);
    if (shown) {
      unread = 0;
      preview.hidden = true;
      scrollDown();
    }
    updateBadge();
  }

  function setOpen(value) {
    open = value;
    sync();
    if (open && mode === 'side') input.focus({ preventScroll: true });
  }

  return {
    el,
    toggle,
    /** 'column': the lobby puts el in its chat column. 'side': a panel on the right of the page. */
    place(next) {
      mode = next;
      if (mode === 'side' && el.parentNode !== document.body) document.body.append(el);
      if (!preview.isConnected) document.body.append(preview);
      sync();
    },
    /** Called after the lobby moved el into a fresh column. */
    refresh() { sync(); },
    /** Something to show above the messages (the opponents during a round), or null. */
    setTop(node) {
      setChildren(top, node);
      top.hidden = !node;
    },
    setYou(id) { youId = id; },
    /** Your team colour (or null): with one, messages can go to the team only. */
    setTeam(next) {
      if (team === next) return;
      team = next;
      drawChannel();
    },
    setLog(messages) {
      setChildren(list, messages.map(line));
      scrollDown();
    },
    add(msg) {
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      list.append(line(msg));
      while (list.children.length > 100) list.firstChild.remove();
      if (atBottom || msg.fromId === youId) scrollDown();
      if (el.hidden && msg.fromId !== youId) {
        unread += 1;
        updateBadge();
        showPreview(msg);
      }
    },
    setOpen,
    isOpen: () => open,
    detach() {
      document.body.classList.remove('chat-side-open');
      clearTimeout(previewTimer);
      preview.hidden = true;
      preview.remove();
      el.remove();
    },
    destroy() {
      this.detach();
    },
  };
}
