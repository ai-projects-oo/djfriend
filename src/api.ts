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
import { authenticate, getArtistGenres, searchTrack, getAudioFeatures } from './spotify.js'
import { readSettings, writeSettings } from './settings.js'
import { enrichTracks, analyzeTracksWithAI, planSet } from './ai.js'
import type { SemanticTags } from './ai.js'
import { normalizeBpm } from './normalize-bpm.js'
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
  dateAdded?: number   // Unix timestamp (seconds)
  spotifyArtist?: string
  spotifyTitle?: string
  bpm: number
  key: string
  camelot: string
  energy: number
  genres: string[]
  genresFromSpotify?: boolean
  semanticTags?: SemanticTags
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


function normalizePathKey(p: string): string {
  return path.normalize(p).normalize('NFC')
}

function readExistingResultsFile(filePath: string): Record<string, AppSong> {
  if (!fs.existsSync(filePath)) return {}
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    const out: Record<string, AppSong> = {}
    for (const [rawKey, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!isAppSong(value)) continue
      const key = normalizePathKey(rawKey)
      // Skip if we already have an entry for this normalized key
      if (out[key]) continue
      // Normalize the file/filePath fields to match the normalized key
      out[key] = { ...value, file: normalizePathKey(value.file), ...(value.filePath ? { filePath: normalizePathKey(value.filePath) } : {}) }
    }
    return out
  } catch { return {} }
}

function readExistingResults(rootPath: string): Record<string, AppSong> {
  return readExistingResultsFile(path.join(rootPath, 'results.json'))
}

interface AppleMusicTrack { filePath: string; file: string; artist: string | null; title: string; duration: number | null; dateAdded?: number }

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
  const script = `set outputLines to {}\ntell application "Music"\n\trepeat with t in (every track of user playlist "${esc}")\n\t\ttry\n\t\t\tset trackLocation to location of t\n\t\t\tif trackLocation is missing value then\n\t\t\t\terror "skip"\n\t\t\tend if\n\t\t\tset trackPath to POSIX path of trackLocation\n\t\t\tset trackName to (name of t) as text\n\t\t\tset trackArtist to ""\n\t\t\ttry\n\t\t\t\tset trackArtist to (artist of t) as text\n\t\t\tend try\n\t\t\tset trackDuration to ""\n\t\t\ttry\n\t\t\t\tset trackDuration to (duration of t) as text\n\t\t\tend try\n\t\t\tset trackAdded to ""\n\t\t\ttry\n\t\t\t\tset dAdded to date added of t\n\t\t\t\tset trackAdded to ((year of dAdded) as text) & "-" & ((month of dAdded as integer) as text) & "-" & ((day of dAdded) as text)\n\t\t\tend try\n\t\t\tset end of outputLines to trackPath & "${us}" & trackArtist & "${us}" & trackName & "${us}" & trackDuration & "${us}" & trackAdded\n\t\tend try\n\tend repeat\nend tell\nset AppleScript's text item delimiters to "${rs}"\nreturn outputLines as text`
  const { stdout } = await execFileAsync('osascript', ['-e', script], { maxBuffer: 64 * 1024 * 1024 })
  const tracks: AppleMusicTrack[] = []
  for (const row of (stdout.trim() ? stdout.trim().split(rs) : [])) {
    const [rawPath, rawArtist, rawTitle, rawDuration, rawAdded] = row.split(us)
    const filePath = (rawPath ?? '').trim()
    if (!filePath) continue
    const ext = path.extname(filePath).toLowerCase()
    if (!AUDIO_EXTENSIONS.has(ext) || !fs.existsSync(filePath)) continue
    let dateAdded: number | undefined
    if (rawAdded?.trim()) {
      const parts = rawAdded.trim().split('-')
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0] ?? '0'), parseInt(parts[1] ?? '1') - 1, parseInt(parts[2] ?? '1'))
        if (!isNaN(d.getTime())) dateAdded = Math.floor(d.getTime() / 1000)
      }
    }
    tracks.push({ filePath, file: path.basename(filePath), artist: (rawArtist ?? '').trim() || null, title: (rawTitle ?? '').trim() || path.basename(filePath, ext), duration: Number.isFinite(Number(rawDuration)) ? Number(rawDuration) : null, dateAdded })
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
      await new Promise<void>(r => setImmediate(r)) // yield: flush progress event before heavy work
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
        resultsJson[relativeFilePath] = { filePath: relativeFilePath, file: relativeFilePath, artist: track.artist ?? 'Unknown artist', title: track.title, ...(track.duration != null ? { duration: track.duration } : {}), spotifyArtist: match?.spotifyArtist, spotifyTitle: match?.spotifyTitle, bpm: normalizeBpm(features.bpm, features.energy, finalGenres), key: keyInfo.keyName, camelot: keyInfo.camelot, energy: features.energy, genres: finalGenres, ...(track.localGenres.length === 0 ? { genresFromSpotify: true } : {}), ...(features.year != null ? { year: features.year } : {}), ...(features.comment ? { comment: features.comment } : {}), ...(features.energyProfile ? { energyProfile: features.energyProfile } : {}) }
      } catch { /* skip */ }
    }
    writeEvent({ type: 'folder_done', folder: folderKey })
  }
  const { groqApiKey } = readSettings()
  if (groqApiKey) {
    writeEvent({ type: 'enriching', message: 'Running AI semantic enrichment…' })
    try {
      await enrichTracks(resultsJson, groqApiKey, (completed, total) => {
        writeEvent({ type: 'enrich_progress', completed, total })
      })
    } catch { /* enrichment is optional — don't fail the whole analysis */ }
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
    const key = normalizePathKey(track.filePath)
    completed += 1
    writeEvent({ type: 'progress', completed, total: tracks.length, folder: 'Apple Music', file: track.file })
    await new Promise<void>(r => setImmediate(r)) // yield: flush progress event before heavy work
    const cached = existing[key]
    if (cached) {
      if (cached.duration == null && track.duration != null) cached.duration = track.duration
      else if (cached.duration == null) { try { const meta = await mm.parseFile(track.filePath, { duration: true }); if (meta.format.duration != null) cached.duration = meta.format.duration } catch { /* ignore */ } }
      if (track.dateAdded != null && cached.dateAdded == null) cached.dateAdded = track.dateAdded
      resultsJson[key] = cached; continue
    }
    try {
      let localGenres: string[] = []
      try { const meta = await mm.parseFile(track.filePath, { duration: false }); localGenres = meta.common.genre ?? [] } catch { /* ignore */ }
      const match = await searchTrack(track.artist, track.title, token)
      const [localFeatures, spotifyGenres] = await Promise.all([analyzeAudio(track.filePath), localGenres.length === 0 && match?.artistId ? getArtistGenres(match.artistId, token) : Promise.resolve([])])
      const genres = localGenres.length > 0 ? localGenres : spotifyGenres

      let features = localFeatures
      // Fallback: if local audio decode failed (e.g. FLAC), use Spotify audio features
      if (!features && match?.spotifyId) {
        const sf = await getAudioFeatures(match.spotifyId, token)
        if (sf) features = { bpm: sf.bpm, pitchClass: sf.key, mode: sf.mode, energy: sf.energy }
      }
      if (!features) continue

      const keyInfo = toCamelot(features.pitchClass, features.mode)
      if (!keyInfo) continue
      resultsJson[key] = { filePath: track.filePath, file: track.filePath, artist: track.artist ?? 'Unknown artist', title: track.title, ...(track.duration != null ? { duration: track.duration } : {}), ...(track.dateAdded != null ? { dateAdded: track.dateAdded } : {}), spotifyArtist: match?.spotifyArtist, spotifyTitle: match?.spotifyTitle, bpm: normalizeBpm(features.bpm, features.energy, genres), key: keyInfo.keyName, camelot: keyInfo.camelot, energy: features.energy, genres, ...(localGenres.length === 0 && spotifyGenres.length > 0 ? { genresFromSpotify: true } : {}), ...(features.year != null ? { year: features.year } : {}), ...(features.comment ? { comment: features.comment } : {}), ...(features.energyProfile ? { energyProfile: features.energyProfile } : {}) }
    } catch { /* skip */ }
  }
  const { groqApiKey } = readSettings()
  if (groqApiKey) {
    writeEvent({ type: 'enriching', message: 'Running AI semantic enrichment…' })
    try {
      await enrichTracks(resultsJson, groqApiKey, (completed, total) => {
        writeEvent({ type: 'enrich_progress', completed, total })
      })
    } catch { /* enrichment is optional — don't fail the whole analysis */ }
  }
  fs.mkdirSync(path.dirname(APPLE_RESULTS_PATH), { recursive: true })
  fs.writeFileSync(APPLE_RESULTS_PATH, JSON.stringify(resultsJson, null, 2), 'utf-8')
  const songs = Object.values(resultsJson)
  return { total: tracks.length, analyzed: songs.length, songs, resultsJson }
}

export function setupMiddlewares(middlewares: MiddlewareApp, songsFolder?: string | null): void {
  // Public endpoint — returns whether a password is required
  middlewares.use('/api/auth/check', (req, res, next) => {
    if (req.method !== 'GET') { next(); return }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ requiresPassword: !!process.env.APP_PASSWORD }))
  })

  // Auth guard — active only when APP_PASSWORD env var is set
  middlewares.use((req, res, next) => {
    const url = req.url ?? ''
    if (!url.startsWith('/api/')) { next(); return }
    if (url.startsWith('/api/auth/check')) { next(); return }
    const appPwd = process.env.APP_PASSWORD
    if (!appPwd) { next(); return }
    const provided = req.headers['x-app-password']
    if (provided !== appPwd) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    next()
  })

  if (songsFolder) {
    middlewares.use('/results.json', (_req, res, next) => {
      const filePath = path.join(songsFolder, 'results.json')
      if (!fs.existsSync(filePath)) { next(); return }
      res.setHeader('Content-Type', 'application/json')
      fs.createReadStream(filePath).pipe(res)
    })
  }

  middlewares.use('/api/apple-library', (req, res, next) => {
    if (req.method !== 'GET') { next(); return }
    if (!fs.existsSync(APPLE_RESULTS_PATH)) {
      res.setHeader('Content-Type', 'application/json')
      res.end('null')
      return
    }
    res.setHeader('Content-Type', 'application/json')
    fs.createReadStream(APPLE_RESULTS_PATH).pipe(res)
  })

  middlewares.use('/api/settings', async (req, res, next) => {
    if (req.method === 'GET') {
      const s = readSettings()
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ spotifyClientId: s.spotifyClientId ?? '', hasSecret: !!s.spotifyClientSecret, musicFolder: s.musicFolder ?? '', playlistsFolder: s.playlistsFolder ?? '', hasGroqKey: !!s.groqApiKey }))
      return
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req) as Record<string, unknown>
      const updates: Partial<import('./settings.js').Settings> = {}
      if (typeof body.spotifyClientId === 'string') updates.spotifyClientId = body.spotifyClientId.trim()
      if (typeof body.spotifyClientSecret === 'string' && body.spotifyClientSecret.trim()) updates.spotifyClientSecret = body.spotifyClientSecret.trim()
      if (typeof body.musicFolder === 'string') updates.musicFolder = body.musicFolder.trim()
      if (typeof body.playlistsFolder === 'string') updates.playlistsFolder = body.playlistsFolder.trim()
      if (typeof body.groqApiKey === 'string' && body.groqApiKey.trim()) updates.groqApiKey = body.groqApiKey.trim()
      writeSettings(updates)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
      return
    }
    next()
  })

  middlewares.use('/api/check-path', (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      try {
        const { folderPath } = JSON.parse(body) as { folderPath: string }
        const exists = typeof folderPath === 'string' && folderPath.trim().length > 0 && fs.existsSync(folderPath.trim())
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ exists }))
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ exists: false }))
      }
    })
  })

  middlewares.use('/api/clear-database', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    const deleted: string[] = []
    // Clear Apple Music results
    if (fs.existsSync(APPLE_RESULTS_PATH)) {
      fs.unlinkSync(APPLE_RESULTS_PATH)
      deleted.push(APPLE_RESULTS_PATH)
    }
    // Clear folder results.json if music folder is configured
    const { musicFolder } = readSettings()
    if (musicFolder) {
      const folderResults = path.join(musicFolder, 'results.json')
      if (fs.existsSync(folderResults)) {
        fs.unlinkSync(folderResults)
        deleted.push(folderResults)
      }
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, deleted }))
  })

  middlewares.use('/api/analyze-folder', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    const writeEvent = (event: Record<string, unknown>) => { res.write(`${JSON.stringify(event)}\n`) }
    try {
      const body = await readJsonBody(req)
      const folderPath = (typeof (body as Record<string, unknown>)?.folderPath === 'string' ? ((body as Record<string, unknown>).folderPath as string).trim() : (readSettings().musicFolder ?? '')).trim()
      if (!folderPath) { writeEvent({ type: 'error', message: 'Missing folderPath.' }); res.end(); return }
      if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) { writeEvent({ type: 'error', message: 'Folder not found.' }); res.end(); return }
      const analysis = await analyzeLibrary(folderPath, path.basename(folderPath), writeEvent)
      writeEvent({ type: 'done', total: analysis.total, analyzed: analysis.analyzed, libraryName: path.basename(folderPath), songs: analysis.songs, resultsJson: analysis.resultsJson })
      res.end()
    } catch (err) { writeEvent({ type: 'error', message: err instanceof Error ? err.message : 'Analysis failed.' }); res.end() }
  })

  const RB_KEY_MAP: Record<string, { pitchClass: number; mode: number }> = {
    Cmaj:{pitchClass:0,mode:1}, Dbmaj:{pitchClass:1,mode:1}, Dmaj:{pitchClass:2,mode:1}, Ebmaj:{pitchClass:3,mode:1},
    Emaj:{pitchClass:4,mode:1}, Fmaj:{pitchClass:5,mode:1}, Gbmaj:{pitchClass:6,mode:1}, Gmaj:{pitchClass:7,mode:1},
    Abmaj:{pitchClass:8,mode:1}, Amaj:{pitchClass:9,mode:1}, Bbmaj:{pitchClass:10,mode:1}, Bmaj:{pitchClass:11,mode:1},
    'C#maj':{pitchClass:1,mode:1},'D#maj':{pitchClass:3,mode:1},'F#maj':{pitchClass:6,mode:1},'G#maj':{pitchClass:8,mode:1},'A#maj':{pitchClass:10,mode:1},
    Cmin:{pitchClass:0,mode:0}, Dbmin:{pitchClass:1,mode:0}, Dmin:{pitchClass:2,mode:0}, Ebmin:{pitchClass:3,mode:0},
    Emin:{pitchClass:4,mode:0}, Fmin:{pitchClass:5,mode:0}, Gbmin:{pitchClass:6,mode:0}, Gmin:{pitchClass:7,mode:0},
    Abmin:{pitchClass:8,mode:0}, Amin:{pitchClass:9,mode:0}, Bbmin:{pitchClass:10,mode:0}, Bmin:{pitchClass:11,mode:0},
    'C#min':{pitchClass:1,mode:0},'D#min':{pitchClass:3,mode:0},'F#min':{pitchClass:6,mode:0},'G#min':{pitchClass:8,mode:0},'A#min':{pitchClass:10,mode:0},
  }

  middlewares.use('/api/import-rekordbox', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    const writeEvent = (event: Record<string, unknown>) => { res.write(`${JSON.stringify(event)}\n`) }
    try {
      interface RBTrack { path: string; title: string; artist: string; bpm: number; tonality: string; duration: number }
      const body = await readJsonBody(req) as { tracks?: unknown }
      const rbTracks = Array.isArray(body.tracks)
        ? (body.tracks as unknown[]).filter((t): t is RBTrack =>
            typeof t === 'object' && t !== null &&
            typeof (t as RBTrack).path === 'string' &&
            typeof (t as RBTrack).title === 'string')
        : []
      if (rbTracks.length === 0) { writeEvent({ type: 'error', message: 'No tracks in Rekordbox XML.' }); res.end(); return }
      writeEvent({ type: 'start', total: rbTracks.length })
      const existing = readExistingResultsFile(APPLE_RESULTS_PATH)
      const resultsJson: Record<string, AppSong> = { ...existing }
      let needsSpotify = false
      try { const s = readSettings(); needsSpotify = !!(s.spotifyClientId && s.spotifyClientSecret) } catch { /* skip */ }
      let token: string | null = null
      if (needsSpotify) {
        try { const s = readSettings(); token = await authenticate(s.spotifyClientId!, s.spotifyClientSecret!) } catch { needsSpotify = false }
      }
      let completed = 0
      for (const track of rbTracks) {
        completed++
        writeEvent({ type: 'progress', completed, total: rbTracks.length, folder: 'Rekordbox', file: path.basename(track.path) })
        const cached = existing[track.path]
        if (cached) { resultsJson[track.path] = cached; continue }
        const keyInfo_rb = RB_KEY_MAP[track.tonality] ? toCamelot(RB_KEY_MAP[track.tonality].pitchClass, RB_KEY_MAP[track.tonality].mode) : null
        if (!keyInfo_rb) continue
        let genres: string[] = []
        let localGenres: string[] = []
        try { const meta = await mm.parseFile(track.path, { duration: false }); localGenres = meta.common.genre ?? [] } catch { /* ignore */ }
        if (localGenres.length > 0) { genres = localGenres }
        else if (needsSpotify && token) {
          try { const match = await searchTrack(track.artist, track.title, token); if (match?.artistId) genres = await getArtistGenres(match.artistId, token) } catch { /* ignore */ }
        }
        resultsJson[track.path] = { filePath: track.path, file: path.basename(track.path), artist: track.artist || 'Unknown artist', title: track.title, duration: track.duration || undefined, bpm: track.bpm, key: keyInfo_rb.keyName, camelot: keyInfo_rb.camelot, energy: 0.5, genres, ...(localGenres.length === 0 && genres.length > 0 ? { genresFromSpotify: true } : {}) }
      }
      const { groqApiKey } = readSettings()
      if (groqApiKey) {
        writeEvent({ type: 'enriching', message: 'Running AI semantic enrichment…' })
        try { await enrichTracks(resultsJson, groqApiKey, (c, t) => { writeEvent({ type: 'enrich_progress', completed: c, total: t }) }) } catch { /* optional */ }
      }
      fs.writeFileSync(APPLE_RESULTS_PATH, JSON.stringify(resultsJson, null, 2), 'utf-8')
      const songs = Object.values(resultsJson)
      writeEvent({ type: 'done', total: rbTracks.length, analyzed: songs.length, libraryName: 'Rekordbox', songs, resultsJson })
      res.end()
    } catch (err) { writeEvent({ type: 'error', message: err instanceof Error ? err.message : 'Import failed.' }); res.end() }
  })

  // Reverse Camelot lookup: "7A" → { keyName, camelot }
  const KEY_NAMES_LOCAL = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B']
  const CAMELOT_MAJOR_LOCAL = ['8B','3B','10B','5B','12B','7B','2B','9B','4B','11B','6B','1B']
  const CAMELOT_MINOR_LOCAL = ['5A','12A','7A','2A','9A','4A','11A','6A','1A','8A','3A','10A']
  const camelotToKey: Record<string, { keyName: string; camelot: string }> = {}
  for (let i = 0; i < 12; i++) {
    const maj = CAMELOT_MAJOR_LOCAL[i]; camelotToKey[maj.toLowerCase()] = { camelot: maj, keyName: `${KEY_NAMES_LOCAL[i]} Major` }
    const min = CAMELOT_MINOR_LOCAL[i]; camelotToKey[min.toLowerCase()] = { camelot: min, keyName: `${KEY_NAMES_LOCAL[i]} Minor` }
  }
  // Parse MixedInKey prefix: "7A - 6 - Title" → { camelot:"7A", energy:0.6, cleanTitle:"Title" }
  function parseMIKPrefix(title: string): { camelot: string; keyName: string; energy: number; cleanTitle: string } | null {
    const m = title.match(/^([0-9]{1,2}[AB])\s*-\s*([0-9]+)\s*-\s*(.+)$/i)
    if (!m) return null
    const info = camelotToKey[m[1].toLowerCase()]
    if (!info) return null
    const energy = Math.min(1, Math.max(0, parseInt(m[2], 10) / 10))
    return { ...info, energy, cleanTitle: m[3].trim() }
  }

  // Web-friendly M3U import: takes artist+title metadata, extracts MIK prefix then enriches via Spotify
  middlewares.use('/api/import-m3u-web', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    const writeEvent = (event: Record<string, unknown>) => { res.write(`${JSON.stringify(event)}\n`) }
    try {
      const { spotifyClientId, spotifyClientSecret } = readSettings()
      if (!spotifyClientId || !spotifyClientSecret) { writeEvent({ type: 'error', message: 'Spotify credentials not configured.' }); res.end(); return }
      const body = await readJsonBody(req) as { tracks?: unknown; label?: unknown }
      interface M3UTrack { artist: string; title: string }
      const tracks = Array.isArray(body.tracks)
        ? (body.tracks as unknown[]).filter((t): t is M3UTrack =>
            typeof t === 'object' && t !== null &&
            typeof (t as M3UTrack).title === 'string')
        : []
      if (tracks.length === 0) { writeEvent({ type: 'error', message: 'No tracks found in playlist.' }); res.end(); return }
      const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'M3U Playlist'
      writeEvent({ type: 'start', total: tracks.length })
      const token = await authenticate(spotifyClientId, spotifyClientSecret)
      const existing = readExistingResultsFile(APPLE_RESULTS_PATH)
      const resultsJson: Record<string, AppSong> = { ...existing }
      let completed = 0
      for (const track of tracks) {
        completed++
        writeEvent({ type: 'progress', completed, total: tracks.length, folder: label, file: track.title })
        const cacheKey = `m3u:${track.artist}:${track.title}`
        if (existing[cacheKey]) { resultsJson[cacheKey] = existing[cacheKey]; continue }
        try {
          // Extract Camelot key + energy from MixedInKey prefix if present
          const mik = parseMIKPrefix(track.title)
          const searchTitle = mik ? mik.cleanTitle : track.title

          const match = await searchTrack(track.artist || null, searchTitle, token)

          // Get genres via artist if we found a match
          let finalGenres: string[] = []
          if (match?.artistId) {
            try { finalGenres = await getArtistGenres(match.artistId, token) } catch { /* ignore */ }
          }

          const camelot = mik?.camelot ?? ''
          const keyName = mik?.keyName ?? ''
          const energy = mik ? mik.energy : 0.5

          resultsJson[cacheKey] = {
            filePath: cacheKey,
            file: `${track.artist ? track.artist + ' - ' : ''}${track.title}`,
            artist: match?.spotifyArtist || track.artist || 'Unknown artist',
            title: match?.spotifyTitle || searchTitle,
            bpm: 0,
            key: keyName,
            camelot,
            energy,
            genres: finalGenres,
            spotifyArtist: match?.spotifyArtist,
            spotifyTitle: match?.spotifyTitle,
          }
        } catch { /* skip unresolvable tracks */ }
      }
      // AI pass: estimate BPM/key/energy for tracks missing MIK prefix, then semantic-tag all tracks
      const { groqApiKey } = readSettings()
      if (groqApiKey) {
        // Pass 1: fill in BPM/key/energy for tracks without MIK prefix
        const needsAI = Object.entries(resultsJson).filter(([, s]) => s.bpm === 0 && s.camelot === '')
        if (needsAI.length > 0) {
          const aiInput = needsAI.map(([cacheKey, s]) => ({ file: cacheKey, artist: s.artist, title: s.title }))
          try {
            const aiResults = await analyzeTracksWithAI(aiInput, groqApiKey)
            for (const [cacheKey] of needsAI) {
              const est = aiResults.get(cacheKey)
              if (!est) continue
              const keyInfo = camelotToKey[est.camelot.toLowerCase()]
              resultsJson[cacheKey] = {
                ...resultsJson[cacheKey],
                bpm: est.bpm,
                camelot: keyInfo?.camelot ?? est.camelot,
                key: keyInfo?.keyName ?? '',
                energy: est.energy,
              }
            }
          } catch { /* skip AI pass on error */ }
        }
        // Pass 2: semantic tagging (vibe/mood/venue/time) for all tracks — same as desktop pipeline
        try {
          await enrichTracks(resultsJson, groqApiKey, (completed, total) => {
            writeEvent({ type: 'progress', completed: tracks.length + completed, total: tracks.length + total })
          })
        } catch { /* skip enrichment on error */ }
      }

      fs.mkdirSync(path.dirname(APPLE_RESULTS_PATH), { recursive: true })
      fs.writeFileSync(APPLE_RESULTS_PATH, JSON.stringify(resultsJson, null, 2), 'utf-8')
      const songs = Object.values(resultsJson)
      writeEvent({ type: 'done', total: tracks.length, analyzed: songs.length, libraryName: label, songs, resultsJson })
      res.end()
    } catch (err) { writeEvent({ type: 'error', message: err instanceof Error ? err.message : 'Import failed.' }); res.end() }
  })

  middlewares.use('/api/analyze-paths', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    const writeEvent = (event: Record<string, unknown>) => { res.write(`${JSON.stringify(event)}\n`) }
    try {
      const { spotifyClientId: SPOTIFY_CLIENT_ID, spotifyClientSecret: SPOTIFY_CLIENT_SECRET } = readSettings()
      if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) { writeEvent({ type: 'error', message: 'Spotify credentials not configured.' }); res.end(); return }
      const body = await readJsonBody(req) as { paths?: unknown; label?: unknown }
      const rawPaths = Array.isArray(body.paths) ? (body.paths as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : []
      if (rawPaths.length === 0) { writeEvent({ type: 'error', message: 'No valid file paths provided.' }); res.end(); return }
      const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'Imported playlist'
      const validPaths = rawPaths.filter(p => AUDIO_EXTENSIONS.has(path.extname(p).toLowerCase()) && fs.existsSync(p))
      if (validPaths.length === 0) { writeEvent({ type: 'error', message: 'No audio files found at the provided paths.' }); res.end(); return }
      writeEvent({ type: 'start', total: validPaths.length })
      const token = await authenticate(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)
      const existing = readExistingResultsFile(APPLE_RESULTS_PATH)
      const resultsJson: Record<string, AppSong> = { ...existing }
      let completed = 0
      for (const filePath of validPaths) {
        const file = path.basename(filePath)
        completed++
        writeEvent({ type: 'progress', completed, total: validPaths.length, folder: label, file })
        const cached = existing[filePath]
        if (cached) { resultsJson[filePath] = cached; continue }
        try {
          let localGenres: string[] = []
          let localArtist: string | null = null
          let localTitle: string = path.basename(filePath, path.extname(filePath))
          let localDuration: number | null = null
          try {
            const meta = await mm.parseFile(filePath, { duration: true })
            localGenres = meta.common.genre ?? []
            localArtist = meta.common.artist ?? null
            if (meta.common.title) localTitle = meta.common.title
            if (meta.format.duration != null) localDuration = meta.format.duration
          } catch { /* ignore */ }
          const match = await searchTrack(localArtist, localTitle, token)
          const [features, spotifyGenres] = await Promise.all([
            analyzeAudio(filePath),
            localGenres.length === 0 && match?.artistId ? getArtistGenres(match.artistId, token) : Promise.resolve([])
          ])
          if (!features) continue
          const keyInfo = toCamelot(features.pitchClass, features.mode)
          if (!keyInfo) continue
          const genres = localGenres.length > 0 ? localGenres : spotifyGenres
          resultsJson[filePath] = { filePath, file, artist: localArtist ?? 'Unknown artist', title: localTitle, ...(localDuration != null ? { duration: localDuration } : {}), spotifyArtist: match?.spotifyArtist, spotifyTitle: match?.spotifyTitle, bpm: normalizeBpm(features.bpm, features.energy, genres), key: keyInfo.keyName, camelot: keyInfo.camelot, energy: features.energy, genres, ...(localGenres.length === 0 && spotifyGenres.length > 0 ? { genresFromSpotify: true } : {}), ...(features.year != null ? { year: features.year } : {}), ...(features.comment ? { comment: features.comment } : {}), ...(features.energyProfile ? { energyProfile: features.energyProfile } : {}) }
        } catch { /* skip */ }
      }
      const { groqApiKey } = readSettings()
      if (groqApiKey) {
        writeEvent({ type: 'enriching', message: 'Running AI semantic enrichment…' })
        try { await enrichTracks(resultsJson, groqApiKey, (c, t) => { writeEvent({ type: 'enrich_progress', completed: c, total: t }) }) } catch { /* optional */ }
      }
      fs.writeFileSync(APPLE_RESULTS_PATH, JSON.stringify(resultsJson, null, 2), 'utf-8')
      const songs = Object.values(resultsJson)
      writeEvent({ type: 'done', total: validPaths.length, analyzed: songs.length, libraryName: label, songs, resultsJson })
      res.end()
    } catch (err) { writeEvent({ type: 'error', message: err instanceof Error ? err.message : 'Analysis failed.' }); res.end() }
  })

  middlewares.use('/api/export-m3u', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    const body = await readJsonBody(req) as { content?: string; filename?: string }
    const { playlistsFolder } = readSettings()
    if (!playlistsFolder) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'playlistsFolder not set in settings.' })); return }
    const filename = (body.filename ?? 'djfriend-set.m3u').replace(/[/\\?%*:|"<>]/g, '-')
    const outPath = path.join(playlistsFolder, filename)
    fs.mkdirSync(playlistsFolder, { recursive: true })
    fs.writeFileSync(outPath, body.content ?? '', 'utf-8')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, path: outPath }))
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
    if (process.platform !== 'darwin') { res.statusCode = 501; res.end(JSON.stringify({ error: 'Apple Music is only available on macOS.' })); return }
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

  middlewares.use('/api/reveal-in-finder', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    const body = await readJsonBody(req) as Record<string, unknown>
    const filePath = typeof body.filePath === 'string' ? body.filePath : null
    if (!filePath) { res.statusCode = 400; res.end(JSON.stringify({ error: 'filePath required' })); return }
    try {
      if (process.platform === 'darwin') {
        await execFileAsync('open', ['-R', filePath])
      } else if (process.platform === 'win32') {
        await execFileAsync('explorer', [`/select,${filePath}`])
      } else {
        await execFileAsync('xdg-open', [path.dirname(filePath)])
      }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true }))
    } catch (err) { res.statusCode = 500; res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed' })) }
  })

  middlewares.use('/api/apple-music-playlists', async (req, res, next) => {
    if (req.method !== 'GET') { next(); return }
    if (process.platform !== 'darwin') { res.end(JSON.stringify([])); return }
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
    if (process.platform !== 'darwin') { writeEvent({ type: 'error', message: 'Apple Music is only available on macOS.' }); res.end(); return }
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

  middlewares.use('/api/ai/enrich', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    const writeEvent = (event: Record<string, unknown>) => { res.write(`${JSON.stringify(event)}\n`) }
    try {
      const { groqApiKey } = readSettings()
      if (!groqApiKey) { writeEvent({ type: 'error', message: 'Groq API key not configured. Open Settings to add it.' }); res.end(); return }
      const body = await readJsonBody(req) as Record<string, unknown>
      const resultsPath = typeof body.resultsPath === 'string' && body.resultsPath.trim()
        ? body.resultsPath.trim()
        : songsFolder ? path.join(songsFolder, 'results.json') : null
      if (!resultsPath || !fs.existsSync(resultsPath)) { writeEvent({ type: 'error', message: 'results.json not found.' }); res.end(); return }
      const resultsJson = readExistingResultsFile(resultsPath.replace(/\/results\.json$/, ''))
      const toEnrich = Object.values(resultsJson).filter(s => !s.semanticTags).length
      writeEvent({ type: 'start', total: toEnrich })
      await enrichTracks(resultsJson, groqApiKey, (completed, total) => {
        writeEvent({ type: 'progress', completed, total })
      })
      fs.writeFileSync(resultsPath, JSON.stringify(resultsJson, null, 2), 'utf-8')
      writeEvent({ type: 'done', enriched: toEnrich })
      res.end()
    } catch (err) { writeEvent({ type: 'error', message: err instanceof Error ? err.message : 'Enrichment failed.' }); res.end() }
  })

  middlewares.use('/api/ai/plan-set', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return }
    res.setHeader('Content-Type', 'application/json')
    try {
      const { groqApiKey } = readSettings()
      if (!groqApiKey) {
        res.statusCode = 400
        res.end(JSON.stringify({ ok: false, error: 'Groq API key not configured. Open Settings to add it.' }))
        return
      }
      const body = await readJsonBody(req) as Record<string, unknown>
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
      if (!prompt) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'prompt is required' })); return }
      const availableGenres = Array.isArray(body.availableGenres) ? body.availableGenres as string[] : []
      const librarySize = typeof body.librarySize === 'number' ? body.librarySize : 0
      const plan = await planSet(prompt, { availableGenres, librarySize }, groqApiKey)
      res.end(JSON.stringify({ ok: true, plan }))
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Planning failed.' }))
    }
  })
}
