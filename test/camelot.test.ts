import { describe, it, expect } from 'vitest'
import { toCamelot } from '../src/camelot'

describe('toCamelot', () => {
  it('returns null for pitch class -1 (unknown)', () => {
    expect(toCamelot(-1, 1)).toBeNull()
  })

  it('returns null for pitch class 12 (out of range)', () => {
    expect(toCamelot(12, 1)).toBeNull()
  })

  it('returns null for negative pitch class', () => {
    expect(toCamelot(-5, 0)).toBeNull()
  })

  it('C Major → 8B', () => {
    expect(toCamelot(0, 1)).toEqual({ camelot: '8B', keyName: 'C Major' })
  })

  it('A Minor → 8A', () => {
    expect(toCamelot(9, 0)).toEqual({ camelot: '8A', keyName: 'A Minor' })
  })

  it('C Minor → 5A', () => {
    expect(toCamelot(0, 0)).toEqual({ camelot: '5A', keyName: 'C Minor' })
  })

  it('A Major → 11B', () => {
    expect(toCamelot(9, 1)).toEqual({ camelot: '11B', keyName: 'A Major' })
  })

  it('F# Major → 2B', () => {
    expect(toCamelot(6, 1)).toEqual({ camelot: '2B', keyName: 'F♯ Major' })
  })

  it('all 12 major keys produce unique camelot values', () => {
    const results = Array.from({ length: 12 }, (_, i) => toCamelot(i, 1)?.camelot)
    expect(new Set(results).size).toBe(12)
  })

  it('all 12 minor keys produce unique camelot values', () => {
    const results = Array.from({ length: 12 }, (_, i) => toCamelot(i, 0)?.camelot)
    expect(new Set(results).size).toBe(12)
  })

  it('major and minor keys at same pitch class differ', () => {
    const major = toCamelot(0, 1)
    const minor = toCamelot(0, 0)
    expect(major?.camelot).not.toBe(minor?.camelot)
    expect(major?.keyName).toContain('Major')
    expect(minor?.keyName).toContain('Minor')
  })
})
