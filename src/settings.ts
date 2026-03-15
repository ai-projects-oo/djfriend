import fs from 'fs'
import path from 'path'
import os from 'os'

const SETTINGS_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'djfriend')
const SETTINGS_PATH = path.join(SETTINGS_DIR, 'settings.json')

export interface Settings {
  spotifyClientId: string
  spotifyClientSecret: string
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
