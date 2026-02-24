import 'dotenv/config'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { promisify } from 'util'
import { execFile } from 'child_process'
import Busboy from 'busboy'
import { scanFolder } from './src/scanner'
import { analyzeAudio } from './src/analyzer'
import { toCamelot } from './src/camelot'
import { authenticate, getArtistGenres, searchTrack } from './src/spotify'

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.aac', '.m4a', '.wav', '.ogg', '.opus'])
const execFileAsync = promisify(execFile)
const APPLE_RESULTS_PATH = path.join(os.homedir(), 'Music', 'djfriend-results.json')

interface AppSong {
  filePath: string
  file: string
  artist: string
  title: string
  bpm: number
  key: string
  camelot: string
  energy: number
  genres: string[]
}

function collectAudioDirs(rootPath: string): string[] {
  const folders: string[] = []

  function walk(currentPath: string): void {
    let hasAudio = false
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (AUDIO_EXTENSIONS.has(ext)) hasAudio = true
      }
    }
    if (hasAudio) folders.push(currentPath)
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(currentPath, entry.name))
      }
    }
  }

  walk(rootPath)
  return folders
}

function readJsonBody(req: NodeJS.ReadableStream): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8')
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function toSafeRelative(input: string): string | null {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized) return null
  if (normalized.includes('\0')) return null
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return null
  if (parts.some((part) => part === '..')) return null
  return parts.join('/')
}

function isAppSong(value: unknown): value is AppSong {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.filePath === 'string' &&
    typeof v.file === 'string' &&
    typeof v.artist === 'string' &&
    typeof v.title === 'string' &&
    typeof v.bpm === 'number' &&
    typeof v.key === 'string' &&
    typeof v.camelot === 'string' &&
    typeof v.energy === 'number' &&
    Array.isArray(v.genres)
  )
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
  } catch {
    return {}
  }
}

function readExistingResults(rootPath: string): Record<string, AppSong> {
  return readExistingResultsFile(path.join(rootPath, 'results.json'))
}

interface AppleMusicTrack {
  filePath: string
  file: string
  artist: string | null
  title: string
  duration: number | null
}

async function listAppleMusicTracks(): Promise<AppleMusicTrack[]> {
  const rs = String.fromCharCode(30)
  const us = String.fromCharCode(31)
  const script = `
set outputLines to {}
tell application "Music"
	repeat with t in (every track of library playlist 1)
		try
			set trackLocation to location of t
			if trackLocation is missing value then
				error "skip"
			end if
			set trackPath to POSIX path of trackLocation
			set trackName to (name of t) as text
			set trackArtist to ""
			try
				set trackArtist to (artist of t) as text
			end try
			set trackDuration to ""
			try
				set trackDuration to (duration of t) as text
			end try
			set end of outputLines to trackPath & "${us}" & trackArtist & "${us}" & trackName & "${us}" & trackDuration
		end try
	end repeat
end tell
set AppleScript's text item delimiters to "${rs}"
return outputLines as text
`.trim()

  const { stdout } = await execFileAsync('osascript', ['-e', script], { maxBuffer: 64 * 1024 * 1024 })
  const rows = stdout.trim() ? stdout.trim().split(rs) : []
  const tracks: AppleMusicTrack[] = []

  for (const row of rows) {
    const [rawPath, rawArtist, rawTitle, rawDuration] = row.split(us)
    const filePath = (rawPath ?? '').trim()
    if (!filePath) continue
    const ext = path.extname(filePath).toLowerCase()
    if (!AUDIO_EXTENSIONS.has(ext)) continue
    if (!fs.existsSync(filePath)) continue
    tracks.push({
      filePath,
      file: path.basename(filePath),
      artist: (rawArtist ?? '').trim() || null,
      title: (rawTitle ?? '').trim() || path.basename(filePath, ext),
      duration: Number.isFinite(Number(rawDuration)) ? Number(rawDuration) : null,
    })
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
      if (!safeRelative) {
        file.resume()
        return
      }

      const [rootLabel] = safeRelative.split('/')
      if (rootLabel) rootLabels.add(rootLabel)

      const outPath = path.join(tempRoot, safeRelative)
      fs.mkdirSync(path.dirname(outPath), { recursive: true })

      const task = new Promise<void>((resolveFile, rejectFile) => {
        const out = fs.createWriteStream(outPath)
        out.on('finish', resolveFile)
        out.on('error', rejectFile)
        file.on('error', rejectFile)
        file.pipe(out)
      })
      writeTasks.push(task)
    })

    bb.on('error', reject)
    bb.on('finish', resolve)
    req.pipe(bb)
  })

  await Promise.all(writeTasks)

  if (rootLabels.size !== 1) {
    throw new Error('Please upload exactly one root folder at a time.')
  }
  const [rootLabel] = Array.from(rootLabels)
  if (!rootLabel) throw new Error('Could not determine selected root folder.')
  const rootPath = path.join(tempRoot, rootLabel)
  if (!fs.existsSync(rootPath)) throw new Error('Uploaded folder payload was empty.')

  return { tempRoot, rootPath, rootLabel }
}

async function analyzeLibrary(
  rootPath: string,
  rootLabel: string,
  writeEvent: (event: Record<string, unknown>) => void,
): Promise<{ total: number; analyzed: number; songs: AppSong[]; resultsJson: Record<string, AppSong> }> {
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env.')
  }

  const audioFolders = collectAudioDirs(rootPath)
  const folderTracks = new Map<string, Awaited<ReturnType<typeof scanFolder>>>()
  let total = 0

  for (const folder of audioFolders) {
    const tracks = await scanFolder(folder)
    if (tracks.length > 0) {
      folderTracks.set(folder, tracks)
      total += tracks.length
    }
  }

  if (total === 0) {
    throw new Error('No audio files found in selected folder.')
  }

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
      writeEvent({
        type: 'progress',
        completed,
        total,
        folder: folderKey,
        file: track.file,
      })

      const cached = existing[relativeFilePath]
      if (cached) {
        resultsJson[relativeFilePath] = cached
        continue
      }

      try {
        const match = await searchTrack(track.artist, track.title, token)
        const [features, genres] = await Promise.all([
          analyzeAudio(track.filePath),
          match?.artistId ? getArtistGenres(match.artistId, token) : Promise.resolve([]),
        ])

        if (!features) continue
        const keyInfo = toCamelot(features.pitchClass, features.mode)
        if (!keyInfo) continue

        const song: AppSong = {
          filePath: relativeFilePath,
          file: relativeFilePath,
          artist: match?.spotifyArtist ?? track.artist ?? 'Unknown artist',
          title: match?.spotifyTitle ?? track.title,
          bpm: features.bpm,
          key: keyInfo.keyName,
          camelot: keyInfo.camelot,
          energy: features.energy,
          genres,
        }
        resultsJson[relativeFilePath] = song
      } catch {
        // Skip failed files and continue processing.
      }
    }
    writeEvent({ type: 'folder_done', folder: folderKey })
  }

  const outputPath = path.join(rootPath, 'results.json')
  fs.writeFileSync(outputPath, JSON.stringify(resultsJson, null, 2), 'utf-8')
  const songs = Object.values(resultsJson)

  return {
    total,
    analyzed: songs.length,
    songs,
    resultsJson,
  }
}

async function analyzeAppleMusicLibrary(
  writeEvent: (event: Record<string, unknown>) => void,
): Promise<{ total: number; analyzed: number; songs: AppSong[]; resultsJson: Record<string, AppSong> }> {
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env.')
  }

  const tracks = await listAppleMusicTracks()
  if (tracks.length === 0) throw new Error('No Apple Music local file tracks were found.')

  writeEvent({ type: 'start', total: tracks.length })
  const token = await authenticate(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)
  const existing = readExistingResultsFile(APPLE_RESULTS_PATH)
  const resultsJson: Record<string, AppSong> = { ...existing }
  let completed = 0

  for (const track of tracks) {
    const key = track.filePath
    completed += 1
    writeEvent({
      type: 'progress',
      completed,
      total: tracks.length,
      folder: 'Apple Music',
      file: track.file,
    })

    const cached = existing[key]
    if (cached) {
      resultsJson[key] = cached
      continue
    }

    try {
      const match = await searchTrack(track.artist, track.title, token)
      const [features, genres] = await Promise.all([
        analyzeAudio(track.filePath),
        match?.artistId ? getArtistGenres(match.artistId, token) : Promise.resolve([]),
      ])

      if (!features) continue
      const keyInfo = toCamelot(features.pitchClass, features.mode)
      if (!keyInfo) continue

      const song: AppSong = {
        filePath: track.filePath,
        file: track.filePath,
        artist: match?.spotifyArtist ?? track.artist ?? 'Unknown artist',
        title: match?.spotifyTitle ?? track.title,
        bpm: features.bpm,
        key: keyInfo.keyName,
        camelot: keyInfo.camelot,
        energy: features.energy,
        genres,
      }
      resultsJson[key] = song
    } catch {
      // Skip failed files and continue.
    }
  }

  fs.mkdirSync(path.dirname(APPLE_RESULTS_PATH), { recursive: true })
  fs.writeFileSync(APPLE_RESULTS_PATH, JSON.stringify(resultsJson, null, 2), 'utf-8')
  const songs = Object.values(resultsJson)

  return {
    total: tracks.length,
    analyzed: songs.length,
    songs,
    resultsJson,
  }
}

// ─── Read SONGS_FOLDER from the parent project's .env ────────────────────────
function readSongsFolder(): string | null {
  const envPath = path.resolve(__dirname, '.env')
  if (!fs.existsSync(envPath)) return null
  const contents = fs.readFileSync(envPath, 'utf-8')
  for (const line of contents.split('\n')) {
    const match = line.match(/^\s*SONGS_FOLDER\s*=\s*(.+)\s*$/)
    if (match) return match[1].trim()
  }
  return null
}

const songsFolder = readSongsFolder()

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Custom plugin: serve result.json from SONGS_FOLDER in dev,
    // and copy it into dist/ during build.
    {
      name: 'songs-folder',
      configureServer(server) {
        if (songsFolder) {
          server.middlewares.use('/results.json', (_req, res, next) => {
            const filePath = path.join(songsFolder, 'results.json')
            if (!fs.existsSync(filePath)) { next(); return }
            res.setHeader('Content-Type', 'application/json')
            fs.createReadStream(filePath).pipe(res)
          })
        }

        server.middlewares.use('/api/analyze-folder', async (req, res, next) => {
          if (req.method !== 'POST') {
            next()
            return
          }

          res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache')

          const writeEvent = (event: Record<string, unknown>): void => {
            res.write(`${JSON.stringify(event)}\n`)
          }

          try {
            const body = await readJsonBody(req)
            const folderPath = typeof (body as Record<string, unknown>)?.folderPath === 'string'
              ? ((body as Record<string, unknown>).folderPath as string).trim()
              : ''

            if (!folderPath) {
              writeEvent({ type: 'error', message: 'Missing folderPath.' })
              res.end()
              return
            }
            if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
              writeEvent({ type: 'error', message: 'Folder path does not exist or is not a directory.' })
              res.end()
              return
            }

            const analysis = await analyzeLibrary(folderPath, path.basename(folderPath), writeEvent)

            writeEvent({
              type: 'done',
              total: analysis.total,
              analyzed: analysis.analyzed,
              libraryName: path.basename(folderPath),
              songs: analysis.songs,
              resultsJson: analysis.resultsJson,
            })
            res.end()
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Analysis failed.'
            writeEvent({ type: 'error', message })
            res.end()
          }
        })

        server.middlewares.use('/api/analyze-upload', async (req, res, next) => {
          if (req.method !== 'POST') {
            next()
            return
          }

          res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache')

          const writeEvent = (event: Record<string, unknown>): void => {
            res.write(`${JSON.stringify(event)}\n`)
          }

          let tempRoot: string | null = null
          try {
            const parsed = await parseUploadedFolder(
              req as NodeJS.ReadableStream & { headers: Record<string, string | string[] | undefined> },
            )
            tempRoot = parsed.tempRoot
            const analysis = await analyzeLibrary(parsed.rootPath, parsed.rootLabel, writeEvent)
            writeEvent({
              type: 'done',
              total: analysis.total,
              analyzed: analysis.analyzed,
              libraryName: parsed.rootLabel,
              songs: analysis.songs,
              resultsJson: analysis.resultsJson,
            })
            res.end()
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Upload analysis failed.'
            writeEvent({ type: 'error', message })
            res.end()
          } finally {
            if (tempRoot && fs.existsSync(tempRoot)) {
              fs.rmSync(tempRoot, { recursive: true, force: true })
            }
          }
        })

        server.middlewares.use('/api/analyze-apple-music', async (req, res, next) => {
          if (req.method !== 'POST') {
            next()
            return
          }

          res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache')

          const writeEvent = (event: Record<string, unknown>): void => {
            res.write(`${JSON.stringify(event)}\n`)
          }

          try {
            const analysis = await analyzeAppleMusicLibrary(writeEvent)
            writeEvent({
              type: 'done',
              total: analysis.total,
              analyzed: analysis.analyzed,
              libraryName: 'Apple Music',
              songs: analysis.songs,
              resultsJson: analysis.resultsJson,
            })
            res.end()
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Apple Music analysis failed.'
            writeEvent({ type: 'error', message })
            res.end()
          }
        })
      },
      closeBundle() {
        if (!songsFolder) return
        const src = path.join(songsFolder, 'results.json')
        const dest = path.resolve(__dirname, 'dist/results.json')
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest)
          console.log(`[songs-folder] Copied results.json from ${src}`)
        }
      },
    },
  ],
  // Inject SONGS_FOLDER into client code so M3U export can build absolute paths
  define: {
    __SONGS_FOLDER__: JSON.stringify(songsFolder ?? ''),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './app'),
    },
  },
})
