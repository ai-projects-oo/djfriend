// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { generateSet } from '../app/lib/setGenerator'
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
  genre: 'Any',
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
    const set = generateSet(songs, { ...defaultPrefs, genre: 'Techno' }, flatCurve)
    expect(set.every(t => t.genres.some(g => g.toLowerCase().includes('techno')))).toBe(true)
  })

  it('falls back to full library when no songs match genre filter', () => {
    const songs = [makeSong({ file: 'a.mp3', genres: ['Jazz'] })]
    expect(generateSet(songs, { ...defaultPrefs, genre: 'Techno' }, flatCurve).length).toBeGreaterThan(0)
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
