import { describe, it, expect, vi } from 'vitest'
import { buildVinylSongs, estimateVinylEnergy, vinylFileKey } from '../app/lib/vinylSongs'
import { generateM3U } from '../app/lib/m3uExport'
import { generateRekordboxXml } from '../app/lib/rekordboxExport'
import type { DiscogsCollectionEntry, DiscogsRelease, ManualData, SetTrack, VinylReleaseData } from '../app/types'

// Baked in at Vite build time — empty in Electron production
vi.stubGlobal('__SONGS_FOLDER__', '')

const release = (over: Partial<DiscogsRelease> = {}): DiscogsRelease => ({
  releaseId: 1, title: 'Night Moves EP', artist: 'DJ Test', year: 1998,
  formats: ['Vinyl'], genres: ['Electronic'], styles: ['Deep House'], inLibrary: false,
  ...over,
})

const collection = (releases: DiscogsRelease[]): DiscogsCollectionEntry => ({
  id: 'discogs-collection', username: 'tester', syncedAt: 0, totalReleases: releases.length, releases,
})

const store = (tracks: VinylReleaseData['tracks'], genre?: string): VinylReleaseData => ({ tracks, ...(genre ? { genre } : {}) })

describe('estimateVinylEnergy', () => {
  it('rises with tempo', () => {
    expect(estimateVinylEnergy(140, [])).toBeGreaterThan(estimateVinylEnergy(120, []))
  })
  it('lowers chilled genres and raises hard ones', () => {
    expect(estimateVinylEnergy(120, ['Downtempo'])).toBeLessThan(estimateVinylEnergy(120, []))
    expect(estimateVinylEnergy(120, ['Techno'])).toBeGreaterThan(estimateVinylEnergy(120, []))
  })
  it('clamps to 0.2–0.9', () => {
    expect(estimateVinylEnergy(60, ['ambient'])).toBe(0.2)
    expect(estimateVinylEnergy(200, ['hard techno'])).toBe(0.9)
  })
})

describe('buildVinylSongs', () => {
  const none = new Map<number, ManualData>()
  const noReject = new Set<number>()

  it('returns nothing without a collection', () => {
    expect(buildVinylSongs(null, {}, none, noReject, new Set())).toEqual([])
  })

  it('turns AI-analysed tracks into vinyl-only songs', () => {
    const songs = buildVinylSongs(
      collection([release()]),
      { 1: store([{ id: 'a', position: 'A1', title: 'Moves', bpm: 122, camelot: '8a', genre: 'Deep House' }]) },
      none, noReject, new Set(),
    )
    expect(songs).toHaveLength(1)
    expect(songs[0]).toMatchObject({
      file: vinylFileKey(1, 'A1'), artist: 'DJ Test', title: 'Moves', bpm: 122,
      camelot: '8A', key: 'A Minor', genres: ['Deep House'], year: 1998,
      discogsReleaseId: 1, vinylOnly: true,
    })
    expect(songs[0].energy).toBeGreaterThan(0)
    expect(songs[0].filePath).toBeUndefined()
  })

  it('skips tracks missing a BPM or a valid key', () => {
    const songs = buildVinylSongs(
      collection([release()]),
      { 1: store([
        { id: 'a', position: 'A1', bpm: 122 },
        { id: 'b', position: 'A2', camelot: '8A' },
        { id: 'c', position: 'B1', bpm: 124, camelot: '13A' },
        { id: 'd', position: 'B2', bpm: 0, camelot: '8A' },
      ]) },
      none, noReject, new Set(),
    )
    expect(songs).toEqual([])
  })

  it('skips records linked to a file already in the library', () => {
    const tracks = { 1: store([{ id: 'a', position: 'A1', bpm: 122, camelot: '8A' }]) }
    expect(buildVinylSongs(collection([release({ matchedFile: 'x.mp3' })]), tracks, none, noReject, new Set(['x.mp3']))).toEqual([])
    const manual = new Map<number, ManualData>([[1, { matchedFile: 'y.mp3' }]])
    expect(buildVinylSongs(collection([release()]), tracks, manual, noReject, new Set(['y.mp3']))).toEqual([])
    // A stale link to a file no longer in the library doesn't hide the record
    expect(buildVinylSongs(collection([release({ matchedFile: 'gone.mp3' })]), tracks, none, noReject, new Set())).toHaveLength(1)
  })

  it('skips rejected records', () => {
    const tracks = { 1: store([{ id: 'a', position: 'A1', bpm: 122, camelot: '8A' }]) }
    expect(buildVinylSongs(collection([release()]), tracks, none, new Set([1]), new Set())).toEqual([])
  })

  it('falls back through store genre, AI release genre, then Discogs styles/genres', () => {
    const t = [{ id: 'a', position: 'A1', bpm: 122, camelot: '8A' }]
    const c = collection([release()])
    expect(buildVinylSongs(c, { 1: store(t, 'Garage') }, none, noReject, new Set())[0].genres).toEqual(['Garage'])
    const manual = new Map<number, ManualData>([[1, { aiGenre: 'Acid House' }]])
    expect(buildVinylSongs(c, { 1: store(t) }, manual, noReject, new Set())[0].genres).toEqual(['Acid House'])
    expect(buildVinylSongs(c, { 1: store(t) }, none, noReject, new Set())[0].genres).toEqual(['Deep House'])
    expect(buildVinylSongs(collection([release({ styles: [] })]), { 1: store(t) }, none, noReject, new Set())[0].genres).toEqual(['Electronic'])
  })

  it('titles untitled tracks from the release and position', () => {
    const songs = buildVinylSongs(collection([release()]), { 1: store([{ id: 'a', position: 'B2', bpm: 120, camelot: '1B' }]) }, none, noReject, new Set())
    expect(songs[0].title).toBe('Night Moves EP (B2)')
  })
})

describe('exports with vinyl-only tracks', () => {
  const setTrack = (over: Partial<SetTrack>): SetTrack => ({
    file: '/music/a.mp3', filePath: '/music/a.mp3', artist: 'A', title: 'Digital', bpm: 124, key: 'A Minor',
    camelot: '8A', energy: 0.6, genres: [], slot: 0, targetEnergy: 0.6, harmonicWarning: false, ...over,
  })
  const vinyl = setTrack({ file: vinylFileKey(1, 'A1'), filePath: undefined, title: 'Record', vinylOnly: true })

  it('M3U lists the record as a comment instead of a path', () => {
    const m3u = generateM3U([setTrack({}), vinyl])
    expect(m3u).toContain('# VINYL: A - Record')
    expect(m3u).not.toContain('vinyl:1')
  })

  it('Rekordbox XML leaves the record out and counts only file tracks', () => {
    const xml = generateRekordboxXml([setTrack({}), vinyl])
    expect(xml).not.toContain('Record')
    expect(xml).toContain('<COLLECTION Entries="1">')
  })
})
