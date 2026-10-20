import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { PairingPayload, Playlist, PlaylistFolder, SyncRecord, VinylReleaseData } from '../../../app/types';
import { libraryTracks, playlistsOf, releasesOf, savedSets, type PhoneRelease, type PhoneSet, type PhoneTrack } from '../../../app/lib/phoneLibrary';
import { applySyncRound, writeLocal, type LocalEdit } from '../../../app/lib/sync/outbox';
import { recordKey } from '../../../app/lib/sync/merge';
import { endGigSession } from '../gig/session';
import { forgetPairing, loadLocalCopy, loadPairing, saveLocalCopy, savePairing, syncOnce, type LocalCopy } from './phoneSync';

const SYNC_EVERY_MS = 2 * 60_000;

export interface SyncStatus { syncing: boolean; error: string | null; lastPulled: number }

interface SyncContextValue {
  /** False until the pairing and local copy have been read from storage. */
  ready: boolean;
  pairing: PairingPayload | null;
  lastSync: number | null;
  status: SyncStatus;
  tracks: PhoneTrack[];
  trackById: Map<string, PhoneTrack>;
  playlists: Playlist[];
  folders: PlaylistFolder[];
  sets: PhoneSet[];
  releases: PhoneRelease[];
  /** Vinyl tracks entered for a Discogs release, by release id. */
  vinylById: Map<string, VinylReleaseData>;
  /** Local edits not sent to the relay yet. */
  pending: number;
  /** Saves edits on the phone at once; they're sent with the next sync (right away when online). */
  edit: (edits: LocalEdit[]) => void;
  /** The current version of a record, if any. */
  getRecord: (type: SyncRecord['type'], id: string) => SyncRecord | undefined;
  /** Pairs with a scanned / pasted code. False if it isn't a DJFriend pairing code. */
  pair: (code: string) => Promise<boolean>;
  unpair: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync outside SyncProvider');
  return ctx;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [pairing, setPairing] = useState<PairingPayload | null>(null);
  const [copy, setCopy] = useState<LocalCopy | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ syncing: false, error: null, lastPulled: 0 });
  const running = useRef(false);
  const again = useRef(false);   // an edit arrived during a round: run another one after it
  const latest = useRef({ pairing, copy });
  useEffect(() => { latest.current = { pairing, copy }; }, [pairing, copy]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [p, c] = await Promise.all([loadPairing(), loadLocalCopy()]);
      if (!alive) return;
      setPairing(p); setCopy(c); setReady(true);
    })();
    return () => { alive = false; };
  }, []);

  const syncNow = useCallback(async () => {
    const { pairing: p, copy: c } = latest.current;
    if (!p || !c) return;
    if (running.current) { again.current = true; return; }
    running.current = true;
    setStatus(s => ({ ...s, syncing: true }));
    try {
      const r = await syncOnce(p, c);
      // Ignore the result if the phone was unpaired / re-paired meanwhile. Edits made while the
      // round ran are kept: the result is folded into the latest copy, not the one we started from.
      const cur = latest.current.copy;
      if (latest.current.pairing?.syncId === p.syncId && cur) {
        const folded = applySyncRound(cur, r.pulled, r.sent, Date.now());
        const next: LocalCopy = { ...folded, cursor: r.cursor, lastSync: Date.now() };
        latest.current = { pairing: p, copy: next };
        setCopy(next);
        await saveLocalCopy(next);
      }
      setStatus({ syncing: false, error: null, lastPulled: r.pulledCount });
    } catch (err) {
      setStatus(s => ({ ...s, syncing: false, error: err instanceof Error ? err.message : 'Sync failed' }));
    } finally {
      running.current = false;
    }
    if (again.current) { again.current = false; await syncNow(); }
  }, []);

  // Sync when paired, when the app comes to the foreground, and every 2 minutes while it's open
  useEffect(() => {
    if (!pairing || !ready) return;
    void syncNow();
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => void syncNow(), SYNC_EVERY_MS);
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        void syncNow();
        if (!timer) timer = setInterval(() => void syncNow(), SYNC_EVERY_MS);
      } else if (timer) { clearInterval(timer); timer = null; }
    });
    return () => { sub.remove(); if (timer) clearInterval(timer); };
  }, [pairing, ready, syncNow]);

  const pair = useCallback(async (code: string) => {
    const p = await savePairing(code);
    if (!p) return false;
    const c = await loadLocalCopy();
    latest.current = { pairing: p, copy: c };
    setCopy(c); setPairing(p);
    setStatus({ syncing: false, error: null, lastPulled: 0 });
    return true;
  }, []);

  const edit = useCallback((edits: LocalEdit[]) => {
    const c = latest.current.copy;
    if (!c || !edits.length) return;
    const next = writeLocal(c, edits, Date.now());
    latest.current = { ...latest.current, copy: next };
    setCopy(next);
    void saveLocalCopy(next).catch(() => {});
    void syncNow();
  }, [syncNow]);

  const getRecord = useCallback((type: SyncRecord['type'], id: string) => latest.current.copy?.state.records[recordKey({ type, id })], []);

  const unpair = useCallback(async () => {
    await forgetPairing();
    endGigSession();   // its set belonged to the old pairing
    const c = await loadLocalCopy();
    latest.current = { pairing: null, copy: c };
    setPairing(null); setCopy(c);
    setStatus({ syncing: false, error: null, lastPulled: 0 });
  }, []);

  const state = copy?.state;
  // Derived lists only change when the record store does, not on every status update
  const data = useMemo(() => {
    const tracks = state ? libraryTracks(state) : [];
    const { playlists, folders } = state ? playlistsOf(state) : { playlists: [], folders: [] };
    const { releases, vinylById } = state ? releasesOf(state) : { releases: [], vinylById: new Map<string, VinylReleaseData>() };
    return { tracks, trackById: new Map(tracks.map(t => [t.id, t])), playlists, folders, sets: state ? savedSets(state) : [], releases, vinylById };
  }, [state]);
  const lastSync = copy?.lastSync ?? null;
  const pending = copy?.outbox.length ?? 0;
  const value = useMemo<SyncContextValue>(
    () => ({ ready, pairing, lastSync, status, ...data, pending, edit, getRecord, pair, unpair, syncNow }),
    [ready, pairing, lastSync, status, data, pending, edit, getRecord, pair, unpair, syncNow],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
