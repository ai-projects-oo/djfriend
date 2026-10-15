/**
 * Integration tests using real audio files from test/mock_music/.
 * Sanity checks only: analysis returns in-range BPM / energy and a resolvable key.
 * (No accuracy assertions against third-party key/energy labels.)
 */
import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs'
import { analyzeAudio } from '../src/analyzer'
import { toCamelot } from '../src/camelot'
import { generateSet } from '../app/lib/setGenerator'
import type { Song, DJPreferences, CurvePoint } from '../app/types'

const MOCK_DIR = path.resolve(__dirname, 'mock_music')

const mp3Files = fs.existsSync(MOCK_DIR)
  ? fs.readdirSync(MOCK_DIR).filter(f => f.endsWith('.mp3'))
  : []

// ─── Analysis sanity ──────────────────────────────────────────────────────────

describe('audio analysis (sanity)', () => {
  if (mp3Files.length === 0) {
    it.skip('no mock audio files in test/mock_music — add real MP3s to enable', () => {})
    return
  }
  for (const file of mp3Files) {
    it(`${file} — analyzeAudio returns sane values`, async () => {
      const features = await analyzeAudio(path.join(MOCK_DIR, file))
      expect(features, 'analyzeAudio returned null').not.toBeNull()
      expect(features!.bpm).toBeGreaterThan(60)
      expect(features!.bpm).toBeLessThan(220)
      expect(features!.energy).toBeGreaterThanOrEqual(0)
      expect(features!.energy).toBeLessThanOrEqual(1)
      expect(toCamelot(features!.pitchClass, features!.mode)).not.toBeNull()
      expect(features!.keyVersion).toBe(2)
      expect(features!.keyConfidence).toBeGreaterThanOrEqual(0)
      expect(features!.keyConfidence).toBeLessThanOrEqual(1)
    }, 30_000)
  }
})

// ─── Set generator determinism ────────────────────────────────────────────────

describe('generateSet determinism', () => {
  const songs: Song[] = mp3Files.map((file, i): Song => {
    const camelot = ['8A', '8B', '9A', '9B', '7A'][i % 5]
    const energy = 0.4 + (i % 6) * 0.1
    const nameWithoutExt = path.basename(file, '.mp3')
    return {
      file,
      filePath: path.join(MOCK_DIR, file),
      artist: 'Various',
      title: nameWithoutExt,
      bpm: 125,
      key: 'C Major',
      camelot,
      energy,
      genres: ['House'],
      duration: 420,
    }
  })

  const prefs: DJPreferences = {
    setDuration: 60,
    venueType: 'Club',
    audienceAgeRange: 'Mixed',
    audiencePurpose: 'Dancing',
    occasionType: 'Peak time',
    genres: [],
  }

  const curve: CurvePoint[] = [
    { x: 0, y: 0.4 },
    { x: 0.5, y: 0.85 },
    { x: 1, y: 0.6 },
  ]

  it('produces identical results when called twice with the same config', () => {
    const set1 = generateSet(songs, prefs, curve)
    const set2 = generateSet(songs, prefs, curve)
    expect(set1.map(t => t.file)).toEqual(set2.map(t => t.file))
  })

  it('produces identical results with a different curve shape', () => {
    const steadyCurve: CurvePoint[] = [{ x: 0, y: 0.7 }, { x: 1, y: 0.7 }]
    const set1 = generateSet(songs, prefs, steadyCurve)
    const set2 = generateSet(songs, prefs, steadyCurve)
    expect(set1.map(t => t.file)).toEqual(set2.map(t => t.file))
  })

  it('produces identical results with a genre filter', () => {
    const filtered = { ...prefs, genres: ["House"] }
    const set1 = generateSet(songs, filtered, curve)
    const set2 = generateSet(songs, filtered, curve)
    expect(set1.map(t => t.file)).toEqual(set2.map(t => t.file))
  })
})
