// Desktop side of device sync (Phase 9): pairing storage and push/pull with the encrypted relay.
// Everything sent is encrypted with the pairing key first; the relay only sees the sync id.
import type { PairingPayload, SyncEnvelope, SyncRecord, SyncRecordType } from '../types';
import { decryptJson, encryptJson, newPairing, toBase64Url } from '../lib/sync/crypto';
import { emptySyncState, liveData, mergeRemote, recordLocalChanges, type LocalItem, type SyncState } from '../lib/sync/merge';

export const DEFAULT_RELAY = 'https://djfriend.onrender.com';
const PAIRING_KEY = 'djfriend-sync-pairing';
const STATE_KEY = 'djfriend-sync-state';
const CURSOR_KEY = 'djfriend-sync-cursor';
const SNAPSHOT_KEY = 'djfriend-sync-snapshot-at';
const SNAPSHOT_EVERY_MS = 24 * 3600_000;
const SYNCED_TYPES: SyncRecordType[] = ['track', 'playlist', 'folder', 'set', 'vinylTrack'];
/** Types the phone may change on the desktop. Analysed track fields stay desktop-owned. */
const ACCEPTED_FROM_REMOTE = new Set<SyncRecordType>(['playlist', 'folder', 'set', 'vinylTrack']);
const BATCH_PLAINTEXT_BYTES = 150_000;   // stays under the relay's 256 KB batch limit after encryption

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

async function relayFetch<T>(p: PairingPayload, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${p.relay}/api/sync/${p.syncId}${path}`, { ...init, headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`Sync relay: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface SyncResult { pulled: number; pushed: number; applied: SyncRecord[] }

/**
 * One sync round: pull the other devices' changes (returned as `applied` for the app to apply),
 * then push local changes. The first push uploads a full encrypted snapshot.
 */
export async function syncNow(items: LocalItem[]): Promise<SyncResult> {
  const p = getPairing();
  if (!p) throw new Error('Not paired');
  let state = loadState();
  let cursor = read<number>(CURSOR_KEY) ?? 0;
  const now = Date.now();

  // ── Pull ──
  const applied: SyncRecord[] = [];
  let pulled = 0;
  for (let guard = 0; guard < 50; guard++) {
    const page = await relayFetch<{ batches: { seq: number; env: SyncEnvelope }[]; latest: number; oldest: number }>(p, `/changes?since=${cursor}`);
    if (cursor < page.oldest - 1) {
      // Fell behind the kept history — start from the snapshot
      const snap = await relayFetch<{ seq: number; env: SyncEnvelope }>(p, '/snapshot').catch(() => null);
      if (snap) {
        const recs = decryptJson<SyncRecord[]>(p, snap.env).filter(r => ACCEPTED_FROM_REMOTE.has(r.type));
        const m = mergeRemote(state, recs, now); state = m.state; applied.push(...m.applied); pulled += recs.length;
        cursor = snap.seq;
      } else cursor = page.oldest - 1;
      continue;
    }
    for (const b of page.batches) {
      const recs = decryptJson<SyncRecord[]>(p, b.env).filter(r => ACCEPTED_FROM_REMOTE.has(r.type));
      const m = mergeRemote(state, recs, now); state = m.state; applied.push(...m.applied); pulled += recs.length;
      cursor = b.seq;
    }
    if (cursor >= page.latest || page.batches.length === 0) break;
  }

  // ── Push ──
  const firstPush = !read<number>(SNAPSHOT_KEY);
  const { state: next, outgoing } = recordLocalChanges(state, items, SYNCED_TYPES, now);
  state = next;
  if (!firstPush) {
    let chunk: SyncRecord[] = [], size = 0;
    const flush = async () => {
      if (!chunk.length) return;
      const r = await relayFetch<{ seq: number }>(p, '/changes', { method: 'POST', body: JSON.stringify({ env: encryptJson(p, chunk, random) }) });
      if (r.seq === cursor + 1) cursor = r.seq;   // nothing else arrived in between — skip re-reading our own batch
      chunk = []; size = 0;
    };
    for (const r of outgoing) {
      const n = JSON.stringify(r).length;
      if (size + n > BATCH_PLAINTEXT_BYTES) await flush();
      chunk.push(r); size += n;
    }
    await flush();
  }
  // Full snapshot on the first push, then refreshed daily so a newly paired phone starts from current data
  const last = read<number>(SNAPSHOT_KEY);
  if (firstPush || typeof last !== 'number' || now - last > SNAPSHOT_EVERY_MS) {
    const dataByKey = new Map(items.map(i => [`${i.type}:${i.id}`, i.data]));
    const all = Object.values(state.records).map(r => (r.deleted ? r : { ...r, data: dataByKey.get(`${r.type}:${r.id}`) ?? r.data }));
    await relayFetch(p, '/snapshot', { method: 'PUT', body: JSON.stringify({ env: encryptJson(p, all, random) }) });
    write(SNAPSHOT_KEY, now);
  }
  saveState(state);
  write(CURSOR_KEY, cursor);
  return { pulled, pushed: outgoing.length, applied };
}

export { liveData };
