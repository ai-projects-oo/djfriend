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

  it('returns "energyBoost" for same number, different letter', () => {
    expect(getCamelotCompatibility('8B', '8A')).toBe('energyBoost')
  })

  it('returns "compatible" for ±1 position, same letter', () => {
    expect(getCamelotCompatibility('8B', '9B')).toBe('compatible')
    expect(getCamelotCompatibility('8B', '7B')).toBe('compatible')
  })

  it('returns "compatible" for wrap-around 12↔1', () => {
    expect(getCamelotCompatibility('12A', '1A')).toBe('compatible')
    expect(getCamelotCompatibility('1B', '12B')).toBe('compatible')
  })

  it('returns "incompatible" for 2+ positions apart', () => {
    expect(getCamelotCompatibility('8B', '10B')).toBe('incompatible')
  })

  it('returns "incompatible" for different number and different letter', () => {
    expect(getCamelotCompatibility('8B', '5A')).toBe('incompatible')
  })

  it('returns "incompatible" for invalid input', () => {
    expect(getCamelotCompatibility('invalid', '8B')).toBe('incompatible')
  })
})

describe('camelotHarmonyScore', () => {
  it('returns 1.0 for perfect or compatible', () => {
    expect(camelotHarmonyScore('8B', '8B')).toBe(1.0)
    expect(camelotHarmonyScore('8B', '9B')).toBe(1.0)
  })

  it('returns 0.5 for energy boost', () => {
    expect(camelotHarmonyScore('8B', '8A')).toBe(0.5)
  })

  it('returns 0.0 for incompatible', () => {
    expect(camelotHarmonyScore('8B', '3A')).toBe(0.0)
  })
})
