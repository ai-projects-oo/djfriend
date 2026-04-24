// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { computePlayStats, familiarityScore } from '../app/lib/historyStats'
import type { HistoryEntry, DJPreferences, SetTrack, CurvePoint } from '../app/types'

const basePart: Omit<DJPreferences, 'venueType'> = {
  setDuration: 60,
  setPhase: 'Peak time',
  genres: [],
  tagFilters: { vibeTags: [], moodTags: [], vocalTypes: [], venueTags: [], timeOfNightTags: [] },
  dateFilter: { field: 'dateAdded' as const, preset: 'all' as const },
}

function makeTrack(file: string, slot: number): SetTrack {
  return {
    file,
    filePath: file,
    artist: 'Artist',
    title: 'Title',
    bpm: 128,
    key: 'C Major',
    camelot: '8B',
    energy: 0.7,
    genres: [],
    slot,
    targetEnergy: 0.7,
    harmonicWarning: false,
  }
}

function makeEntry(id: string, files: string[], venueType: string, timestamp: number): HistoryEntry {
  return {
    id,
    name: `Set ${id}`,
    timestamp,
    tracks: files.map((f, i) => makeTrack(f, i)),
    prefs: { ...basePart, venueType: venueType as DJPreferences['venueType'] },
    curve: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] as CurvePoint[],
  }
}

// ─── computePlayStats ─────────────────────────────────────────────────────────

describe('computePlayStats', () => {
  it('returns zero playCount for a track not in history', () => {
    const stats = computePlayStats([], 'missing.mp3')
    expect(stats.playCount).toBe(0)
    expect(stats.lastPlayed).toBe('')
  })

  it('counts appearances across multiple sets', () => {
    const history = [
      makeEntry('1', ['a.mp3', 'b.mp3'], 'Club', 1000),
      makeEntry('2', ['b.mp3', 'c.mp3'], 'Bar', 2000),
      makeEntry('3', ['b.mp3'], 'Festival', 3000),
    ]
    const stats = computePlayStats(history, 'b.mp3')
    expect(stats.playCount).toBe(3)
  })

  it('records the most recent timestamp as lastPlayed', () => {
    const history = [
      makeEntry('1', ['a.mp3'], 'Club', 1_000_000),
      makeEntry('2', ['a.mp3'], 'Club', 2_000_000),
    ]
    const stats = computePlayStats(history, 'a.mp3')
    expect(stats.lastPlayed).toBe(new Date(2_000_000 * 1000).toISOString().slice(0, 10))
  })

  it('computes avgSetPosition correctly', () => {
    // Track is at index 0 in a 3-track set → position 0/2 = 0
    const history = [makeEntry('1', ['a.mp3', 'b.mp3', 'c.mp3'], 'Club', 1000)]
    expect(computePlayStats(history, 'a.mp3').avgSetPosition).toBeCloseTo(0)
    expect(computePlayStats(history, 'c.mp3').avgSetPosition).toBeCloseTo(1)
    expect(computePlayStats(history, 'b.mp3').avgSetPosition).toBeCloseTo(0.5)
  })

  it('collects unique venue types', () => {
    const history = [
      makeEntry('1', ['x.mp3'], 'Club', 1000),
      makeEntry('2', ['x.mp3'], 'Club', 2000),
      makeEntry('3', ['x.mp3'], 'Festival', 3000),
    ]
    const stats = computePlayStats(history, 'x.mp3')
    expect(stats.setTypes).toContain('Club')
    expect(stats.setTypes).toContain('Festival')
    expect(stats.setTypes.length).toBe(2)
  })

  it('handles single-track sets without crashing (avgSetPosition = 0.5)', () => {
    const history = [makeEntry('1', ['solo.mp3'], 'Bar', 1000)]
    expect(computePlayStats(history, 'solo.mp3').avgSetPosition).toBe(0.5)
  })
})

// ─── familiarityScore ─────────────────────────────────────────────────────────

describe('familiarityScore', () => {
  it('returns 0.5 for 0 plays (neutral)', () => {
    expect(familiarityScore(0)).toBe(0.5)
  })

  it('returns 1.0 at the sweet spot (3–6 plays)', () => {
    expect(familiarityScore(3)).toBeCloseTo(1.0)
    expect(familiarityScore(4)).toBeCloseTo(1.0)
    expect(familiarityScore(6)).toBeCloseTo(1.0)
  })

  it('returns 0.3 for 10+ plays (overplay penalty)', () => {
    expect(familiarityScore(10)).toBe(0.3)
    expect(familiarityScore(50)).toBe(0.3)
  })

  it('rises monotonically from 0 to 3 plays', () => {
    expect(familiarityScore(1)).toBeGreaterThan(familiarityScore(0))
    expect(familiarityScore(2)).toBeGreaterThan(familiarityScore(1))
    expect(familiarityScore(3)).toBeGreaterThan(familiarityScore(2))
  })

  it('falls monotonically from 6 to 10 plays', () => {
    expect(familiarityScore(7)).toBeLessThan(familiarityScore(6))
    expect(familiarityScore(8)).toBeLessThan(familiarityScore(7))
    expect(familiarityScore(9)).toBeLessThan(familiarityScore(8))
    expect(familiarityScore(10)).toBeLessThan(familiarityScore(9))
  })

  it('all values stay in 0.3–1.0 range', () => {
    for (let i = 0; i <= 15; i++) {
      const s = familiarityScore(i)
      expect(s).toBeGreaterThanOrEqual(0.3)
      expect(s).toBeLessThanOrEqual(1.0)
    }
  })
})
