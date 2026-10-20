import { describe, it, expect } from 'vitest'
import { bpmShift, liveLog, nextPlanIndex, suggestNext, transitionTip, type GigTrack } from '../app/lib/gigMode'

const tr = (id: string, bpm: number, camelot: string, energy = 0.5, artist = 'A'): GigTrack => ({ id, artist, title: id, bpm, camelot, energy })

describe('nextPlanIndex', () => {
  const plan = ['a', 'b', 'c', 'd']
  it('starts at the top, then follows the last planned track played', () => {
    expect(nextPlanIndex(plan, [])).toBe(0)
    expect(nextPlanIndex(plan, ['a'])).toBe(1)
    expect(nextPlanIndex(plan, ['a', 'c'])).toBe(3)           // jumped ahead
    expect(nextPlanIndex(plan, ['a', 'b', 'c', 'd'])).toBe(4) // finished
  })
  it('an off-plan track keeps the place; tracks already played are skipped', () => {
    expect(nextPlanIndex(plan, ['a', 'x'])).toBe(1)
    expect(nextPlanIndex(plan, ['b', 'a'])).toBe(2)           // a played after b → next unplayed after a is c
    expect(nextPlanIndex(plan, ['x'])).toBe(0)
    expect(nextPlanIndex(plan, ['a', 'c', 'b'])).toBe(3)
  })
  it('handles an empty plan', () => {
    expect(nextPlanIndex([], ['x'])).toBe(0)
  })
})

describe('bpmShift / transitionTip', () => {
  it('bpmShift is a signed percentage, 0 when a tempo is unknown', () => {
    expect(bpmShift(124, 126)).toBe(1.6)
    expect(bpmShift(126, 124)).toBe(-1.6)
    expect(bpmShift(0, 124)).toBe(0)
    expect(bpmShift(124, NaN)).toBe(0)
  })
  it('describes key move, tempo change and energy direction', () => {
    expect(transitionTip(tr('a', 124, '8A', 0.5), tr('b', 126, '9A', 0.7))).toBe('Forward +1 (8A→9A) · +1.6% tempo · energy up')
    expect(transitionTip(tr('a', 124, '8A', 0.5), tr('b', 124, '8A', 0.45))).toBe('Same Key (8A) · same tempo')
    expect(transitionTip(tr('a', 0, '', 0.8), tr('b', 124, '', 0.5))).toBe('energy down')
  })
})

describe('liveLog', () => {
  it('builds a synced set from the played tracks, in order', () => {
    expect(liveLog('Played live: Fri', 5, [tr('b', 120, '1A'), tr('a', 122, '2A', 0.6)])).toEqual({
      name: 'Played live: Fri', timestamp: 5,
      tracks: [
        { file: 'b', artist: 'A', title: 'b', bpm: 120, camelot: '1A', energy: 0.5 },
        { file: 'a', artist: 'A', title: 'a', bpm: 122, camelot: '2A', energy: 0.6 },
      ],
    })
  })
})

describe('suggestNext', () => {
  const cur = tr('cur', 124, '8A', 0.6)
  const lib = [
    cur,
    tr('same', 124, '8A', 0.6),          // perfect
    tr('plus1', 125, '9A', 0.6),         // compatible, close tempo
    tr('boost', 124, '10A', 0.6),        // +2 energy boost (0.87)
    tr('clash', 124, '3B', 0.6),         // incompatible → left out
    tr('fast', 140, '8A', 0.6),          // > 8 % faster → left out
    tr('nokey', 124, '', 0.6),           // unknown key → neutral
    tr('played', 124, '8A', 0.6),
  ]

  it('ranks by harmony, tempo and energy; leaves out clashes, big tempo jumps, the current and excluded tracks', () => {
    const r = suggestNext(cur, lib, { exclude: new Set(['played']) })
    expect(r.map(x => x.track.id)).toEqual(['same', 'plus1', 'boost', 'nokey'])
    expect(r[0].score).toBe(1)
    expect(r[1].tip).toBe('Forward +1 (8A→9A) · +0.8% tempo')
  })
  it('aims at a target energy when given', () => {
    const a = tr('low', 124, '8A', 0.3), b = tr('high', 124, '8A', 0.9)
    expect(suggestNext(cur, [a, b], { targetEnergy: 0.9 }).map(x => x.track.id)).toEqual(['high', 'low'])
  })
  it('limits the list; a current track with no BPM/key still gets suggestions', () => {
    expect(suggestNext(cur, lib, { limit: 2 })).toHaveLength(2)
    expect(suggestNext(tr('x', 0, '', 0.5), [tr('y', 128, '5B', 0.5)])).toHaveLength(1)
  })
})
