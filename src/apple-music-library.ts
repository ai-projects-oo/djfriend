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

/**
 * Reads the library through Apple's iTunesLibrary framework (ITLibrary) — it reads the library
 * database directly, so there are no AppleEvents to Music.app and no -1712 timeouts on big libraries
 * (a 4 000-track library reads in under a second). Same output shape as READ_LIBRARY_FN.
 */
export const READ_LIBRARY_ITLIB = String.raw`
ObjC.import('iTunesLibrary');
function run() {
  var err = Ref();
  var lib = $.ITLibrary.libraryWithAPIVersionError('1.0', err);
  if (!lib || lib.isNil()) throw new Error('ITLibrary unavailable');
  var u = ObjC.unwrap;
  var items = lib.allMediaItems, tracks = [];
  for (var i = 0, n = items.count; i < n; i++) {
    var it = items.objectAtIndex(i);
    if (it.locationType != 1 || it.location.isNil()) continue;          // 1 = local file
    var artist = it.artist.isNil() ? null : u(it.artist.name);
    tracks.push({
      pid: u(it.persistentID.stringValue), path: u(it.location.path), name: u(it.title), artist: artist,
      duration: it.totalTime > 0 ? it.totalTime / 1000 : null,          // ms → s
      added: it.addedDate.isNil() ? null : Math.round(it.addedDate.timeIntervalSince1970 * 1000),
    });
  }
  var pls = lib.allPlaylists, folderName = {}, playlists = [];
  for (var j = 0, m = pls.count; j < m; j++) { var f = pls.objectAtIndex(j); if (f.kind == 3) folderName[u(f.persistentID.stringValue)] = u(f.name); }
  for (var k = 0, c = pls.count; k < c; k++) {
    var p = pls.objectAtIndex(k);
    // Regular (0) and smart (1) user playlists only — skip folders, Genius, the library itself and built-ins
    if ((p.kind != 0 && p.kind != 1) || p.distinguishedKind != 0 || p.master) continue;
    var members = [], its = p.items;
    for (var x = 0, y = its.count; x < y; x++) members.push(u(its.objectAtIndex(x).persistentID.stringValue));
    var parent = p.parentID.isNil() ? null : folderName[u(p.parentID.stringValue)] || null;
    playlists.push({ name: u(p.name), folder: parent, members: members });
  }
  return JSON.stringify({ tracks: tracks, playlists: playlists });
}
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
  const opts = { maxBuffer: 256 * 1024 * 1024 }
  let stdout: string
  try {
    ({ stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', READ_LIBRARY_ITLIB], opts))
  } catch (err) {
    // Older macOS / framework unavailable → ask Music.app over AppleEvents (slow on big libraries)
    console.warn('[apple-music] iTunesLibrary read failed, falling back to Music.app:', err instanceof Error ? err.message.split('\n')[0] : err)
    ;({ stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', SCRIPT], opts))
  }
  return shapeMusicLibrary(JSON.parse(stdout.trim()) as RawLibrary, audioExt)
}
