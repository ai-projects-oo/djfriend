import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { MUSIC_EXPORT_FN, validateExportJob, friendlyError, type MusicExportJob, type MusicExportResult } from '../src/apple-music-export'

// ─── A fake Music.app that follows JXA conventions ───────────────────────────
// Reading a property is a call (`pl.name()`), writing is an assignment (`pl.name = 'x'`).

interface TrackState { id: number; location: string | null; bpm: number; grouping: string; comment: string }
interface PlaylistState { pid: string; kind: 'folder' | 'user'; name: string; parent: string | null; entries: number[] }

function jxa<T extends object>(state: T, methods: Record<string, unknown>) {
  return new Proxy({} as Record<string, unknown>, {
    get(_, k: string) { return k in methods ? methods[k] : () => (state as Record<string, unknown>)[k] },
    set(_, k: string, v) { (state as Record<string, unknown>)[k] = v; return true },
  })
}

class FakeMusic {
  tracks: TrackState[] = []
  playlists: PlaylistState[] = []
  addable = new Set<string>()        // files that exist on "disk" and can be added
  failAdd = new Set<string>()
  log: unknown[] = []
  private nextPid = 1
  private nextTrack = 100

  addTrack(location: string, extra: Partial<TrackState> = {}): number {
    const id = this.nextTrack++
    this.tracks.push({ id, location, bpm: 0, grouping: '', comment: '', ...extra })
    return id
  }
  addPlaylist(kind: PlaylistState['kind'], name: string, parent: string | null = null, entries: number[] = []): PlaylistState {
    const pl = { pid: `PID${this.nextPid++}`, kind, name, parent, entries }
    this.playlists.push(pl)
    return pl
  }
  find(name: string) { return this.playlists.find(p => p.name === name) }
  namesIn(parentPid: string | null) { return this.playlists.filter(p => p.parent === parentPid).map(p => p.name).sort() }
  titles(pl: PlaylistState) { return pl.entries.map(id => this.tracks.find(t => t.id === id)!.location) }

  trackProxy(t: TrackState) { return jxa(t, {}) }
  playlistProxy(pl: PlaylistState): Record<string, unknown> {
    return jxa(pl, {
      __state: pl,
      class: () => (pl.kind === 'folder' ? 'folderPlaylist' : 'userPlaylist'),
      persistentID: () => pl.pid,
      parent: () => {
        const parent = this.playlists.find(p => p.pid === pl.parent)
        if (!parent) throw new Error('Can’t get parent')
        return this.playlistProxy(parent)
      },
      tracks: () => pl.entries.map((id) => ({ delete: () => { pl.entries.splice(pl.entries.indexOf(id), 1) } })),
    })
  }
  // Like real Music: every playlist kind is queried through `playlists`
  allPlaylists() {
    return {
      whose: (q: { persistentID?: string; name?: string }) => () => this.playlists
        .filter(p => (q.persistentID === undefined || p.pid === q.persistentID) && (q.name === undefined || p.name === q.name))
        .map(p => this.playlistProxy(p)),
    }
  }

  get app() {
    const lib = {
      fileTracks: {
        id: () => this.tracks.map(t => t.id),
        location: () => this.tracks.map(t => (t.location ? { toString: () => t.location } : null)),
      },
      tracks: { byId: (id: number) => this.trackProxy(this.tracks.find(t => t.id === id)!) },
    }
    return {
      libraryPlaylists: [lib],
      playlists: this.allPlaylists(),
      // Real Music: these exist but can't be queried with whose() (folders never show up in userPlaylists)
      folderPlaylists: {},
      userPlaylists: { whose: () => () => [] },
      make: ({ new: cls, withProperties }: { new: string; withProperties: { name: string } }) =>
        this.playlistProxy(this.addPlaylist(cls === 'folderPlaylist' ? 'folder' : 'user', withProperties.name)),
      move: (pl: { __state: PlaylistState }, { to }: { to: { __state: PlaylistState } }) => { pl.__state.parent = to.__state.pid },
      add: (p: { path: string }) => {
        if (this.failAdd.has(p.path) || !this.addable.has(p.path)) throw new Error('File not found')
        const id = this.addTrack(p.path)
        return this.trackProxy(this.tracks.find(t => t.id === id)!)
      },
      duplicate: (t: { id: () => number }, { to }: { to: { __state: PlaylistState } }) => { to.__state.entries.push(t.id()) },
    }
  }

  run(job: MusicExportJob): MusicExportResult {
    const exportToMusic = new Function(`${MUSIC_EXPORT_FN}; return exportToMusic;`)() as
      (job: MusicExportJob, Music: unknown, Path: (p: string) => { path: string }, log: (o: unknown) => void) => MusicExportResult
    return exportToMusic(job, this.app, (p: string) => ({ path: p }), o => this.log.push(o))
  }
}

const job = (over: Partial<MusicExportJob> = {}): MusicExportJob => ({
  rootFolderName: 'DJFriend',
  folders: [{ id: 'f1', name: 'Gigs' }],
  playlists: [
    { id: 'p1', name: 'Friday', folderId: 'f1', files: ['/m/a.mp3', '/m/b.mp3'] },
    { id: 'p2', name: 'Warmup', files: ['/m/c.mp3'] },
  ],
  addMissing: false,
  ...over,
})

describe('Music export script', () => {
  let music: FakeMusic
  beforeEach(() => {
    music = new FakeMusic()
    for (const f of ['/m/a.mp3', '/m/b.mp3', '/m/c.mp3']) music.addTrack(f)
  })

  it('creates DJFriend/<folders>/<playlists> with tracks in order on first export', () => {
    const r = music.run(job())
    const root = music.find('DJFriend')!
    expect(root.kind).toBe('folder')
    expect(root.parent).toBeNull()
    expect(music.namesIn(root.pid)).toEqual(['Gigs', 'Warmup'])
    const gigs = music.find('Gigs')!
    expect(music.namesIn(gigs.pid)).toEqual(['Friday'])
    expect(music.titles(music.find('Friday')!)).toEqual(['/m/a.mp3', '/m/b.mp3'])
    expect(r.rootFolderId).toBe(root.pid)
    expect(r.folders).toEqual({ f1: gigs.pid })
    expect(r.playlists.p1).toEqual({ appleMusicId: music.find('Friday')!.pid, added: 2, skipped: [] })
  })

  it('updates linked playlists in place on the next export: rename, reorder, remove — no duplicates', () => {
    const first = music.run(job())
    const count = music.playlists.length
    const second = music.run(job({
      rootFolderId: first.rootFolderId,
      folders: [{ id: 'f1', name: 'Gigs 2026', appleMusicId: first.folders.f1 }],
      playlists: [
        { id: 'p1', name: 'Friday Peak', folderId: 'f1', appleMusicId: first.playlists.p1.appleMusicId, files: ['/m/b.mp3', '/m/c.mp3'] },
        { id: 'p2', name: 'Warmup', appleMusicId: first.playlists.p2.appleMusicId, files: [] },
      ],
    }))
    expect(music.playlists.length).toBe(count)
    expect(second.playlists.p1.appleMusicId).toBe(first.playlists.p1.appleMusicId)
    const friday = music.playlists.find(p => p.pid === first.playlists.p1.appleMusicId)!
    expect(friday.name).toBe('Friday Peak')
    expect(music.titles(friday)).toEqual(['/m/b.mp3', '/m/c.mp3'])
    expect(music.playlists.find(p => p.pid === first.folders.f1)!.name).toBe('Gigs 2026')
    expect(music.find('Warmup')!.entries).toEqual([])
  })

  it('moves a linked playlist back into its folder if it was moved in Music', () => {
    const first = music.run(job())
    music.find('Friday')!.parent = null
    music.run(job({ rootFolderId: first.rootFolderId, folders: [{ id: 'f1', name: 'Gigs', appleMusicId: first.folders.f1 }],
      playlists: [{ id: 'p1', name: 'Friday', folderId: 'f1', appleMusicId: first.playlists.p1.appleMusicId, files: ['/m/a.mp3'] }] }))
    expect(music.find('Friday')!.parent).toBe(first.folders.f1)
  })

  it('reuses an existing top-level "DJFriend" folder, but not a nested one with that name', () => {
    const other = music.addPlaylist('folder', 'Other')
    music.addPlaylist('folder', 'DJFriend', other.pid)
    const existing = music.addPlaylist('folder', 'DJFriend')
    const r = music.run(job())
    expect(r.rootFolderId).toBe(existing.pid)
    expect(music.playlists.filter(p => p.name === 'DJFriend')).toHaveLength(2)
  })

  it('never touches playlists it did not create, even with the same name', () => {
    const mine = music.addPlaylist('user', 'Friday', null, [music.tracks[2].id])
    music.run(job())
    expect(mine.entries).toEqual([music.tracks[2].id])
    expect(mine.parent).toBeNull()
    expect(music.playlists.filter(p => p.name === 'Friday')).toHaveLength(2)
  })

  it('skips files not in Music unless addMissing is on', () => {
    const j = job({ playlists: [{ id: 'p1', name: 'New', files: ['/m/a.mp3', '/m/new.mp3'] }], folders: [] })
    music.addable.add('/m/new.mp3')
    const off = music.run(j)
    expect(off.playlists.p1).toMatchObject({ added: 1, skipped: ['/m/new.mp3'] })
    expect(off.addedToLibrary).toBe(0)

    const on = music.run({ ...j, addMissing: true, rootFolderId: off.rootFolderId,
      playlists: [{ ...j.playlists[0], appleMusicId: off.playlists.p1.appleMusicId }] })
    expect(on.addedToLibrary).toBe(1)
    expect(on.playlists.p1).toMatchObject({ added: 2, skipped: [] })
    expect(music.titles(music.find('New')!)).toEqual(['/m/a.mp3', '/m/new.mp3'])
  })

  it('records an error and skips a file Music refuses to add', () => {
    music.failAdd.add('/m/bad.mp3')
    const r = music.run(job({ addMissing: true, folders: [], playlists: [{ id: 'p1', name: 'X', files: ['/m/bad.mp3', '/m/a.mp3'] }] }))
    expect(r.errors[0]).toMatch(/Could not add \/m\/bad\.mp3/)
    expect(r.playlists.p1).toMatchObject({ added: 1, skipped: ['/m/bad.mp3'] })
  })

  it('writes BPM and key into the grouping field', () => {
    const r = music.run(job({ writeBack: { keyField: 'grouping', tracks: { '/m/a.mp3': { bpm: 123.6, camelot: '8A' }, '/m/zzz.mp3': { bpm: 120 } } } }))
    const a = music.tracks.find(t => t.location === '/m/a.mp3')!
    expect(a).toMatchObject({ bpm: 124, grouping: '8A', comment: '' })
    expect(r.tagged).toBe(1)
  })

  it('puts the key in front of the comment, replacing an older key', () => {
    music.tracks[0].comment = 'Great tune'
    music.tracks[1].comment = '5B · Old key here'
    music.run(job({ writeBack: { keyField: 'comment', tracks: { '/m/a.mp3': { camelot: '8A' }, '/m/b.mp3': { camelot: '12B' }, '/m/c.mp3': { camelot: '1A' } } } }))
    expect(music.tracks.map(t => t.comment)).toEqual(['8A · Great tune', '12B · Old key here', '1A'])
    expect(music.tracks[0].bpm).toBe(0)
  })

  it('reports progress phases', () => {
    music.run(job())
    const phases = music.log.map(l => (l as { phase: string }).phase)
    expect(phases[0]).toBe('index')
    expect(phases).toContain('playlist')
  })
})

describe('validateExportJob', () => {
  const exists = (p: string) => p.startsWith('/m/')

  it('keeps existing local audio files and drops the rest', () => {
    const j = validateExportJob({
      rootFolderName: 'DJFriend', folders: [], addMissing: true,
      playlists: [{ id: 'p1', name: 'X', files: ['/m/a.mp3', 'relative.mp3', '/m/notes.txt', '/gone/x.mp3', '/m/a.mp3', 5] }],
    }, exists)
    expect(j.playlists[0].files).toEqual(['/m/a.mp3'])
    expect(j.addMissing).toBe(true)
  })

  it('rejects jobs with nothing to export', () => {
    expect(() => validateExportJob(null, exists)).toThrow()
    expect(() => validateExportJob({ folders: [], playlists: [] }, exists)).toThrow(/Nothing to export/)
    expect(() => validateExportJob({ folders: [], playlists: [{ name: 'no id', files: [] }] }, exists)).toThrow(/Nothing to export/)
  })

  it('cleans write-back data: valid BPM and Camelot keys only', () => {
    const j = validateExportJob({
      folders: [], playlists: [{ id: 'p', name: 'P', files: ['/m/a.mp3'] }],
      writeBack: { keyField: 'weird', tracks: { '/m/a.mp3': { bpm: 124, camelot: '8A' }, '/m/b.mp3': { bpm: -1, camelot: '13A' }, '/x/c.mp3': { bpm: 120 } } },
    }, exists)
    expect(j.writeBack).toEqual({ keyField: 'grouping', tracks: { '/m/a.mp3': { bpm: 124, camelot: '8A' } } })
  })

  it('defaults the root folder name and normalises file names to NFC', () => {
    const decomposed = '/m/café.mp3'
    const j = validateExportJob({ folders: [], playlists: [{ id: 'p', name: 'P', files: [decomposed] }] }, exists)
    expect(j.rootFolderName).toBe('DJFriend')
    expect(j.playlists[0].files[0]).toBe('/m/café.mp3'.normalize('NFC'))
  })
})

describe('friendlyError', () => {
  it('explains the Automation permission error', () => {
    expect(friendlyError('execution error: Not authorized to send Apple events to Music. (-1743)')).toMatch(/Automation/)
  })
  it('strips osascript noise', () => {
    expect(friendlyError('export.js: execution error: Something broke (-2700)')).toBe('Something broke (-2700)')
  })
})

// ─── runMusicExport with a fake osascript process ────────────────────────────

const spawned: { args: string[] }[] = []
let scriptOutput: { stdout: string; stderr: string[]; code: number } = { stdout: '', stderr: [], code: 0 }
vi.mock('child_process', async (orig) => {
  const real = await orig<typeof import('child_process')>()
  return {
    ...real,
    spawn: (_cmd: string, args: string[]) => {
      spawned.push({ args })
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => setTimeout(() => child.emit('close', null), 0)
      setTimeout(() => {
        for (const line of scriptOutput.stderr) child.stderr.emit('data', Buffer.from(line + '\n'))
        child.stdout.emit('data', Buffer.from(scriptOutput.stdout))
        child.emit('close', scriptOutput.code)
      }, 0)
      return child
    },
  }
})

describe('runMusicExport', () => {
  const result: MusicExportResult = { rootFolderId: 'R', folders: {}, playlists: {}, addedToLibrary: 0, tagged: 0, errors: [] }

  it('streams progress and resolves with the script result', async () => {
    const { runMusicExport } = await import('../src/apple-music-export')
    scriptOutput = { stdout: JSON.stringify(result), stderr: ['PROGRESS {"phase":"index"}', 'some osascript noise', 'PROGRESS {"phase":"playlist","name":"X","index":0,"total":1}'], code: 0 }
    const progress: unknown[] = []
    await expect(runMusicExport(job(), { onProgress: p => progress.push(p) })).resolves.toEqual(result)
    expect(progress).toEqual([{ phase: 'index' }, { phase: 'playlist', name: 'X', index: 0, total: 1 }])
    const args = spawned.at(-1)!.args
    expect(args.slice(0, 2)).toEqual(['-l', 'JavaScript'])
  })

  it('rejects with a readable message when osascript fails', async () => {
    const { runMusicExport } = await import('../src/apple-music-export')
    scriptOutput = { stdout: '', stderr: ['execution error: Not authorized to send Apple events to Music. (-1743)'], code: 1 }
    await expect(runMusicExport(job())).rejects.toThrow(/Automation/)
  })
})
