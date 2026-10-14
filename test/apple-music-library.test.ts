import { describe, it, expect } from 'vitest'
import { READ_LIBRARY_FN, shapeMusicLibrary } from '../src/apple-music-library'

const AUDIO = new Set(['.mp3', '.m4a', '.aiff', '.wav', '.flac'])

// Fake Music.app in JXA style: bulk reads on fileTracks, userPlaylists() with specialKind/parent
function fakeMusic() {
  const tracks = [
    { pid: 'T1', loc: '/m/a.mp3', name: 'Alpha', artist: 'X', dur: 300, added: new Date('2026-01-02T00:00:00Z') },
    { pid: 'T2', loc: '/m/b.mp3', name: 'Bravo', artist: '', dur: 240, added: null },
    { pid: 'T3', loc: null, name: 'Cloud only', artist: 'Y', dur: 200, added: null },
    { pid: 'T4', loc: '/m/notes.txt', name: 'Not audio', artist: 'Z', dur: 0, added: null },
  ]
  const pl = (name: string, kind: string, members: string[] | 'throws', parent?: string) => ({
    name: () => name,
    specialKind: () => kind,
    fileTracks: { persistentID: () => { if (members === 'throws') throw new Error("Can't get object."); return members } },
    parent: () => { if (!parent) throw new Error("Can't get object."); return { name: () => parent } },
  })
  return {
    libraryPlaylists: [{
      fileTracks: {
        persistentID: () => tracks.map(t => t.pid),
        location: () => tracks.map(t => (t.loc ? { toString: () => t.loc } : null)),
        name: () => tracks.map(t => t.name),
        artist: () => tracks.map(t => t.artist),
        duration: () => tracks.map(t => t.dur),
        dateAdded: () => tracks.map(t => t.added),
      },
    }],
    userPlaylists: () => [
      pl('Music', 'Music', ['T1', 'T2']),               // built-in: skipped
      pl('Warmup', 'none', ['T2', 'T1'], 'Gigs'),
      pl('Empty cloud list', 'none', 'throws'),           // no local files
      pl('Warmup', 'none', ['T1']),                       // same name, different folder
      pl('Only text', 'none', ['T4']),
    ],
  }
}

const run = () => (new Function(`${READ_LIBRARY_FN}; return readMusicLibrary;`)() as (m: unknown) => Parameters<typeof shapeMusicLibrary>[0])(fakeMusic())

describe('reading the whole Music library', () => {
  it('reads local tracks and regular playlists, surviving playlists without local files', () => {
    const raw = run()
    expect(raw.tracks.map(t => t.pid)).toEqual(['T1', 'T2', 'T4'])
    expect(raw.tracks[0].added).toBe(Date.parse('2026-01-02T00:00:00Z'))
    expect(raw.playlists.map(p => p.name)).toEqual(['Warmup', 'Empty cloud list', 'Warmup', 'Only text'])
    expect(raw.playlists[0]).toMatchObject({ folder: 'Gigs', members: ['T2', 'T1'] })
    expect(raw.playlists[1].members).toEqual([])
  })

  it('keeps existing audio files only and maps playlists to files in their order', () => {
    const lib = shapeMusicLibrary(run(), AUDIO, () => true)
    expect(lib.tracks.map(t => t.filePath)).toEqual(['/m/a.mp3', '/m/b.mp3'])
    expect(lib.tracks[0]).toMatchObject({ title: 'Alpha', artist: 'X', duration: 300, dateAdded: Math.floor(Date.parse('2026-01-02T00:00:00Z') / 1000) })
    expect(lib.tracks[1].artist).toBeNull()
    expect(lib.playlists).toEqual([
      { name: 'Warmup', folder: 'Gigs', files: ['/m/b.mp3', '/m/a.mp3'] },
      { name: 'Warmup (2)', files: ['/m/a.mp3'] },
    ])
  })

  it('drops files that no longer exist on disk', () => {
    const lib = shapeMusicLibrary(run(), AUDIO, p => p !== '/m/b.mp3')
    expect(lib.tracks.map(t => t.filePath)).toEqual(['/m/a.mp3'])
    expect(lib.playlists[0].files).toEqual(['/m/a.mp3'])
  })
})
