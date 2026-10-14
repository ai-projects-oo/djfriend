import { describe, it, expect, vi } from 'vitest'
import { buildVinylSongs, estimateVinylEnergy, vinylFileKey } from '../app/lib/vinylSongs'
import { generateM3U } from '../app/lib/m3uExport'
import { generateRekordboxXml } from '../app/lib/rekordboxExport'
import type { DiscogsCollectionEntry, DiscogsRelease, ManualData, SetTrack, Song, VinylReleaseData } from '../app/types'
import { mergeAiTracks, clearAiFields } from '../app/lib/vinylTracks'

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
    expect(buildVinylSongs(null, {}, none, noReject, [])).toEqual([])
  })

  it('turns AI-analysed tracks into vinyl-only songs', () => {
    const songs = buildVinylSongs(
      collection([release()]),
      { 1: store([{ id: 'a', position: 'A1', title: 'Moves', bpm: 122, camelot: '8a', genre: 'Deep House' }]) },
      none, noReject, [],
    )
    expect(songs).toHaveLength(1)
    expect(songs[0]).toMatchObject({
      file: vinylFileKey(1, 'a'), artist: 'DJ Test', title: 'Moves', bpm: 122,
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
      none, noReject, [],
    )
    expect(songs).toEqual([])
  })

  const libSong = (title: string, artist: string, file = `/m/${title}.mp3`): Song => ({
    file, filePath: file, artist, title, bpm: 124, key: 'A Minor', camelot: '8A', energy: 0.6, genres: [],
  })

  it('skips a single-track release linked to a library file', () => {
    const tracks = { 1: store([{ id: 'a', position: 'A', bpm: 122, camelot: '8A', title: 'Other Name' }]) }
    const lib = [libSong('Whatever', 'X', 'x.mp3')]
    expect(buildVinylSongs(collection([release({ matchedFile: 'x.mp3' })]), tracks, none, noReject, lib)).toEqual([])
    const manual = new Map<number, ManualData>([[1, { matchedFile: 'x.mp3' }]])
    expect(buildVinylSongs(collection([release()]), tracks, manual, noReject, lib)).toEqual([])
    // A stale link to a file no longer in the library doesn't hide the record
    expect(buildVinylSongs(collection([release({ matchedFile: 'gone.mp3' })]), tracks, none, noReject, [])).toHaveLength(1)
  })

  it('keeps the other tracks of a multi-track release whose title matched a library file', () => {
    const tracks = { 1: store([
      { id: 'a', position: 'A1', bpm: 122, camelot: '8A', title: 'Moves' },
      { id: 'b', position: 'B1', bpm: 124, camelot: '9A', title: 'Shapes' },
    ]) }
    const songs = buildVinylSongs(collection([release({ matchedFile: 'x.mp3' })]), tracks, none, noReject, [libSong('Moves', 'DJ Test', 'x.mp3')])
    expect(songs.map(s => s.title)).toEqual(['Shapes'])
  })

  it('skips individual tracks already in the library (ignoring mix suffixes and case)', () => {
    const tracks = { 1: store([
      { id: 'a', position: 'A1', bpm: 122, camelot: '8A', title: 'Moves (Original Mix)' },
      { id: 'b', position: 'B1', bpm: 124, camelot: '9A', title: 'Shapes' },
    ]) }
    const songs = buildVinylSongs(collection([release()]), tracks, none, noReject, [libSong('moves', 'DJ Test feat. Someone')])
    expect(songs.map(s => s.title)).toEqual(['Shapes'])
  })

  it('does not treat a same-titled track by another artist as a duplicate', () => {
    const tracks = { 1: store([{ id: 'a', position: 'A1', bpm: 122, camelot: '8A', title: 'Moves' }]) }
    expect(buildVinylSongs(collection([release()]), tracks, none, noReject, [libSong('Moves', 'Someone Else')])).toHaveLength(1)
  })

  it('gives every track a unique file key even when old imports duplicated ids', () => {
    const tracks = { 1: store([
      { id: '1-A-auto', position: 'A', bpm: 122, camelot: '8A', title: 'One' },
      { id: '1-A-auto', position: 'A', bpm: 124, camelot: '9A', title: 'Two' },
      { id: '1-A-auto', position: 'A', bpm: 126, camelot: '10A', title: 'Three' },
    ]) }
    const files = buildVinylSongs(collection([release()]), tracks, none, noReject, []).map(s => s.file)
    expect(new Set(files).size).toBe(3)
  })

  it('skips rejected records', () => {
    const tracks = { 1: store([{ id: 'a', position: 'A1', bpm: 122, camelot: '8A' }]) }
    expect(buildVinylSongs(collection([release()]), tracks, none, new Set([1]), [])).toEqual([])
  })

  it('falls back through store genre, AI release genre, then Discogs styles/genres', () => {
    const t = [{ id: 'a', position: 'A1', bpm: 122, camelot: '8A' }]
    const c = collection([release()])
    expect(buildVinylSongs(c, { 1: store(t, 'Garage') }, none, noReject, [])[0].genres).toEqual(['Garage'])
    const manual = new Map<number, ManualData>([[1, { aiGenre: 'Acid House' }]])
    expect(buildVinylSongs(c, { 1: store(t) }, manual, noReject, [])[0].genres).toEqual(['Acid House'])
    expect(buildVinylSongs(c, { 1: store(t) }, none, noReject, [])[0].genres).toEqual(['Deep House'])
    expect(buildVinylSongs(collection([release({ styles: [] })]), { 1: store(t) }, none, noReject, [])[0].genres).toEqual(['Electronic'])
  })

  it('titles untitled tracks from the release and position', () => {
    const songs = buildVinylSongs(collection([release()]), { 1: store([{ id: 'a', position: 'B2', bpm: 120, camelot: '1B' }]) }, none, noReject, [])
    expect(songs[0].title).toBe('Night Moves EP (B2)')
  })
})

describe('exports with vinyl-only tracks', () => {
  const setTrack = (over: Partial<SetTrack>): SetTrack => ({
    file: '/music/a.mp3', filePath: '/music/a.mp3', artist: 'A', title: 'Digital', bpm: 124, key: 'A Minor',
    camelot: '8A', energy: 0.6, genres: [], slot: 0, targetEnergy: 0.6, harmonicWarning: false, ...over,
  })
  const vinyl = setTrack({ file: vinylFileKey(1, 'a'), filePath: undefined, title: 'Record', vinylOnly: true })

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

describe('mergeAiTracks', () => {
  it('matches by title, not by a shared position', () => {
    const stored = [
      { id: '1', position: 'A', title: 'One' },
      { id: '2', position: 'A', title: 'Two' },
    ]
    const ai = [
      { position: 'A', title: 'One', bpm: 120, camelot: '8A' },
      { position: 'A', title: 'Two', bpm: 130, camelot: '3B' },
    ]
    const merged = mergeAiTracks(stored, ai, { releaseId: 1, addMissing: false })
    expect(merged.map(t => [t.bpm, t.camelot])).toEqual([[120, '8A'], [130, '3B']])
  })

  it('never copies one result onto several tracks that share a position', () => {
    const stored = [
      { id: '1', position: 'A', title: 'Untitled 1' },
      { id: '2', position: 'A', title: 'Untitled 2' },
    ]
    const merged = mergeAiTracks(stored, [{ position: 'A', title: 'Something', bpm: 120 }], { releaseId: 1, addMissing: false })
    expect(merged.every(t => t.bpm === undefined)).toBe(true)
  })

  it('uses a position match when the position is unique on both sides', () => {
    const merged = mergeAiTracks([{ id: '1', position: 'B2' }], [{ position: 'B2', title: 'Named', bpm: 125 }], { releaseId: 1, addMissing: false })
    expect(merged[0].bpm).toBe(125)
  })

  it('fills only empty fields and records which ones in aiFields', () => {
    const merged = mergeAiTracks([{ id: '1', position: 'A1', title: 'One', bpm: 118 }], [{ position: 'A1', title: 'One', bpm: 125, camelot: '8A', genre: 'House' }], { releaseId: 1, addMissing: false })
    expect(merged[0]).toMatchObject({ bpm: 118, camelot: '8A', genre: 'House', aiFields: ['camelot', 'genre'] })
  })

  it('appends unmatched results with unique ids only when addMissing is set', () => {
    const ai = [{ position: '', title: 'New 1', bpm: 120 }, { position: '', title: 'New 2', bpm: 122 }]
    expect(mergeAiTracks([], ai, { releaseId: 7, addMissing: false })).toEqual([])
    const added = mergeAiTracks([], ai, { releaseId: 7, addMissing: true })
    expect(added).toHaveLength(2)
    expect(new Set(added.map(t => t.id)).size).toBe(2)
    expect(added[0].aiFields).toEqual(['bpm'])
  })
})

describe('clearAiFields', () => {
  it('removes only AI-filled values and keeps hand-entered ones', () => {
    const t = clearAiFields({ id: '1', position: 'A1', bpm: 120, camelot: '8A', genre: 'House', aiFields: ['camelot'] })
    expect(t).toEqual({ id: '1', position: 'A1', bpm: 120, genre: 'House' })
  })
  it('clears only BPM on tracks from before aiFields existed', () => {
    expect(clearAiFields({ id: '1', position: 'A1', bpm: 120, camelot: '8A' })).toEqual({ id: '1', position: 'A1', camelot: '8A' })
  })
})
