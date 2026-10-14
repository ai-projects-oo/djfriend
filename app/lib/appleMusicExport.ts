import type { AppleMusicExportJob, AppleMusicExportResult, AppleMusicKeyField, PlaylistFolder, PlaylistLibrary, Song } from '../types';
import { CAMELOT_TO_KEY } from './camelot';

export const APPLE_MUSIC_ROOT_FOLDER = 'DJFriend';

export interface AppleMusicExportOptions {
  addMissing: boolean;
  /** null = don't touch BPM/key in Music. */
  writeBack: AppleMusicKeyField | null;
}

export type SkipReason = 'missing' | 'vinyl' | 'streaming' | 'no-file';

export interface PreparedExport {
  job: AppleMusicExportJob;
  /** Tracks DJFriend can't send to Music, per playlist id. */
  skipped: Record<string, { title: string; reason: SkipReason }[]>;
  trackCount: number;
}

const isAbsolute = (p: string) => p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);

/** The local file Music.app needs for a song, or why there isn't one. */
export function exportPath(song: Song | undefined): { path: string } | { reason: SkipReason } {
  if (!song) return { reason: 'missing' };
  if (song.vinylOnly) return { reason: 'vinyl' };
  if (song.spotifyOnly) return { reason: 'streaming' };
  const p = (song.filePath ?? song.file).trim();
  return isAbsolute(p) ? { path: p } : { reason: 'no-file' };
}

/** Folders needed for `playlistIds` (each folder's ancestors included), parents before children. */
function foldersFor(lib: PlaylistLibrary, folderIds: Set<string>): PlaylistFolder[] {
  const byId = new Map(lib.folders.map(f => [f.id, f]));
  const needed = new Set<string>();
  for (const id of folderIds) {
    const seen = new Set<string>();
    for (let cur: string | undefined = id; cur && byId.has(cur) && !seen.has(cur); cur = byId.get(cur)!.parentId) {
      seen.add(cur);
      needed.add(cur);
    }
  }
  const depth = (f: PlaylistFolder): number => {
    let d = 0;
    const seen = new Set<string>();
    for (let cur = f.parentId; cur && byId.has(cur) && !seen.has(cur); cur = byId.get(cur)!.parentId) { seen.add(cur); d++; }
    return d;
  };
  return [...needed].map(id => byId.get(id)!).sort((a, b) => depth(a) - depth(b) || a.name.localeCompare(b.name));
}

/**
 * Builds the export job for some playlists (or all of them). Tracks without a local file
 * (missing from the library, vinyl-only, streaming-only) are left out and listed in `skipped`.
 */
export function buildAppleMusicJob(
  lib: PlaylistLibrary,
  playlistIds: string[] | 'all',
  songsByFile: Map<string, Song>,
  opts: AppleMusicExportOptions,
): PreparedExport {
  const chosen = playlistIds === 'all' ? lib.playlists : lib.playlists.filter(p => playlistIds.includes(p.id));
  const folderIds = new Set(chosen.map(p => p.folderId).filter((f): f is string => !!f && lib.folders.some(x => x.id === f)));
  const folders = playlistIds === 'all' ? foldersFor(lib, new Set(lib.folders.map(f => f.id))) : foldersFor(lib, folderIds);

  const skipped: PreparedExport['skipped'] = {};
  const writeBackTracks: Record<string, { bpm?: number; camelot?: string }> = {};
  let trackCount = 0;

  const playlists = chosen.map(p => {
    const files: string[] = [];
    for (const key of p.tracks) {
      const song = songsByFile.get(key);
      const target = exportPath(song);
      if ('reason' in target) {
        (skipped[p.id] ??= []).push({ title: song ? `${song.artist} – ${song.title}` : key, reason: target.reason });
        continue;
      }
      files.push(target.path);
      if (opts.writeBack && song) {
        const camelot = song.camelot && CAMELOT_TO_KEY[song.camelot.toLowerCase()] ? song.camelot.toUpperCase() : undefined;
        const bpm = song.bpm > 0 ? song.bpm : undefined;
        if (bpm || camelot) writeBackTracks[target.path] = { ...(bpm ? { bpm } : {}), ...(camelot ? { camelot } : {}) };
      }
    }
    trackCount += files.length;
    const folderId = p.folderId && lib.folders.some(f => f.id === p.folderId) ? p.folderId : undefined;
    return { id: p.id, name: p.name, files, ...(folderId ? { folderId } : {}), ...(p.appleMusicId ? { appleMusicId: p.appleMusicId } : {}) };
  });

  const job: AppleMusicExportJob = {
    rootFolderName: APPLE_MUSIC_ROOT_FOLDER,
    ...(lib.appleMusicRootId ? { rootFolderId: lib.appleMusicRootId } : {}),
    folders: folders.map(f => ({ id: f.id, name: f.name, ...(f.parentId ? { parentId: f.parentId } : {}), ...(f.appleMusicId ? { appleMusicId: f.appleMusicId } : {}) })),
    playlists,
    addMissing: opts.addMissing,
    ...(opts.writeBack ? { writeBack: { keyField: opts.writeBack, tracks: writeBackTracks } } : {}),
  };
  return { job, skipped, trackCount };
}

/** Stores the Music.app persistent IDs from an export so the next push updates instead of duplicating. */
export function applyAppleMusicResult(lib: PlaylistLibrary, result: AppleMusicExportResult): PlaylistLibrary {
  return {
    ...lib,
    appleMusicRootId: result.rootFolderId || lib.appleMusicRootId,
    folders: lib.folders.map(f => (result.folders[f.id] ? { ...f, appleMusicId: result.folders[f.id] } : f)),
    playlists: lib.playlists.map(p => (result.playlists[p.id] ? { ...p, appleMusicId: result.playlists[p.id].appleMusicId } : p)),
  };
}

const REASON_TEXT: Record<SkipReason, string> = {
  missing: 'no longer in your library',
  vinyl: 'vinyl only',
  streaming: 'streaming only',
  'no-file': 'no local file',
};
export function skipReasonText(r: SkipReason): string { return REASON_TEXT[r]; }
