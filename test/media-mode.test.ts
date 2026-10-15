import { describe, it, expect } from 'vitest'
import { generatorFilterFiles } from '../app/lib/discogsCollection'

const crates = new Set(['vinyl-linked.mp3', 'vinyl:only1'])
const vinylOnly = ['vinyl:only1']

describe('generatorFilterFiles — media mode', () => {
  it('Digital: no restriction, or just the playlist', () => {
    expect(generatorFilterFiles('library', undefined, undefined, [])).toBeUndefined()
    expect(generatorFilterFiles('library', undefined, new Set(['a.mp3']), [])).toEqual(new Set(['a.mp3']))
  })
  it('Mixed without a playlist: no restriction — digital and vinyl both eligible (the reported bug)', () => {
    expect(generatorFilterFiles('crates-first', crates, undefined, vinylOnly)).toBeUndefined()
  })
  it('Mixed with a playlist: the playlist plus every vinyl-only record', () => {
    expect(generatorFilterFiles('crates-first', crates, new Set(['a.mp3', 'b.mp3']), vinylOnly)).toEqual(new Set(['a.mp3', 'b.mp3', 'vinyl:only1']))
  })
  it('Vinyl: only crate files, intersected with the playlist', () => {
    expect(generatorFilterFiles('crates', crates, undefined, vinylOnly)).toBe(crates)
    expect(generatorFilterFiles('crates', crates, new Set(['vinyl-linked.mp3', 'a.mp3']), vinylOnly)).toEqual(new Set(['vinyl-linked.mp3']))
    expect(generatorFilterFiles('crates', crates, new Set(['a.mp3']), vinylOnly)).toBeUndefined()
  })
})
