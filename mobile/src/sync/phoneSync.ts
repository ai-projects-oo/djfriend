// Phone side of device sync: pairing (secure storage), the local record store (a file), and pulls
// from the encrypted relay. The phone reads everything the desktop shares; in this version it
// doesn't edit anything, so it never pushes.
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { getRandomBytes } from 'expo-crypto';
import type { PairingPayload, SyncRecordType } from '../../../app/types';
import { parsePairing, toBase64Url } from '../../../app/lib/sync/crypto';
import { emptySyncState, type SyncState } from '../../../app/lib/sync/merge';
import { httpTransport, pullChanges } from '../../../app/services/syncProtocol';

const PAIRING_KEY = 'djfriend.pairing';
const ACCEPT = new Set<SyncRecordType>(['track', 'playlist', 'folder', 'set', 'vinylTrack', 'gigLead']);

/** The phone's full working copy, plus how far it has read the relay (null = start from the snapshot). */
export interface LocalCopy { state: SyncState; cursor: number | null; lastSync: number | null }

const stateFile = () => new File(Paths.document, 'sync-state.json');
const freshCopy = (): LocalCopy => ({ state: emptySyncState(toBase64Url(getRandomBytes(6))), cursor: null, lastSync: null });

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
  try { return JSON.parse(await f.text()) as LocalCopy; } catch { return freshCopy(); }
}

async function saveLocalCopy(copy: LocalCopy): Promise<void> {
  const f = stateFile();
  if (!f.exists) f.create();
  await f.write(JSON.stringify(copy));
}

/** One sync round: pull and merge everything new from the relay. */
export async function syncOnce(p: PairingPayload, copy: LocalCopy): Promise<{ copy: LocalCopy; pulled: number; changed: boolean }> {
  const r = await pullChanges(httpTransport(p), p, copy.state, copy.cursor, ACCEPT, Date.now());
  // Keep the same state object when nothing changed, so screens don't recompute
  const next: LocalCopy = { state: r.applied.length ? r.state : copy.state, cursor: r.cursor, lastSync: Date.now() };
  await saveLocalCopy(next);
  return { copy: next, pulled: r.pulled, changed: r.applied.length > 0 };
}
