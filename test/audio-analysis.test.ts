/**
 * Integration tests using real audio files from test/mock_music/.
 * Filenames contain MixedInKey prefixes: "[KEY] - [ENERGY] - [Title].mp3"
 * e.g. "11A - 7 - Be Free.mp3" → expected camelot 11A, energy 7/10.
 *
 * Key: accept detected == expected (perfect), or harmonically adjacent
 * (compatible / energyBoost), or a recognised near-miss (parallel mode,
 * ±2 same-letter, ±1 diagonal).
 * Energy: detected value (0–1) must be within ±0.15 of the MixedInKey level/10.
 */
import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs'
import { analyzeAudio } from '../src/analyzer'
import { toCamelot } from '../src/camelot'
import { getCamelotCompatibility, parseCamelot } from '../app/lib/camelot'
import { generateSet } from '../app/lib/setGenerator'
import type { Song, DJPreferences, CurvePoint } from '../app/types'

// Camelot → pitch class lookup (same arrays as src/camelot.ts)
const CAMELOT_MAJOR = ['8B','3B','10B','5B','12B','7B','2B','9B','4B','11B','6B','1B']
const CAMELOT_MINOR = ['5A','12A','7A','2A','9A','4A','11A','6A','1A','8A','3A','10A']
function camelotToPitchClass(camelot: string): number {
  const idx = CAMELOT_MAJOR.indexOf(camelot)
  if (idx !== -1) return idx
  return CAMELOT_MINOR.indexOf(camelot)  // -1 if not found
}

const MOCK_DIR = path.resolve(__dirname, 'mock_music')

function extractCamelotFromFilename(filename: string): string | null {
  const match = filename.match(/\b(1[0-2]|[1-9])([AB])\s*-\s*\d/i)
  if (!match) return null
  return `${match[1]}${match[2].toUpperCase()}`
}

function extractEnergyFromFilename(filename: string): number {
  const match = filename.match(/\b(?:1[0-2]|[1-9])[AB]\s*-\s*(\d+)\s*-/i)
  return match ? parseInt(match[1], 10) / 10 : 0.6
}

const mp3Files = fs.existsSync(MOCK_DIR)
  ? fs.readdirSync(MOCK_DIR).filter(f => f.endsWith('.mp3'))
  : []

// ─── Key + energy detection ───────────────────────────────────────────────────

describe('audio analysis (key + energy)', () => {
  if (mp3Files.length === 0) {
    it.skip('no mock audio files in test/mock_music — add real MP3s to enable', () => {})
    return
  }
  for (const file of mp3Files) {
    const expectedCamelot = extractCamelotFromFilename(file)
    if (!expectedCamelot) continue
    const expectedEnergy = extractEnergyFromFilename(file) // MixedInKey level / 10

    it(`${file} → key ${expectedCamelot}, energy ${Math.round(expectedEnergy * 10)}/10`, async () => {
      const filePath = path.join(MOCK_DIR, file)
      const features = await analyzeAudio(filePath)

      expect(features, 'analyzeAudio returned null').not.toBeNull()

      // ── Key ──────────────────────────────────────────────────────────────────
      const detected = toCamelot(features!.pitchClass, features!.mode)
      expect(detected, 'toCamelot returned null').not.toBeNull()

      const compat = getCamelotCompatibility(expectedCamelot, detected!.camelot)
      // Accept near-misses: parallel-mode, ±2 same-letter, ±1 diagonal
      const parsedExp = parseCamelot(expectedCamelot)
      const parsedDet = parseCamelot(detected!.camelot)
      const wheelDiff = (parsedExp && parsedDet)
        ? Math.min(Math.abs(parsedExp.num - parsedDet.num), 12 - Math.abs(parsedExp.num - parsedDet.num))
        : 99
      const parallelMode =
        compat === 'incompatible' &&
        camelotToPitchClass(expectedCamelot) === camelotToPitchClass(detected!.camelot) &&
        camelotToPitchClass(expectedCamelot) !== -1
      const nearAdjacent =
        compat === 'incompatible' && !!parsedExp && !!parsedDet &&
        parsedExp.letter === parsedDet.letter && wheelDiff === 2
      const diagonalNeighbor =
        compat === 'incompatible' && !!parsedExp && !!parsedDet &&
        parsedExp.letter !== parsedDet.letter && wheelDiff === 1
      expect(
        compat !== 'incompatible' || parallelMode || nearAdjacent || diagonalNeighbor,
        `Key: expected ${expectedCamelot}, got ${detected!.camelot} (${compat})`
      ).toBe(true)

      // ── Energy ───────────────────────────────────────────────────────────────
      const energyDiff = Math.abs(features!.energy - expectedEnergy)
      expect(
        energyDiff,
        `Energy: expected ${Math.round(expectedEnergy * 10)}/10 (${expectedEnergy}), ` +
        `got ${(features!.energy * 10).toFixed(1)}/10 (${features!.energy})`
      ).toBeLessThanOrEqual(0.15)
    }, 30_000)
  }
})

// ─── Set generator determinism ────────────────────────────────────────────────

describe('generateSet determinism', () => {
  const songs: Song[] = mp3Files.map((file): Song => {
    const camelot = extractCamelotFromFilename(file) ?? '8B'
    const energy = extractEnergyFromFilename(file)
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
    genre: 'Any',
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
    const filtered = { ...prefs, genre: 'House' }
    const set1 = generateSet(songs, filtered, curve)
    const set2 = generateSet(songs, filtered, curve)
    expect(set1.map(t => t.file)).toEqual(set2.map(t => t.file))
  })
})
