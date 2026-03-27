import fs from 'fs'
import path from 'path'
import os from 'os'

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
}

export function readSettings(): Partial<Settings> {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return {}
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) as Partial<Settings>
  } catch {
    return {}
  }
}

export function writeSettings(updates: Partial<Settings>): void {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true })
  const existing = readSettings()
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ ...existing, ...updates }, null, 2), 'utf-8')
}
