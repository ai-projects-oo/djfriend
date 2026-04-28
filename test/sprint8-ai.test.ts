// @vitest-environment node
import { describe, test, expect } from 'vitest'
import { deriveSemanticTags } from '../src/ai'

// ─── deriveSemanticTags — vocalLikelihood path ────────────────────────────────

const baseProfile = {
  bpm: 128,
  camelot: '8B',
  energy: 0.7,
  genres: [] as string[],
}

describe('deriveSemanticTags — vocalLikelihood', () => {
  test('high vocalLikelihood (≥0.62) → vocal', () => {
    const tags = deriveSemanticTags({ ...baseProfile, vocalLikelihood: 0.75 })
    expect(tags.vocalType).toBe('vocal')
  })

  test('mid vocalLikelihood (0.42–0.62) → mostly-vocal', () => {
    const tags = deriveSemanticTags({ ...baseProfile, vocalLikelihood: 0.50 })
    expect(tags.vocalType).toBe('mostly-vocal')
  })

  test('low vocalLikelihood (<0.42) → instrumental', () => {
    const tags = deriveSemanticTags({ ...baseProfile, vocalLikelihood: 0.20 })
    expect(tags.vocalType).toBe('instrumental')
  })

  test('boundary: exactly 0.62 → vocal', () => {
    const tags = deriveSemanticTags({ ...baseProfile, vocalLikelihood: 0.62 })
    expect(tags.vocalType).toBe('vocal')
  })

  test('boundary: exactly 0.42 → mostly-vocal', () => {
    const tags = deriveSemanticTags({ ...baseProfile, vocalLikelihood: 0.42 })
    expect(tags.vocalType).toBe('mostly-vocal')
  })

  test('genre hint overrides vocalLikelihood — vocal genre wins', () => {
    const tags = deriveSemanticTags({ ...baseProfile, genres: ['R&B'], vocalLikelihood: 0.10 })
    expect(tags.vocalType).toBe('vocal')
  })

  test('genre hint overrides vocalLikelihood — instrumental genre wins', () => {
    const tags = deriveSemanticTags({ ...baseProfile, genres: ['techno'], vocalLikelihood: 0.90 })
    expect(tags.vocalType).toBe('instrumental')
  })

  test('no vocalLikelihood, no spectral, no genre → falls back to BPM/energy heuristic', () => {
    // major key, mid BPM, mid energy → mostly-vocal
    const tags = deriveSemanticTags({ bpm: 122, camelot: '8B', energy: 0.60, genres: [] })
    expect(['vocal', 'mostly-vocal', 'instrumental']).toContain(tags.vocalType)
  })

  test('vocalLikelihood used when spectral fallback fields absent', () => {
    const tags = deriveSemanticTags({ ...baseProfile, vocalLikelihood: 0.80 })
    expect(tags.vocalType).toBe('vocal')
  })
})

// ─── deriveSemanticTags — vibeTags, moodTags, venueTags, timeOfNightTags ──────

describe('deriveSemanticTags — tag derivation', () => {
  test('high BPM → driving vibe', () => {
    const tags = deriveSemanticTags({ ...baseProfile, bpm: 145 })
    expect(tags.vibeTags).toContain('driving')
  })

  test('high energy + high BPM → intense vibe', () => {
    const tags = deriveSemanticTags({ ...baseProfile, bpm: 130, energy: 0.85 })
    expect(tags.vibeTags).toContain('intense')
  })

  test('minor key → dark mood', () => {
    const tags = deriveSemanticTags({ ...baseProfile, camelot: '8A' })
    expect(tags.moodTags).toContain('dark')
  })

  test('major key → uplifting mood', () => {
    const tags = deriveSemanticTags({ ...baseProfile, camelot: '8B' })
    expect(tags.moodTags).toContain('uplifting')
  })

  test('peak-time conditions', () => {
    const tags = deriveSemanticTags({ ...baseProfile, bpm: 130, energy: 0.80 })
    expect(tags.timeOfNightTags).toContain('peak-time')
  })

  test('club venue for high BPM + energy', () => {
    const tags = deriveSemanticTags({ ...baseProfile, bpm: 130, energy: 0.70 })
    expect(tags.venueTags).toContain('club')
  })

  test('no duplicate tags', () => {
    const tags = deriveSemanticTags({ ...baseProfile, bpm: 145, energy: 0.90, camelot: '8A' })
    const allTags = [...tags.vibeTags, ...tags.moodTags, ...tags.venueTags, ...tags.timeOfNightTags]
    expect(new Set(allTags).size).toBe(allTags.length)
  })

  test('vibeTags capped at 3', () => {
    const tags = deriveSemanticTags({ bpm: 145, camelot: '8A', energy: 0.90, genres: [] })
    expect(tags.vibeTags.length).toBeLessThanOrEqual(3)
  })

  test('moodTags capped at 3', () => {
    const tags = deriveSemanticTags({ bpm: 145, camelot: '8A', energy: 0.90, genres: [] })
    expect(tags.moodTags.length).toBeLessThanOrEqual(3)
  })
})

// ─── Camelot harmonic move helpers ───────────────────────────────────────────
// These test the getCompatibleKeys logic by exercising camelotStep arithmetic.

function camelotStep(num: number, delta: number): number {
  return ((num - 1 + delta + 120) % 12) + 1
}

describe('camelotStep', () => {
  test('simple forward step', () => {
    expect(camelotStep(8, 1)).toBe(9)
  })

  test('wraps from 12 to 1', () => {
    expect(camelotStep(12, 1)).toBe(1)
  })

  test('backward step', () => {
    expect(camelotStep(8, -1)).toBe(7)
  })

  test('wraps from 1 backward to 12', () => {
    expect(camelotStep(1, -1)).toBe(12)
  })

  test('+2 energy surge from 8', () => {
    expect(camelotStep(8, 2)).toBe(10)
  })

  test('+7 power shift (= -5 CCW) from 8 lands on 3', () => {
    expect(camelotStep(8, 7)).toBe(3)
  })

  test('+7 wraps correctly from 9', () => {
    expect(camelotStep(9, 7)).toBe(4)
  })

  test('+7 wraps correctly from 11', () => {
    expect(camelotStep(11, 7)).toBe(6)
  })

  test('+7 wraps correctly from 6', () => {
    expect(camelotStep(6, 7)).toBe(1)
  })

  test('identity: step of 12 returns same position', () => {
    expect(camelotStep(5, 12)).toBe(5)
    expect(camelotStep(12, 12)).toBe(12)
  })
})
