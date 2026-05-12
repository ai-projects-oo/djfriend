import { useState, useCallback, useMemo } from 'react';
import type { DiscogsCollectionEntry, DiscogsMode } from '../types';
import { fetchDiscogsCollection, matchDiscogsCollection } from '../lib/discogsCollection';
import type { Song } from '../types';

const STORAGE_KEY = 'djfriend_discogs_collection';

export type SyncStatus =
  | { phase: 'idle' }
  | { phase: 'syncing'; loaded: number; total: number }
  | { phase: 'done' }
  | { phase: 'error'; message: string };

function loadFromStorage(): DiscogsCollectionEntry | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DiscogsCollectionEntry) : null;
  } catch {
    return null;
  }
}

function saveToStorage(entry: DiscogsCollectionEntry): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
}

export function useDiscogsCollection(library: Song[]) {
  const [rawCollection, setRawCollection] = useState<DiscogsCollectionEntry | null>(
    () => loadFromStorage(),
  );
  const [discogsMode, setDiscogsMode] = useState<DiscogsMode>('library');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ phase: 'idle' });

  // Derive matched collection from raw stored releases + current library (recomputed on library change)
  const discogsCollection = useMemo<DiscogsCollectionEntry | null>(() => {
    if (!rawCollection || library.length === 0) return rawCollection;
    const matched = matchDiscogsCollection(rawCollection.releases, library);
    return { ...rawCollection, releases: matched };
  }, [rawCollection, library]);

  const syncCollection = useCallback(async () => {
    setSyncStatus({ phase: 'syncing', loaded: 0, total: 0 });
    try {
      const releases = await fetchDiscogsCollection(
        (loaded, total) => setSyncStatus({ phase: 'syncing', loaded, total }),
      );
      const entry: DiscogsCollectionEntry = {
        id:            'discogs-collection',
        username:      rawCollection?.username ?? '',
        syncedAt:      Date.now(),
        totalReleases: releases.length,
        releases,
      };
      saveToStorage(entry);
      setRawCollection(entry);
      setSyncStatus({ phase: 'done' });
    } catch (err) {
      setSyncStatus({
        phase:   'error',
        message: err instanceof Error ? err.message : 'Sync failed.',
      });
    }
  }, [rawCollection]);

  const clearCollection = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setRawCollection(null);
    setDiscogsMode('library');
    setSyncStatus({ phase: 'idle' });
  }, []);

  return {
    discogsCollection,
    discogsMode,
    setDiscogsMode,
    syncStatus,
    setSyncStatus,
    syncCollection,
    clearCollection,
  };
}
