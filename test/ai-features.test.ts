// @vitest-environment jsdom
import { describe, test, expect } from 'vitest'
import { generateSet } from '../app/lib/setGenerator'
import type { Song, DJPreferences, CurvePoint } from '../app/types/index'

// SemanticTags will be added to app/types/index.ts by the frontend agent.
// Until then, we declare it here so this file compiles independently.
interface SemanticTags {
  vibeTags: string[]
  moodTags: string[]
  vocalType: 'instrumental' | 'vocal' | 'mixed'
  venueTags: string[]
  timeOfNightTags: string[]
}

// Extend Song locally to include the upcoming semanticTags field.
// Once the frontend agent merges SemanticTags into app/types/index.ts and adds
// the field to Song, this augmentation can be removed.
type SongWithTags = Song & { semanticTags?: SemanticTags }

function makeSong(overrides: Partial<SongWithTags> & { file: string }): SongWithTags {
  return {
    file: overrides.file,
    filePath: overrides.file,
    artist: 'Test Artist',
    title: 'Test Track',
    bpm: 128,
    key: 'A Major',
    camelot: '11B',
    energy: 0.7,
    genres: [],
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

const flatCurve: CurvePoint[] = [{ x: 0, y: 0.7 }, { x: 1, y: 0.7 }]

// ─── Suite 1: SemanticTags type validation ─────────────────────────────────────

describe('SemanticTags type validation', () => {
  test('song without semanticTags still works in generateSet', () => {
    const song = makeSong({ file: 'no-tags.mp3' })
    expect(song.semanticTags).toBeUndefined()
    const result = generateSet([song] as Song[], defaultPrefs, flatCurve)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].file).toBe('no-tags.mp3')
  })

  test('song with semanticTags is accepted and returned without modification', () => {
    const tags: SemanticTags = {
      vibeTags: ['euphoric'],
      moodTags: ['uplifting'],
      vocalType: 'instrumental',
      venueTags: ['club'],
      timeOfNightTags: ['peak-time'],
    }
    const song = makeSong({ file: 'tagged.mp3', semanticTags: tags })
    expect(song.semanticTags).toEqual(tags)
    const result = generateSet([song] as Song[], defaultPrefs, flatCurve)
    expect(result.length).toBeGreaterThan(0)
    const returned = result[0] as SongWithTags
    // semanticTags should be spread through untouched
    expect(returned.semanticTags).toEqual(tags)
  })

  test('mix of tagged and untagged songs works without crashing', () => {
    const tagged = makeSong({
      file: 'tagged.mp3',
      semanticTags: {
        vibeTags: ['groovy'],
        moodTags: [],
        vocalType: 'vocal',
        venueTags: ['bar'],
        timeOfNightTags: ['warm-up'],
      },
    })
    const untagged = makeSong({ file: 'untagged.mp3' })
    const result = generateSet([tagged, untagged] as Song[], defaultPrefs, flatCurve)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── Suite 2: Semantic affinity bonus ──────────────────────────────────────────

describe('Semantic affinity bonus', () => {
  // These tests verify the *expected* behavior once semanticAffinityBonus is
  // wired into generateSet by the frontend agent (Story 1.1). They may fail
  // until that work is merged — that is intentional.

  test('prefers club-tagged track over untagged track for Club/Peak time venue', () => {
    // Both tracks have identical camelot, BPM, and energy so harmonic and BPM
    // scores cancel out. Only the semantic affinity bonus can break the tie.
    const clubTagged = makeSong({
      file: 'club-tagged.mp3',
      camelot: '8B',
      bpm: 128,
      energy: 0.7,
      semanticTags: {
        vibeTags: ['energetic'],
        moodTags: [],
        vocalType: 'instrumental',
        venueTags: ['club'],
        timeOfNightTags: ['peak-time'],
      },
    })
    const notTagged = makeSong({
      file: 'not-tagged.mp3',
      camelot: '8B',
      bpm: 128,
      energy: 0.7,
    })

    const prefs: DJPreferences = {
      ...defaultPrefs,
      venueType: 'Club',
      occasionType: 'Peak time',
      audiencePurpose: 'Dancing',
      setDuration: 10,
    }

    const result = generateSet([clubTagged, notTagged] as Song[], prefs, flatCurve)
    // The first picked song should be the club-tagged one when semantic bonus is active
    expect(result[0].file).toBe('club-tagged.mp3')
  })

  test('fallback: songs without semanticTags are still selected normally', () => {
    const songs = Array.from({ length: 5 }, (_, i) =>
      makeSong({ file: `track-${i}.mp3`, energy: 0.7, bpm: 128 }),
    )
    // No semanticTags on any song — generator must not crash and must return results
    const result = generateSet(songs as Song[], defaultPrefs, flatCurve)
    expect(result.length).toBeGreaterThan(0)
  })

  test('peak-time tag boosts score for Peak time occasion', () => {
    // Track A has peak-time tag; Track B does not. Identical everything else.
    const peakTagged = makeSong({
      file: 'peak-tagged.mp3',
      camelot: '8B',
      bpm: 130,
      energy: 0.75,
      semanticTags: {
        vibeTags: [],
        moodTags: [],
        vocalType: 'instrumental',
        venueTags: ['club'],
        timeOfNightTags: ['peak-time'],
      },
    })
    const noTag = makeSong({
      file: 'no-peak-tag.mp3',
      camelot: '8B',
      bpm: 130,
      energy: 0.75,
    })

    const prefs: DJPreferences = {
      ...defaultPrefs,
      occasionType: 'Peak time',
      setDuration: 10,
    }

    const curve: CurvePoint[] = [{ x: 0, y: 0.75 }, { x: 1, y: 0.75 }]
    const result = generateSet([peakTagged, noTag] as Song[], prefs, curve)
    expect(result[0].file).toBe('peak-tagged.mp3')
  })
})

// ─── Suite 3: Enrichment skip logic (pure unit test) ───────────────────────────

describe('Enrichment skip logic', () => {
  // Pure unit test — no API calls. Mirrors the filter inside enrichTracks.
  function getTracksToEnrich(
    resultsMap: Record<string, { semanticTags?: unknown }>,
  ): [string, { semanticTags?: unknown }][] {
    return Object.entries(resultsMap).filter(([, song]) => !song.semanticTags)
  }

  test('skips already-tagged tracks', () => {
    const map: Record<string, { semanticTags?: SemanticTags }> = {
      'track-a.mp3': {
        semanticTags: {
          vibeTags: ['euphoric'],
          moodTags: [],
          vocalType: 'instrumental',
          venueTags: ['club'],
          timeOfNightTags: ['peak-time'],
        },
      },
      'track-b.mp3': {},
    }
    const toEnrich = getTracksToEnrich(map)
    expect(toEnrich).toHaveLength(1)
    expect(toEnrich[0][0]).toBe('track-b.mp3')
  })

  test('returns all tracks when none are tagged', () => {
    const map: Record<string, { semanticTags?: SemanticTags }> = {
      'a.mp3': {},
      'b.mp3': {},
      'c.mp3': {},
    }
    const toEnrich = getTracksToEnrich(map)
    expect(toEnrich).toHaveLength(3)
  })

  test('returns empty list when all tracks are already tagged', () => {
    const tag: SemanticTags = {
      vibeTags: ['dark'],
      moodTags: ['intense'],
      vocalType: 'instrumental',
      venueTags: ['club'],
      timeOfNightTags: ['peak-time'],
    }
    const map: Record<string, { semanticTags?: SemanticTags }> = {
      'x.mp3': { semanticTags: tag },
      'y.mp3': { semanticTags: tag },
    }
    const toEnrich = getTracksToEnrich(map)
    expect(toEnrich).toHaveLength(0)
  })

  test('handles empty results map', () => {
    const map: Record<string, { semanticTags?: SemanticTags }> = {}
    const toEnrich = getTracksToEnrich(map)
    expect(toEnrich).toHaveLength(0)
  })

  test('partial tagging: only untagged tracks are returned', () => {
    const tag: SemanticTags = {
      vibeTags: [],
      moodTags: [],
      vocalType: 'vocal',
      venueTags: ['bar'],
      timeOfNightTags: ['warm-up'],
    }
    const map: Record<string, { semanticTags?: SemanticTags }> = {
      'tagged-1.mp3': { semanticTags: tag },
      'untagged-1.mp3': {},
      'tagged-2.mp3': { semanticTags: tag },
      'untagged-2.mp3': {},
    }
    const toEnrich = getTracksToEnrich(map)
    expect(toEnrich).toHaveLength(2)
    const keys = toEnrich.map(([k]) => k)
    expect(keys).toContain('untagged-1.mp3')
    expect(keys).toContain('untagged-2.mp3')
  })
})
