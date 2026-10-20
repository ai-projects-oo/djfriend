import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { PairingPayload, Playlist, PlaylistFolder } from '../../../app/types';
import { libraryTracks, playlistsOf, savedSets, type PhoneSet, type PhoneTrack } from '../../../app/lib/phoneLibrary';
import { forgetPairing, loadLocalCopy, loadPairing, savePairing, syncOnce, type LocalCopy } from './phoneSync';

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
    if (!p || !c || running.current) return;
    running.current = true;
    setStatus(s => ({ ...s, syncing: true }));
    try {
      const r = await syncOnce(p, c);
      // Ignore the result if the phone was unpaired / re-paired meanwhile
      if (latest.current.pairing?.syncId === p.syncId) {
        setCopy(r.copy);
        latest.current = { pairing: p, copy: r.copy };
      }
      setStatus({ syncing: false, error: null, lastPulled: r.pulled });
    } catch (err) {
      setStatus(s => ({ ...s, syncing: false, error: err instanceof Error ? err.message : 'Sync failed' }));
    } finally {
      running.current = false;
    }
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

  const unpair = useCallback(async () => {
    await forgetPairing();
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
    return { tracks, trackById: new Map(tracks.map(t => [t.id, t])), playlists, folders, sets: state ? savedSets(state) : [] };
  }, [state]);
  const lastSync = copy?.lastSync ?? null;
  const value = useMemo<SyncContextValue>(
    () => ({ ready, pairing, lastSync, status, ...data, pair, unpair, syncNow }),
    [ready, pairing, lastSync, status, data, pair, unpair, syncNow],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
