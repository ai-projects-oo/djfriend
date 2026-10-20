// Device-sync protocol (Phase 9), shared by the desktop and the phone app: pull and push encrypted
// record batches through the relay. No storage or globals — callers pass the pairing, sync state,
// cursor, transport and randomness, so this runs unchanged in Electron, the browser and React Native.
import type { PairingPayload, SyncEnvelope, SyncRecord, SyncRecordType } from '../types';
import { decryptJson, encryptJson, type RandomBytes } from '../lib/sync/crypto';
import { mergeRemote, type SyncState } from '../lib/sync/merge';

/** Stays under the relay's 256 KB batch limit after encryption + base64. */
export const BATCH_PLAINTEXT_BYTES = 150_000;

export interface ChangesPage { batches: { seq: number; env: SyncEnvelope }[]; latest: number; oldest: number }

export interface RelayTransport {
  getChanges(since: number): Promise<ChangesPage>;
  /** Null when no snapshot has been uploaded yet. */
  getSnapshot(): Promise<{ seq: number; env: SyncEnvelope } | null>;
  postChanges(env: SyncEnvelope): Promise<{ seq: number }>;
  /** `seq` = the last batch the snapshot includes. */
  putSnapshot(env: SyncEnvelope, seq: number): Promise<{ seq: number }>;
}

export class RelayError extends Error {
  readonly status: number;
  constructor(status: number) { super(`Sync relay: ${status}`); this.status = status; }
}

export function httpTransport(p: PairingPayload, fetchFn: typeof fetch = (...a) => fetch(...a)): RelayTransport {
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetchFn(`${p.relay}/api/sync/${p.syncId}${path}`, { ...init, headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) throw new RelayError(res.status);
    return res.json() as Promise<T>;
  };
  return {
    getChanges: since => call(`/changes?since=${since}`),
    getSnapshot: () => call<{ seq: number; env: SyncEnvelope }>('/snapshot').catch(err => {
      if (err instanceof RelayError && err.status === 404) return null;
      throw err;
    }),
    postChanges: env => call('/changes', { method: 'POST', body: JSON.stringify({ env }) }),
    putSnapshot: (env, seq) => call('/snapshot', { method: 'PUT', body: JSON.stringify({ env, seq }) }),
  };
}

/** `reset` = the relay lost our history (wiped / redeployed without storage); the caller should re-upload a snapshot. */
export interface PullResult { state: SyncState; cursor: number; applied: SyncRecord[]; pulled: number; reset: boolean }

/**
 * Pulls the other devices' changes after `cursor` and merges the accepted record types.
 * `cursor` null = never pulled (a newly paired phone): starts from the full snapshot.
 * Falls back to the snapshot too when the relay no longer keeps the batches we need.
 */
export async function pullChanges(
  t: RelayTransport, p: PairingPayload, state: SyncState, cursor: number | null,
  accept: ReadonlySet<SyncRecordType>, now: number,
): Promise<PullResult> {
  const applied: SyncRecord[] = [];
  let pulled = 0;
  const take = (recs: SyncRecord[]) => {
    const ok = recs.filter(r => accept.has(r.type));
    const m = mergeRemote(state, ok, now);
    state = m.state; applied.push(...m.applied); pulled += ok.length;
  };
  const fromSnapshot = async (fallback: number) => {
    const snap = await t.getSnapshot();
    if (!snap) return fallback;
    take(decryptJson<SyncRecord[]>(p, snap.env));
    return snap.seq;
  };

  let at = cursor ?? await fromSnapshot(0);
  let reset = false;
  for (let guard = 0; guard < 50; guard++) {
    const page = await t.getChanges(at);
    if (page.latest < at) { reset = true; at = Math.min(await fromSnapshot(0), page.latest); continue; }
    if (at < page.oldest - 1) { at = Math.max(await fromSnapshot(page.oldest - 1), page.oldest - 1); continue; }
    for (const b of page.batches) { take(decryptJson<SyncRecord[]>(p, b.env)); at = b.seq; }
    if (at >= page.latest || page.batches.length === 0) break;
  }
  return { state, cursor: at, applied, pulled, reset };
}

/** Uploads records as encrypted batches. Returns the new cursor (skips re-reading our own batches). */
export async function pushChanges(
  t: RelayTransport, p: PairingPayload, outgoing: SyncRecord[], cursor: number, random: RandomBytes,
  maxBytes = BATCH_PLAINTEXT_BYTES,
): Promise<number> {
  let chunk: SyncRecord[] = [], size = 0;
  const flush = async () => {
    if (!chunk.length) return;
    const r = await t.postChanges(encryptJson(p, chunk, random));
    if (r.seq === cursor + 1) cursor = r.seq;   // nothing else arrived in between
    chunk = []; size = 0;
  };
  for (const r of outgoing) {
    const n = JSON.stringify(r).length;
    if (size + n > maxBytes) await flush();
    chunk.push(r); size += n;
  }
  await flush();
  return cursor;
}

/** Replaces the relay's full snapshot. `cursor` = last batch merged into `records`. */
export async function pushSnapshot(t: RelayTransport, p: PairingPayload, records: SyncRecord[], cursor: number, random: RandomBytes): Promise<void> {
  await t.putSnapshot(encryptJson(p, records, random), cursor);
}
