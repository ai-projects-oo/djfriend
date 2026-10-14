import { describe, it, expect } from 'vitest'
import {
  EMPTY_PLAYLIST_LIBRARY, parsePlaylistLibrary, uniqueName, createPlaylist, renamePlaylist, deletePlaylist,
  duplicatePlaylist, addTracks, removeTracks, moveTracks, moveWithin, createFolder, renameFolder, toggleFolder,
  deleteFolder, movePlaylistToFolder, moveFolder, isInsideFolder, buildPlaylistTree, resolvePlaylist, flattenPlaylistTree,
  setPlaylistOrder, describeAdd,
} from '../app/lib/playlists'
import type { PlaylistLibrary, Song } from '../app/types'

const T0 = 1_000
const T1 = 2_000

const withPlaylist = (tracks: string[] = ['a', 'b', 'c', 'd', 'e']): PlaylistLibrary =>
  createPlaylist(EMPTY_PLAYLIST_LIBRARY, { id: 'p1', name: 'Warmup', now: T0, tracks })

const tracksOf = (lib: PlaylistLibrary, id = 'p1') => lib.playlists.find(p => p.id === id)?.tracks

describe('parsePlaylistLibrary', () => {
  it('returns an empty library for junk', () => {
    expect(parsePlaylistLibrary(null)).toEqual(EMPTY_PLAYLIST_LIBRARY)
    expect(parsePlaylistLibrary('nope')).toEqual(EMPTY_PLAYLIST_LIBRARY)
  })
  it('drops malformed entries and dangling folder links', () => {
    const lib = parsePlaylistLibrary({
      playlists: [
        { id: 'p1', name: 'Ok', tracks: ['a', 3, 'b'], folderId: 'gone', createdAt: 0, updatedAt: 0 },
        { id: 'p2', name: 'No tracks' },
        { name: 'No id', tracks: [] },
      ],
      folders: [{ id: 'f1', name: 'Gigs' }, { name: 'no id' }],
    })
    expect(lib.playlists).toHaveLength(1)
    expect(lib.playlists[0].tracks).toEqual(['a', 'b'])
    expect(lib.playlists[0].folderId).toBeUndefined()
    expect(lib.folders.map(f => f.id)).toEqual(['f1'])
  })
})

describe('playlists', () => {
  it('creates with a unique name and de-duplicated tracks', () => {
    let lib = createPlaylist(EMPTY_PLAYLIST_LIBRARY, { id: 'p1', name: 'Set', now: T0, tracks: ['a', 'a', 'b'] })
    lib = createPlaylist(lib, { id: 'p2', name: 'set', now: T0 })
    expect(lib.playlists.map(p => p.name)).toEqual(['Set', 'set 2'])
    expect(tracksOf(lib)).toEqual(['a', 'b'])
    expect(uniqueName(lib, '  ')).toBe('Untitled Playlist')
  })

  it('renames (ignoring blank names) and bumps updatedAt', () => {
    const lib = renamePlaylist(withPlaylist(), 'p1', ' Peak ', T1)
    expect(lib.playlists[0]).toMatchObject({ name: 'Peak', updatedAt: T1 })
    expect(renamePlaylist(lib, 'p1', '   ', T1)).toBe(lib)
  })

  it('deletes and duplicates', () => {
    const dup = duplicatePlaylist(withPlaylist(), 'p1', 'p2', T1)
    expect(dup.playlists.map(p => p.name)).toEqual(['Warmup', 'Warmup copy'])
    expect(tracksOf(dup, 'p2')).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(deletePlaylist(dup, 'p1').playlists.map(p => p.id)).toEqual(['p2'])
    expect(duplicatePlaylist(dup, 'missing', 'x', T1)).toBe(dup)
  })

  it('adds tracks at the end or an index, skipping ones already present', () => {
    expect(tracksOf(addTracks(withPlaylist(['a', 'b']), 'p1', ['c', 'a'], T1))).toEqual(['a', 'b', 'c'])
    expect(tracksOf(addTracks(withPlaylist(['a', 'b']), 'p1', ['x', 'y'], T1, 1))).toEqual(['a', 'x', 'y', 'b'])
    const same = withPlaylist(['a'])
    expect(tracksOf(addTracks(same, 'p1', ['a'], T1))).toEqual(['a'])
  })

  it('removes tracks', () => {
    expect(tracksOf(removeTracks(withPlaylist(), 'p1', ['b', 'd'], T1))).toEqual(['a', 'c', 'e'])
  })
})

describe('moveWithin / moveTracks', () => {
  const t = ['a', 'b', 'c', 'd', 'e']
  it('moves a single track down and up', () => {
    expect(moveWithin(t, ['a'], 3)).toEqual(['b', 'c', 'a', 'd', 'e'])
    expect(moveWithin(t, ['d'], 1)).toEqual(['a', 'd', 'b', 'c', 'e'])
  })
  it('moves to the start and the end', () => {
    expect(moveWithin(t, ['c'], 0)).toEqual(['c', 'a', 'b', 'd', 'e'])
    expect(moveWithin(t, ['b'], 5)).toEqual(['a', 'c', 'd', 'e', 'b'])
  })
  it('moves a non-contiguous selection as a block, keeping its order', () => {
    expect(moveWithin(t, ['e', 'b'], 0)).toEqual(['b', 'e', 'a', 'c', 'd'])
    expect(moveWithin(t, ['a', 'c'], 4)).toEqual(['b', 'd', 'a', 'c', 'e'])
  })
  it('is a no-op for unknown files and clamps the index', () => {
    expect(moveWithin(t, ['zz'], 2)).toBe(t)
    expect(moveWithin(t, ['a'], 99)).toEqual(['b', 'c', 'd', 'e', 'a'])
  })
  it('moveTracks updates the playlist', () => {
    expect(tracksOf(moveTracks(withPlaylist(), 'p1', ['e'], 0, T1))).toEqual(['e', 'a', 'b', 'c', 'd'])
  })
})

describe('folders', () => {
  const base = () => {
    let lib = withPlaylist()
    lib = createFolder(lib, { id: 'f1', name: 'Gigs' })
    lib = createFolder(lib, { id: 'f2', name: 'Friday', parentId: 'f1' })
    lib = movePlaylistToFolder(lib, 'p1', 'f2', T1)
    return lib
  }

  it('creates, renames and toggles', () => {
    let lib = createFolder(EMPTY_PLAYLIST_LIBRARY, { id: 'f', name: ' ' })
    expect(lib.folders[0].name).toBe('New Folder')
    lib = renameFolder(lib, 'f', 'Clubs')
    lib = toggleFolder(lib, 'f')
    expect(lib.folders[0]).toMatchObject({ name: 'Clubs', collapsed: true })
  })

  it('moves playlists into folders and back to the top level', () => {
    const lib = base()
    expect(lib.playlists[0].folderId).toBe('f2')
    expect(movePlaylistToFolder(lib, 'p1', undefined, T1).playlists[0].folderId).toBeUndefined()
    expect(movePlaylistToFolder(lib, 'p1', 'nope', T1)).toBe(lib)
  })

  it('deleting a folder moves its contents up to the parent', () => {
    const lib = deleteFolder(base(), 'f2')
    expect(lib.folders.map(f => f.id)).toEqual(['f1'])
    expect(lib.playlists[0].folderId).toBe('f1')
    const top = deleteFolder(lib, 'f1')
    expect(top.playlists[0].folderId).toBeUndefined()
  })

  it('refuses folder moves that would create a cycle', () => {
    const lib = base()
    expect(isInsideFolder(lib, 'f2', 'f1')).toBe(true)
    expect(moveFolder(lib, 'f1', 'f2')).toBe(lib)
    expect(moveFolder(lib, 'f1', 'f1')).toBe(lib)
    expect(moveFolder(lib, 'f2', undefined).folders.find(f => f.id === 'f2')?.parentId).toBeUndefined()
  })

  it('builds a sorted tree with folders first', () => {
    let lib = base()
    lib = createPlaylist(lib, { id: 'p2', name: 'b side', now: T0 })
    lib = createPlaylist(lib, { id: 'p3', name: 'A side', now: T0 })
    const tree = buildPlaylistTree(lib)
    expect(tree.playlists.map(p => p.name)).toEqual(['A side', 'b side'])
    expect(tree.folders[0].folder.name).toBe('Gigs')
    expect(tree.folders[0].folders[0].playlists.map(p => p.id)).toEqual(['p1'])
  })

  it('shows items with a dangling parent at the top level', () => {
    const lib: PlaylistLibrary = {
      schemaVersion: 1,
      folders: [{ id: 'f', name: 'Orphan', parentId: 'gone' }],
      playlists: [{ id: 'p', name: 'P', tracks: [], folderId: 'gone', createdAt: 0, updatedAt: 0 }],
    }
    const tree = buildPlaylistTree(lib)
    expect(tree.folders.map(n => n.folder.id)).toEqual(['f'])
    expect(tree.playlists.map(p => p.id)).toEqual(['p'])
  })
})

describe('setPlaylistOrder', () => {
  it('applies a sorted order and keeps unlisted tracks at the end', () => {
    expect(tracksOf(setPlaylistOrder(withPlaylist(['a', 'b', 'c', 'gone']), 'p1', ['c', 'a', 'b', 'zz'], T1))).toEqual(['c', 'a', 'b', 'gone'])
  })
})

describe('describeAdd', () => {
  it('reports added and already-present tracks', () => {
    const before = withPlaylist(['a'])
    expect(describeAdd(before, addTracks(before, 'p1', ['a', 'b', 'c'], T1), 'p1', 3)).toEqual({ text: 'Added 2 tracks to “Warmup” · 1 already there', changed: true })
    expect(describeAdd(before, addTracks(before, 'p1', ['b'], T1), 'p1', 1)).toEqual({ text: 'Added 1 track to “Warmup”', changed: true })
    expect(describeAdd(before, before, 'p1', 1)).toEqual({ text: 'Already in “Warmup”', changed: false })
  })
})

describe('flattenPlaylistTree', () => {
  const lib = () => {
    let l = createFolder(EMPTY_PLAYLIST_LIBRARY, { id: 'f1', name: 'Places' })
    l = createFolder(l, { id: 'f2', name: 'LouLou', parentId: 'f1' })
    l = createFolder(l, { id: 'f3', name: 'Rest' })
    l = createPlaylist(l, { id: 'p1', name: 'LouLou Night', now: T0, folderId: 'f2', tracks: ['x'] })
    l = createPlaylist(l, { id: 'p2', name: 'Flying', now: T0, folderId: 'f3' })
    l = createPlaylist(l, { id: 'p3', name: 'Loose', now: T0, tracks: ['x'] })
    return l
  }

  it('lists folders as labels with playlists indented under them', () => {
    expect(flattenPlaylistTree(lib()).map(e => `${'  '.repeat(e.depth)}${e.kind}:${e.name}`)).toEqual([
      'folder:Places', '  folder:LouLou', '    playlist:LouLou Night', 'folder:Rest', '  playlist:Flying', 'playlist:Loose',
    ])
  })

  it('keeps only matching playlists and the folders leading to them', () => {
    expect(flattenPlaylistTree(lib(), p => p.tracks.includes('x')).map(e => e.name)).toEqual(['Places', 'LouLou', 'LouLou Night', 'Loose'])
    expect(flattenPlaylistTree(lib(), () => false)).toEqual([])
  })
})

describe('resolvePlaylist', () => {
  it('returns songs in playlist order and counts missing ones', () => {
    const song = (file: string): Song => ({ file, artist: 'A', title: file, bpm: 120, key: 'A Minor', camelot: '8A', energy: 0.5, genres: [] })
    const byFile = new Map(['a', 'c'].map(f => [f, song(f)]))
    const lib = withPlaylist(['c', 'x', 'a'])
    const { songs, missing } = resolvePlaylist(lib.playlists[0], byFile)
    expect(songs.map(s => s.file)).toEqual(['c', 'a'])
    expect(missing).toBe(1)
  })
})
