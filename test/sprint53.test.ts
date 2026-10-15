import { describe, it, expect } from 'vitest'
import { buildPlaylistTree, filterPlaylistTree, expandToPlaylist } from '../app/lib/playlists'
import { applyVinylDetection } from '../app/lib/vinylTracks'
import { energyScore, computeVocalTimeline, analyzePcm } from '../src/analyzer-core'
import { toCamelot } from '../src/camelot'
import type { PlaylistLibrary, VinylTrackEntry } from '../app/types'

const pl = (id: string, name: string, tracks: string[], folderId?: string, smart = false) => ({
  id, name, tracks, folderId, createdAt: 0, updatedAt: 0,
  ...(smart ? { smart: { match: 'all' as const, rules: [] } } : {}),
})

// Gigs/ → { Warmup, Clubs/ → { Peak, Smart(smart) } }, Empty/ → {}, Loose (top level)
const lib: PlaylistLibrary = {
  schemaVersion: 1,
  folders: [
    { id: 'gigs', name: 'Gigs', collapsed: true },
    { id: 'clubs', name: 'Clubs', parentId: 'gigs', collapsed: true },
    { id: 'empty', name: 'Empty' },
  ],
  playlists: [
    pl('warm', 'Warmup', ['a', 'b'], 'gigs'),
    pl('peak', 'Peak', ['b'], 'clubs'),
    pl('smart', 'Smart', [], 'clubs', true),
    pl('loose', 'Loose', ['c']),
  ],
}

describe('filterPlaylistTree', () => {
  it('keeps nesting and drops folders with nothing matching inside', () => {
    const t = filterPlaylistTree(buildPlaylistTree(lib), p => !p.smart)
    expect(t.folders.map(f => f.folder.id)).toEqual(['gigs'])          // "Empty" dropped
    expect(t.folders[0].playlists.map(p => p.id)).toEqual(['warm'])
    expect(t.folders[0].folders[0].folder.id).toBe('clubs')
    expect(t.folders[0].folders[0].playlists.map(p => p.id)).toEqual(['peak'])   // smart excluded
    expect(t.playlists.map(p => p.id)).toEqual(['loose'])
  })
  it('narrows to playlists containing a track (Show in Playlist)', () => {
    const t = filterPlaylistTree(buildPlaylistTree(lib), p => p.tracks.includes('b'))
    expect(t.playlists).toEqual([])
    expect(t.folders[0].playlists.map(p => p.id)).toEqual(['warm'])
    expect(t.folders[0].folders[0].playlists.map(p => p.id)).toEqual(['peak'])
  })
  it('is empty when nothing matches', () => {
    const t = filterPlaylistTree(buildPlaylistTree(lib), () => false)
    expect(t).toEqual({ folders: [], playlists: [] })
  })
})

describe('expandToPlaylist', () => {
  it('opens every collapsed ancestor folder', () => {
    const out = expandToPlaylist(lib, 'peak')
    expect(out.folders.find(f => f.id === 'gigs')?.collapsed).toBe(false)
    expect(out.folders.find(f => f.id === 'clubs')?.collapsed).toBe(false)
  })
  it('only touches the path to the playlist', () => {
    const out = expandToPlaylist(lib, 'warm')
    expect(out.folders.find(f => f.id === 'gigs')?.collapsed).toBe(false)
    expect(out.folders.find(f => f.id === 'clubs')?.collapsed).toBe(true)
  })
  it('returns the same library when nothing needs expanding', () => {
    expect(expandToPlaylist(lib, 'loose')).toBe(lib)
    expect(expandToPlaylist(lib, 'missing')).toBe(lib)
    const open = expandToPlaylist(lib, 'peak')
    expect(expandToPlaylist(open, 'peak')).toBe(open)
  })
  it('survives a folder cycle', () => {
    const cyc: PlaylistLibrary = { ...lib, folders: [{ id: 'x', name: 'X', parentId: 'y', collapsed: true }, { id: 'y', name: 'Y', parentId: 'x', collapsed: true }], playlists: [pl('p', 'P', [], 'x')] }
    expect(expandToPlaylist(cyc, 'p').folders.every(f => !f.collapsed)).toBe(true)
  })
})

describe('applyVinylDetection', () => {
  const base: VinylTrackEntry = { id: '1', position: 'A1' }
  it('fills key and BPM on an empty track and marks them detected', () => {
    const t = applyVinylDetection(base, { camelot: '8A', bpm: 124.37, keyConfidence: 0.4 })
    expect(t).toMatchObject({ camelot: '8A', bpm: 124.4, keyConfidence: 0.4, detectedFields: ['camelot', 'bpm'] })
    expect(t.aiFields).toBeUndefined()
  })
  it('replaces AI guesses', () => {
    const t = applyVinylDetection({ ...base, camelot: '1A', bpm: 100, genre: 'House', aiFields: ['camelot', 'bpm', 'genre'] }, { camelot: '8A', bpm: 124 })
    expect(t).toMatchObject({ camelot: '8A', bpm: 124, genre: 'House', aiFields: ['genre'] })
  })
  it('keeps a hand-entered BPM', () => {
    const t = applyVinylDetection({ ...base, bpm: 122 }, { camelot: '8A', bpm: 124 })
    expect(t.bpm).toBe(122)
    expect(t.detectedFields).toEqual(['camelot'])
  })
  it('ignores a zero BPM', () => {
    expect(applyVinylDetection(base, { camelot: '8A', bpm: 0 }).bpm).toBeUndefined()
  })
})

describe('energyScore (v5, hand-weighted)', () => {
  const f = { bassDb: 35, midDb: 30, highMidDb: 28, highDb: 25, spectralFlux: 1 }
  it('stays in 0–1', () => {
    expect(energyScore(f)).toBeGreaterThan(0)
    expect(energyScore(f)).toBeLessThan(1)
    expect(energyScore({ bassDb: -100, midDb: -100, highMidDb: -100, highDb: -100, spectralFlux: 0 })).toBeGreaterThanOrEqual(0)
    expect(energyScore({ bassDb: 200, midDb: 200, highMidDb: 200, highDb: 200, spectralFlux: 99 })).toBeLessThanOrEqual(1)
  })
  it('rises with louder bass, highs and more rhythmic activity', () => {
    expect(energyScore({ ...f, bassDb: 40 })).toBeGreaterThan(energyScore(f))
    expect(energyScore({ ...f, highDb: 30 })).toBeGreaterThan(energyScore(f))
    expect(energyScore({ ...f, spectralFlux: 2 })).toBeGreaterThan(energyScore(f))
  })
})

describe('computeVocalTimeline', () => {
  it('returns one 0–1 value per 3 s window', () => {
    const sr = 44100
    const audio = new Float32Array(sr * 10)
    for (let i = 0; i < audio.length; i++) audio[i] = Math.sin((2 * Math.PI * 220 * i) / sr) * 0.5
    const tl = computeVocalTimeline(audio, sr)
    expect(tl.length).toBe(4)
    for (const v of tl) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })
  it('is empty for very short audio', () => {
    expect(computeVocalTimeline(new Float32Array(1000), 44100)).toEqual([])
  })
})

describe('analyzePcm (vinyl live capture)', () => {
  const chord = (midis: number[], seconds: number, sr: number) => {
    const out = new Float32Array(Math.round(seconds * sr))
    const hz = midis.map(m => 440 * Math.pow(2, (m - 69) / 12))
    for (let i = 0; i < out.length; i++) { let v = 0; for (const f of hz) v += Math.sin((2 * Math.PI * f * i) / sr); out[i] = v / (hz.length * 2) }
    return out
  }
  it('detects A minor from a 48 kHz capture (resampled internally)', () => {
    const sr = 48000
    const parts = [[45, 57, 60, 64], [38, 50, 53, 57], [40, 52, 56, 59], [45, 57, 60, 64]].map(c => chord(c, 2.5, sr))
    const pcm = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0
    for (const p of parts) { pcm.set(p, o); o += p.length }
    const r = analyzePcm(pcm, sr)!
    expect(toCamelot(r.pitchClass, r.mode)?.camelot).toBe('8A')
    expect(r.keyVersion).toBe(2)
  })
  it('rejects clips shorter than 5 s and silence', () => {
    expect(analyzePcm(new Float32Array(44100 * 2), 44100)).toBeNull()
    expect(analyzePcm(new Float32Array(44100 * 10), 44100)).toBeNull()
  })
})
