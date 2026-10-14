import { describe, it, expect } from 'vitest'
import { buildAppleMusicJob, applyAppleMusicResult, exportPath, skipReasonText } from '../app/lib/appleMusicExport'
import { playlistsInFolder } from '../app/lib/playlists'
import type { PlaylistLibrary, Song } from '../app/types'

const song = (file: string, over: Partial<Song> = {}): Song => ({
  file, filePath: file, artist: 'A', title: file, bpm: 124, key: 'A Minor', camelot: '8A', energy: 0.6, genres: [], ...over,
})

const songs = new Map<string, Song>([
  ['/m/a.mp3', song('/m/a.mp3')],
  ['/m/b.mp3', song('/m/b.mp3', { bpm: 0, camelot: 'Unknown' })],
  ['vinyl:1:x', song('vinyl:1:x', { filePath: undefined, vinylOnly: true, title: 'Record' })],
  ['local-spotify', song('local-spotify', { filePath: undefined, spotifyOnly: true })],
  ['rel/c.mp3', song('rel/c.mp3', { filePath: undefined })],
])

const lib: PlaylistLibrary = {
  schemaVersion: 1,
  appleMusicRootId: 'ROOT',
  folders: [
    { id: 'f1', name: 'Gigs', appleMusicId: 'MF1' },
    { id: 'f2', name: 'Friday', parentId: 'f1' },
    { id: 'f3', name: 'Unused' },
  ],
  playlists: [
    { id: 'p1', name: 'Peak', folderId: 'f2', tracks: ['/m/a.mp3', 'vinyl:1:x', '/m/b.mp3', 'gone.mp3'], createdAt: 0, updatedAt: 0, appleMusicId: 'MP1' },
    { id: 'p2', name: 'Loose', tracks: ['local-spotify', 'rel/c.mp3'], createdAt: 0, updatedAt: 0 },
  ],
}

describe('exportPath', () => {
  it('returns the local file, or why there is none', () => {
    expect(exportPath(songs.get('/m/a.mp3'))).toEqual({ path: '/m/a.mp3' })
    expect(exportPath(undefined)).toEqual({ reason: 'missing' })
    expect(exportPath(songs.get('vinyl:1:x'))).toEqual({ reason: 'vinyl' })
    expect(exportPath(songs.get('local-spotify'))).toEqual({ reason: 'streaming' })
    expect(exportPath(songs.get('rel/c.mp3'))).toEqual({ reason: 'no-file' })
    expect(skipReasonText('vinyl')).toBe('vinyl only')
  })
})

describe('buildAppleMusicJob', () => {
  it('exports one playlist with its folder chain, links and skipped tracks', () => {
    const { job, skipped, trackCount } = buildAppleMusicJob(lib, ['p1'], songs, { addMissing: true, writeBack: null })
    expect(job.rootFolderId).toBe('ROOT')
    expect(job.folders).toEqual([
      { id: 'f1', name: 'Gigs', appleMusicId: 'MF1' },
      { id: 'f2', name: 'Friday', parentId: 'f1' },
    ])
    expect(job.playlists).toEqual([{ id: 'p1', name: 'Peak', folderId: 'f2', appleMusicId: 'MP1', files: ['/m/a.mp3', '/m/b.mp3'] }])
    expect(job.addMissing).toBe(true)
    expect(job.writeBack).toBeUndefined()
    expect(skipped.p1.map(s => s.reason)).toEqual(['vinyl', 'missing'])
    expect(trackCount).toBe(2)
  })

  it('exports everything, including empty folders, parents first', () => {
    const { job, skipped } = buildAppleMusicJob(lib, 'all', songs, { addMissing: false, writeBack: null })
    expect(job.playlists.map(p => p.id)).toEqual(['p1', 'p2'])
    expect(job.folders.map(f => f.id)).toEqual(['f1', 'f3', 'f2'])
    expect(job.playlists[1].files).toEqual([])
    expect(skipped.p2.map(s => s.reason)).toEqual(['streaming', 'no-file'])
  })

  it('collects BPM and valid keys for write-back', () => {
    const { job } = buildAppleMusicJob(lib, ['p1'], songs, { addMissing: false, writeBack: 'comment' })
    expect(job.writeBack).toEqual({ keyField: 'comment', tracks: { '/m/a.mp3': { bpm: 124, camelot: '8A' } } })
  })
})

describe('applyAppleMusicResult', () => {
  it('stores the Music IDs so the next push updates instead of duplicating', () => {
    const next = applyAppleMusicResult(lib, {
      rootFolderId: 'ROOT2', folders: { f2: 'MF2' }, addedToLibrary: 0, tagged: 0, errors: [],
      playlists: { p2: { appleMusicId: 'MP2', added: 0, skipped: [] } },
    })
    expect(next.appleMusicRootId).toBe('ROOT2')
    expect(next.folders.find(f => f.id === 'f2')?.appleMusicId).toBe('MF2')
    expect(next.folders.find(f => f.id === 'f1')?.appleMusicId).toBe('MF1')
    expect(next.playlists.map(p => p.appleMusicId)).toEqual(['MP1', 'MP2'])
  })
})

describe('playlistsInFolder', () => {
  it('includes playlists in nested folders', () => {
    expect(playlistsInFolder(lib, 'f1')).toEqual(['p1'])
    expect(playlistsInFolder(lib, 'f3')).toEqual([])
  })
})
