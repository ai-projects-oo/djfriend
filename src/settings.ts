import fs from 'fs'
import path from 'path'
import os from 'os'
import { config } from 'dotenv'

config() // load .env if present

function getSettingsDir(): string {
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? os.homedir(), 'djfriend')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'djfriend')
  return path.join(os.homedir(), '.config', 'djfriend')
}
const SETTINGS_DIR = getSettingsDir()
const SETTINGS_PATH = path.join(SETTINGS_DIR, 'settings.json')

export interface Settings {
  spotifyClientId: string
  spotifyClientSecret: string
  musicFolder: string
  playlistsFolder: string
  rekordboxFolder?: string
  useAllCores?: boolean         // spawn one audio worker per core (default false = single worker)
  energyCheckThreshold?: number // 0–1, minimum delta to flag an energy mismatch (default 0.12)
}

export function readSettings(): Partial<Settings> {
  // Env vars are the baseline — settings.json values override them
  const fromEnv: Partial<Settings> = {
    ...(process.env.SPOTIFY_CLIENT_ID ? { spotifyClientId: process.env.SPOTIFY_CLIENT_ID } : {}),
    ...(process.env.SPOTIFY_CLIENT_SECRET ? { spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET } : {}),
    ...(process.env.SONGS_FOLDER ? { musicFolder: process.env.SONGS_FOLDER } : {}),
  }
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return fromEnv
    const fromFile = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) as Partial<Settings>
    return { ...fromEnv, ...fromFile }
  } catch {
    return fromEnv
  }
}

export function writeSettings(updates: Partial<Settings>): void {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true })
  const existing = readSettings()
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ ...existing, ...updates }, null, 2), 'utf-8')
}
