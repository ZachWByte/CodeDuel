// Shared editors for teams: one document per team and question, edited by every
// teammate at once. The server keeps the authoritative text and the list of
// changes; a client pushes its changes against the version it has seen, and the
// server takes them only if nobody got in first (otherwise the client rebases on
// what it missed and pushes again). Changes are CodeMirror ChangeSets as JSON, so
// the browser and the server agree on what they mean.
import { ChangeSet, Text } from '@codemirror/state';

const KEEP = 1000; // changes kept for clients catching up; older ones need a full reload

/** A document starting from `text`. */
export function createDoc(text) {
  return { text: Text.of(text.split('\n')), base: 0, updates: [] };
}

export const docVersion = (doc) => doc.base + doc.updates.length;
export const docString = (doc) => doc.text.toString();

/** The changes after `version`, or null if they are no longer kept (the client must reload). */
export function updatesSince(doc, version) {
  if (!Number.isInteger(version) || version < doc.base || version > docVersion(doc)) return null;
  return doc.updates.slice(version - doc.base);
}

/**
 * Applies a client's changes, made on top of `version`.
 * -> { ok: true, from, updates } | { stale: true } | { error }
 * Nothing is applied unless every change fits the document.
 */
export function pushUpdates(doc, version, updates, { maxLength = 20_000, maxUpdates = 200 } = {}) {
  if (!Array.isArray(updates) || updates.length === 0 || updates.length > maxUpdates) return { error: 'No changes.' };
  if (version !== docVersion(doc)) return { stale: true };
  let text = doc.text;
  const accepted = [];
  for (const u of updates) {
    let changes;
    try {
      changes = ChangeSet.fromJSON(u?.changes);
    } catch {
      return { error: 'Those changes are not valid.' };
    }
    if (changes.length !== text.length) return { error: 'Those changes do not fit the document.' };
    text = changes.apply(text);
    if (text.length > maxLength) return { error: 'The code is too long.' };
    accepted.push({ clientID: String(u.clientID ?? '').slice(0, 40), changes: changes.toJSON() });
  }
  const from = docVersion(doc);
  doc.text = text;
  doc.updates.push(...accepted);
  if (doc.updates.length > KEEP) {
    const drop = doc.updates.length - KEEP;
    doc.updates.splice(0, drop);
    doc.base += drop;
  }
  return { ok: true, from, updates: accepted };
}
