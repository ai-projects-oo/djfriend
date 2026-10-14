import { describe, it, expect } from 'vitest'
import * as Q from '../app/lib/playQueue'

const q = (items: string[], index = 0, over: Partial<Q.PlayQueue> = {}): Q.PlayQueue => ({ ...Q.EMPTY_QUEUE, items, index, ...over })

describe('playList', () => {
  it('starts at the chosen track', () => {
    const r = Q.playList(Q.EMPTY_QUEUE, ['a', 'b', 'c'], 1)
    expect(Q.current(r)).toBe('b')
    expect(Q.upNext(r)).toEqual(['c'])
  })
  it('de-duplicates and handles empty lists', () => {
    expect(Q.playList(Q.EMPTY_QUEUE, ['a', 'a', 'b']).items).toEqual(['a', 'b'])
    expect(Q.current(Q.playList(q(['x']), []))).toBeNull()
  })
  it('with shuffle on, plays the chosen track first then the rest shuffled', () => {
    const r = Q.playList(q([], -1, { shuffle: true }), ['a', 'b', 'c', 'd', 'e'], 2, 42)
    expect(Q.current(r)).toBe('c')
    expect([...r.items].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(r.unshuffled).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('Play Next / Play Later', () => {
  it('Play Next inserts right after the current track, moving duplicates', () => {
    const r = Q.playNext(q(['a', 'b', 'c', 'd'], 1), ['d', 'x'])
    expect(r.items).toEqual(['a', 'b', 'd', 'x', 'c'])
    expect(Q.current(r)).toBe('b')
  })
  it('Play Next on an empty queue starts with those tracks', () => {
    const r = Q.playNext(Q.EMPTY_QUEUE, ['x', 'y'])
    expect(Q.current(r)).toBe('x')
  })
  it('Play Later appends, skipping tracks already waiting', () => {
    const r = Q.playLater(q(['a', 'b', 'c'], 0), ['c', 'd', 'a'])
    expect(r.items).toEqual(['a', 'b', 'c', 'd'])
    expect(Q.current(Q.playLater(Q.EMPTY_QUEUE, ['x']))).toBe('x')
  })
})

describe('next / prev / repeat', () => {
  it('stops at the end with repeat off, wraps with repeat all', () => {
    expect(Q.next(q(['a', 'b'], 1))).toEqual(q(['a', 'b'], 1))
    expect(Q.hasNext(q(['a', 'b'], 1))).toBe(false)
    expect(Q.current(Q.next(q(['a', 'b'], 1, { repeat: 'all' })))).toBe('a')
    expect(Q.current(Q.prev(q(['a', 'b'], 0, { repeat: 'all' })))).toBe('b')
  })
  it('repeat one replays when a song ends, but Next still advances', () => {
    const one = q(['a', 'b'], 0, { repeat: 'one' })
    expect(Q.next(one, { auto: true })).toBe(one)
    expect(Q.current(Q.next(one))).toBe('b')
  })
  it('cycles repeat off → all → one → off', () => {
    let r = Q.EMPTY_QUEUE
    const seen = [r.repeat]
    for (let i = 0; i < 3; i++) { r = Q.cycleRepeat(r); seen.push(r.repeat) }
    expect(seen).toEqual(['off', 'all', 'one', 'off'])
  })
})

describe('editing the queue', () => {
  it('jumps, removes and moves while keeping the current track', () => {
    expect(Q.current(Q.jumpTo(q(['a', 'b', 'c']), 2))).toBe('c')
    expect(Q.removeAt(q(['a', 'b', 'c'], 2), 0)).toMatchObject({ items: ['b', 'c'], index: 1 })
    // Removing the current, last track leaves nothing current (it doesn't jump back to the previous one)
    expect(Q.removeAt(q(['a', 'b'], 1), 1)).toMatchObject({ items: ['a'], index: -1 })
    // Removing the current track moves on to the one that followed it
    expect(Q.current(Q.removeAt(q(['a', 'b', 'c'], 1), 1))).toBe('c')
    expect(Q.removeAt(q(['a'], 0), 0)).toMatchObject({ items: [], index: -1 })
    const moved = Q.moveInQueue(q(['a', 'b', 'c', 'd'], 1), 3, 2)
    expect(moved.items).toEqual(['a', 'b', 'd', 'c'])
    expect(Q.current(moved)).toBe('b')
  })
  it('clears only what comes next', () => {
    expect(Q.clearUpNext(q(['a', 'b', 'c'], 1)).items).toEqual(['a', 'b'])
  })
})

describe('shuffle', () => {
  it('shuffles only upcoming tracks and restores the order when turned off', () => {
    const start = q(['a', 'b', 'c', 'd', 'e', 'f'], 1)
    const on = Q.toggleShuffle(start, 7)
    expect(on.shuffle).toBe(true)
    expect(on.items.slice(0, 2)).toEqual(['a', 'b'])
    expect([...on.items].sort()).toEqual(start.items)
    const off = Q.toggleShuffle(on)
    expect(off.items).toEqual(start.items)
    expect(Q.current(off)).toBe('b')
  })
  it('keeps tracks added while shuffled when shuffle is turned off', () => {
    const on = Q.toggleShuffle(q(['a', 'b', 'c'], 0), 3)
    const added = Q.playLater(on, ['z'])
    expect(Q.toggleShuffle(added).items).toEqual(['a', 'b', 'c', 'z'])
  })
})
