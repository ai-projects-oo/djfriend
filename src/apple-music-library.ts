// Read the whole Music.app library in one go (macOS): every local file track plus every regular
// playlist's membership. Uses JXA bulk property reads — one Apple event per property instead of
// one per track — so ~4,000 tracks take seconds, not minutes.

import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import { execFile } from 'child_process'

const execFileAsync = promisify(execFile)

export interface MusicLibraryTrack { filePath: string; file: string; artist: string | null; title: string; duration: number | null; dateAdded?: number }
export interface MusicLibraryPlaylist { name: string; folder?: string; files: string[] }

/** Plain ES5-style JXA, also runnable in Node tests against a fake Music object. */
export const READ_LIBRARY_FN = String.raw`
function readMusicLibrary(Music) {
  var ft = Music.libraryPlaylists[0].fileTracks;
  var pids = ft.persistentID(), locs = ft.location(), names = ft.name(), artists = ft.artist(), durs = ft.duration(), added = ft.dateAdded();
  var tracks = [];
  for (var i = 0; i < pids.length; i++) {
    if (!locs[i]) continue;
    tracks.push({ pid: pids[i], path: String(locs[i].toString()), name: names[i], artist: artists[i], duration: durs[i], added: added[i] ? new Date(added[i]).getTime() : null });
  }
  var playlists = [];
  var all = Music.userPlaylists();
  for (var j = 0; j < all.length; j++) {
    var p = all[j];
    try {
      if (p.specialKind() !== 'none') continue;     // skip built-ins (Music, Purchased…)
      var members = [];
      try { members = p.fileTracks.persistentID(); } catch (e) { members = []; }   // no local files → "Can't get object"
      var folder = null;
      try { folder = p.parent().name(); } catch (e) { folder = null; }
      playlists.push({ name: p.name(), folder: folder, members: members });
    } catch (e) { /* skip unreadable playlist */ }
  }
  return { tracks: tracks, playlists: playlists };
}
`

const SCRIPT = `${READ_LIBRARY_FN}
function run() { return JSON.stringify(readMusicLibrary(Application('Music'))); }
`

interface RawLibrary {
  tracks: { pid: string; path: string; name: string; artist: string; duration: number | null; added: number | null }[]
  playlists: { name: string; folder: string | null; members: string[] }[]
}

/**
 * Turns the raw script output into tracks DJFriend can analyse (existing local audio files) and
 * playlists as lists of those files. Duplicate playlist names get " (2)", " (3)"… so none is lost.
 */
export function shapeMusicLibrary(raw: RawLibrary, audioExt: Set<string>, exists: (p: string) => boolean = fs.existsSync): { tracks: MusicLibraryTrack[]; playlists: MusicLibraryPlaylist[] } {
  const pathByPid = new Map<string, string>()
  const tracks: MusicLibraryTrack[] = []
  for (const t of raw.tracks) {
    const filePath = (t.path ?? '').trim()
    const ext = path.extname(filePath).toLowerCase()
    if (!filePath || !audioExt.has(ext) || !exists(filePath)) continue
    pathByPid.set(t.pid, filePath)
    tracks.push({
      filePath,
      file: path.basename(filePath),
      artist: (t.artist ?? '').trim() || null,
      title: (t.name ?? '').trim() || path.basename(filePath, ext),
      duration: typeof t.duration === 'number' && Number.isFinite(t.duration) ? t.duration : null,
      ...(t.added ? { dateAdded: Math.floor(t.added / 1000) } : {}),
    })
  }
  const used = new Map<string, number>()
  const playlists: MusicLibraryPlaylist[] = []
  for (const p of raw.playlists) {
    const files = [...new Set(p.members.map(m => pathByPid.get(m)).filter((f): f is string => !!f))]
    if (files.length === 0) continue
    const base = (p.name ?? '').trim() || 'Untitled'
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    playlists.push({ name: n === 1 ? base : `${base} (${n})`, ...(p.folder ? { folder: p.folder } : {}), files })
  }
  return { tracks, playlists }
}

/** Reads the whole Music library via osascript (macOS only). */
export async function readMusicLibrary(audioExt: Set<string>): Promise<{ tracks: MusicLibraryTrack[]; playlists: MusicLibraryPlaylist[] }> {
  const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', SCRIPT], { maxBuffer: 128 * 1024 * 1024 })
  return shapeMusicLibrary(JSON.parse(stdout.trim()) as RawLibrary, audioExt)
}
