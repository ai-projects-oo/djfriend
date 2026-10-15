// App state ↔ sync records. Pure.
// The desktop is authoritative for analysed track fields; playlists, folders, vinyl data and set
// metadata can be edited on either device.
import type { HistoryEntry, SetTrack, Playlist, PlaylistFolder, PlaylistLibrary, Song, SyncRecord, VinylReleaseData, VinylStore } from '../../types';
import type { LocalItem } from './merge';

/** What the phone needs about a track (no waveforms, no file paths). */
export interface SyncTrack {
  artist: string; title: string; bpm: number; key: string; camelot: string; energy: number;
  genres: string[]; duration?: number; year?: number; comment?: string;
}

/** A saved set as the phone sees it. */
export interface SyncSet {
  name: string; timestamp: number; rating?: HistoryEntry['rating']; notes?: string;
  tracks: { file: string; artist: string; title: string; bpm: number; camelot: string; energy: number }[];
}

export function trackItems(library: Song[]): LocalItem[] {
  return library.map(s => ({
    type: 'track' as const, id: s.file,
    data: {
      artist: s.artist, title: s.title, bpm: s.bpm, key: s.key, camelot: s.camelot, energy: s.energy, genres: s.genres,
      ...(s.duration != null ? { duration: s.duration } : {}), ...(s.year != null ? { year: s.year } : {}), ...(s.comment ? { comment: s.comment } : {}),
    } satisfies SyncTrack,
  }));
}

export function playlistItems(lib: PlaylistLibrary): LocalItem[] {
  return [
    ...lib.playlists.map(p => ({ type: 'playlist' as const, id: p.id, data: p })),
    ...lib.folders.map(f => ({ type: 'folder' as const, id: f.id, data: f })),
  ];
}

export function setItems(history: HistoryEntry[]): LocalItem[] {
  return history.map(h => ({
    type: 'set' as const, id: h.id,
    data: {
      name: h.name, timestamp: h.timestamp, ...(h.rating ? { rating: h.rating } : {}), ...(h.notes ? { notes: h.notes } : {}),
      tracks: h.tracks.map(t => ({ file: t.file, artist: t.artist, title: t.title, bpm: t.bpm, camelot: t.camelot, energy: t.energy })),
    } satisfies SyncSet,
  }));
}

export function vinylItems(store: VinylStore): LocalItem[] {
  return Object.entries(store).map(([releaseId, data]) => ({ type: 'vinylTrack' as const, id: releaseId, data }));
}

const live = (applied: SyncRecord[], type: SyncRecord['type']) => applied.filter(r => r.type === type);

/** Applies merged playlist/folder records to the playlist library. Unchanged library if none applied. */
export function applyPlaylistRecords(lib: PlaylistLibrary, applied: SyncRecord[]): PlaylistLibrary {
  const pl = live(applied, 'playlist'), fo = live(applied, 'folder');
  if (!pl.length && !fo.length) return lib;
  const playlists = new Map(lib.playlists.map(p => [p.id, p]));
  for (const r of pl) { if (r.deleted) playlists.delete(r.id); else playlists.set(r.id, r.data as Playlist); }
  const folders = new Map(lib.folders.map(f => [f.id, f]));
  for (const r of fo) { if (r.deleted) folders.delete(r.id); else folders.set(r.id, r.data as PlaylistFolder); }
  return { ...lib, playlists: [...playlists.values()], folders: [...folders.values()] };
}

/** Applies merged vinyl records (key/BPM detected on the phone, edits) to the vinyl store. */
export function applyVinylRecords(store: VinylStore, applied: SyncRecord[]): VinylStore {
  const vr = live(applied, 'vinylTrack');
  if (!vr.length) return store;
  const next: VinylStore = { ...store };
  for (const r of vr) {
    const id = Number(r.id);
    if (r.deleted) delete next[id]; else next[id] = r.data as VinylReleaseData;
  }
  return next;
}

/**
 * Applies merged set records. Existing sets get the synced name/rating/notes/track order; sets
 * created on the phone (e.g. a live set log) are added using `songsByFile` and the given defaults.
 */
export function applySetRecords(
  history: HistoryEntry[], applied: SyncRecord[], songsByFile: Map<string, Song>,
  defaults: Pick<HistoryEntry, 'prefs' | 'curve'>,
): HistoryEntry[] {
  const sr = live(applied, 'set');
  if (!sr.length) return history;
  const byId = new Map(history.map(h => [h.id, h]));
  for (const r of sr) {
    if (r.deleted) { byId.delete(r.id); continue; }
    const d = r.data as SyncSet;
    const prev = byId.get(r.id);
    const prevTracks = new Map((prev?.tracks ?? []).map(t => [t.file, t]));
    const tracks: SetTrack[] = d.tracks.map((t, slot) => {
      const old = prevTracks.get(t.file);
      if (old) return { ...old, slot };
      const song = songsByFile.get(t.file);
      if (song) return { ...song, slot, targetEnergy: song.energy, harmonicWarning: false };
      return { file: t.file, artist: t.artist, title: t.title, bpm: t.bpm, key: '', camelot: t.camelot, energy: t.energy, genres: [], slot, targetEnergy: t.energy, harmonicWarning: false };
    });
    byId.set(r.id, {
      ...(prev ?? { id: r.id, ...defaults }),
      id: r.id, name: d.name, timestamp: d.timestamp, rating: d.rating, notes: d.notes, tracks,
    });
  }
  return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
}
