// Export DJFriend playlists into Music.app (macOS) via JXA (osascript -l JavaScript).
//
// One job = one osascript run: the job is written to a temp JSON file, the script reads it,
// mirrors folders and playlists under a "DJFriend" folder, and prints a JSON result.
// Progress lines ("PROGRESS {...}") go to stderr and are streamed to the client.
//
// Safety: the script only creates folders/playlists, and only clears/refills playlists it
// created before (matched by the persistent IDs DJFriend stored). It never deletes a playlist
// or a track from the library, and never touches playlists it didn't create.

import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'

// Mirrors AppleMusicExportJob / AppleMusicExportResult in app/types/index.ts
export interface MusicExportJob {
  rootFolderName: string
  rootFolderId?: string
  folders: { id: string; name: string; parentId?: string; appleMusicId?: string }[]
  playlists: { id: string; name: string; folderId?: string; appleMusicId?: string; files: string[] }[]
  addMissing: boolean
  writeBack?: { keyField: 'grouping' | 'comment'; tracks: Record<string, { bpm?: number; camelot?: string }> }
}

export interface MusicExportResult {
  rootFolderId: string
  folders: Record<string, string>
  playlists: Record<string, { appleMusicId: string; added: number; skipped: string[] }>
  addedToLibrary: number
  tagged: number
  errors: string[]
}

export type MusicExportProgress =
  | { phase: 'index' }
  | { phase: 'library'; done: number; total: number }
  | { phase: 'playlist'; name: string; index: number; total: number }
  | { phase: 'tracks'; name: string; done: number; total: number }
  | { phase: 'tagging'; done: number; total: number }

/**
 * The part of the script that does the work. Plain ES5-style JavaScript so it runs unchanged in
 * JXA (JavaScriptCore) — and in Node tests against a fake Music object model.
 * JXA conventions: `obj.prop()` reads a property, `obj.prop = v` writes it.
 */
export const MUSIC_EXPORT_FN = String.raw`
function withKey(comment, key) {
  var c = comment || '';
  var m = c.match(/^(1[0-2]|[1-9])[AB]\b\s*(·\s*)?/);
  var rest = m ? c.slice(m[0].length) : c;
  return rest ? key + ' · ' + rest : key;
}

function exportToMusic(job, Music, Path, log) {
  var result = { rootFolderId: '', folders: {}, playlists: {}, addedToLibrary: 0, tagged: 0, errors: [] };
  var lib = Music.libraryPlaylists[0];

  function first(arr) { return arr && arr.length ? arr[0] : null; }
  // Music only lets you query folders through the generic playlists collection, so filter by class
  function playlistsWhere(query, cls) {
    try { return Music.playlists.whose(query)().filter(function (p) { return p.class() === cls; }); } catch (e) { return []; }
  }
  function byPid(cls, pid) {
    return pid ? first(playlistsWhere({ persistentID: pid }, cls)) : null;
  }
  function parentPid(pl) {
    try { var p = pl.parent(); return p ? p.persistentID() : null; } catch (e) { return null; }
  }
  function moveInto(pl, folder) {
    if (parentPid(pl) !== folder.persistentID()) Music.move(pl, { to: folder });
  }
  function rename(pl, name) {
    if (pl.name() !== name) pl.name = name;
  }

  // 1. Index the library's file tracks by POSIX path
  log({ phase: 'index' });
  var byPath = {};
  var ids = lib.fileTracks.id();
  var locs = lib.fileTracks.location();
  for (var i = 0; i < ids.length; i++) {
    if (locs[i]) byPath[String(locs[i].toString()).normalize('NFC')] = ids[i];
  }
  function track(id) { return lib.tracks.byId(id); }

  // 2. Root "DJFriend" folder: linked one, else a top-level folder with that name, else a new one
  var root = byPid('folderPlaylist', job.rootFolderId);
  if (!root) {
    root = first(playlistsWhere({ name: job.rootFolderName }, 'folderPlaylist').filter(function (f) { return !parentPid(f); }));
  }
  if (!root) root = Music.make({ new: 'folderPlaylist', withProperties: { name: job.rootFolderName } });
  result.rootFolderId = root.persistentID();

  // 3. Folders (parents first)
  var folderRef = {};
  job.folders.forEach(function (f) {
    var parent = f.parentId && folderRef[f.parentId] ? folderRef[f.parentId] : root;
    var mf = byPid('folderPlaylist', f.appleMusicId);
    if (!mf) mf = Music.make({ new: 'folderPlaylist', withProperties: { name: f.name } });
    rename(mf, f.name);
    moveInto(mf, parent);
    folderRef[f.id] = mf;
    result.folders[f.id] = mf.persistentID();
  });

  // 4. Files not in the library yet
  var missing = [];
  var seen = {};
  job.playlists.forEach(function (p) {
    p.files.forEach(function (f) { if (byPath[f] == null && !seen[f]) { seen[f] = true; missing.push(f); } });
  });
  if (job.addMissing) {
    missing.forEach(function (f, k) {
      try {
        var r = Music.add(Path(f), { to: lib });
        var t = Array.isArray(r) ? r[0] : r;
        if (t) { byPath[f] = t.id(); result.addedToLibrary++; }
      } catch (e) {
        result.errors.push('Could not add ' + f + ': ' + (e && e.message ? e.message : e));
      }
      if (k % 10 === 0) log({ phase: 'library', done: k, total: missing.length });
    });
  }

  // 5. Playlists: link or create, empty it, refill in DJFriend's order
  job.playlists.forEach(function (p, pi) {
    log({ phase: 'playlist', name: p.name, index: pi, total: job.playlists.length });
    var folder = p.folderId && folderRef[p.folderId] ? folderRef[p.folderId] : root;
    var mp = byPid('userPlaylist', p.appleMusicId);
    if (mp) {
      rename(mp, p.name);
      var existing = mp.tracks();
      for (var k = existing.length - 1; k >= 0; k--) existing[k].delete();
    } else {
      mp = Music.make({ new: 'userPlaylist', withProperties: { name: p.name } });
    }
    moveInto(mp, folder);
    var added = 0;
    var skipped = [];
    p.files.forEach(function (f, ti) {
      var id = byPath[f];
      if (id == null) { skipped.push(f); return; }
      try { Music.duplicate(track(id), { to: mp }); added++; } catch (e) { skipped.push(f); }
      if (ti % 25 === 0) log({ phase: 'tracks', name: p.name, done: ti, total: p.files.length });
    });
    result.playlists[p.id] = { appleMusicId: mp.persistentID(), added: added, skipped: skipped };
  });

  // 6. Optional BPM / key write-back
  if (job.writeBack) {
    var paths = Object.keys(job.writeBack.tracks);
    paths.forEach(function (f, k) {
      var id = byPath[f];
      if (id == null) return;
      var v = job.writeBack.tracks[f];
      try {
        var t = track(id);
        if (v.bpm) t.bpm = Math.round(v.bpm);
        if (v.camelot) {
          if (job.writeBack.keyField === 'grouping') t.grouping = v.camelot;
          else t.comment = withKey(t.comment(), v.camelot);
        }
        result.tagged++;
      } catch (e) {
        result.errors.push('Could not tag ' + f + ': ' + (e && e.message ? e.message : e));
      }
      if (k % 50 === 0) log({ phase: 'tagging', done: k, total: paths.length });
    });
  }

  return result;
}
`

/** Full JXA program: reads the job file passed as the first argument and runs the export. */
export const MUSIC_EXPORT_SCRIPT = `${MUSIC_EXPORT_FN}
function run(argv) {
  ObjC.import('Foundation');
  var text = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js;
  var job = JSON.parse(text);
  var Music = Application('Music');
  var log = function (o) { console.log('PROGRESS ' + JSON.stringify(o)); };
  return JSON.stringify(exportToMusic(job, Music, Path, log));
}
`

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.aif', '.aiff', '.wav', '.flac', '.alac', '.mp4'])
const nfc = (s: string) => s.normalize('NFC')

/**
 * Checks a job from the client: shape, names, and that every file is an existing local audio file.
 * Files that fail are dropped (the script reports them as skipped by leaving them out).
 */
export function validateExportJob(raw: unknown, fileExists: (p: string) => boolean = fs.existsSync): MusicExportJob {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid export job')
  const r = raw as Partial<MusicExportJob>
  const str = (v: unknown, max = 255): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
  if (!Array.isArray(r.playlists) || r.playlists.length === 0) throw new Error('Nothing to export')
  if (!Array.isArray(r.folders)) throw new Error('Invalid export job')

  const folders = r.folders.flatMap(f => {
    const id = str(f?.id), name = str(f?.name)
    return id && name ? [{ id, name, ...(str(f.parentId) ? { parentId: str(f.parentId) } : {}), ...(str(f.appleMusicId, 64) ? { appleMusicId: str(f.appleMusicId, 64) } : {}) }] : []
  })
  const okFile = (f: unknown): f is string =>
    typeof f === 'string' && path.isAbsolute(f) && AUDIO_EXT.has(path.extname(f).toLowerCase()) && fileExists(f)
  const playlists = r.playlists.flatMap(p => {
    const id = str(p?.id), name = str(p?.name)
    if (!id || !name || !Array.isArray(p.files)) return []
    return [{
      id, name,
      ...(str(p.folderId) ? { folderId: str(p.folderId) } : {}),
      ...(str(p.appleMusicId, 64) ? { appleMusicId: str(p.appleMusicId, 64) } : {}),
      files: [...new Set(p.files.filter(okFile).map(nfc))],
    }]
  })
  if (playlists.length === 0) throw new Error('Nothing to export')

  let writeBack: MusicExportJob['writeBack']
  if (r.writeBack && typeof r.writeBack === 'object' && r.writeBack.tracks && typeof r.writeBack.tracks === 'object') {
    const tracks: Record<string, { bpm?: number; camelot?: string }> = {}
    for (const [f, v] of Object.entries(r.writeBack.tracks)) {
      if (!okFile(f) || typeof v !== 'object' || v === null) continue
      const bpm = typeof v.bpm === 'number' && v.bpm > 0 && v.bpm < 400 ? v.bpm : undefined
      const camelot = typeof v.camelot === 'string' && /^(1[0-2]|[1-9])[AB]$/.test(v.camelot) ? v.camelot : undefined
      if (bpm || camelot) tracks[nfc(f)] = { ...(bpm ? { bpm } : {}), ...(camelot ? { camelot } : {}) }
    }
    writeBack = { keyField: r.writeBack.keyField === 'comment' ? 'comment' : 'grouping', tracks }
  }

  return {
    rootFolderName: str(r.rootFolderName, 100) ?? 'DJFriend',
    ...(str(r.rootFolderId, 64) ? { rootFolderId: str(r.rootFolderId, 64) } : {}),
    folders,
    playlists,
    addMissing: r.addMissing === true,
    ...(writeBack ? { writeBack } : {}),
  }
}

/** Runs the export in Music.app. Resolves with the script's result; rejects on failure or abort. */
export function runMusicExport(
  job: MusicExportJob,
  opts: { onProgress?: (p: MusicExportProgress) => void; signal?: AbortSignal } = {},
): Promise<MusicExportResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djfriend-music-'))
  const jobPath = path.join(dir, `job-${crypto.randomUUID()}.json`)
  const scriptPath = path.join(dir, 'export.js')
  fs.writeFileSync(jobPath, JSON.stringify(job), 'utf-8')
  fs.writeFileSync(scriptPath, MUSIC_EXPORT_SCRIPT, 'utf-8')
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } }

  return new Promise((resolve, reject) => {
    const child = spawn('osascript', ['-l', 'JavaScript', scriptPath, jobPath])
    let stdout = ''
    let stderrBuf = ''
    const errLines: string[] = []
    const onAbort = () => child.kill('SIGTERM')
    opts.signal?.addEventListener('abort', onAbort)

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf-8') })
    child.stderr.on('data', (d: Buffer) => {
      stderrBuf += d.toString('utf-8')
      const lines = stderrBuf.split('\n')
      stderrBuf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('PROGRESS ')) {
          try { opts.onProgress?.(JSON.parse(line.slice(9)) as MusicExportProgress) } catch { /* ignore */ }
        } else if (line.trim()) errLines.push(line.trim())
      }
    })
    child.on('error', err => { cleanup(); opts.signal?.removeEventListener('abort', onAbort); reject(err) })
    child.on('close', code => {
      cleanup()
      opts.signal?.removeEventListener('abort', onAbort)
      if (opts.signal?.aborted) { reject(new Error('Export cancelled')); return }
      if (code !== 0) { reject(new Error(friendlyError(errLines.join(' ')) || `osascript exited with code ${code}`)); return }
      try { resolve(JSON.parse(stdout.trim()) as MusicExportResult) }
      catch { reject(new Error('Music export returned an unreadable result')) }
    })
  })
}

// osascript errors are terse — translate the common ones
export function friendlyError(raw: string): string {
  if (/-1743|not allowed to send Apple events|Not authorized/i.test(raw)) {
    return 'DJFriend isn\'t allowed to control Music. Enable it in System Settings → Privacy & Security → Automation, then try again.'
  }
  if (/-600|isn.t running|Application can.t be found/i.test(raw)) return 'Music.app could not be opened.'
  return raw.replace(/^.*execution error:\s*/i, '').trim()
}
