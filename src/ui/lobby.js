// Duel lobby: room code, players, match score, room settings (host), the pick for
// the next round (a vote, or the loser's choice) and the Ready button.
import { h, setChildren, toast, segmented } from './dom.js';
import { COUNTS } from './home.js';
import { viewButton } from './view-settings.js';
import { filterQuestions, LANG_LABELS, MODE_LABELS, DIFFICULTY_LABELS, CATEGORIES } from '../questions/index.js';

export const roomLink = (code) => `${location.origin}/?room=${code}`;
const BOT_LEVELS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];

export const pickLabel = ({ mode, category }) =>
  `${mode === 'random' ? '🎲 Random mode' : MODE_LABELS[mode]} · ${category === 'random' ? '🎲 random topic' : CATEGORIES[category].label}`;

export const displayName = (p) => (p.bot ? `🤖 ${p.name}` : p.name);

/** "Ada 2 – 1 Bob" (and draws), or null before any round has finished. */
export function matchScore(room) {
  const played = room.round - (room.status === 'playing' ? 1 : 0);
  if (played <= 0) return null;
  const players = room.players.filter((p) => !p.left);
  const text = players.map((p) => `${p.name} ${room.wins[p.id] ?? 0}`).join(' – ');
  return room.draws ? `${text} · ${room.draws} draw${room.draws === 1 ? '' : 's'}` : text;
}

export function playerList(room, { onRemoveBot } = {}) {
  const isHost = room.hostId === room.youId;
  const slots = room.players.map((p) => {
    const tags = [];
    if (p.id === room.hostId) tags.push('host');
    if (p.id === room.youId) tags.push('you');
    if (p.bot) tags.push(`${p.bot} bot`);
    const state = p.left ? 'left' : p.connected ? 'online' : 'offline';
    return h(`li.player.player-${state}`, {},
      h('span.dot', { title: state }),
      h('span.player-name', {}, displayName(p)),
      tags.length ? h('span.muted.small', {}, ` (${tags.join(', ')})`) : null,
      p.left ? h('span.muted.small', {}, ' · left') : !p.connected ? h('span.muted.small', {}, ' · reconnecting…') : null,
      room.status === 'lobby' ? h(`span.ready-tag${p.ready ? '.is-ready' : ''}`, {}, p.ready ? '✓ ready' : 'not ready') : null,
      (room.wins[p.id] ?? 0) > 0 ? h('span.player-score', { title: 'Rounds won' }, `🏆 ${room.wins[p.id]}`) : null,
      p.bot && isHost && onRemoveBot && room.status === 'lobby'
        ? h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: () => onRemoveBot(p.id), title: 'Remove the bot' }, '✕') : null);
  });
  for (let i = room.players.length; i < room.maxPlayers; i++) {
    slots.push(h('li.player.player-empty', {}, h('span.dot'), h('span.muted', {}, 'Waiting for a friend to join…')));
  }
  return h('ul.players', {}, slots);
}

/**
 * renderLobby(root, { room, onConfig, onPick, onReady, onAddBot, onRemoveBot, onLeave })
 * The callbacks return a promise of the server's reply. -> { update(room), cleanup() }
 */
export function renderLobby(root, { room: initial, onConfig, onPick, onReady, onAddBot, onRemoveBot, onLeave }) {
  let room = initial;
  let alive = true; // a reply can arrive after the game screen has replaced this one
  let draft = null; // the pick being put together, before it is sent
  let botLevel = 'medium';

  const run = async (promise) => {
    const res = await promise;
    if (res?.error) toast(res.error, 3500, 'bad');
    if (alive) draw();
  };

  const me = () => room.players.find((p) => p.id === room.youId);

  /** How many questions a pick could draw from, at the room's difficulty (or any, if none). */
  function available(mode, category) {
    const modes = mode === 'random' ? Object.keys(MODE_LABELS) : [mode];
    const n = (difficulty) => modes.reduce((sum, m) => sum +
      filterQuestions({ lang: room.config.lang, mode: m, category: category === 'random' ? undefined : category, difficulty }).length, 0);
    const exact = n(room.config.difficulty);
    return exact > 0 ? `${exact}` : `${n('mixed')} · any level`;
  }

  function pickCard() {
    const self = me();
    const { pickerId, votes, reason } = room.pick;
    const picker = room.players.find((p) => p.id === pickerId);
    const canPick = pickerId === null || pickerId === self.id;
    const myPick = votes[self.id];
    const others = room.players.filter((p) => p.id !== self.id && !p.left);

    let intro;
    if (reason === 'loser' && pickerId === self.id) intro = `You lost round ${room.round}, so you choose the next mode and topic.`;
    else if (reason === 'loser') intro = `${displayName(picker)} lost round ${room.round} and chooses the next mode and topic.`;
    else if (reason === 'draw') intro = 'The last round was a draw, so vote again. If your votes differ, a coin flip decides.';
    else intro = 'Vote for the first round. If your votes differ, a coin flip decides. After that, the loser of each round chooses the next one.';

    const body = [h('p.muted', {}, intro)];
    if (canPick) {
      draft ??= myPick ?? { mode: 'random', category: 'random' };
      const modeOptions = [...Object.entries(MODE_LABELS), ['random', '🎲 Random']];
      const topics = [...Object.entries(CATEGORIES).map(([key, c]) => [key, c.label]), ['random', '🎲 Random topic']];
      body.push(
        h('div.field', {}, h('label', {}, 'Mode'),
          segmented('Mode', modeOptions, draft.mode, (mode) => { draft = { ...draft, mode }; draw(); })),
        h('div.field.field-top', {}, h('label', {}, 'Topic'),
          h('div.topic-grid', {}, topics.map(([key, label]) => h(`button.topic${draft.category === key ? '.active' : ''}`, {
            type: 'button',
            'aria-pressed': String(draft.category === key),
            onclick: () => { draft = { ...draft, category: key }; draw(); },
          }, h('span', {}, label), h('span.topic-count', {}, available(draft.mode, key)))))),
        h('div.pick-row', {},
          myPick
            ? h('span.muted', {}, `Your ${pickerId ? 'pick' : 'vote'}: `, h('strong', {}, pickLabel(myPick)))
            : h('span.muted', {}, 'Not sent yet'),
          h('button.btn.btn-primary#btn-pick', {
            disabled: !!myPick && myPick.mode === draft.mode && myPick.category === draft.category,
            onclick: () => run(onPick(draft)),
          }, myPick ? 'Change' : pickerId ? 'Choose this' : 'Vote for this')));
    } else {
      body.push(h('p', {}, votes[pickerId]
        ? ['✓ ', displayName(picker), ' picked ', h('strong', {}, pickLabel(votes[pickerId]))]
        : h('span.muted', {}, `Waiting for ${displayName(picker)} to choose…`)));
    }
    if (pickerId === null && others.length) {
      body.push(h('p.muted.small', {}, others.map((p) => `${displayName(p)}: ${votes[p.id] ? 'voted ✓' : 'not voted yet'}`).join(' · ')));
    }
    return h('section.card.setup', {}, h('h2.card-title', {}, room.round === 0 ? 'First round' : `Round ${room.round + 1}`), ...body);
  }

  function draw() {
    const isHost = room.hostId === room.youId;
    const self = me();
    const c = room.config;
    const inRoom = room.players.filter((p) => !p.left).length;
    const mustPick = (room.pick.pickerId === null || room.pick.pickerId === self.id) && !room.pick.votes[self.id];
    const score = matchScore(room);

    const settings = isHost
      ? [
        h('div.field', {}, h('label', {}, 'Language'),
          segmented('Language', Object.entries(LANG_LABELS), c.lang, (lang) => run(onConfig({ ...c, lang })))),
        h('div.field', {}, h('label', {}, 'Difficulty'),
          segmented('Difficulty', Object.entries(DIFFICULTY_LABELS), c.difficulty, (difficulty) => run(onConfig({ ...c, difficulty })))),
        h('div.field', {}, h('label', {}, 'Questions'),
          segmented('Questions per round', COUNTS.map((n) => [n, String(n)]), c.count, (count) => run(onConfig({ ...c, count })))),
      ]
      : [h('p', {}, `${LANG_LABELS[c.lang]} · ${DIFFICULTY_LABELS[c.difficulty]} · ${c.count} question${c.count === 1 ? '' : 's'} per round`)];

    setChildren(root, h('div.home.lobby', {},
      h('header.home-header', {},
        viewButton(),
        h('h1', {}, h('span.logo', {}, '{ }'), ' Duel room'),
        h('p.tagline', {}, 'Same questions, same clock. Win rounds to win the match.')),

      h('section.card.lobby-code', {},
        h('div', {},
          h('div.muted.small', {}, 'Room code'),
          h('div.room-code', {}, room.code)),
        score ? h('div.match-score', {}, h('div.muted.small', {}, 'Match'), h('strong', {}, score)) : null,
        h('div.lobby-share', {},
          h('code.room-link', {}, roomLink(room.code)),
          h('button.btn.btn-small#btn-copy', {
            onclick: async () => {
              try {
                await navigator.clipboard.writeText(roomLink(room.code));
                toast('Link copied — send it to your friend');
              } catch {
                toast('Copy the link above and send it to your friend');
              }
            },
          }, 'Copy link'))),

      h('section.card', {},
        h('h2.card-title', {}, 'Players'),
        playerList(room, { onRemoveBot: (id) => run(onRemoveBot(id)) }),
        isHost && inRoom < room.maxPlayers ? h('div.bot-row', {},
          h('span.muted', {}, 'No one to play? Add a practice bot:'),
          segmented('Bot level', BOT_LEVELS, botLevel, (level) => { botLevel = level; draw(); }),
          h('button.btn.btn-small#btn-add-bot', { onclick: () => run(onAddBot(botLevel)) }, '🤖 Add bot')) : null),

      h('section.card.setup', {},
        h('h2.card-title', {}, isHost ? 'Room settings' : 'Room settings (chosen by the host)'),
        ...settings),

      pickCard(),

      h('section.card.start-row.ready-row', {},
        h('div.available', {},
          inRoom < 2 ? h('span.muted', {}, 'Waiting for a second player…')
            : mustPick ? h('span.muted', {}, room.pick.pickerId ? 'Choose a mode and topic first.' : 'Send your vote first.')
              : self.ready ? h('span.muted', {}, 'Waiting for everyone to be ready…')
                : h('span.muted', {}, 'The round starts as soon as everyone is ready.')),
        h('div.lobby-actions', {},
          h('button.btn.btn-ghost#btn-leave', { onclick: onLeave }, 'Leave'),
          h(`button.btn.btn-large${self.ready ? '' : '.btn-primary'}#btn-ready`, {
            disabled: inRoom < 2 || mustPick,
            onclick: () => run(onReady(!self.ready)),
          }, self.ready ? 'Not ready' : 'Ready ▸')))));
  }

  draw();
  return {
    update(next) {
      if (next.round !== room.round || next.pick.pickerId !== room.pick.pickerId) draft = null;
      room = next;
      draw();
    },
    cleanup() {
      alive = false;
    },
  };
}
