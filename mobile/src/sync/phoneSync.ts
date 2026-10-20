// Phone side of device sync: pairing (secure storage), the local record store (a file), and
// pull / push with the encrypted relay. Edits made on the phone (live set logs, vinyl keys) are
// written to the local store at once and queued; each sync round sends the queue.
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { getRandomBytes } from 'expo-crypto';
import type { PairingPayload, SyncRecord, SyncRecordType } from '../../../app/types';
import { parsePairing, toBase64Url } from '../../../app/lib/sync/crypto';
import { emptySyncState, type SyncState } from '../../../app/lib/sync/merge';
import { outgoingRecords } from '../../../app/lib/sync/outbox';
import { httpTransport, pullChanges, pushChanges } from '../../../app/services/syncProtocol';

const PAIRING_KEY = 'djfriend.pairing';
const ACCEPT = new Set<SyncRecordType>(['track', 'playlist', 'folder', 'set', 'vinylTrack', 'gigLead', 'release']);

/**
 * The phone's full working copy, how far it has read the relay (null = start from the snapshot),
 * and the keys of local edits not sent yet.
 */
export interface LocalCopy { state: SyncState; cursor: number | null; lastSync: number | null; outbox: string[] }

const stateFile = () => new File(Paths.document, 'sync-state.json');
const freshCopy = (): LocalCopy => ({ state: emptySyncState(toBase64Url(getRandomBytes(6))), cursor: null, lastSync: null, outbox: [] });

export async function loadPairing(): Promise<PairingPayload | null> {
  const raw = await SecureStore.getItemAsync(PAIRING_KEY);
  return raw ? parsePairing(raw) : null;
}

/** Saves a scanned / pasted pairing code. Null if the text isn't a DJFriend pairing code. */
export async function savePairing(text: string): Promise<PairingPayload | null> {
  const p = parsePairing(text.trim());
  if (!p) return null;
  await SecureStore.setItemAsync(PAIRING_KEY, JSON.stringify(p));
  deleteLocalCopy();
  return p;
}

/** Unpairs this phone only: forgets the key and the local copy. The desktop's pairing is untouched. */
export async function forgetPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(PAIRING_KEY);
  deleteLocalCopy();
}

function deleteLocalCopy(): void {
  const f = stateFile();
  if (f.exists) f.delete();
}

export async function loadLocalCopy(): Promise<LocalCopy> {
  const f = stateFile();
  if (!f.exists) return freshCopy();
  try {
    const c = JSON.parse(await f.text()) as LocalCopy;
    return { ...c, outbox: c.outbox ?? [] };   // copies saved by 0.1.0 have no outbox
  } catch { return freshCopy(); }
}

export async function saveLocalCopy(copy: LocalCopy): Promise<void> {
  const f = stateFile();
  if (!f.exists) f.create();
  await f.write(JSON.stringify(copy));
}

export interface SyncRound { cursor: number; pulled: SyncRecord[]; sent: SyncRecord[]; pulledCount: number }

/**
 * One sync round: pull and merge everything new from the relay, then send queued edits. Doesn't
 * touch the copy — fold the result into the latest copy with `applySyncRound`.
 */
export async function syncOnce(p: PairingPayload, copy: LocalCopy): Promise<SyncRound> {
  const t = httpTransport(p);
  const pull = await pullChanges(t, p, copy.state, copy.cursor, ACCEPT, Date.now());
  const sent = outgoingRecords({ state: pull.state, outbox: copy.outbox });
  const cursor = sent.length ? await pushChanges(t, p, sent, pull.cursor, getRandomBytes) : pull.cursor;
  return { cursor, pulled: pull.applied, sent, pulledCount: pull.pulled };
}
