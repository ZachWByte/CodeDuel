// Duel chat: one panel, placed two ways. In the lobby it is the third column; in a
// round and on the results screen it is a side panel on the right (about a third of
// the screen) that the Chat button opens and closes. While it is closed, new
// messages show a short preview and an unread count on the button. In a team, a
// switch by the message box sends to the whole room or to your team only.
//
// The mic button records a voice message (up to VOICE_MAX_S seconds, sent when you
// press Send or when time runs out). Voice messages play in the chat with a small
// player; they never play on their own.
import { h, setChildren, toast } from './dom.js';
import { icon } from './icons.js';

const QUICK = ['gg', '👏', '🔥', '😅', 'nice one', 'good luck!'];
const PREVIEW_MS = 4000;
const VOICE_MAX_S = 15;
const VOICE_MIN_S = 0.5;
const VOICE_BITS_PER_SECOND = 32_000; // 15 s stays well under the server's limit
const VOICE_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
const canRecord = () => typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// One clip plays at a time, across the whole page.
let playing = null; // { audio, stop() }

/** A voice message's player: play / pause, how far it got, and its length. */
function voicePlayer(voice, urls) {
  if (!voice.audio) return h('span.chat-voice.chat-voice-gone', {}, icon('mic'), 'Voice message (no longer available)');
  let audio = null;
  const fill = h('i');
  const time = h('span.voice-time', {}, clock(voice.seconds));
  const btn = h('button.voice-play', { type: 'button', 'aria-label': 'Play the voice message', onclick: toggle }, icon('play'));
  const el = h('span.chat-voice', {}, btn, h('span.voice-bar', { 'aria-hidden': 'true' }, fill), time);

  function draw(on) {
    setChildren(btn, icon(on ? 'pause' : 'play'));
    btn.setAttribute('aria-label', on ? 'Pause the voice message' : 'Play the voice message');
    el.classList.toggle('is-playing', on);
  }
  function stop() {
    audio.pause();
    audio.currentTime = 0;
  }
  function toggle() {
    if (!audio) {
      // WebM from MediaRecorder has no length in it, so the bar uses the length sent with the clip.
      const url = URL.createObjectURL(new Blob([voice.audio], { type: voice.mime }));
      urls.add(url);
      audio = new Audio(url);
      audio.addEventListener('timeupdate', () => {
        fill.style.width = `${Math.min(100, (audio.currentTime / voice.seconds) * 100)}%`;
        time.textContent = clock(audio.currentTime || voice.seconds);
      });
      audio.addEventListener('pause', () => draw(false));
      audio.addEventListener('play', () => draw(true));
      audio.addEventListener('ended', () => {
        draw(false);
        fill.style.width = '0%';
        time.textContent = clock(voice.seconds);
        if (playing?.audio === audio) playing = null;
      });
    }
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (playing && playing.audio !== audio) playing.stop();
    playing = { audio, stop };
    audio.play().catch(() => toast('This browser can’t play that voice message.', 3500, 'bad'));
  }
  return el;
}

/** createChatDock({ onSend(text, toTeam), onVoice?(audio, seconds, toTeam) -> reply }) -> { el, toggle, place, setTop, setLog, add, setYou, setTeam, setOpen, isOpen, detach, destroy } */
export function createChatDock({ onSend, onVoice = null }) {
  let youId = null;
  let team = null; // your team colour, if any
  let toTeam = false;
  let open = true;
  let mode = 'side'; // 'column' (lobby) | 'side' (round, results)
  let unread = 0;
  let previewTimer = 0;
  let rec = null; // the voice message being recorded
  let starting = false; // waiting for the microphone
  const urls = new Set(); // object URLs of the clips played, freed with the log

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
  const recTime = h('span.rec-time');
  const recFill = h('i');
  const recBar = h('div.chat-rec', { hidden: true, role: 'status' },
    h('span.rec-dot', { 'aria-hidden': 'true' }), recTime, h('span.voice-bar', { 'aria-hidden': 'true' }, recFill));
  const mic = h('button.icon-btn.chat-mic', {
    type: 'button',
    hidden: !onVoice || !canRecord(),
    onclick: () => (rec ? stopRecording(false) : startRecording()),
  });
  const sendBtn = h('button.btn.btn-primary', { type: 'button', onclick: () => (rec ? stopRecording(true) : send(input.value)) }, 'Send');
  const el = h('aside.chat-panel', {
    'aria-label': 'Chat',
    onkeydown: (e) => {
      if (rec && e.key === 'Escape') {
        e.stopPropagation();
        stopRecording(false);
      }
    },
  },
    h('div.chat-head', {}, h('h2.col-title', {}, 'Chat'), close),
    top,
    list,
    h('div.chat-quick', {}, QUICK.map((q) => h('button.chat-chip', { type: 'button', onclick: () => send(q) }, q))),
    h('div.chat-row', {}, channel, input, recBar, mic, sendBtn));
  drawRecording();

  function send(text) {
    const t = text.trim();
    if (!t) return;
    onSend(t, toTeam);
    input.value = '';
    input.focus();
  }

  // ---------------------------------------------------------------- voice messages

  function drawRecording() {
    const on = rec !== null;
    input.hidden = on;
    recBar.hidden = !on;
    channel.classList.toggle('is-locked', on);
    setChildren(mic, icon(on ? 'close' : 'mic'));
    const label = on ? 'Cancel the voice message' : `Record a voice message (up to ${VOICE_MAX_S} seconds)`;
    mic.title = label;
    mic.setAttribute('aria-label', label);
    mic.classList.toggle('is-recording', on);
    if (on) tickRecording();
  }

  function tickRecording() {
    const s = (performance.now() - rec.startedAt) / 1000;
    recTime.textContent = `${clock(s)} / ${clock(VOICE_MAX_S)}`;
    recFill.style.width = `${Math.min(100, (s / VOICE_MAX_S) * 100)}%`;
    if (s >= VOICE_MAX_S) stopRecording(true);
  }

  async function startRecording() {
    if (rec || starting) return;
    starting = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      toast(err?.name === 'NotAllowedError' ? 'Allow the microphone in your browser to send voice messages.' : 'No microphone was found.', 4500, 'bad');
      return;
    } finally {
      starting = false;
    }
    const mimeType = VOICE_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: VOICE_BITS_PER_SECOND });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      toast('This browser can’t record voice messages.', 4000, 'bad');
      return;
    }
    const r = { recorder, stream, chunks: [], startedAt: performance.now(), toTeam, send: false, seconds: 0, timer: 0 };
    recorder.addEventListener('dataavailable', (e) => { if (e.data.size) r.chunks.push(e.data); });
    recorder.addEventListener('stop', () => finishRecording(r));
    recorder.start();
    r.timer = setInterval(tickRecording, 200);
    rec = r;
    drawRecording();
  }

  /** Stops the recording; send: false throws it away. */
  function stopRecording(sendIt) {
    const r = rec;
    if (!r) return;
    rec = null;
    clearInterval(r.timer);
    r.send = sendIt;
    r.seconds = Math.min(VOICE_MAX_S, (performance.now() - r.startedAt) / 1000);
    if (r.recorder.state !== 'inactive') r.recorder.stop();
    r.stream.getTracks().forEach((t) => t.stop());
    drawRecording();
  }

  async function finishRecording(r) {
    if (!r.send) return;
    if (r.seconds < VOICE_MIN_S) {
      toast('Hold on a little longer: that voice message was too short.', 3000);
      return;
    }
    const blob = new Blob(r.chunks, { type: r.recorder.mimeType });
    const res = await onVoice(await blob.arrayBuffer(), r.seconds, r.toTeam);
    if (res?.error) toast(res.error, 4000, 'bad');
  }

  function freeClips() {
    playing?.stop();
    playing = null;
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls.clear();
  }

  function line(msg) {
    const time = new Date(msg.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const mine = msg.fromId === youId;
    const teamTag = msg.team ? h(`span.chat-team.team-${msg.team}`, {}, 'team') : null;
    if (msg.fromId === null) return h(`div.chat-msg.chat-system${msg.team ? '.chat-to-team' : ''}`, { title: time }, teamTag, msg.text);
    return h(`div.chat-msg${mine ? '.chat-mine' : ''}${msg.team ? `.chat-to-team.team-${msg.team}` : ''}`, { title: time },
      mine ? null : h('span.chat-name', {}, msg.bot ? icon('bot', 'Bot') : null, msg.name, teamTag),
      mine && teamTag ? h('span.chat-name', {}, teamTag) : null,
      msg.voice ? voicePlayer(msg.voice, urls) : h('span.chat-text', {}, msg.text));
  }

  const scrollDown = () => { list.scrollTop = list.scrollHeight; };

  function updateBadge() {
    badge.hidden = open || unread === 0;
    badge.textContent = String(unread);
  }

  function showPreview(msg) {
    const text = msg.voice ? `🎤 Voice message (${clock(msg.voice.seconds)})` : msg.text;
    setChildren(preview, msg.fromId === null ? text : [h('strong', {}, `${msg.name}: `), text]);
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
      freeClips();
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
      stopRecording(false);
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
