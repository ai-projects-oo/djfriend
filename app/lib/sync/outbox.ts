// Edits made directly on a record store (the phone): stamp them, queue them, and fold a finished
// sync round back into a copy that may have changed while the round was running. Pure.
import type { Hlc, SyncRecord, SyncRecordType } from '../../types';
import { tickHlc } from './hlc';
import { mergeRemote, recordKey, stableStringify, type SyncState } from './merge';

/** A local edit: new data for a record, or `deleted` to remove it. */
export interface LocalEdit { type: SyncRecordType; id: string; data?: unknown; deleted?: boolean }

/** Record store + what still has to be sent (record keys). */
export interface Outboxed { state: SyncState; outbox: string[] }

/** Stamps edits with fresh clocks, stores them and queues them for the next push. */
export function writeLocal<T extends Outboxed>(copy: T, edits: LocalEdit[], now: number): T {
  if (!edits.length) return copy;
  const records = { ...copy.state.records };
  const hashes = { ...copy.state.hashes };
  let clock = copy.state.clock;
  const outbox = new Set(copy.outbox);
  for (const e of edits) {
    const key = recordKey(e);
    clock = tickHlc(clock, now, copy.state.device);
    if (e.deleted) {
      records[key] = { type: e.type, id: e.id, hlc: clock, deleted: true };
      delete hashes[key];
    } else {
      records[key] = { type: e.type, id: e.id, hlc: clock, data: e.data };
      hashes[key] = stableStringify(e.data);
    }
    outbox.add(key);
  }
  return { ...copy, state: { ...copy.state, clock, records, hashes }, outbox: [...outbox] };
}

/** The queued records to send, in queue order (ones that no longer exist are skipped). */
export function outgoingRecords(copy: Outboxed): SyncRecord[] {
  return copy.outbox.map(k => copy.state.records[k]).filter((r): r is SyncRecord => !!r);
}

/**
 * Folds a finished sync round into the latest copy: merges what was pulled, and drops queued keys
 * that were sent — unless they were edited again while the round ran (their clock changed).
 */
export function applySyncRound<T extends Outboxed>(latest: T, pulled: SyncRecord[], sent: SyncRecord[], now: number): T {
  const merged = pulled.length ? mergeRemote(latest.state, pulled, now).state : latest.state;
  const sentAt = new Map<string, Hlc>(sent.map(r => [recordKey(r), r.hlc]));
  const outbox = latest.outbox.filter(k => {
    const at = sentAt.get(k), cur = merged.records[k]?.hlc;
    return !(at && cur && at.t === cur.t && at.c === cur.c && at.d === cur.d);
  });
  return { ...latest, state: merged, outbox };
}
