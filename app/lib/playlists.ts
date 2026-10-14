import type { Playlist, PlaylistFolder, PlaylistLibrary, SmartCriteria, Song } from '../types';

// Pure operations on the playlist library. Callers pass in ids and timestamps so every
// function stays deterministic; each returns a new library and never mutates its input.

export const EMPTY_PLAYLIST_LIBRARY: PlaylistLibrary = { schemaVersion: 1, playlists: [], folders: [] };

// `fn` returns the same playlist object when nothing changes — then the library is returned
// unchanged too, so no save and no empty undo step happen
function updatePlaylist(lib: PlaylistLibrary, id: string, now: number, fn: (p: Playlist) => Playlist): PlaylistLibrary {
  let changed = false;
  const playlists = lib.playlists.map(p => {
    if (p.id !== id) return p;
    const next = fn(p);
    if (next === p) return p;
    changed = true;
    return { ...next, updatedAt: now };
  });
  return changed ? { ...lib, playlists } : lib;
}

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((f, i) => f === b[i]);

/** Validates data read from disk; anything malformed is dropped rather than crashing the UI. */
export function parsePlaylistLibrary(raw: unknown): PlaylistLibrary {
  if (typeof raw !== 'object' || raw === null) return EMPTY_PLAYLIST_LIBRARY;
  const r = raw as Partial<PlaylistLibrary>;
  const folders = Array.isArray(r.folders)
    ? r.folders.filter((f): f is PlaylistFolder => typeof f?.id === 'string' && typeof f?.name === 'string')
    : [];
  const folderIds = new Set(folders.map(f => f.id));
  const playlists = Array.isArray(r.playlists)
    ? r.playlists
        .filter((p): p is Playlist => typeof p?.id === 'string' && typeof p?.name === 'string' && Array.isArray(p?.tracks))
        .map(p => {
          const smartOk = p.smart && (p.smart.match === 'all' || p.smart.match === 'any') && Array.isArray(p.smart.rules);
          const { smart: _smart, ...rest } = p;
          void _smart;
          return {
            ...rest,
            tracks: p.tracks.filter((t): t is string => typeof t === 'string'),
            ...(p.folderId && !folderIds.has(p.folderId) ? { folderId: undefined } : {}),
            ...(smartOk ? { smart: { ...p.smart!, rules: p.smart!.rules.filter(r => typeof r?.id === 'string' && typeof r?.field === 'string' && typeof r?.op === 'string' && typeof r?.value === 'string') } } : {}),
          };
        })
    : [];
  return { schemaVersion: 1, playlists, folders, ...(typeof r.appleMusicRootId === 'string' ? { appleMusicRootId: r.appleMusicRootId } : {}) };
}

/** Picks "Name", or "Name 2", "Name 3"… so new playlists don't share a name. */
export function uniqueName(lib: PlaylistLibrary, base: string): string {
  const names = new Set(lib.playlists.map(p => p.name.toLowerCase()));
  const clean = base.trim() || 'Untitled Playlist';
  if (!names.has(clean.toLowerCase())) return clean;
  for (let n = 2; ; n++) {
    const candidate = `${clean} ${n}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
}

export function createPlaylist(
  lib: PlaylistLibrary,
  opts: { id: string; name: string; now: number; folderId?: string; tracks?: string[]; source?: Playlist['source']; smart?: SmartCriteria },
): PlaylistLibrary {
  const playlist: Playlist = {
    id: opts.id,
    name: uniqueName(lib, opts.name),
    tracks: opts.smart ? [] : dedupe(opts.tracks ?? []),
    createdAt: opts.now,
    updatedAt: opts.now,
    ...(opts.folderId ? { folderId: opts.folderId } : {}),
    ...(opts.source ? { source: opts.source } : {}),
    ...(opts.smart ? { smart: opts.smart } : {}),
  };
  return { ...lib, playlists: [...lib.playlists, playlist] };
}

/** Replaces a smart playlist's rules (no-op for regular playlists). */
export function setSmartCriteria(lib: PlaylistLibrary, id: string, smart: SmartCriteria, now: number): PlaylistLibrary {
  return updatePlaylist(lib, id, now, p => (p.smart ? { ...p, smart } : p));
}

/** Turns a smart playlist into a regular one holding `files` (its current matches). */
export function freezeSmartPlaylist(lib: PlaylistLibrary, id: string, files: string[], now: number): PlaylistLibrary {
  return updatePlaylist(lib, id, now, p => {
    if (!p.smart) return p;
    const { smart: _smart, ...rest } = p;
    void _smart;
    return { ...rest, tracks: dedupe(files) };
  });
}

export function renamePlaylist(lib: PlaylistLibrary, id: string, name: string, now: number): PlaylistLibrary {
  const clean = name.trim();
  if (!clean) return lib;
  return updatePlaylist(lib, id, now, p => (p.name === clean ? p : { ...p, name: clean }));
}

export function deletePlaylist(lib: PlaylistLibrary, id: string): PlaylistLibrary {
  return { ...lib, playlists: lib.playlists.filter(p => p.id !== id) };
}

export function duplicatePlaylist(lib: PlaylistLibrary, id: string, newId: string, now: number): PlaylistLibrary {
  const src = lib.playlists.find(p => p.id === id);
  if (!src) return lib;
  return createPlaylist(lib, { id: newId, name: `${src.name} copy`, now, folderId: src.folderId, tracks: src.tracks, ...(src.smart ? { smart: src.smart } : {}) });
}

function dedupe(files: string[]): string[] {
  return [...new Set(files)];
}

/** Adds tracks (skipping ones already in the playlist) at `index`, or at the end. */
export function addTracks(lib: PlaylistLibrary, id: string, files: string[], now: number, index?: number): PlaylistLibrary {
  return updatePlaylist(lib, id, now, p => {
    if (p.smart) return p;   // smart playlists get their tracks from rules
    const existing = new Set(p.tracks);
    const incoming = dedupe(files).filter(f => !existing.has(f));
    if (incoming.length === 0) return p;
    const at = index == null ? p.tracks.length : Math.max(0, Math.min(index, p.tracks.length));
    return { ...p, tracks: [...p.tracks.slice(0, at), ...incoming, ...p.tracks.slice(at)] };
  });
}

export function removeTracks(lib: PlaylistLibrary, id: string, files: string[], now: number): PlaylistLibrary {
  const drop = new Set(files);
  return updatePlaylist(lib, id, now, p => {
    if (p.smart || !p.tracks.some(f => drop.has(f))) return p;
    return { ...p, tracks: p.tracks.filter(f => !drop.has(f)) };
  });
}

/**
 * Moves `files` (keeping their relative order) so they sit before the track currently at
 * `toIndex` in the playlist; `toIndex === tracks.length` moves them to the end.
 */
export function moveTracks(lib: PlaylistLibrary, id: string, files: string[], toIndex: number, now: number): PlaylistLibrary {
  return updatePlaylist(lib, id, now, p => {
    if (p.smart) return p;
    const tracks = moveWithin(p.tracks, files, toIndex);
    return sameOrder(tracks, p.tracks) ? p : { ...p, tracks };
  });
}

/**
 * Sets a playlist's order to `ordered` (e.g. the table sorted by BPM). Tracks not listed —
 * such as ones missing from the library — keep their relative order at the end.
 */
export function setPlaylistOrder(lib: PlaylistLibrary, id: string, ordered: string[], now: number): PlaylistLibrary {
  return updatePlaylist(lib, id, now, p => {
    if (p.smart) return p;
    const inPlaylist = new Set(p.tracks);
    const head = dedupe(ordered.filter(f => inPlaylist.has(f)));
    const listed = new Set(head);
    const tracks = [...head, ...p.tracks.filter(f => !listed.has(f))];
    return sameOrder(tracks, p.tracks) ? p : { ...p, tracks };
  });
}

/** One-line description of what an edit did, for the undo notice. Null = nothing worth announcing. */
export function describeAdd(before: PlaylistLibrary, after: PlaylistLibrary, id: string, requested: number): { text: string; changed: boolean } | null {
  const a = before.playlists.find(p => p.id === id);
  const b = after.playlists.find(p => p.id === id);
  if (!a || !b) return null;
  const added = b.tracks.length - a.tracks.length;
  const already = requested - added;
  const plural = (n: number) => `${n} track${n === 1 ? '' : 's'}`;
  if (added === 0) return { text: `${requested === 1 ? 'Already' : 'All already'} in “${b.name}”`, changed: false };
  return { text: `Added ${plural(added)} to “${b.name}”${already > 0 ? ` · ${already} already there` : ''}`, changed: true };
}

export function moveWithin(tracks: string[], files: string[], toIndex: number): string[] {
  const moving = new Set(files);
  const block = tracks.filter(f => moving.has(f));
  if (block.length === 0) return tracks;
  // Count how many moving tracks sit before the target so the index still points at the same spot
  const clamped = Math.max(0, Math.min(toIndex, tracks.length));
  const shift = tracks.slice(0, clamped).filter(f => moving.has(f)).length;
  const rest = tracks.filter(f => !moving.has(f));
  const at = clamped - shift;
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

// ─── Folders ──────────────────────────────────────────────────────────────────

export function createFolder(lib: PlaylistLibrary, opts: { id: string; name: string; parentId?: string }): PlaylistLibrary {
  const folder: PlaylistFolder = { id: opts.id, name: opts.name.trim() || 'New Folder', ...(opts.parentId ? { parentId: opts.parentId } : {}) };
  return { ...lib, folders: [...lib.folders, folder] };
}

export function renameFolder(lib: PlaylistLibrary, id: string, name: string): PlaylistLibrary {
  const clean = name.trim();
  if (!clean) return lib;
  return { ...lib, folders: lib.folders.map(f => (f.id === id ? { ...f, name: clean } : f)) };
}

export function toggleFolder(lib: PlaylistLibrary, id: string): PlaylistLibrary {
  return { ...lib, folders: lib.folders.map(f => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)) };
}

/** Deletes a folder; its playlists and sub-folders move up to the folder's parent. */
export function deleteFolder(lib: PlaylistLibrary, id: string): PlaylistLibrary {
  const folder = lib.folders.find(f => f.id === id);
  if (!folder) return lib;
  const parent = folder.parentId;
  return {
    ...lib,
    folders: lib.folders.filter(f => f.id !== id).map(f => (f.parentId === id ? withParent(f, parent) : f)),
    playlists: lib.playlists.map(p => (p.folderId === id ? withFolder(p, parent) : p)),
  };
}

function withParent(f: PlaylistFolder, parentId: string | undefined): PlaylistFolder {
  const { parentId: _old, ...rest } = f;
  void _old;
  return parentId ? { ...rest, parentId } : rest;
}

function withFolder(p: Playlist, folderId: string | undefined): Playlist {
  const { folderId: _old, ...rest } = p;
  void _old;
  return folderId ? { ...rest, folderId } : rest;
}

export function movePlaylistToFolder(lib: PlaylistLibrary, playlistId: string, folderId: string | undefined, now: number): PlaylistLibrary {
  if (folderId && !lib.folders.some(f => f.id === folderId)) return lib;
  return updatePlaylist(lib, playlistId, now, p => (p.folderId === folderId ? p : withFolder(p, folderId)));
}

/** True when `folderId` is `ancestorId` or nested anywhere inside it. */
export function isInsideFolder(lib: PlaylistLibrary, folderId: string | undefined, ancestorId: string): boolean {
  const byId = new Map(lib.folders.map(f => [f.id, f]));
  const seen = new Set<string>();
  for (let cur = folderId; cur && !seen.has(cur); cur = byId.get(cur)?.parentId) {
    if (cur === ancestorId) return true;
    seen.add(cur);
  }
  return false;
}

/** Ids of every playlist inside a folder, including nested folders. */
export function playlistsInFolder(lib: PlaylistLibrary, folderId: string): string[] {
  return lib.playlists.filter(p => p.folderId && isInsideFolder(lib, p.folderId, folderId)).map(p => p.id);
}

/** Moves a folder under another (or to the top level). Refuses moves that would create a cycle. */
export function moveFolder(lib: PlaylistLibrary, folderId: string, parentId: string | undefined): PlaylistLibrary {
  if (parentId && (parentId === folderId || isInsideFolder(lib, parentId, folderId))) return lib;
  return { ...lib, folders: lib.folders.map(f => (f.id === folderId ? withParent(f, parentId) : f)) };
}

// ─── Reading ──────────────────────────────────────────────────────────────────

export interface FolderNode {
  folder: PlaylistFolder;
  folders: FolderNode[];
  playlists: Playlist[];
}

export interface PlaylistTree {
  folders: FolderNode[];
  playlists: Playlist[];
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/** Builds the sidebar tree: folders first, then playlists, each sorted by name. */
export function buildPlaylistTree(lib: PlaylistLibrary): PlaylistTree {
  const folderIds = new Set(lib.folders.map(f => f.id));
  const build = (parentId: string | undefined, seen: Set<string>): PlaylistTree => ({
    folders: lib.folders
      .filter(f => (f.parentId && folderIds.has(f.parentId) ? f.parentId : undefined) === parentId && !seen.has(f.id))
      .sort(byName)
      .map(f => {
        const inner = build(f.id, new Set([...seen, f.id]));
        return { folder: f, folders: inner.folders, playlists: inner.playlists };
      }),
    playlists: lib.playlists
      .filter(p => (p.folderId && folderIds.has(p.folderId) ? p.folderId : undefined) === parentId)
      .sort(byName),
  });
  return build(undefined, new Set());
}

export type PlaylistMenuEntry =
  | { kind: 'folder'; id: string; name: string; depth: number }
  | { kind: 'playlist'; id: string; name: string; depth: number };

/**
 * The playlist tree flattened for a menu (folders as labels, playlists indented under them).
 * With `include`, only matching playlists — and the folders leading to them — are listed.
 */
export function flattenPlaylistTree(lib: PlaylistLibrary, include?: (p: Playlist) => boolean): PlaylistMenuEntry[] {
  const out: PlaylistMenuEntry[] = [];
  const walk = (node: PlaylistTree, depth: number): boolean => {
    let any = false;
    for (const f of node.folders) {
      const at = out.length;
      out.push({ kind: 'folder', id: f.folder.id, name: f.folder.name, depth });
      if (walk(f, depth + 1) || !include) any = true;
      else out.splice(at, 1);   // nothing matched inside — drop the folder label
    }
    for (const p of node.playlists) {
      if (include && !include(p)) continue;
      out.push({ kind: 'playlist', id: p.id, name: p.name, depth });
      any = true;
    }
    return any;
  };
  walk(buildPlaylistTree(lib), 0);
  return out;
}

/** Resolves a playlist's track keys to songs, in playlist order. Tracks no longer in the library are counted, not returned. */
export function resolvePlaylist(playlist: Playlist, songsByFile: Map<string, Song>): { songs: Song[]; missing: number } {
  const songs: Song[] = [];
  let missing = 0;
  for (const f of playlist.tracks) {
    const s = songsByFile.get(f);
    if (s) songs.push(s);
    else missing++;
  }
  return { songs, missing };
}
