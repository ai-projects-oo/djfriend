// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { parseCamelot, getCamelotCompatibility, camelotHarmonyScore, getTransitionLabel } from '../app/lib/camelot'

describe('parseCamelot', () => {
  it('parses valid key "8B"', () => {
    expect(parseCamelot('8B')).toEqual({ num: 8, letter: 'B' })
  })

  it('is case-insensitive', () => {
    expect(parseCamelot('5a')).toEqual({ num: 5, letter: 'A' })
  })

  it('trims whitespace', () => {
    expect(parseCamelot('  12A  ')).toEqual({ num: 12, letter: 'A' })
  })

  it('returns null for out-of-range number', () => {
    expect(parseCamelot('0A')).toBeNull()
    expect(parseCamelot('13A')).toBeNull()
  })

  it('returns null for invalid format', () => {
    expect(parseCamelot('C Major')).toBeNull()
    expect(parseCamelot('8C')).toBeNull()
    expect(parseCamelot('')).toBeNull()
  })
})

describe('getCamelotCompatibility', () => {
  it('returns "perfect" for identical keys', () => {
    expect(getCamelotCompatibility('8B', '8B')).toBe('perfect')
  })

  it('returns "compatible" for ±1 position, same letter', () => {
    expect(getCamelotCompatibility('8B', '9B')).toBe('compatible')
    expect(getCamelotCompatibility('8B', '7B')).toBe('compatible')
  })

  it('returns "compatible" for same number, different letter (relative major/minor)', () => {
    expect(getCamelotCompatibility('8B', '8A')).toBe('compatible')
    expect(getCamelotCompatibility('5A', '5B')).toBe('compatible')
  })

  it('returns "compatible" for wrap-around 12↔1', () => {
    expect(getCamelotCompatibility('12A', '1A')).toBe('compatible')
    expect(getCamelotCompatibility('1B', '12B')).toBe('compatible')
  })

  it('returns "energyBoost" for ±1 with letter switch (diagonal)', () => {
    expect(getCamelotCompatibility('8A', '9B')).toBe('energyBoost')
    expect(getCamelotCompatibility('8A', '7B')).toBe('energyBoost')
    expect(getCamelotCompatibility('8B', '9A')).toBe('energyBoost')
    expect(getCamelotCompatibility('8B', '7A')).toBe('energyBoost')
  })

  it('returns "energyBoost" for diagonal wrap-around', () => {
    expect(getCamelotCompatibility('12A', '1B')).toBe('energyBoost')
    expect(getCamelotCompatibility('1B', '12A')).toBe('energyBoost')
  })

  it('returns "energyBoost2" for clockwise +2 same letter', () => {
    expect(getCamelotCompatibility('8A', '10A')).toBe('energyBoost2')
    expect(getCamelotCompatibility('8B', '10B')).toBe('energyBoost2')
    expect(getCamelotCompatibility('11A', '1A')).toBe('energyBoost2')  // wrap-around
    expect(getCamelotCompatibility('5A', '7A')).toBe('energyBoost2')
  })

  it('returns "arminBoost" for counterclockwise -5 same letter', () => {
    expect(getCamelotCompatibility('8A', '3A')).toBe('arminBoost')
    expect(getCamelotCompatibility('12A', '7A')).toBe('arminBoost')
    expect(getCamelotCompatibility('1A', '8A')).toBe('arminBoost')   // wrap-around
    expect(getCamelotCompatibility('5B', '12B')).toBe('arminBoost')
  })

  it('returns "incompatible" for unrecognized intervals', () => {
    expect(getCamelotCompatibility('8B', '6A')).toBe('incompatible')
    expect(getCamelotCompatibility('8B', '4B')).toBe('incompatible')  // -4, not a named transition
  })

  it('returns "incompatible" for invalid input', () => {
    expect(getCamelotCompatibility('invalid', '8B')).toBe('incompatible')
  })
})

describe('camelotHarmonyScore', () => {
  it('returns 1.0 for perfect match', () => {
    expect(camelotHarmonyScore('8B', '8B')).toBe(1.0)
  })

  it('returns 1.0 for compatible (±1 same letter)', () => {
    expect(camelotHarmonyScore('8B', '9B')).toBe(1.0)
    expect(camelotHarmonyScore('8B', '7B')).toBe(1.0)
  })

  it('returns 1.0 for compatible (relative major/minor)', () => {
    expect(camelotHarmonyScore('8B', '8A')).toBe(1.0)
  })

  it('returns 0.75 for energy boost (diagonal ±1 with letter switch)', () => {
    expect(camelotHarmonyScore('8A', '9B')).toBe(0.75)
    expect(camelotHarmonyScore('8A', '7B')).toBe(0.75)
  })

  it('returns 0.87 for Energy Boost +2 (same letter, clockwise +2)', () => {
    expect(camelotHarmonyScore('8A', '10A')).toBe(0.87)
    expect(camelotHarmonyScore('5B', '7B')).toBe(0.87)
  })

  it('returns 0.82 for Armin Boost -5 (same letter, counterclockwise -5)', () => {
    expect(camelotHarmonyScore('8A', '3A')).toBe(0.82)
    expect(camelotHarmonyScore('12A', '7A')).toBe(0.82)
  })

  it('returns 0.0 for incompatible', () => {
    expect(camelotHarmonyScore('8B', '4B')).toBe(0.0)
  })
})

describe('getTransitionLabel', () => {
  it('labels same key', () => {
    expect(getTransitionLabel('8A', '8A')).toBe('Same Key (8A)')
  })

  it('labels forward +1', () => {
    expect(getTransitionLabel('8A', '9A')).toBe('Forward +1 (8A→9A)')
  })

  it('labels back -1', () => {
    expect(getTransitionLabel('8A', '7A')).toBe('Back -1 (8A→7A)')
  })

  it('labels relative major/minor', () => {
    expect(getTransitionLabel('8A', '8B')).toBe('Relative (8A→8B)')
  })

  it('labels Energy Boost +2', () => {
    expect(getTransitionLabel('8A', '10A')).toBe('Energy Boost +2 (8A→10A)')
  })

  it('labels Armin Boost -5', () => {
    expect(getTransitionLabel('8A', '3A')).toBe('Armin Boost -5 (8A→3A)')
  })

  it('labels incompatible as key jump', () => {
    expect(getTransitionLabel('8B', '4B')).toBe('Key jump (8B→4B)')
  })
})
