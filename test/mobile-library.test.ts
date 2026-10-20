import { describe, it, expect } from 'vitest'
import { utf8Decode } from '../app/lib/sync/utf8'
import { emptySyncState, mergeRemote } from '../app/lib/sync/merge'
import { filterTracks, formatDate, formatDuration, libraryTracks, playlistTree, playlistsOf, resolveTracks, savedSets, timeAgo, type PhoneTrack } from '../app/lib/phoneLibrary'
import type { Playlist, PlaylistFolder, SyncRecord } from '../app/types'

const tr = (id: string, o: Partial<PhoneTrack> = {}): PhoneTrack =>
  ({ id, artist: 'Artist', title: id, bpm: 124, key: '', camelot: '8A', energy: 0.5, genres: [], ...o })

const hlc = (t: number) => ({ t, c: 0, d: 'desk' })

describe('libraryTracks / savedSets / playlistsOf', () => {
  const records: SyncRecord[] = [
    { type: 'track', id: 'b.mp3', hlc: hlc(1), data: { artist: 'beta', title: 'Two', bpm: 120, key: '', camelot: '1A', energy: 0.4, genres: [] } },
    { type: 'track', id: 'a.mp3', hlc: hlc(1), data: { artist: 'Alpha', title: 'One', bpm: 128, key: '', camelot: '2A', energy: 0.7, genres: [] } },
    { type: 'track', id: 'gone.mp3', hlc: hlc(2), deleted: true },
    { type: 'set', id: 's1', hlc: hlc(1), data: { name: 'Old', timestamp: 100, tracks: [] } },
    { type: 'set', id: 's2', hlc: hlc(1), data: { name: 'New', timestamp: 200, tracks: [] } },
    { type: 'playlist', id: 'p1', hlc: hlc(1), data: { id: 'p1', name: 'P', tracks: [], createdAt: 0, updatedAt: 0 } },
    { type: 'folder', id: 'f1', hlc: hlc(1), data: { id: 'f1', name: 'F' } },
  ]
  const state = mergeRemote(emptySyncState('phone'), records, 10).state

  it('lists live tracks A–Z by artist (case-insensitive) with their ids', () => {
    expect(libraryTracks(state).map(t => t.id)).toEqual(['a.mp3', 'b.mp3'])
  })
  it('lists sets newest first', () => {
    expect(savedSets(state).map(s => s.name)).toEqual(['New', 'Old'])
  })
  it('splits playlists and folders', () => {
    const { playlists, folders } = playlistsOf(state)
    expect(playlists.map(p => p.id)).toEqual(['p1'])
    expect(folders.map(f => f.id)).toEqual(['f1'])
  })
})

describe('filterTracks', () => {
  const tracks = [
    tr('1', { artist: 'Kerri Chandler', title: 'Rain', bpm: 122, camelot: '8A', genres: ['Deep House'], energy: 0.5 }),
    tr('2', { artist: 'Ben Klock', title: 'Subzero', bpm: 132, camelot: '3A', genres: ['Techno'], energy: 0.9 }),
    tr('3', { artist: 'Moodymann', title: 'Shades', bpm: 118, camelot: '9A', genres: ['House'], energy: 0.3 }),
    tr('4', { artist: 'Unknown', title: 'No key', bpm: 0, camelot: '', energy: 0 }),
  ]

  it('matches every word against artist, title, genre and key', () => {
    expect(filterTracks(tracks, { query: 'house rain' }).map(t => t.id)).toEqual(['1'])
    expect(filterTracks(tracks, { query: '  TECHNO ' }).map(t => t.id)).toEqual(['2'])
    expect(filterTracks(tracks, { query: '9a' }).map(t => t.id)).toEqual(['3'])
    expect(filterTracks(tracks, { query: '' })).toHaveLength(4)
  })
  it('filters by BPM range (inclusive)', () => {
    expect(filterTracks(tracks, { query: '', bpmMin: 118, bpmMax: 122 }).map(t => t.id)).toEqual(['1', '3'])
  })
  it('keeps only harmonically compatible keys', () => {
    // 8A: same, 9A (+1) compatible; 3A is an Armin boost (−5) — compatible too; no key → excluded
    expect(filterTracks(tracks, { query: '', mixesWith: '8A' }).map(t => t.id)).toEqual(['1', '2', '3'])
    expect(filterTracks(tracks, { query: '', mixesWith: '9A' }).map(t => t.id)).toEqual(['1', '3'])
  })
  it('sorts', () => {
    expect(filterTracks(tracks, { query: '', sort: 'bpm' }).map(t => t.id)).toEqual(['4', '3', '1', '2'])
    expect(filterTracks(tracks, { query: '', sort: 'energy' }).map(t => t.id)).toEqual(['2', '1', '3', '4'])
    expect(filterTracks(tracks, { query: '', sort: 'key' }).map(t => t.id)).toEqual(['2', '1', '3', '4'])
    expect(filterTracks(tracks, { query: '', sort: 'title' }).map(t => t.title)).toEqual(['No key', 'Rain', 'Shades', 'Subzero'])
    expect(filterTracks(tracks, { query: '', sort: 'artist' }).map(t => t.id)).toEqual(['1', '2', '3', '4'])   // input order kept
  })
  it('does not mutate the input', () => {
    const copy = [...tracks]
    filterTracks(tracks, { query: '', sort: 'bpm' })
    expect(tracks).toEqual(copy)
  })
})

describe('playlistTree', () => {
  const pl = (id: string, name: string, folderId?: string, n = 0): Playlist => ({ id, name, tracks: Array(n).fill('x'), folderId, createdAt: 0, updatedAt: 0 })
  const fo = (id: string, name: string, parentId?: string): PlaylistFolder => ({ id, name, parentId })

  it('nests folders first, A–Z at each level, with depth and counts', () => {
    const tree = playlistTree(
      [fo('f2', 'Zeta'), fo('f1', 'Alpha'), fo('f1a', 'Inner', 'f1')],
      [pl('p1', 'b top'), pl('p2', 'A top'), pl('p3', 'In alpha', 'f1', 3), pl('p4', 'Deep', 'f1a', 1)],
    )
    expect(tree.map(n => `${'-'.repeat(n.depth)}${n.kind[0]}:${n.name}:${n.count}`)).toEqual([
      'f:Alpha:2', '-f:Inner:1', '--p:Deep:1', '-p:In alpha:3', 'f:Zeta:0', 'p:A top:0', 'p:b top:0',
    ])
  })
  it('puts playlists and folders with a missing parent at the top level', () => {
    const tree = playlistTree([fo('f1', 'Orphan folder', 'nope')], [pl('p1', 'Orphan', 'gone')])
    expect(tree.map(n => [n.name, n.depth])).toEqual([['Orphan folder', 0], ['Orphan', 0]])
  })
  it('survives folder cycles', () => {
    const tree = playlistTree([fo('a', 'A', 'b'), fo('b', 'B', 'a')], [pl('p', 'P')])
    expect(tree.map(n => n.name)).toEqual(['P'])
  })
})

describe('helpers', () => {
  it('resolveTracks keeps order and skips unknown ids', () => {
    const byId = new Map([['a', tr('a')], ['b', tr('b')]])
    expect(resolveTracks(['b', 'zzz', 'a', 'b'], byId).map(t => t.id)).toEqual(['b', 'a', 'b'])
  })
  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65.4)).toBe('1:05')
    expect(formatDuration(3600)).toBe('60:00')
    expect(formatDuration(undefined)).toBe('')
    expect(formatDuration(NaN)).toBe('')
  })
  it('timeAgo', () => {
    const now = 10_000_000
    expect(timeAgo(now - 5_000, now)).toBe('just now')
    expect(timeAgo(now + 5_000, now)).toBe('just now')
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(timeAgo(now - 3 * 3600_000, now)).toBe('3 h ago')
    expect(timeAgo(now - 2 * 86400_000, now)).toBe('2 d ago')
  })
  it('formatDate includes the year', () => {
    expect(formatDate(Date.UTC(2026, 5, 15, 12))).toMatch(/2026/)
  })
})

describe('utf8Decode (no TextDecoder)', () => {
  it('matches the built-in decoder for 1–4 byte sequences', () => {
    const sample = 'Café — Röyksopp ♫ 🎧 日本 ' + 'x'.repeat(20_000)
    const bytes = new TextEncoder().encode(sample)
    expect(utf8Decode(bytes)).toBe(sample)
    expect(utf8Decode(new Uint8Array())).toBe('')
  })
  it('replaces invalid sequences with U+FFFD and keeps the valid text around them', () => {
    for (const bad of [[0xff], [0xc3], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xc0, 0xaf], [0xf0, 0x9f, 0x8e]]) {
      const out = utf8Decode(new Uint8Array([0x61, ...bad, 0x62]))
      expect(out.startsWith('a') && out.endsWith('b')).toBe(true)
      expect(out.slice(1, -1)).toMatch(/^\ufffd+$/)
    }
  })
})
