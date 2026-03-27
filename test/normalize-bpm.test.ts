import { describe, it, expect } from 'vitest'
import { normalizeBpm } from '../src/normalize-bpm'

describe('normalizeBpm', () => {
  it('returns BPM unchanged for fast genres (house, techno, dnb)', () => {
    expect(normalizeBpm(174, 0.9, ['Drum and Bass'])).toBe(174)
    expect(normalizeBpm(145, 0.8, ['Techno'])).toBe(145)
    expect(normalizeBpm(128, 0.3, ['Deep House'])).toBe(128)
  })

  it('returns BPM unchanged when bpm <= 100', () => {
    expect(normalizeBpm(90, 0.3, ['Soul'])).toBe(90)
  })

  it('returns BPM unchanged for high energy (>=0.5) non-slow genre', () => {
    expect(normalizeBpm(140, 0.7, ['Pop'])).toBe(140)
  })

  it('halves BPM for slow genre at high tempo', () => {
    expect(normalizeBpm(140, 0.3, ['Soul'])).toBe(70)
    expect(normalizeBpm(120, 0.2, ['Jazz'])).toBe(60)
  })

  it('takes a third for BPM > 150 when third lands in range', () => {
    expect(normalizeBpm(180, 0.2, ['Classical'])).toBe(60)   // 180/3 = 60
  })

  it('halves BPM for unknown genre with low energy (<0.5)', () => {
    expect(normalizeBpm(130, 0.4, ['Unknown'])).toBe(65)
  })

  it('does not halve for unknown genre with high energy (>=0.5)', () => {
    expect(normalizeBpm(130, 0.6, ['Unknown'])).toBe(130)
  })
})
