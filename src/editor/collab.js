// Live shared editing for teams (the browser side of server/collab.js), and
// teammates' cursors.
//
// A session follows one document. Local edits are kept as "unconfirmed" changes
// and pushed against the last version we have seen. Changes from the server are
// applied in order: our own ones confirm the oldest unconfirmed changes, and
// everyone else's are applied with our unconfirmed changes rebased on top. This is
// the same scheme as CodeMirror's @codemirror/collab.
import { ChangeSet, Annotation, StateField, StateEffect, Transaction } from '@codemirror/state';
import { EditorView, Decoration, WidgetType } from '@codemirror/view';

/** Marks transactions that came from the server, so they are not pushed back. */
export const remoteChange = Annotation.define();

const PUSH_DELAY_MS = 120;
const randomId = () => Math.random().toString(36).slice(2, 10);

/**
 * createCollabSession({ version, net }) -> { attach(view), detach(), local(changes), receive(from, updates), resync(version, doc), idle(), close() }
 * net: { push({ version, updates }) -> Promise<reply>, pull(version) -> Promise<reply> }
 * reply: { ok } | { stale, from?, updates? } | { resync: { version, doc } }
 */
export function createCollabSession({ version, net }) {
  const clientID = randomId(); // one per session, so a reopened document never mistakes old changes for its own
  let v = version;
  let unconfirmed = []; // ChangeSets applied locally, not yet confirmed by the server
  let view = null;
  let inflight = false;
  let timer = 0;
  let closed = false;
  let onIdle = null;

  function schedule() {
    if (timer || inflight || closed || unconfirmed.length === 0) {
      if (!inflight && unconfirmed.length === 0) onIdle?.();
      return;
    }
    timer = setTimeout(flush, PUSH_DELAY_MS);
  }

  async function flush() {
    timer = 0;
    if (inflight || closed || unconfirmed.length === 0) return;
    inflight = true;
    const reply = await net.push({ version: v, updates: unconfirmed.map((c) => ({ clientID, changes: c.toJSON() })) });
    inflight = false;
    if (closed) return;
    if (reply?.resync) resync(reply.resync.version, reply.resync.doc);
    else if (reply?.stale && reply.updates) receive(reply.from, reply.updates);
    // Retry what is still unconfirmed (after a stale push, or edits made meanwhile).
    schedule();
  }

  function dispatch(spec) {
    if (view) view.dispatch({ ...spec, annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)] });
  }

  /** Changes from the server, starting at version `from`. */
  function receive(from, raw) {
    if (closed) return;
    if (from > v) {
      // We missed some: ask for them.
      net.pull(v).then((reply) => {
        if (reply?.resync) resync(reply.resync.version, reply.resync.doc);
        else if (reply?.updates) receive(reply.from, reply.updates);
      });
      return;
    }
    let updates = raw.slice(v - from).map((u) => ({ clientID: u.clientID, changes: ChangeSet.fromJSON(u.changes) }));
    if (updates.length === 0) return;
    v += updates.length;
    let own = 0;
    while (own < updates.length && own < unconfirmed.length && updates[own].clientID === clientID) own++;
    if (own) {
      unconfirmed = unconfirmed.slice(own);
      updates = updates.slice(own);
    }
    if (updates.length) {
      let changes = updates[0].changes;
      for (let i = 1; i < updates.length; i++) changes = changes.compose(updates[i].changes);
      // Ours were made on an older document: move them past the new changes, and the
      // new changes past ours, so both end up in the same place on every screen.
      unconfirmed = unconfirmed.map((u) => {
        const moved = u.map(changes);
        changes = changes.map(u, true);
        return moved;
      });
      dispatch({ changes });
    }
    schedule();
  }

  /** The server's whole document replaces ours (we fell too far behind). */
  function resync(version2, doc) {
    v = version2;
    unconfirmed = [];
    if (view) dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
  }

  return {
    clientID,
    attach(next) { view = next; },
    /** Stop showing it; it keeps pushing what is unconfirmed until that is confirmed. */
    detach(whenIdle) {
      view = null;
      onIdle = whenIdle;
      schedule();
    },
    local(changes) {
      if (closed) return;
      unconfirmed.push(changes);
      schedule();
    },
    receive,
    resync,
    pending: () => unconfirmed.length > 0,
    close() {
      closed = true;
      clearTimeout(timer);
    },
  };
}

// ---------------------------------------------------------------- teammates' cursors

/** setCursors([{ id, name, color, pos }]) replaces the cursors shown. */
export const setCursors = StateEffect.define();

class CursorWidget extends WidgetType {
  constructor(name, color) {
    super();
    this.name = name;
    this.color = color;
  }

  eq(other) { return other.name === this.name && other.color === this.color; }

  toDOM() {
    const el = document.createElement('span');
    el.className = `cm-mate cm-mate-${this.color}`;
    el.setAttribute('aria-hidden', 'true');
    const tag = document.createElement('span');
    tag.className = 'cm-mate-name';
    tag.textContent = this.name;
    el.append(tag);
    return el;
  }

  ignoreEvent() { return true; }
}

export const remoteCursors = StateField.define({
  create: () => Decoration.none,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setCursors)) continue;
      const len = tr.state.doc.length;
      next = Decoration.set(e.value
        .map((c) => ({ c, pos: Math.max(0, Math.min(len, c.pos)) }))
        .sort((a, b) => a.pos - b.pos)
        .map(({ c, pos }) => Decoration.widget({ widget: new CursorWidget(c.name, c.color), side: 1 }).range(pos)));
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});
