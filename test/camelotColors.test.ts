import { describe, it, expect } from 'vitest'
import { camelotColor } from '../app/lib/camelotColors'

const FALLBACK = '#64748b'

describe('camelotColor', () => {
  it('returns correct color for 1A', () => {
    expect(camelotColor('1A')).toBe('#4a9e6b')
  })

  it('returns correct color for 8B', () => {
    expect(camelotColor('8B')).toBe('#d49050')
  })

  it('returns correct color for 12B', () => {
    expect(camelotColor('12B')).toBe('#50d4a0')
  })

  it('is case-insensitive', () => {
    expect(camelotColor('8b')).toBe(camelotColor('8B'))
    expect(camelotColor('4a')).toBe(camelotColor('4A'))
  })

  it('trims whitespace', () => {
    expect(camelotColor('  8B  ')).toBe(camelotColor('8B'))
  })

  it('returns fallback for empty string', () => {
    expect(camelotColor('')).toBe(FALLBACK)
  })

  it('returns fallback for unknown key', () => {
    expect(camelotColor('13A')).toBe(FALLBACK)
    expect(camelotColor('0B')).toBe(FALLBACK)
    expect(camelotColor('C Major')).toBe(FALLBACK)
  })

  it('covers all 24 Camelot positions', () => {
    for (let n = 1; n <= 12; n++) {
      expect(camelotColor(`${n}A`)).not.toBe(FALLBACK)
      expect(camelotColor(`${n}B`)).not.toBe(FALLBACK)
    }
  })

  it('A and B of the same position have different colors', () => {
    for (let n = 1; n <= 12; n++) {
      expect(camelotColor(`${n}A`)).not.toBe(camelotColor(`${n}B`))
    }
  })
})
