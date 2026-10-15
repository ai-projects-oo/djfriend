// Record store + last-writer-wins merge for device sync. Pure.
import type { Hlc, SyncRecord, SyncRecordType } from '../../types';
import { compareHlc, receiveHlc, tickHlc } from './hlc';

export const recordKey = (r: { type: SyncRecordType; id: string }) => `${r.type}:${r.id}`;

/** Deterministic JSON (sorted object keys) so equal data always gives the same string. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

/** Everything a device knows: the latest version of each record (tombstones included), and its clock. */
export interface SyncState {
  device: string;
  clock: Hlc | null;
  records: Record<string, SyncRecord>;   // by recordKey
  hashes: Record<string, string>;        // stableStringify(data) of the local value last recorded
}

export function emptySyncState(device: string): SyncState {
  return { device, clock: null, records: {}, hashes: {} };
}

/** A value the app currently holds, before it has a clock. */
export interface LocalItem { type: SyncRecordType; id: string; data: unknown }

/**
 * Records local edits: compares the app's current items (of the given types) with what was last
 * recorded, stamps new/changed ones with a fresh clock, and adds tombstones for removed ones.
 * Returns the new state and the records to send.
 */
export function recordLocalChanges(state: SyncState, items: LocalItem[], types: SyncRecordType[], now: number): { state: SyncState; outgoing: SyncRecord[] } {
  const scope = new Set(types);
  const records = { ...state.records };
  const hashes = { ...state.hashes };
  let clock = state.clock;
  const outgoing: SyncRecord[] = [];
  const seen = new Set<string>();

  for (const it of items) {
    const key = recordKey(it);
    seen.add(key);
    const h = stableStringify(it.data);
    if (hashes[key] === h && records[key] && !records[key].deleted) continue;
    clock = tickHlc(clock, now, state.device);
    const rec: SyncRecord = { type: it.type, id: it.id, hlc: clock, data: it.data };
    records[key] = rec;
    hashes[key] = h;
    outgoing.push(rec);
  }
  for (const [key, rec] of Object.entries(records)) {
    if (!scope.has(rec.type) || rec.deleted || seen.has(key)) continue;
    clock = tickHlc(clock, now, state.device);
    const tomb: SyncRecord = { type: rec.type, id: rec.id, hlc: clock, deleted: true };
    records[key] = tomb;
    delete hashes[key];
    outgoing.push(tomb);
  }
  return { state: { ...state, clock, records, hashes }, outgoing };
}

/**
 * Merges records from another device: each record wins if its clock is newer than ours.
 * Returns the new state and the records that changed locally (to apply to the app).
 */
export function mergeRemote(state: SyncState, incoming: SyncRecord[], now: number): { state: SyncState; applied: SyncRecord[] } {
  const records = { ...state.records };
  const hashes = { ...state.hashes };
  let clock = state.clock;
  const applied: SyncRecord[] = [];
  for (const rec of incoming) {
    if (!rec || typeof rec.id !== 'string' || !rec.hlc) continue;
    clock = receiveHlc(clock, rec.hlc, now, state.device);
    const key = recordKey(rec);
    const mine = records[key];
    if (mine && compareHlc(mine.hlc, rec.hlc) >= 0) continue;
    records[key] = rec;
    if (rec.deleted) delete hashes[key]; else hashes[key] = stableStringify(rec.data);
    applied.push(rec);
  }
  return { state: { ...state, clock, records, hashes }, applied };
}

/** Live (non-deleted) records of a type, as data. */
export function liveData<T>(state: SyncState, type: SyncRecordType): { id: string; data: T }[] {
  return Object.values(state.records).filter(r => r.type === type && !r.deleted).map(r => ({ id: r.id, data: r.data as T }));
}
