// Desktop side of device sync (Phase 9): pairing storage and push/pull with the encrypted relay.
// Everything sent is encrypted with the pairing key first; the relay only sees the sync id.
import type { PairingPayload, SyncRecord, SyncRecordType } from '../types';
import { newPairing, toBase64Url } from '../lib/sync/crypto';
import { emptySyncState, liveData, recordLocalChanges, type LocalItem, type SyncState } from '../lib/sync/merge';
import { httpTransport, pullChanges, pushChanges, pushSnapshot } from './syncProtocol';

export const DEFAULT_RELAY = 'https://djfriend.onrender.com';
const PAIRING_KEY = 'djfriend-sync-pairing';
const STATE_KEY = 'djfriend-sync-state';
const CURSOR_KEY = 'djfriend-sync-cursor';
const SNAPSHOT_KEY = 'djfriend-sync-snapshot-at';
const SNAPSHOT_EVERY_MS = 24 * 3600_000;
const SYNCED_TYPES: SyncRecordType[] = ['track', 'playlist', 'folder', 'set', 'vinylTrack', 'release'];
/** Types the phone may change on the desktop. Analysed track fields and Discogs releases stay desktop-owned. */
const ACCEPTED_FROM_REMOTE = new Set<SyncRecordType>(['playlist', 'folder', 'set', 'vinylTrack']);

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function read<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode — sync restarts from a snapshot */ }
}

export function getPairing(): PairingPayload | null { return read<PairingPayload>(PAIRING_KEY); }

export function createPairing(relay = DEFAULT_RELAY): PairingPayload {
  const p = newPairing(random, relay);
  write(PAIRING_KEY, p);
  write(STATE_KEY, null);
  write(CURSOR_KEY, 0);
  try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* */ }
  return p;
}

/** Unpair: wipe the relay copy and forget the key. Old devices can no longer read anything new. */
export async function unpair(): Promise<void> {
  const p = getPairing();
  if (p) await fetch(`${p.relay}/api/sync/${p.syncId}`, { method: 'DELETE' }).catch(() => {});
  for (const k of [PAIRING_KEY, STATE_KEY, CURSOR_KEY, SNAPSHOT_KEY]) { try { localStorage.removeItem(k); } catch { /* */ } }
}

// The persisted state keeps clocks and hashes only — record data is rebuilt from the app on every push.
function loadState(): SyncState {
  const s = read<SyncState>(STATE_KEY);
  return s ?? emptySyncState(toBase64Url(random(6)));
}
function saveState(s: SyncState): void {
  const records: SyncState['records'] = {};
  for (const [k, r] of Object.entries(s.records)) records[k] = { type: r.type, id: r.id, hlc: r.hlc, ...(r.deleted ? { deleted: true } : {}) };
  write(STATE_KEY, { ...s, records });
}

export interface SyncResult { pulled: number; pushed: number; applied: SyncRecord[] }

/**
 * One sync round: pull the other devices' changes (returned as `applied` for the app to apply),
 * then push local changes. The first push uploads a full encrypted snapshot.
 */
export async function syncNow(items: LocalItem[]): Promise<SyncResult> {
  const p = getPairing();
  if (!p) throw new Error('Not paired');
  const t = httpTransport(p);
  const now = Date.now();

  // ── Pull ──
  const pull = await pullChanges(t, p, loadState(), read<number>(CURSOR_KEY) ?? 0, ACCEPTED_FROM_REMOTE, now);
  let cursor = pull.cursor;

  // ── Push ──
  const last = pull.reset ? null : read<number>(SNAPSHOT_KEY);
  const { state, outgoing } = recordLocalChanges(pull.state, items, SYNCED_TYPES, now);
  if (last) cursor = await pushChanges(t, p, outgoing, cursor, random);
  // Full snapshot on the first push, then refreshed daily so a newly paired phone starts from current data
  if (typeof last !== 'number' || now - last > SNAPSHOT_EVERY_MS) {
    const dataByKey = new Map(items.map(i => [`${i.type}:${i.id}`, i.data]));
    const all = Object.values(state.records).map(r => (r.deleted ? r : { ...r, data: dataByKey.get(`${r.type}:${r.id}`) ?? r.data }));
    await pushSnapshot(t, p, all, cursor, random);
    write(SNAPSHOT_KEY, now);
  }
  saveState(state);
  write(CURSOR_KEY, cursor);
  return { pulled: pull.pulled, pushed: outgoing.length, applied: pull.applied };
}

export { liveData };
