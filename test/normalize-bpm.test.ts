import { describe, it, expect } from 'vitest'
import { normalizeBpm } from '../src/normalize-bpm'

describe('normalizeBpm — tag-based correction (preferred path)', () => {
  it('doubles when detector returned ~half of tag BPM', () => {
    // 62 detected, tag says 124 → should return 124
    expect(normalizeBpm(62, 0.55, ['Melodic House & Techno'], 124)).toBe(124)
    expect(normalizeBpm(65, 0.4, ['Unknown'], 130)).toBe(130)
    expect(normalizeBpm(70, 0.3, [], 140)).toBe(140)
  })

  it('halves when detector returned ~double of tag BPM', () => {
    // 248 detected, tag says 124 → should return 124
    expect(normalizeBpm(248, 0.8, ['Techno'], 124)).toBe(124)
    expect(normalizeBpm(260, 0.7, [], 130)).toBe(130)
  })

  it('triples when detector returned ~one-third of tag BPM', () => {
    // 42 detected, tag says 128 → ~1/3 → triple → 126
    expect(normalizeBpm(43, 0.5, [], 129)).toBeCloseTo(129, 0)
  })

  it('thirds when detector returned ~triple tag BPM', () => {
    expect(normalizeBpm(384, 0.5, [], 128)).toBeCloseTo(128, 0)
  })

  it('uses tag value when detector is close enough', () => {
    // Detected 123, tag says 124 — close enough, return tag
    expect(normalizeBpm(123, 0.7, ['Techno'], 124)).toBe(124)
  })

  it('ignores tag when out of plausible range', () => {
    // Tag is 30 BPM — not a DJ-range BPM, ignore it
    expect(normalizeBpm(128, 0.8, ['House'], 30)).toBe(128)
    // Tag is 300 — too high
    expect(normalizeBpm(128, 0.8, ['Techno'], 300)).toBe(128)
  })

  it('ignores null / missing tag and falls through to genre logic', () => {
    expect(normalizeBpm(128, 0.8, ['House'], null)).toBe(128)
    expect(normalizeBpm(128, 0.8, ['House'])).toBe(128)
  })
})

describe('normalizeBpm — genre heuristics (fallback when no tag)', () => {
  it('doubles half-time for confirmed fast genres below 90 BPM', () => {
    expect(normalizeBpm(62, 0.55, ['Techno'])).toBe(124)
    expect(normalizeBpm(70, 0.3, ['House'])).toBe(140)
    expect(normalizeBpm(87, 0.7, ['Trance'])).toBe(174)
    expect(normalizeBpm(62, 0.3, ['Drum and Bass'])).toBe(124)
  })

  it('does not double below 90 if result would be outside 100–200 range', () => {
    // 45 * 2 = 90 — below 100, skip
    expect(normalizeBpm(45, 0.9, ['Techno'])).toBe(45)
  })

  it('leaves fast genre BPM in normal range unchanged', () => {
    expect(normalizeBpm(128, 0.8, ['House'])).toBe(128)
    expect(normalizeBpm(145, 0.7, ['Techno'])).toBe(145)
    expect(normalizeBpm(174, 0.9, ['Drum and Bass'])).toBe(174)
  })

  it('halves for confirmed slow genre at high detected BPM', () => {
    expect(normalizeBpm(140, 0.3, ['Soul'])).toBe(70)
    expect(normalizeBpm(120, 0.2, ['Jazz'])).toBe(60)
  })

  it('thirds for confirmed slow genre when > 150 BPM', () => {
    expect(normalizeBpm(180, 0.2, ['Classical'])).toBe(60)
  })

  it('does NOT correct unknown/unlisted genres without a tag', () => {
    // Unknown genre — trust the detector whatever it returns
    expect(normalizeBpm(62, 0.4, ['Pop'])).toBe(62)
    expect(normalizeBpm(62, 0.8, ['Electronic'])).toBe(62)
    expect(normalizeBpm(62, 0.5, [])).toBe(62)
  })
})
