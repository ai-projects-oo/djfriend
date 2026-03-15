import path from 'path'
import fs from 'fs'
import os from 'os'
import { promisify } from 'util'
import { execFile } from 'child_process'
import Busboy from 'busboy'
import * as mm from 'music-metadata'
import NodeID3 from 'node-id3'
import { scanFolder } from './scanner.js'
import { analyzeAudio } from './analyzer.js'
import { toCamelot } from './camelot.js'
import { authenticate, getArtistGenres, searchTrack } from './spotify.js'
import { readSettings, writeSettings } from './settings.js'
import type { IncomingMessage, ServerResponse } from 'http'

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.aac', '.m4a', '.wav', '.ogg', '.opus'])
const execFileAsync = promisify(execFile)
export const APPLE_RESULTS_PATH = path.join(os.homedir(), 'Music', 'djfriend-results-v3.json')

export interface AppSong {
  filePath: string
  file: string
  artist: string
  title: string
  duration?: number
  spotifyArtist?: string
  spotifyTitle?: string
  bpm: number
  key: string
  camelot: string
  energy: number
  genres: string[]
  genresFromSpotify?: boolean
}

type NextFn = (err?: unknown) => void
type Middleware = (req: IncomingMessage, res: ServerResponse, next: NextFn) => void
export interface MiddlewareApp { use(fn: Middleware): void; use(path: string, fn: Middleware): void }

function collectAudioDirs(rootPath: string): string[] {
  const folders: string[] = []
  function walk(currentPath: string): void {
    let hasAudio = false
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) hasAudio = true
    }
    if (hasAudio) folders.push(currentPath)
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(currentPath, entry.name))
    }
  }
  walk(rootPath)
  return folders
}

export function readJsonBody(req: NodeJS.ReadableStream): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))) }
      catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

function toSafeRelative(input: string): string | null {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0')) return null
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0 || parts.some(p => p === '..')) return null
  return parts.join('/')
}

function isAppSong(value: unknown): value is AppSong {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.filePath === 'string' && typeof v.file === 'string' &&
    typeof v.artist === 'string' && typeof v.title === 'string' &&
    typeof v.bpm === 'number' && typeof v.key === 'string' &&
    typeof v.camelot === 'string' && typeof v.energy === 'number' && Array.isArray(v.genres)
}

function normalizeBpm(bpm: number, energy: number, genres: string[]): number {
  const gl = genres.map(g => g.toLowerCase())
  const hasAny = (terms: string[]) => gl.some(g => terms.some(t => g.includes(t)))
  const isFastGenre = hasAny(['house', 'techno', 'trance', 'drum and bass', 'dnb', 'jungle', 'hardstyle', 'hardcore', 'gabber', 'neurofunk', 'speed garage', 'edm', 'electronic dance', 'eurodance'])
  if (isFastGenre) return bpm
  const isSlowGenre = hasAny(['soul', 'r&b', 'rnb', 'neo soul', 'jazz', 'blues', 'gospel', 'ambient', 'downtempo', 'chill', 'lo-fi', 'lofi', 'classical', 'opera', 'orchestral', 'folk', 'acoustic', 'singer-songwriter', 'country', 'bluegrass', 'bossa nova', 'bolero', 'fado', 'adult contemporary', 'soft rock', 'easy listening', 'reggae', 'dub', 'ska', 'christmas', 'holiday', 'seasonal', 'christian', 'hymn', 'carol'])
  if ((!isSlowGenre && energy >= 0.50) || bpm <= 100) return bpm
  if (bpm > 150) { const third = Math.round((bpm / 3) * 10) / 10; if (third >= 50 && third <= 100) return third }
  const half = Math.round((bpm / 2) * 10) / 10
  if (half >= 45 && half <= 100) return half
  return bpm
}

function readExistingResultsFile(filePath: string): Record<string, AppSong> {
  if (!fs.existsSync(filePath)) return {}
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    const out: Record<string, AppSong> = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (isAppSong(value)) out[key] = value
    }
    return out
  } catch { return {} }
}

function readExistingResults(rootPath: string): Record<string, AppSong> {
  return readExistingResultsFile(path.join(rootPath, 'results.json'))
}

interface AppleMusicTrack { filePath: string; file: string; artist: string | null; title: string; duration: number | null }

async function listAppleMusicPlaylists(): Promise<Array<{ name: string; count: number }>> {
  const rs = String.fromCharCode(30), us = String.fromCharCode(31)
  const script = `set outputLines to {}\ntell application "Music"\n  repeat with p in (every user playlist)\n    try\n      if class of p is not folder playlist then\n        set pName to (name of p) as text\n        set pCount to (count of tracks of p) as text\n        set end of outputLines to pName & "${us}" & pCount\n      end if\n    end try\n  end repeat\nend tell\nset AppleScript's text item delimiters to "${rs}"\nreturn outputLines as text`
  const { stdout } = await execFileAsync('osascript', ['-e', script], { maxBuffer: 1 * 1024 * 1024 })
  return (stdout.trim() ? stdout.trim().split(rs) : [])
    .map(row => { const [name, countStr] = row.split(us); return { name: (name ?? '').trim(), count: parseInt(countStr ?? '0', 10) || 0 } })
    .filter(p => p.name)
}

async function listAppleMusicTracks(playlistName: string): Promise<AppleMusicTrack[]> {
  const rs = String.fromCharCode(30), us = String.fromCharCode(31)
  const esc = playlistName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const script = `set outputLines to {}\ntell application "Music"\n\trepeat with t in (every track of user playlist "${esc}")\n\t\ttry\n\t\t\tset trackLocation to location of t\n\t\t\tif trackLocation is missing value then\n\t\t\t\terror "skip"\n\t\t\tend if\n\t\t\tset trackPath to POSIX path of trackLocation\n\t\t\tset trackName to (name of t) as text\n\t\t\tset trackArtist to ""\n\t\t\ttry\n\t\t\t\tset trackArtist to (artist of t) as text\n\t\t\tend try\n\t\t\tset trackDuration to ""\n\t\t\ttry\n\t\t\t\tset trackDuration to (duration of t) as text\n\t\t\tend try\n\t\t\tset end of outputLines to trackPath & "${us}" & trackArtist & "${us}" & trackName & "${us}" & trackDuration\n\t\tend try\n\tend repeat\nend tell\nset AppleScript's text item delimiters to "${rs}"\nreturn outputLines as text`
  const { stdout } = await execFileAsync('osascript', ['-e', script], { maxBuffer: 64 * 1024 * 1024 })
  const tracks: AppleMusicTrack[] = []
  for (const row of (stdout.trim() ? stdout.trim().split(rs) : [])) {
    const [rawPath, rawArtist, rawTitle, rawDuration] = row.split(us)
    const filePath = (rawPath ?? '').trim()
    if (!filePath) continue
    const ext = path.extname(filePath).toLowerCase()
    if (!AUDIO_EXTENSIONS.has(ext) || !fs.existsSync(filePath)) continue
    tracks.push({ filePath, file: path.basename(filePath), artist: (rawArtist ?? '').trim() || null, title: (rawTitle ?? '').trim() || path.basename(filePath, ext), duration: Number.isFinite(Number(rawDuration)) ? Number(rawDuration) : null })
  }
  return tracks
}

async function parseUploadedFolder(req: NodeJS.ReadableStream & { headers: Record<string, string | string[] | undefined> }): Promise<{ tempRoot: string; rootPath: string; rootLabel: string }> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'djfriend-upload-'))
  const writeTasks: Promise<void>[] = []
  const rootLabels = new Set<string>()
  await new Promise<void>((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, preservePath: true })
    bb.on('file', (_fieldName, file, info) => {
      const safeRelative = toSafeRelative(info.filename)
      if (!safeRelative) { file.resume(); return }
      const [rootLabel] = safeRelative.split('/')
      if (rootLabel) rootLabels.add(rootLabel)
      const outPath = path.join(tempRoot, safeRelative)
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      writeTasks.push(new Promise<void>((res, rej) => {
        const out = fs.createWriteStream(outPath)
        out.on('finish', res); out.on('error', rej); file.on('error', rej); file.pipe(out)
      }))
    })
    bb.on('error', reject); bb.on('finish', resolve); req.pipe(bb)
  })
  await Promise.all(writeTasks)
  if (rootLabels.size !== 1) throw new Error('Please upload exactly one root folder at a time.')
  const [rootLabel] = Array.from(rootLabels)
  if (!rootLabel) throw new Error('Could not determine selected root folder.')
  const rootPath = path.join(tempRoot, rootLabel)
  if (!fs.existsSync(rootPath)) throw new Error('Uploaded folder payload was empty.')
  return { tempRoot, rootPath, rootLabel }
}

async function analyzeLibrary(rootPath: string, rootLabel: string, writeEvent: (e: Record<string, unknown>) => void) {
  const { spotifyClientId: SPOTIFY_CLIENT_ID, spotifyClientSecret: SPOTIFY_CLIENT_SECRET } = readSettings()
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) throw new Error('Spotify credentials not configured. Open Settings to add your Client ID and Secret.')
  const audioFolders = collectAudioDirs(rootPath)
  const folderTracks = new Map<string, Awaited<ReturnType<typeof scanFolder>>>()
  let total = 0
  for (const folder of audioFolders) {
    const tracks = await scanFolder(folder)
    if (tracks.length > 0) { folderTracks.set(folder, tracks); total += tracks.length }
  }
  if (total === 0) throw new Error('No audio files found in selected folder.')
  writeEvent({ type: 'start', total })
  const token = await authenticate(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)
  const existing = readExistingResults(rootPath)
  let completed = 0
  const resultsJson: Record<string, AppSong> = { ...existing }
  for (const [folder, tracks] of folderTracks.entries()) {
    const relativeToRoot = path.relative(rootPath, folder).replace(/\\/g, '/')
    const folderKey = relativeToRoot ? `${rootLabel}/${relativeToRoot}` : rootLabel
    for (const track of tracks) {
      const relativeFilePath = path.relative(rootPath, track.filePath).replace(/\\/g, '/')
      completed += 1
      writeEvent({ type: 'progress', completed, total, folder: folderKey, file: track.file })
      const cached = existing[relativeFilePath]
      if (cached) {
        if (cached.duration == null) { try { const meta = await mm.parseFile(track.filePath, { duration: true }); if (meta.format.duration != null) cached.duration = meta.format.duration } catch { /* ignore */ } }
        resultsJson[relativeFilePath] = cached; continue
      }
      try {
        const match = await searchTrack(track.artist, track.title, token)
        const [features, genres] = await Promise.all([analyzeAudio(track.filePath), track.localGenres.length === 0 && match?.artistId ? getArtistGenres(match.artistId, token) : Promise.resolve([])])
        if (!features) continue
        const keyInfo = toCamelot(features.pitchClass, features.mode)
        if (!keyInfo) continue
        const finalGenres = track.localGenres.length > 0 ? track.localGenres : genres
        resultsJson[relativeFilePath] = { filePath: relativeFilePath, file: relativeFilePath, artist: track.artist ?? 'Unknown artist', title: track.title, ...(track.duration != null ? { duration: track.duration } : {}), spotifyArtist: match?.spotifyArtist, spotifyTitle: match?.spotifyTitle, bpm: normalizeBpm(features.bpm, features.energy, finalGenres), key: keyInfo.keyName, camelot: keyInfo.camelot, energy: features.energy, genres: finalGenres, ...(track.localGenres.length === 0 ? { genresFromSpotify: true } : {}) }
      } catch { /* skip */ }
    }
    writeEvent({ type: 'folder_done', folder: folderKey })
  }
  fs.writeFileSync(path.join(rootPath, 'results.json'), JSON.stringify(resultsJson, null, 2), 'utf-8')
  const songs = Object.values(resultsJson)
  return { total, analyzed: songs.length, songs, resultsJson }
}

async function analyzeAppleMusicLibrary(playlistName: string, writeEvent: (e: Record<string, unknown>) => void) {
  const { spotifyClientId: SPOTIFY_CLIENT_ID, spotifyClientSecret: SPOTIFY_CLIENT_SECRET } = readSettings()
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) throw new Error('Spotify credentials not configured. Open Settings to add your Client ID and Secret.')
  const tracks = await listAppleMusicTracks(playlistName)
  if (tracks.length === 0) throw new Error('No Apple Music local file tracks were found.')
  writeEvent({ type: 'start', total: tracks.length })
  const token = await authenticate(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)
  const existing = readExistingResultsFile(APPLE_RESULTS_PATH)
  const resultsJson: Record<string, AppSong> = { ...existing }
  let completed = 0
  for (const track of tracks) {
    const key = track.filePath
    completed += 1
    writeEvent({ type: 'progress', completed, total: tracks.length, folder: 'Apple Music', file: track.file })
    const cached = existing[key]
    if (cached) {
      if (cached.duration == null && track.duration != null) cached.duration = track.duration
      else if (cached.duration == null) { try { const meta = await mm.parseFile(track.filePath, { duration: true }); if (meta.format.duration != null) cached.duration = meta.format.duration } catch { /* ignore */ } }
      resultsJson[key] = cached; continue
    }
    try {
      let localGenres: string[] = []
      try { const meta = await mm.parseFile(track.filePath, { duration: false }); localGenres = meta.common.genre ?? [] } catch { /* ignore */ }
      const match = await searchTrack(track.artist, track.title, token)
      const [features, spotifyGenres] = await Promise.all([analyzeAudio(track.filePath), localGenres.length === 0 && match?.artistId ? getArtistGenres(match.artistId, token) : Promise.resolve([])])
      const genres = localGenres.length > 0 ? localGenres : spotifyGenres
      if (!features) continue
      const keyInfo = toCamelot(features.pitchClass, features.mode)
      if (!keyInfo) continue
      resultsJson[key] = { filePath: track.filePath, file: track.filePath, artist: track.artist ?? 'Unknown artist', title: track.title, ...(track.duration != null ? { duration: track.duration } : {}), spotifyArtist: match?.spotifyArtist, spotifyTitle: match?.spotifyTitle, bpm: normalizeBpm(features.bpm, features.energy, genres), key: keyInfo.keyName, camelot: keyInfo.camelot, energy: features.energy, genres, ...(localGenres.length === 0 && spotifyGenres.length > 0 ? { genresFromSpotify: true } : {}) }
    } catch { /* skip */ }
  }
  fs.mkdirSync(path.dirname(APPLE_RESULTS_PATH), { recursive: true })
  fs.writeFileSync(APPLE_RESULTS_PATH, JSON.stringify(resultsJson, null, 2), 'utf-8')
  const songs = Object.values(resultsJson)
  return { total: tracks.length, analyzed: songs.length, songs, resultsJson }
}

export function setupMiddlewares(middlewares: MiddlewareApp, songsFolder?: string | null): void {
  if (songsFolder) {
    middlewares.use('/results.json', (_req, res, next) => {
      const filePath = path.join(songsFolder, 'results.json')
      if (!fs.existsSync(filePath)) { next(); return }
      res.setHeader('Content-Type', 'application/json')
      fs.createReadStream(filePath).pipe(res)
    })
  }

  middlewares.use('/api/settings', async (req, res, next) => {
    if (req.method === 'GET') {
      const s = readSettings()
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ spotifyClientId: s.spotifyClientId ?? '', hasSecret: !!s.spotifyClientSecret }))
      return
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req) as Record<string, unknown>
      const updates: Record<string, string> = {}
      if (typeof body.spotifyClientId === 'string') updates.spotifyClientId = body.spotifyClientId.trim()
      if (typeof body.spotifyClientSecret === 'string' && body.spotifyClientSecret.trim()) updates.spotifyClientSecret = body.spotifyClientSecret.trim()
      writeSettings(updates)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
      return
    }
    next()
  })

  middlewares.use('/api/analyze-folder', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    const writeEvent = (event: Record<string, unknown>) => { res.write(`${JSON.stringify(event)}\n`) }
    try {
      const body = await readJsonBody(req)
      const folderPath = typeof (body as Record<string, unknown>)?.folderPath === 'string' ? ((body as Record<string, unknown>).folderPath as string).trim() : ''
      if (!folderPath) { writeEvent({ type: 'error', message: 'Missing folderPath.' }); res.end(); return }
      if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) { writeEvent({ type: 'error', message: 'Folder not found.' }); res.end(); return }
      const analysis = await analyzeLibrary(folderPath, path.basename(folderPath), writeEvent)
      writeEvent({ type: 'done', total: analysis.total, analyzed: analysis.analyzed, libraryName: path.basename(folderPath), songs: analysis.songs, resultsJson: analysis.resultsJson })
      res.end()
    } catch (err) { writeEvent({ type: 'error', message: err instanceof Error ? err.message : 'Analysis failed.' }); res.end() }
  })

  middlewares.use('/api/analyze-upload', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    const writeEvent = (event: Record<string, unknown>) => { res.write(`${JSON.stringify(event)}\n`) }
    let tempRoot: string | null = null
    try {
      const parsed = await parseUploadedFolder(req as NodeJS.ReadableStream & { headers: Record<string, string | string[] | undefined> })
      tempRoot = parsed.tempRoot
      const analysis = await analyzeLibrary(parsed.rootPath, parsed.rootLabel, writeEvent)
      writeEvent({ type: 'done', total: analysis.total, analyzed: analysis.analyzed, libraryName: parsed.rootLabel, songs: analysis.songs, resultsJson: analysis.resultsJson })
      res.end()
    } catch (err) { writeEvent({ type: 'error', message: err instanceof Error ? err.message : 'Upload failed.' }); res.end() }
    finally { if (tempRoot && fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true }) }
  })

  middlewares.use('/api/play-in-music', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    const body = await readJsonBody(req) as Record<string, unknown>
    const filePath = typeof body.filePath === 'string' ? body.filePath : null
    const artist = typeof body.artist === 'string' ? body.artist : ''
    const title = typeof body.title === 'string' ? body.title : ''
    const script = filePath
      ? `tell application "Music"\nactivate\nopen POSIX file "${filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\nend tell`
      : `tell application "Music"\nactivate\nset r to (search library playlist 1 for "${`${artist} ${title}`.replace(/"/g, '\\"')}")\nif length of r > 0 then\nplay item 1 of r\nend if\nend tell`
    try {
      await execFileAsync('osascript', ['-e', script])
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true }))
    } catch (err) { res.statusCode = 500; res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Playback failed' })) }
  })

  middlewares.use('/api/apple-music-playlists', async (req, res, next) => {
    if (req.method !== 'GET') { next(); return }
    try {
      const playlists = await listAppleMusicPlaylists()
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(playlists))
    } catch (err) { res.statusCode = 500; res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to list playlists.' })) }
  })

  middlewares.use('/api/analyze-apple-music', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    const writeEvent = (event: Record<string, unknown>) => { res.write(`${JSON.stringify(event)}\n`) }
    try {
      const body = await readJsonBody(req)
      const playlistName = typeof (body as Record<string, unknown>)?.playlistName === 'string' ? ((body as Record<string, unknown>).playlistName as string).trim() : ''
      if (!playlistName) { writeEvent({ type: 'error', message: 'Missing playlistName.' }); res.end(); return }
      const analysis = await analyzeAppleMusicLibrary(playlistName, writeEvent)
      writeEvent({ type: 'done', total: analysis.total, analyzed: analysis.analyzed, libraryName: 'Apple Music', songs: analysis.songs, resultsJson: analysis.resultsJson })
      res.end()
    } catch (err) { writeEvent({ type: 'error', message: err instanceof Error ? err.message : 'Apple Music analysis failed.' }); res.end() }
  })

  middlewares.use('/api/update-tags', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    try {
      const body = await readJsonBody(req) as Record<string, unknown>
      const filePath = typeof body.filePath === 'string' ? body.filePath.trim() : null
      const tags = typeof body.tags === 'object' && body.tags !== null ? body.tags as Record<string, unknown> : null
      if (!filePath || !tags) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing filePath or tags' })); return }
      let absolutePath = filePath
      if (!path.isAbsolute(filePath) && songsFolder) absolutePath = path.join(songsFolder, filePath)
      if (!fs.existsSync(absolutePath)) { res.statusCode = 404; res.end(JSON.stringify({ error: 'File not found' })); return }
      if (!AUDIO_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Not an audio file' })); return }
      const id3Tags: NodeID3.Tags = {}
      if (typeof tags.title === 'string') id3Tags.title = tags.title.trim()
      if (typeof tags.artist === 'string') id3Tags.artist = tags.artist.trim()
      if (typeof tags.genre === 'string') id3Tags.genre = tags.genre.trim()
      if (typeof tags.bpm === 'number') id3Tags.bpm = String(Math.round(tags.bpm))
      if (Object.keys(id3Tags).length === 0) { res.statusCode = 400; res.end(JSON.stringify({ error: 'No tags to update' })); return }
      if (path.extname(absolutePath).toLowerCase() !== '.mp3') { res.statusCode = 400; res.end(JSON.stringify({ error: 'Tag editing only supported for MP3' })); return }
      let result: true | Error
      try { result = NodeID3.update(id3Tags, absolutePath) }
      catch {
        const existing = NodeID3.read(absolutePath)
        const merged = { ...existing, ...id3Tags } as Record<string, unknown>
        delete merged.raw; delete merged.uniqueFileIdentifier; delete merged.generalObject; delete merged.privateFrames
        result = NodeID3.write(merged as NodeID3.Tags, absolutePath)
      }
      if (result !== true) throw new Error(result instanceof Error ? result.message : 'node-id3 write failed')
      const patchResults = (resultsPath: string, key: string): void => {
        if (!fs.existsSync(resultsPath)) return
        try {
          const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8')) as Record<string, AppSong>
          const entry = results[key]; if (!entry) return
          if (typeof tags.title === 'string' && tags.title.trim()) entry.title = tags.title.trim()
          if (typeof tags.artist === 'string' && tags.artist.trim()) entry.artist = tags.artist.trim()
          if (typeof tags.genre === 'string') { entry.genres = tags.genre.trim() ? tags.genre.split(',').map((g: string) => g.trim()).filter(Boolean) : []; delete entry.genresFromSpotify }
          if (typeof tags.bpm === 'number') entry.bpm = tags.bpm
          fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf-8')
        } catch { /* ignore */ }
      }
      if (songsFolder) patchResults(path.join(songsFolder, 'results.json'), path.relative(songsFolder, absolutePath).replace(/\\/g, '/'))
      patchResults(APPLE_RESULTS_PATH, absolutePath)
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true }))
    } catch (err) { res.statusCode = 500; res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to update tags' })) }
  })
}
