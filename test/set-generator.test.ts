// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { generateSet } from '../app/lib/setGenerator'
import { isCamelotClockwise } from '../app/lib/camelot'
import type { Song, DJPreferences, CurvePoint } from '../app/types'

function makeSong(overrides: Partial<Song> & { file: string }): Song {
  return {
    filePath: overrides.file,
    artist: 'Artist',
    title: 'Title',
    bpm: 128,
    key: 'C Major',
    camelot: '8B',
    energy: 0.7,
    genres: ['House'],
    duration: 210,
    ...overrides,
  }
}

const defaultPrefs: DJPreferences = {
  setDuration: 60,
  venueType: 'Club',
  audienceAgeRange: 'Mixed',
  audiencePurpose: 'Dancing',
  occasionType: 'Peak time',
  genres: [],
}

const flatCurve: CurvePoint[] = [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]

describe('generateSet', () => {
  it('returns empty array for empty library', () => {
    expect(generateSet([], defaultPrefs, flatCurve)).toEqual([])
  })

  it('never repeats the same song', () => {
    const songs = Array.from({ length: 10 }, (_, i) => makeSong({ file: `track${i}.mp3` }))
    const set = generateSet(songs, defaultPrefs, flatCurve)
    const files = set.map(t => t.file)
    expect(new Set(files).size).toBe(files.length)
  })

  it('longer set duration produces more tracks', () => {
    const songs = Array.from({ length: 30 }, (_, i) => makeSong({ file: `track${i}.mp3` }))
    const short = generateSet(songs, { ...defaultPrefs, setDuration: 30 }, flatCurve)
    const long = generateSet(songs, { ...defaultPrefs, setDuration: 90 }, flatCurve)
    expect(long.length).toBeGreaterThan(short.length)
  })

  it('does not exceed the number of available songs', () => {
    const songs = [makeSong({ file: 'a.mp3' }), makeSong({ file: 'b.mp3' })]
    const set = generateSet(songs, { ...defaultPrefs, setDuration: 240 }, flatCurve)
    expect(set.length).toBeLessThanOrEqual(2)
  })

  it('first track never has a harmonic warning', () => {
    const songs = Array.from({ length: 5 }, (_, i) =>
      makeSong({ file: `track${i}.mp3`, camelot: i % 2 === 0 ? '8B' : '3A' })
    )
    expect(generateSet(songs, defaultPrefs, flatCurve)[0].harmonicWarning).toBe(false)
  })

  it('filters by genre when set', () => {
    const songs = [
      makeSong({ file: 'techno.mp3', genres: ['Techno'] }),
      makeSong({ file: 'jazz.mp3', genres: ['Jazz'] }),
    ]
    const set = generateSet(songs, { ...defaultPrefs, genres: ["Techno"] }, flatCurve)
    expect(set.every(t => t.genres.some(g => g.toLowerCase().includes('techno')))).toBe(true)
  })

  it('falls back to full library when no songs match genre filter', () => {
    const songs = [makeSong({ file: 'a.mp3', genres: ['Jazz'] })]
    expect(generateSet(songs, { ...defaultPrefs, genres: ["Techno"] }, flatCurve).length).toBeGreaterThan(0)
  })

  it('prefers harmonically compatible tracks over incompatible ones', () => {
    const songs = [
      makeSong({ file: 'first.mp3', camelot: '8B', energy: 0.5 }),
      makeSong({ file: 'compatible.mp3', camelot: '9B', energy: 0.5 }),
      makeSong({ file: 'incompatible.mp3', camelot: '3A', energy: 0.5 }),
    ]
    const set = generateSet(songs, { ...defaultPrefs, setDuration: 20 }, flatCurve)
    if (set.length >= 2) expect(set[1].file).not.toBe('incompatible.mp3')
  })
})

// ─── Sprint 02: isCamelotClockwise ────────────────────────────────────────────

describe('isCamelotClockwise', () => {
  it('returns true for +1 clockwise same letter', () => {
    expect(isCamelotClockwise('8A', '9A')).toBe(true)
    expect(isCamelotClockwise('8B', '9B')).toBe(true)
  })

  it('returns true for +1 clockwise with letter switch (diagonal)', () => {
    expect(isCamelotClockwise('8A', '9B')).toBe(true)
    expect(isCamelotClockwise('8B', '9A')).toBe(true)
  })

  it('returns true for wrap-around 12 → 1', () => {
    expect(isCamelotClockwise('12A', '1A')).toBe(true)
    expect(isCamelotClockwise('12B', '1B')).toBe(true)
  })

  it('returns false for counterclockwise (-1)', () => {
    expect(isCamelotClockwise('8A', '7A')).toBe(false)
    expect(isCamelotClockwise('8A', '7B')).toBe(false)
  })

  it('returns false for same key', () => {
    expect(isCamelotClockwise('8A', '8A')).toBe(false)
  })

  it('returns false for 2+ steps', () => {
    expect(isCamelotClockwise('8A', '10A')).toBe(false)
  })

  it('returns false for invalid input', () => {
    expect(isCamelotClockwise('invalid', '9A')).toBe(false)
  })
})

// ─── Sprint 02: slope-aware energy boost in generator ─────────────────────────

describe('slope-aware clockwise bonus', () => {
  it('on a rising curve prefers clockwise camelot move over counterclockwise', () => {
    // Curve rises from 0.3 → 0.8: slot 0 target ~0.3, slot 1 target ~0.8
    const risingCurve: CurvePoint[] = [{ x: 0, y: 0.3 }, { x: 1, y: 0.8 }]
    const songs = [
      // First track is 8A at energy 0.3
      makeSong({ file: 'first.mp3', camelot: '8A', energy: 0.3, bpm: 128 }),
      // Clockwise from 8A = 9A (or 9B)
      makeSong({ file: 'clockwise.mp3', camelot: '9A', energy: 0.8, bpm: 128 }),
      // Counterclockwise from 8A = 7A
      makeSong({ file: 'counter.mp3', camelot: '7A', energy: 0.8, bpm: 128 }),
    ]
    const set = generateSet(songs, { ...defaultPrefs, setDuration: 15 }, risingCurve)
    if (set.length >= 2) {
      // Both are harmonically compatible (±1 same letter); clockwise should win due to bonus
      expect(set[1].file).toBe('clockwise.mp3')
    }
  })

  it('on a flat curve does not systematically prefer clockwise', () => {
    // With flat curve, both tracks have identical harmonic scores — jitter decides
    // Just assert no crash and both are valid picks
    const songs = [
      makeSong({ file: 'first.mp3', camelot: '8A', energy: 0.5, bpm: 128 }),
      makeSong({ file: 'clockwise.mp3', camelot: '9A', energy: 0.5, bpm: 128 }),
      makeSong({ file: 'counter.mp3', camelot: '7A', energy: 0.5, bpm: 128 }),
    ]
    const set = generateSet(songs, { ...defaultPrefs, setDuration: 15 }, flatCurve)
    expect(set.length).toBeGreaterThan(0)
  })
})

// ─── Phase 6: selectionReason ─────────────────────────────────────────────────

describe('selectionReason', () => {
  it('populates selectionReason on every SetTrack', () => {
    const songs = Array.from({ length: 5 }, (_, i) =>
      makeSong({ file: `track${i}.mp3`, camelot: '8B', energy: 0.5 + i * 0.05 })
    )
    const set = generateSet(songs, defaultPrefs, flatCurve)
    for (const track of set) {
      expect(track.selectionReason).toBeDefined()
      expect(Array.isArray(track.selectionReason)).toBe(true)
    }
  })

  it('includes energy info in selectionReason', () => {
    const songs = [makeSong({ file: 'a.mp3', energy: 0.5 })]
    const set = generateSet(songs, { ...defaultPrefs, setDuration: 10 }, flatCurve)
    const reasons = set[0].selectionReason ?? []
    expect(reasons.some(r => r.text.toLowerCase().includes('energy'))).toBe(true)
  })

  it('includes harmonic info when a previous track exists', () => {
    const songs = [
      makeSong({ file: 'first.mp3', camelot: '8B', energy: 0.5 }),
      makeSong({ file: 'second.mp3', camelot: '9B', energy: 0.5 }),
    ]
    const set = generateSet(songs, { ...defaultPrefs, setDuration: 15 }, flatCurve)
    if (set.length >= 2) {
      const reasons = set[1].selectionReason ?? []
      expect(reasons.some(r => r.text.toLowerCase().includes('key'))).toBe(true)
    }
  })

  it('first track has no key transition reason (no previous track)', () => {
    const songs = [makeSong({ file: 'first.mp3', camelot: '8B', energy: 0.5 })]
    const set = generateSet(songs, { ...defaultPrefs, setDuration: 10 }, flatCurve)
    const reasons = set[0].selectionReason ?? []
    expect(reasons.some(r => r.text.toLowerCase().includes('key'))).toBe(false)
  })
})

// ─── Phase 2: energyProfile transition score ──────────────────────────────────

describe('energyProfile transition score', () => {
  it('prefers a track whose intro matches the previous track outro', () => {
    // prev track has a loud outro (0.9); candidate A has matching intro (0.9),
    // candidate B has mismatching intro (0.2) — A should be preferred.
    const songs = [
      makeSong({ file: 'prev.mp3', camelot: '8B', energy: 0.7,
        energyProfile: { intro: 0.5, body: 0.7, peak: 0.9, outro: 0.9, variance: 0.1, dropStrength: 0 } }),
      makeSong({ file: 'match.mp3', camelot: '8B', energy: 0.7,
        energyProfile: { intro: 0.9, body: 0.7, peak: 0.9, outro: 0.7, variance: 0.1, dropStrength: 0 } }),
      makeSong({ file: 'mismatch.mp3', camelot: '8B', energy: 0.7,
        energyProfile: { intro: 0.2, body: 0.7, peak: 0.8, outro: 0.5, variance: 0.1, dropStrength: 0 } }),
    ]
    const set = generateSet(songs, { ...defaultPrefs, setDuration: 15 }, flatCurve)
    if (set.length >= 2) {
      expect(set[1].file).toBe('match.mp3')
    }
  })

  it('falls back gracefully when energyProfile is absent', () => {
    // No energyProfile on any track — should not throw and should still produce a set
    const songs = Array.from({ length: 5 }, (_, i) =>
      makeSong({ file: `track${i}.mp3`, energy: 0.5 + i * 0.05 })
    )
    expect(() => generateSet(songs, defaultPrefs, flatCurve)).not.toThrow()
    expect(generateSet(songs, defaultPrefs, flatCurve).length).toBeGreaterThan(0)
  })

  it('sets energyProfile on output SetTrack when input Song has it', () => {
    const profile = { intro: 0.4, body: 0.7, peak: 0.9, outro: 0.6, variance: 0.1, dropStrength: 0.2 }
    const songs = [makeSong({ file: 'a.mp3', energyProfile: profile })]
    const set = generateSet(songs, { ...defaultPrefs, setDuration: 10 }, flatCurve)
    expect(set[0].energyProfile).toEqual(profile)
  })
})
