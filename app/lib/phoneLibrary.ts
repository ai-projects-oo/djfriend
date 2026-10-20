// What the DJFriend phone app shows, derived from its synced record store. Pure.
import type { Playlist, PlaylistFolder } from '../types';
import { liveData, type SyncState } from './sync/merge';
import type { SyncSet, SyncTrack } from './sync/records';
import { getCamelotCompatibility } from './camelot';

export interface PhoneTrack extends SyncTrack { id: string }
export interface PhoneSet extends SyncSet { id: string }

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

export function libraryTracks(state: SyncState): PhoneTrack[] {
  return liveData<SyncTrack>(state, 'track')
    .map(({ id, data }) => ({ ...data, id }))
    .sort((a, b) => byText(a.artist, b.artist) || byText(a.title, b.title));
}

export type TrackSort = 'artist' | 'title' | 'bpm' | 'key' | 'energy';

export interface TrackFilter {
  query: string;
  bpmMin?: number;
  bpmMax?: number;
  /** Only tracks that mix harmonically with this Camelot key (same, ±1, relative, boosts). */
  mixesWith?: string;
  sort?: TrackSort;
}

const camelotOrder = (c: string) => {
  const m = c.match(/^(\d{1,2})([AB])$/i);
  return m ? Number(m[1]) * 2 + (m[2].toUpperCase() === 'B' ? 1 : 0) : 999;
};

export function filterTracks(tracks: PhoneTrack[], f: TrackFilter): PhoneTrack[] {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  const out = tracks.filter(t => {
    if (f.bpmMin != null && t.bpm < f.bpmMin) return false;
    if (f.bpmMax != null && t.bpm > f.bpmMax) return false;
    if (f.mixesWith && getCamelotCompatibility(f.mixesWith, t.camelot) === 'incompatible') return false;
    if (!words.length) return true;
    const hay = `${t.artist} ${t.title} ${t.genres.join(' ')} ${t.camelot}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
  switch (f.sort ?? 'artist') {
    case 'title':  return out.sort((a, b) => byText(a.title, b.title));
    case 'bpm':    return out.sort((a, b) => a.bpm - b.bpm || byText(a.artist, b.artist));
    case 'key':    return out.sort((a, b) => camelotOrder(a.camelot) - camelotOrder(b.camelot) || a.bpm - b.bpm);
    case 'energy': return out.sort((a, b) => b.energy - a.energy || byText(a.artist, b.artist));
    default:       return out;   // already artist/title order
  }
}

export interface PlaylistNode { kind: 'folder' | 'playlist'; id: string; name: string; depth: number; count: number }

/** Folders and playlists as an indented list (folders first at each level, both A–Z). */
export function playlistTree(folders: PlaylistFolder[], playlists: Playlist[]): PlaylistNode[] {
  const folderIds = new Set(folders.map(f => f.id));
  const parentOf = (id?: string) => (id && folderIds.has(id) ? id : undefined);   // orphans go to the top
  const out: PlaylistNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | undefined, depth: number) => {
    for (const f of folders.filter(x => parentOf(x.parentId) === parent).sort((a, b) => byText(a.name, b.name))) {
      if (seen.has(f.id)) continue;   // guards against folder cycles
      seen.add(f.id);
      const children = playlists.filter(p => parentOf(p.folderId) === f.id).length + folders.filter(x => x.parentId === f.id).length;
      out.push({ kind: 'folder', id: f.id, name: f.name, depth, count: children });
      walk(f.id, depth + 1);
    }
    for (const p of playlists.filter(x => parentOf(x.folderId) === parent).sort((a, b) => byText(a.name, b.name))) {
      out.push({ kind: 'playlist', id: p.id, name: p.name, depth, count: p.tracks.length });
    }
  };
  walk(undefined, 0);
  return out;
}

export function playlistsOf(state: SyncState): { folders: PlaylistFolder[]; playlists: Playlist[] } {
  return {
    folders: liveData<PlaylistFolder>(state, 'folder').map(r => r.data),
    playlists: liveData<Playlist>(state, 'playlist').map(r => r.data),
  };
}

/** Track ids → tracks, in order; ids not in the library are skipped. */
export function resolveTracks(ids: string[], byId: Map<string, PhoneTrack>): PhoneTrack[] {
  return ids.flatMap(id => byId.get(id) ?? []);
}

export function savedSets(state: SyncState): PhoneSet[] {
  return liveData<SyncSet>(state, 'set').map(({ id, data }) => ({ ...data, id })).sort((a, b) => b.timestamp - a.timestamp);
}

export function formatDuration(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
