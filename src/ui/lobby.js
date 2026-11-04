// Duel lobby, in three columns: the room (code and settings), the players, and the
// chat; Leave and Ready sit in the bar along the bottom. Everyone sees the host's
// settings; only the host can change them, remove a player, hand the room over, or
// start the round without waiting for everyone to be ready (Start now).
import { h, setChildren, toast, confirmDialog } from './dom.js';
import { COUNTS } from './home.js';
import { viewButton } from './view-settings.js';
import { icon, brandMark, clockCase } from './icons.js';
import { filterQuestions, LANG_LABELS, MODE_LABELS, DIFFICULTY_LABELS, CATEGORIES } from '../questions/index.js';
import { ROUND_MINUTES, REVEAL_COSTS, POWERUP_USES } from '../state/round.js';
import { SLOT_LEVELS } from '../questions/pick.js';

export const roomLink = (code) => `${location.origin}/?room=${code}`;
const BOT_LEVELS = [['easy', 'Easy bot'], ['medium', 'Medium bot'], ['hard', 'Hard bot']];
export const TEAM_LABELS = { red: 'Red', green: 'Green', blue: 'Blue' };

/** Plain-text name (bots get a "bot" suffix); nameEl adds the bot icon instead. */
export const displayName = (p) => (p.bot ? `${p.name} (bot)` : p.name);
export const nameEl = (p, tag = 'span.player-name') => h(tag, {}, p.bot ? icon('bot', 'Bot') : null, p.name);

/** "Ada 2 – 1 Bob" (and draws), or null before any round has finished. */
export function matchScore(room) {
  const played = room.round - (room.status === 'playing' ? 1 : 0);
  if (played <= 0) return null;
  const players = room.players.filter((p) => !p.left);
  const text = players.map((p) => `${p.name} ${room.wins[p.id] ?? 0}`).join(' – ');
  return room.draws ? `${text} · ${room.draws} draw${room.draws === 1 ? '' : 's'}` : text;
}

/**
 * Runs a draw that rebuilds the screen, then puts back what the rebuild throws away:
 * how far each column and the chat were scrolled, and the keyboard focus.
 */
function keepingPlace(root, chatEl, drawScreen) {
  const cols = () => [...root.querySelectorAll('.lobby-col')];
  // Only on a redraw: the first draw leaves the chat scrolled to its latest message.
  const chatList = chatEl?.closest('.lobby-col') ? chatEl.querySelector('.chat-list') : null;
  const colTops = cols().map((col) => col.scrollTop);
  const chatTop = chatList?.scrollTop ?? 0;
  const focused = document.activeElement;
  drawScreen();
  cols().forEach((col, i) => { col.scrollTop = colTops[i] ?? 0; });
  if (chatList) chatList.scrollTop = chatTop;
  const refocus = focused?.isConnected ? focused : focused?.id && document.getElementById(focused.id);
  if (refocus && refocus !== document.activeElement) refocus.focus({ preventScroll: true });
}

/** A labelled native select; options are [value, label] pairs. Disabled for players who only see it. */
function selectField(label, options, value, onChange, { id, disabled = false, title } = {}) {
  return h('label.select-field', { title },
    h('span.field-name', {}, label),
    h('select', { id, disabled, onchange: (e) => onChange(e.target.value) },
      options.map(([v, text]) => h('option', { value: v, selected: String(v) === String(value) }, text))));
}

/** Your team (or a bot's, for the host): on your own, or red, green or blue. */
function teamPicker(p, onTeam) {
  const choices = [[null, 'Solo'], ...Object.entries(TEAM_LABELS)];
  return h('span.team-pick', { role: 'radiogroup', 'aria-label': `${p.name}'s team` }, choices.map(([team, label]) =>
    h(`button.team-opt${team ? `.team-${team}` : ''}${p.team === team ? '.active' : ''}`, {
      type: 'button',
      role: 'radio',
      'aria-checked': String(p.team === team),
      title: team ? `${label} team` : 'Play on your own',
      onclick: () => { if (p.team !== team) onTeam(team, p.id); },
    }, team ? h('i.swatch', { 'aria-hidden': 'true' }) : null, label)));
}

/**
 * playerList(room, { onKick?, onHost?, onAddBot?, onTeam?, onGrant? }): one row per player
 * with their team, then the free seats (where the host can add a practice bot).
 * onGrant(playerId, on): the host gives or takes a player's power-ups.
 * onKick(playerId), onHost(playerId): the host removes a player, or hands the room over.
 */
export function playerList(room, { onKick, onHost, onAddBot, onTeam, onGrant } = {}) {
  const isHost = room.hostId === room.youId;
  const lobby = room.status === 'lobby';
  const pu = room.config.powerups ?? {};
  const powersOn = Object.values(pu).some((n) => n > 0);
  const slots = room.players.map((p) => {
    const tags = [];
    if (p.id === room.hostId) tags.push('host');
    if (p.bot) tags.push(`${p.bot} bot`);
    const state = p.left ? 'left' : p.connected ? 'online' : 'offline';
    const canTeam = lobby && room.config.teams && onTeam && (p.id === room.youId || (p.bot && isHost));
    return h(`li.player.player-${state}${p.team ? `.on-${p.team}` : ''}`, {},
      h('span.dot', { title: state }),
      h('span.player-main', {},
        nameEl(p),
        h('span.player-tags', {}, tags.join(' · '),
          p.left ? ' · left' : !p.connected ? ' · reconnecting…' : '',
          !canTeam && p.team ? [tags.length ? ' · ' : '', h(`span.team-word.team-${p.team}`, {}, `${TEAM_LABELS[p.team]} team`)] : null),
        canTeam ? teamPicker(p, onTeam) : null),
      (room.wins[p.id] ?? 0) > 0 ? h('span.player-score', { title: 'Rounds won' }, icon('trophy'), room.wins[p.id]) : null,
      lobby && powersOn && isHost && onGrant ? h(`button.power-grant${p.powerups ? '.on' : ''}`, {
        type: 'button',
        'aria-pressed': String(p.powerups),
        title: p.powerups ? `${p.name} gets power-ups. Click to leave them without.` : `${p.name} gets no power-ups. Click to give them.`,
        onclick: () => onGrant(p.id, !p.powerups),
      }, icon('bolt'), p.powerups ? 'on' : 'off')
        : lobby && powersOn && !p.powerups ? h('span.power-grant.off.static', { title: 'No power-ups for this player' }, icon('bolt'), 'off') : null,
      lobby ? h(`span.ready-word${p.ready ? '.is-ready' : ''}`, {}, p.ready ? 'ready' : 'not ready') : null,
      isHost && onHost && !p.bot && !p.left && p.id !== room.youId ? h('button.icon-btn', {
        type: 'button',
        title: `Make ${p.name} the host`,
        'aria-label': `Make ${p.name} the host`,
        onclick: async () => { if (await confirmDialog(`Make ${p.name} the host? You won't be able to change the settings any more.`, { ok: 'Make host' })) onHost(p.id); },
      }, icon('crown')) : null,
      isHost && onKick && !p.left && p.id !== room.youId ? h('button.icon-btn', {
        type: 'button',
        title: `Remove ${p.name}`,
        'aria-label': `Remove ${p.name}`,
        onclick: async () => { if (p.bot || await confirmDialog(`Remove ${p.name} from the room?`, { ok: 'Remove', danger: true })) onKick(p.id); },
      }, icon('close')) : null);
  });
  const free = room.maxPlayers - room.players.length;
  if (free > 0 && lobby) {
    const canAdd = isHost && onAddBot;
    slots.push(h('li.player.player-empty', {},
      h('span.dot'),
      h('span.player-main', {}, h('span.muted', {}, `${free} seat${free === 1 ? '' : 's'} free`)),
      canAdd ? h('select.add-bot#add-bot', {
        'aria-label': 'Add a practice bot',
        onchange: (e) => { const level = e.target.value; e.target.value = ''; if (level) onAddBot(level); },
      }, h('option', { value: '', selected: true }, 'Add a bot…'), BOT_LEVELS.map(([v, t]) => h('option', { value: v }, t))) : null));
  }
  return h('ul.players', {}, slots);
}

/**
 * renderLobby(root, { room, chatEl, onConfig, onPick, onReady, onStart, onTeam, onGrant, onAddBot, onKick, onHost, onLeave, onDrawn })
 * The callbacks return a promise of the server's reply. chatEl is placed in the third
 * column on every draw (onDrawn runs after). -> { update(room), cleanup() }
 */
export function renderLobby(root, { room: initial, chatEl = null, onConfig, onPick, onReady, onStart, onTeam, onGrant, onAddBot, onKick, onHost, onLeave, onDrawn }) {
  let room = initial;
  let alive = true; // a reply can arrive after the game screen has replaced this one
  let busy = false;

  const run = async (promise) => {
    const res = await promise;
    if (res?.error) toast(res.error, 3500, 'bad');
    if (alive) draw();
    return res;
  };

  const me = () => room.players.find((p) => p.id === room.youId);

  /** How many questions a pick could draw from, at the room's difficulty (or any, if none). */
  function available(mode, category) {
    const modes = mode === 'random' ? Object.keys(MODE_LABELS) : [mode];
    const n = (difficulty) => modes.reduce((sum, m) => sum +
      filterQuestions({ lang: room.config.lang, mode: m, category: category === 'random' ? undefined : category, difficulty }).length, 0);
    const exact = n(room.config.difficulty === 'custom' ? 'mixed' : room.config.difficulty);
    return exact > 0 ? `${exact}` : `${n('mixed')}, any level`;
  }

  async function toggleReady() {
    if (busy) return;
    busy = true;
    try {
      await run(onReady(!me().ready));
    } finally {
      busy = false;
    }
  }

  /** Host only: start now. */
  async function startNow() {
    if (busy) return;
    busy = true;
    try {
      await run(onStart());
    } finally {
      busy = false;
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(roomLink(room.code));
      toast('Link copied. Send it to your friend.');
    } catch {
      toast('Copy the link next to the room code and send it to your friend.');
    }
  }

  const draw = () => keepingPlace(root, chatEl, drawScreen);

  function drawScreen() {
    const isHost = room.hostId === room.youId;
    const self = me();
    const c = room.config;
    const inRoom = room.players.filter((p) => !p.left).length;
    const score = matchScore(room);

    // The same controls for everyone; only the host's can be changed.
    const set = (patch) => run(onConfig({ ...c, ...patch }));
    const opts = { disabled: !isHost };
    const revealLabel = (cost) => (cost === 0 ? 'Not allowed' : `Allowed, −${Math.round(cost * 100)}% of the question`);
    // Difficulty for the whole round, or one level per question (in that order).
    const custom = c.difficulty === 'custom';
    const sized = (levels, n) => Array.from({ length: n }, (_, i) => levels?.[i] ?? levels?.at(-1) ?? 'mixed');
    const setDifficulty = (difficulty) => (difficulty === 'custom'
      ? set({ difficulty, levels: sized([], c.count).map(() => c.difficulty) })
      : set({ difficulty }));
    const setCount = (count) => set(custom ? { count, levels: sized(c.levels, count) } : { count });
    const slots = custom ? h('div.slot-levels', { role: 'group', 'aria-label': 'Difficulty of each question' },
      h('span.field-name', {}, 'Each question'),
      h('div.slot-grid', {}, c.levels.map((level, i) => h('label.slot-level', {},
        h('span.slot-n', {}, `Q${i + 1}`),
        h('select', {
          id: `set-level-${i}`,
          disabled: !isHost,
          'aria-label': `Question ${i + 1} difficulty`,
          onchange: (e) => set({ levels: c.levels.map((l, j) => (j === i ? e.target.value : l)) }),
        }, SLOT_LEVELS.map((l) => h('option', { value: l, selected: l === level }, l === 'mixed' ? 'Any' : DIFFICULTY_LABELS[l]))))))) : null;
    const pick = room.pick;
    const send = (patch) => run(onPick({ ...pick, ...patch }));
    const onOff = [['false', 'Off'], ['true', 'On']];
    // Power-ups: on gives everyone one use of each, which the host can then change.
    const pu = { blackout: 0, wipe: 0, keyboard: 0, hints: 0, ...c.powerups };
    const powersOn = Object.values(pu).some((n) => n > 0);
    const setPowersOn = (on) => set({ powerups: Object.fromEntries(Object.keys(pu).map((key) => [key, on ? 1 : 0])) });
    const settings = h('div.settings-grid', {},
      selectField('Mode', [...Object.entries(MODE_LABELS), ['random', 'Random']], pick.mode, (mode) => send({ mode }), { ...opts, id: 'pick-mode' }),
      selectField('Topic', [...Object.entries(CATEGORIES).map(([key, cat]) => [key, `${cat.label} (${available(pick.mode, key)})`]),
        ['random', `Random topic (${available(pick.mode, 'random')})`]], pick.category, (category) => send({ category }), { ...opts, id: 'pick-topic' }),
      selectField('Language', Object.entries(LANG_LABELS), c.lang, (lang) => set({ lang }), { ...opts, id: 'set-lang' }),
      selectField('Difficulty', [...Object.entries(DIFFICULTY_LABELS), ['custom', 'Set per question']], c.difficulty, setDifficulty, { ...opts, id: 'set-difficulty' }),
      selectField('Questions', COUNTS.map((n) => [n, String(n)]), c.count, (count) => setCount(Number(count)), { ...opts, id: 'set-count' }),
      selectField('Round time', ROUND_MINUTES.map((m) => [m, m ? `${m} minutes` : 'No limit']), c.minutes, (minutes) => set({ minutes: Number(minutes) }),
        { ...opts, id: 'set-minutes', title: 'One clock for the whole round: when it runs out, the round ends. Do the questions in any order.' }),
      selectField('Teams', onOff, String(c.teams), (v) => set({ teams: v === 'true' }), { ...opts, id: 'set-teams' }),
      selectField('Power-ups', onOff, String(powersOn), (v) => setPowersOn(v === 'true'), { ...opts, id: 'set-powers' }),
      selectField('Secret tests', [['false', 'Only a solve scores'], ['true', 'Each one passed scores']], String(c.partial),
        (v) => set({ partial: v === 'true' }), { ...opts, id: 'set-partial', title: 'Whether passing secret tests earns up to half a question without solving it.' }),
      selectField('Reveal a failed test', REVEAL_COSTS.map((x) => [x, revealLabel(x)]), c.revealCost, (v) => set({ revealCost: Number(v) }),
        { ...opts, id: 'set-reveal', title: 'Shows a failed secret test’s call and answer, and lowers what the question can score.' }));

    // The host gives everyone the same uses each round (0 = off).
    const uses = (key, unit) => POWERUP_USES[key].map((n) => [n, n === 0 ? 'Off' : `${n} ${unit}${n === 1 ? '' : 's'} each`]);
    const setPower = (key) => (v) => set({ powerups: { ...pu, [key]: Number(v) } });
    const powers = !powersOn ? null : h('div.lobby-block', {}, h('h3.block-title', {}, icon('bolt'), 'Power-ups'), h('div.settings-grid', {},
      selectField('Blackout', uses('blackout', 'use'), pu.blackout, setPower('blackout'),
        { ...opts, id: 'set-blackout', title: 'Turns every opponent’s editor off for 15 seconds. 3 minute cooldown.' }),
      selectField('Wipe', uses('wipe', 'use'), pu.wipe, setPower('wipe'),
        { ...opts, id: 'set-wipe', title: 'Deletes every opponent’s code on the question they have open.' }),
      selectField('Mouse keys', uses('keyboard', 'use'), pu.keyboard, setPower('keyboard'),
        { ...opts, id: 'set-keyboard', title: 'Takes one opponent’s keyboard for 30 seconds: they type by clicking an on-screen one.' }),
      selectField('Hints', uses('hints', 'hint'), pu.hints, setPower('hints'),
        { ...opts, id: 'set-hints', title: 'Pseudo-code or the first lines of a solution, for a question of yours.' })));

    setChildren(root, h('div.lobby', {},
      h('header.lobby-header', {},
        h('h1.brand', {}, brandMark(), h('span.brand-name', {}, 'Duel room')),
        viewButton()),

      h('div.lobby-cols', {},
        h('section.lobby-col', { 'aria-label': 'Room' },
          h('h2.col-title', {}, 'Room'),
          h('div.lobby-block.room-plate', {},
            clockCase([['room code', h('span.numeral.room-code', {}, room.code), { lit: true }]]),
            h('div.room-share', {},
              h('code.room-link', {}, roomLink(room.code).replace(/^https?:\/\//, '')),
              h('button.icon-btn#btn-copy', { type: 'button', onclick: copyLink, title: 'Copy the invite link', 'aria-label': 'Copy the invite link' }, icon('copy'))),
            score ? h('p.match-score', {}, h('span.label', {}, 'Match'), h('strong', {}, score)) : null),
          h('div.lobby-block', {}, h('h3.block-title', {}, 'Settings'), settings, slots),
          powers),

        h('section.lobby-col', { 'aria-label': 'Players' },
          h('h2.col-title', {}, 'Players'),
          playerList(room, {
            onKick: (id) => run(onKick(id)),
            onHost: (id) => run(onHost(id)),
            onAddBot: (level) => run(onAddBot(level)),
            onTeam: (team, id) => run(onTeam(team, id)),
            onGrant: (id, on) => run(onGrant(id, on)),
          })),

        h('section.lobby-col.lobby-chat', { 'aria-label': 'Chat' }, chatEl)),

      h('footer.lobby-bar', {},
        h('button.btn.btn-ghost#btn-leave', { onclick: onLeave }, icon('back'), 'Leave'),
        h('span.lobby-who', {}, 'Playing as ', h('strong', {}, self.name)),
        h('span.lobby-status', { 'aria-live': 'polite' }, inRoom < 2 ? 'Waiting for someone to join…' : null),
        isHost && onStart ? h('button.btn.btn-large#btn-start', {
          disabled: inRoom < 2,
          title: 'Start the round now, without waiting for everyone to be ready',
          onclick: startNow,
        }, 'Start now') : null,
        h(`button.btn.btn-large${self.ready ? '' : '.btn-primary'}#btn-ready`, {
          disabled: inRoom < 2,
          onclick: toggleReady,
        }, self.ready ? 'Not ready' : ['Ready', icon('chevron')]))));
    onDrawn?.();
  }

  draw();
  return {
    update(next) {
      room = next;
      draw();
    },
    cleanup() {
      alive = false;
    },
  };
}
