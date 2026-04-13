// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { findCrateGaps, setNeedsCrateSuggestions } from '../app/lib/crateBuilder'
import type { SetTrack, DJPreferences } from '../app/types'

const prefs: DJPreferences = {
  setDuration: 60,
  venueType: 'Club',
  setPhase: 'Peak time',
  genre: 'Techno',
  tagFilters: { vibeTags: [], moodTags: [], vocalTypes: [], venueTags: [], timeOfNightTags: [] },
  addedTimeFilter: 'all',
}

function makeTrack(overrides: Partial<SetTrack> & { file: string }): SetTrack {
  return {
    filePath: overrides.file,
    artist: 'Artist',
    title: 'Title',
    bpm: 130,
    key: 'C Major',
    camelot: '8B',
    energy: 0.7,
    genres: ['Techno'],
    slot: 0,
    targetEnergy: 0.7,
    harmonicWarning: false,
    ...overrides,
  }
}

// ─── setNeedsCrateSuggestions ─────────────────────────────────────────────────

describe('setNeedsCrateSuggestions', () => {
  it('returns false for empty set', () => {
    expect(setNeedsCrateSuggestions([])).toBe(false)
  })

  it('returns false when set is clean', () => {
    const set = [
      makeTrack({ file: 'a.mp3', energy: 0.7, targetEnergy: 0.7, harmonicWarning: false }),
      makeTrack({ file: 'b.mp3', energy: 0.72, targetEnergy: 0.7, harmonicWarning: false }),
    ]
    expect(setNeedsCrateSuggestions(set)).toBe(false)
  })

  it('triggers when harmonic warning rate > 20%', () => {
    const set = [
      makeTrack({ file: 'a.mp3', harmonicWarning: true }),
      makeTrack({ file: 'b.mp3', harmonicWarning: true }),
      makeTrack({ file: 'c.mp3', harmonicWarning: false }),
      makeTrack({ file: 'd.mp3', harmonicWarning: false }),
    ]
    // 2/4 = 50% warning rate — should trigger
    expect(setNeedsCrateSuggestions(set)).toBe(true)
  })

  it('does not trigger at exactly 20% warning rate', () => {
    const set = [
      makeTrack({ file: 'a.mp3', harmonicWarning: true, energy: 0.7, targetEnergy: 0.7 }),
      makeTrack({ file: 'b.mp3', harmonicWarning: false, energy: 0.7, targetEnergy: 0.7 }),
      makeTrack({ file: 'c.mp3', harmonicWarning: false, energy: 0.7, targetEnergy: 0.7 }),
      makeTrack({ file: 'd.mp3', harmonicWarning: false, energy: 0.7, targetEnergy: 0.7 }),
      makeTrack({ file: 'e.mp3', harmonicWarning: false, energy: 0.7, targetEnergy: 0.7 }),
    ]
    // 1/5 = 20% exactly — not > 20%, should not trigger on warnings alone
    expect(setNeedsCrateSuggestions(set)).toBe(false)
  })

  it('triggers when avg energy error > 0.15', () => {
    const set = [
      makeTrack({ file: 'a.mp3', energy: 0.3, targetEnergy: 0.7 }), // error 0.4
      makeTrack({ file: 'b.mp3', energy: 0.7, targetEnergy: 0.7 }), // error 0.0
    ]
    // avg = 0.2 > 0.15
    expect(setNeedsCrateSuggestions(set)).toBe(true)
  })
})

// ─── findCrateGaps ────────────────────────────────────────────────────────────

describe('findCrateGaps', () => {
  it('returns empty array for empty set', () => {
    expect(findCrateGaps([], prefs)).toEqual([])
  })

  it('returns empty array for a clean set', () => {
    const set = [
      makeTrack({ file: 'a.mp3', energy: 0.7, targetEnergy: 0.7, harmonicWarning: false }),
      makeTrack({ file: 'b.mp3', energy: 0.72, targetEnergy: 0.7, harmonicWarning: false }),
    ]
    expect(findCrateGaps(set, prefs)).toHaveLength(0)
  })

  it('flags tracks with harmonicWarning', () => {
    const set = [
      makeTrack({ file: 'a.mp3', slot: 0, harmonicWarning: false }),
      makeTrack({ file: 'b.mp3', slot: 1, harmonicWarning: true }),
    ]
    const gaps = findCrateGaps(set, prefs)
    expect(gaps.length).toBe(1)
  })

  it('flags tracks with large energy deviation', () => {
    const set = [
      makeTrack({ file: 'a.mp3', slot: 0, energy: 0.3, targetEnergy: 0.8 }),
    ]
    const gaps = findCrateGaps(set, prefs)
    expect(gaps.length).toBe(1)
    expect(gaps[0].targetEnergy).toBeCloseTo(0.8)
  })

  it('does not flag tracks with small energy deviation', () => {
    const set = [
      makeTrack({ file: 'a.mp3', slot: 0, energy: 0.7, targetEnergy: 0.75, harmonicWarning: false }),
    ]
    expect(findCrateGaps(set, prefs)).toHaveLength(0)
  })

  it('includes BPM range centred on previous track', () => {
    const set = [
      makeTrack({ file: 'a.mp3', slot: 0, bpm: 132, harmonicWarning: false }),
      makeTrack({ file: 'b.mp3', slot: 1, bpm: 128, harmonicWarning: true }),
    ]
    const gaps = findCrateGaps(set, prefs)
    expect(gaps[0].bpmRange.min).toBe(128) // pivot is prev track bpm = 132 − 4
    expect(gaps[0].bpmRange.max).toBe(136) // 132 + 4
  })

  it('includes compatible camelot keys', () => {
    const set = [
      makeTrack({ file: 'a.mp3', slot: 0, camelot: '8B', harmonicWarning: false }),
      makeTrack({ file: 'b.mp3', slot: 1, camelot: '3A', harmonicWarning: true }),
    ]
    const gaps = findCrateGaps(set, prefs)
    // Compatible keys for 8B: 7B, 9B, 8A
    expect(gaps[0].camelotNeeded).toContain('7B')
    expect(gaps[0].camelotNeeded).toContain('9B')
    expect(gaps[0].camelotNeeded).toContain('8A')
  })

  it('includes genre in suggestedSearch when prefs.genre is set', () => {
    const set = [makeTrack({ file: 'a.mp3', slot: 0, harmonicWarning: true })]
    const gaps = findCrateGaps(set, prefs)
    expect(gaps[0].suggestedSearch).toContain('Techno')
  })

  it('setPosition is 0.5 for a single-track set', () => {
    const set = [makeTrack({ file: 'a.mp3', slot: 0, harmonicWarning: true })]
    expect(findCrateGaps(set, prefs)[0].setPosition).toBe(0.5)
  })

  it('setPosition is 0 for first slot and 1 for last in multi-track set', () => {
    const set = [
      makeTrack({ file: 'a.mp3', slot: 0, harmonicWarning: true }),
      makeTrack({ file: 'b.mp3', slot: 1, harmonicWarning: false }),
      makeTrack({ file: 'c.mp3', slot: 2, harmonicWarning: true }),
    ]
    const gaps = findCrateGaps(set, prefs)
    expect(gaps[0].setPosition).toBe(0)
    expect(gaps[1].setPosition).toBe(1)
  })
})
