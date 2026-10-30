// Duel lobby, in three columns: the room (code, settings, the pick for the next
// round), the players (and their teams), and the chat; Leave and Ready sit in the
// bar along the bottom. Everyone sees the host's settings; only the host can
// change them.
import { h, setChildren, toast } from './dom.js';
import { COUNTS } from './home.js';
import { viewButton } from './view-settings.js';
import { icon, brandMark, clockCase } from './icons.js';
import { filterQuestions, LANG_LABELS, MODE_LABELS, DIFFICULTY_LABELS, CATEGORIES } from '../questions/index.js';
import { ROUND_MINUTES, REVEAL_COSTS } from '../state/round.js';

export const roomLink = (code) => `${location.origin}/?room=${code}`;
const BOT_LEVELS = [['easy', 'Easy bot'], ['medium', 'Medium bot'], ['hard', 'Hard bot']];
export const TEAM_LABELS = { red: 'Red', green: 'Green', blue: 'Blue' };

export const pickLabel = ({ mode, category }) =>
  `${mode === 'random' ? 'Random mode' : MODE_LABELS[mode]} · ${category === 'random' ? 'random topic' : CATEGORIES[category].label}`;

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

/** A labelled native select; options are [value, label] pairs. Disabled for players who only see it. */
function selectField(label, options, value, onChange, { id, placeholder, disabled = false, help = null } = {}) {
  return h('label.select-field', {},
    h('span.field-name', {}, label),
    h('select', { id, disabled, onchange: (e) => onChange(e.target.value) },
      placeholder ? h('option', { value: '', selected: true, disabled: true }, placeholder) : null,
      options.map(([v, text]) => h('option', { value: v, selected: String(v) === String(value) }, text))),
    help ? h('span.field-help', {}, help) : null);
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
 * playerList(room, { onRemoveBot?, onAddBot?, onTeam? }): one row per player with
 * their team, then the free seats (where the host can add a practice bot).
 */
export function playerList(room, { onRemoveBot, onAddBot, onTeam } = {}) {
  const isHost = room.hostId === room.youId;
  const lobby = room.status === 'lobby';
  const slots = room.players.map((p) => {
    const tags = [];
    if (p.id === room.hostId) tags.push('host');
    if (p.id === room.youId) tags.push('you');
    if (p.bot) tags.push(`${p.bot} bot`);
    const state = p.left ? 'left' : p.connected ? 'online' : 'offline';
    const canTeam = lobby && onTeam && (p.id === room.youId || (p.bot && isHost));
    return h(`li.player.player-${state}${p.team ? `.on-${p.team}` : ''}`, {},
      h('span.dot', { title: state }),
      h('span.player-main', {},
        nameEl(p),
        h('span.player-tags', {}, tags.join(' · '),
          p.left ? ' · left' : !p.connected ? ' · reconnecting…' : '',
          !canTeam && p.team ? [tags.length ? ' · ' : '', h(`span.team-word.team-${p.team}`, {}, `${TEAM_LABELS[p.team]} team`)] : null),
        canTeam ? teamPicker(p, onTeam) : null),
      (room.wins[p.id] ?? 0) > 0 ? h('span.player-score', { title: 'Rounds won' }, icon('trophy'), room.wins[p.id]) : null,
      lobby ? h(`span.ready-word${p.ready ? '.is-ready' : ''}`, {}, p.ready ? 'ready' : 'not ready') : null,
      p.bot && isHost && onRemoveBot && lobby
        ? h('button.icon-btn', { type: 'button', onclick: () => onRemoveBot(p.id), title: 'Remove the bot', 'aria-label': `Remove ${p.name}` }, icon('close')) : null);
  });
  const free = room.maxPlayers - room.players.length;
  if (free > 0 && lobby) {
    const canAdd = isHost && onAddBot;
    slots.push(h('li.player.player-empty', {},
      h('span.dot'),
      h('span.player-main', {}, h('span.muted', {}, `${free} seat${free === 1 ? '' : 's'} free · send the link to a friend`)),
      canAdd ? h('select.add-bot#add-bot', {
        'aria-label': 'Add a practice bot',
        onchange: (e) => { const level = e.target.value; e.target.value = ''; if (level) onAddBot(level); },
      }, h('option', { value: '', selected: true }, 'Add a bot…'), BOT_LEVELS.map(([v, t]) => h('option', { value: v }, t))) : null));
  }
  return h('ul.players', {}, slots);
}

/** "Red: Ada, Bob · Cy on their own", or null when nobody has picked a team. */
function teamsLine(room) {
  const players = room.players.filter((p) => !p.left);
  if (!players.some((p) => p.team)) return null;
  const teams = Object.keys(TEAM_LABELS).map((t) => [t, players.filter((p) => p.team === t)]).filter(([, ps]) => ps.length);
  const solo = players.filter((p) => !p.team);
  return h('p.teams-line', {},
    teams.map(([t, ps], i) => [i ? ' vs ' : '', h(`span.team-word.team-${t}`, {}, TEAM_LABELS[t]), ` (${ps.map((p) => p.name).join(', ')})`]),
    solo.length ? [teams.length ? ' vs ' : '', solo.map((p) => p.name).join(', '), ' on their own'] : null);
}

/**
 * renderLobby(root, { room, chatEl, onConfig, onPick, onReady, onTeam, onAddBot, onRemoveBot, onLeave, onDrawn })
 * The callbacks return a promise of the server's reply. chatEl is placed in the third
 * column on every draw (onDrawn runs after). -> { update(room), cleanup() }
 */
export function renderLobby(root, { room: initial, chatEl = null, onConfig, onPick, onReady, onTeam, onAddBot, onRemoveBot, onLeave, onDrawn }) {
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
  const myPick = () => room.pick.votes[room.youId];
  const canPick = () => room.pick.pickerId === null || room.pick.pickerId === room.youId;
  // What the selects show: the pick already sent, or the default that Ready will send.
  const shownPick = () => (typeof myPick() === 'object' ? myPick() : { mode: 'random', category: 'random' });

  /** How many questions a pick could draw from, at the room's difficulty (or any, if none). */
  function available(mode, category) {
    const modes = mode === 'random' ? Object.keys(MODE_LABELS) : [mode];
    const n = (difficulty) => modes.reduce((sum, m) => sum +
      filterQuestions({ lang: room.config.lang, mode: m, category: category === 'random' ? undefined : category, difficulty }).length, 0);
    const exact = n(room.config.difficulty);
    return exact > 0 ? `${exact}` : `${n('mixed')}, any level`;
  }

  function pickSection() {
    const self = me();
    const { pickerId, votes, reason } = room.pick;
    const picker = room.players.find((p) => p.id === pickerId);
    const others = room.players.filter((p) => p.id !== self.id && !p.left);

    let intro;
    if (reason === 'loser' && pickerId === self.id) intro = `You came last in round ${room.round}, so you choose the next mode and topic.`;
    else if (reason === 'loser') intro = `${displayName(picker)} came last in round ${room.round} and chooses the next mode and topic.`;
    else if (reason === 'draw') intro = 'The last round was a draw, so vote again. If your votes differ, a coin flip decides.';
    else intro = 'Vote for the first round. If your votes differ, a coin flip decides. After that, whoever comes last chooses the next one.';

    const body = [h('p.muted.small', {}, intro)];
    if (canPick()) {
      const pick = shownPick();
      const send = (patch) => run(onPick({ ...pick, ...patch }));
      body.push(h('div.select-row', {},
        selectField('Mode', [...Object.entries(MODE_LABELS), ['random', 'Random']], pick.mode, (mode) => send({ mode }), { id: 'pick-mode' }),
        selectField('Topic', [...Object.entries(CATEGORIES).map(([key, c]) => [key, `${c.label} (${available(pick.mode, key)})`]),
          ['random', `Random topic (${available(pick.mode, 'random')})`]], pick.category, (category) => send({ category }), { id: 'pick-topic' })),
      h('p.pick-status', {}, myPick()
        ? ['Your ', pickerId ? 'pick' : 'vote', ' is in: ', h('strong', {}, pickLabel(myPick()))]
        : h('span.muted', {}, 'Choose, or press Ready to go with what is shown.')));
    } else {
      body.push(h('p.pick-status', {}, votes[pickerId]
        ? [displayName(picker), ' picked ', h('strong', {}, pickLabel(votes[pickerId]))]
        : h('span.muted', {}, `Waiting for ${displayName(picker)} to choose…`)));
    }
    if (pickerId === null && others.length) {
      body.push(h('p.muted.small', {}, others.map((p) => `${displayName(p)}: ${votes[p.id] ? 'voted' : 'not voted yet'}`).join(' · ')));
    }
    return h('div.lobby-block', {}, h('h3.block-title', {}, room.round === 0 ? 'First round' : `Round ${room.round + 1}`), ...body);
  }

  async function toggleReady() {
    const self = me();
    if (busy) return;
    busy = true;
    try {
      // Ready also sends the pick shown, if it has not been sent yet.
      if (!self.ready && canPick() && !myPick()) {
        const res = await run(onPick(shownPick()));
        if (res?.error) return;
      }
      await run(onReady(!self.ready));
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

  function draw() {
    const isHost = room.hostId === room.youId;
    const self = me();
    const c = room.config;
    const inRoom = room.players.filter((p) => !p.left).length;
    const score = matchScore(room);

    // The same controls for everyone; only the host's can be changed.
    const set = (patch) => run(onConfig({ ...c, ...patch }));
    const opts = { disabled: !isHost };
    const revealLabel = (cost) => (cost === 0 ? 'Not allowed' : `Allowed, −${Math.round(cost * 100)}% of the question`);
    const settings = h('div.settings-grid', {},
      selectField('Language', Object.entries(LANG_LABELS), c.lang, (lang) => set({ lang }), opts),
      selectField('Difficulty', Object.entries(DIFFICULTY_LABELS), c.difficulty, (difficulty) => set({ difficulty }), opts),
      selectField('Questions', COUNTS.map((n) => [n, String(n)]), c.count, (count) => set({ count: Number(count) }), opts),
      selectField('Round time', ROUND_MINUTES.map((m) => [m, `${m} minutes`]), c.minutes, (minutes) => set({ minutes: Number(minutes) }),
        { ...opts, id: 'set-minutes', help: 'One clock for the whole round. Do the questions in any order.' }),
      selectField('Secret tests', [['false', 'Only a solve scores'], ['true', 'Each one passed scores']], String(c.partial),
        (v) => set({ partial: v === 'true' }), { ...opts, id: 'set-partial', help: c.partial ? 'Passing secret tests earns up to half a question without solving it.' : null }),
      selectField('Reveal a failed test', REVEAL_COSTS.map((x) => [x, revealLabel(x)]), c.revealCost, (v) => set({ revealCost: Number(v) }),
        { ...opts, id: 'set-reveal', help: c.revealCost ? 'Shows a failed secret test’s call and answer, and lowers what the question can score.' : null }));

    let status;
    if (inRoom < 2) status = 'Waiting for someone to join…';
    else if (self.ready) status = 'Waiting for everyone to be ready…';
    else status = 'The round starts as soon as everyone is ready.';

    setChildren(root, h('div.lobby', {},
      h('header.lobby-header', {},
        h('h1.brand', {}, brandMark(), h('span.brand-name', {}, 'Duel room')),
        h('p.tagline', {}, 'Same questions, same clock.'),
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
          pickSection(),
          h('div.lobby-block', {}, h('h3.block-title', {}, 'Settings', isHost ? null : h('span.muted.small', {}, ' · set by the host')), settings)),

        h('section.lobby-col', { 'aria-label': 'Players' },
          h('h2.col-title', {}, 'Players'),
          playerList(room, {
            onRemoveBot: (id) => run(onRemoveBot(id)),
            onAddBot: (level) => run(onAddBot(level)),
            onTeam: (team, id) => run(onTeam(team, id)),
          }),
          teamsLine(room),
          h('p.muted.small.team-help', {}, 'Pick a colour to play in a team: teammates share one editor and one score.')),

        h('section.lobby-col.lobby-chat', { 'aria-label': 'Chat' }, chatEl)),

      h('footer.lobby-bar', {},
        h('button.btn.btn-ghost#btn-leave', { onclick: onLeave }, icon('back'), 'Leave'),
        h('span.lobby-who', {}, 'Playing as ', h('strong', {}, self.name)),
        h('span.lobby-status', { 'aria-live': 'polite' }, status),
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
