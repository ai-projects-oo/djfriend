// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { parseCamelot, getCamelotCompatibility, camelotHarmonyScore } from '../app/lib/camelot'

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

  it('returns "incompatible" for 2+ positions apart', () => {
    expect(getCamelotCompatibility('8B', '10B')).toBe('incompatible')
    expect(getCamelotCompatibility('8B', '6A')).toBe('incompatible')
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

  it('returns 0.0 for incompatible', () => {
    expect(camelotHarmonyScore('8B', '3A')).toBe(0.0)
  })
})
