import { useCallback, useEffect, useRef, useState } from "react";
import type { DiscogsCollectionEntry, HistoryEntry, PairingPayload, PlaylistLibrary, Song, SyncRecord, VinylStore } from "../types";
import { createPairing, getPairing, syncNow, unpair as unpairDevice, DEFAULT_RELAY } from "../services/deviceSync";
import { playlistItems, releaseItems, setItems, trackItems, vinylItems } from "../lib/sync/records";

const SYNC_EVERY_MS = 2 * 60_000;
const DEBOUNCE_MS = 10_000;

export interface DeviceSyncStatus { syncing: boolean; lastSync: number | null; error: string | null; pulled: number; pushed: number }

/**
 * Keeps the desktop in sync with paired phones while paired: on start, every 2 minutes, and
 * 10 s after library / playlist / set / vinyl / Discogs collection changes. Incoming changes are
 * handed to `onApply`.
 */
export function useDeviceSync(
  data: { library: Song[]; playlistLib: PlaylistLibrary; history: HistoryEntry[]; vinylStore: VinylStore; discogsCollection?: DiscogsCollectionEntry | null; ready: boolean },
  onApply: (applied: SyncRecord[]) => void,
) {
  const [pairing, setPairing] = useState<PairingPayload | null>(() => getPairing());
  const [status, setStatus] = useState<DeviceSyncStatus>({ syncing: false, lastSync: null, error: null, pulled: 0, pushed: 0 });
  const running = useRef(false);
  const latest = useRef(data);
  latest.current = data;
  const applyRef = useRef(onApply);
  applyRef.current = onApply;

  const run = useCallback(async () => {
    if (!getPairing() || running.current || !latest.current.ready) return;
    running.current = true;
    setStatus(s => ({ ...s, syncing: true }));
    try {
      const d = latest.current;
      const r = await syncNow([...trackItems(d.library), ...playlistItems(d.playlistLib), ...setItems(d.history), ...vinylItems(d.vinylStore), ...releaseItems(d.discogsCollection)]);
      if (r.applied.length) applyRef.current(r.applied);
      setStatus({ syncing: false, lastSync: Date.now(), error: null, pulled: r.pulled, pushed: r.pushed });
    } catch (err) {
      setStatus(s => ({ ...s, syncing: false, error: err instanceof Error ? err.message : "Sync failed" }));
    } finally {
      running.current = false;
    }
  }, []);

  // Periodic sync while paired
  useEffect(() => {
    if (!pairing || !data.ready) return;
    void run();
    const t = setInterval(() => void run(), SYNC_EVERY_MS);
    return () => clearInterval(t);
  }, [pairing, data.ready, run]);

  // Debounced sync after local changes
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!pairing) return;
    const t = setTimeout(() => void run(), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [data.library, data.playlistLib, data.history, data.vinylStore, data.discogsCollection, pairing, run]);

  const pair = useCallback((relay = DEFAULT_RELAY) => { const p = createPairing(relay); setPairing(p); return p; }, []);
  const unpair = useCallback(async () => { await unpairDevice(); setPairing(null); setStatus({ syncing: false, lastSync: null, error: null, pulled: 0, pushed: 0 }); }, []);

  return { pairing, status, pair, unpair, syncNow: run };
}
