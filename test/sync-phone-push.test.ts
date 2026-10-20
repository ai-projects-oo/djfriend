// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomBytes } from 'crypto'
import { createRelay, memoryStorage } from '../src/syncRelay'
import { httpTransport, pullChanges, pushChanges } from '../app/services/syncProtocol'
import { createPairing, syncNow } from '../app/services/deviceSync'
import { applySyncRound, outgoingRecords, writeLocal, type Outboxed } from '../app/lib/sync/outbox'
import { emptySyncState, liveData, recordKey } from '../app/lib/sync/merge'
import { applySetRecords, applyVinylRecords, playlistItems, releaseItems, setItems, trackItems, vinylItems, type SyncSet } from '../app/lib/sync/records'
import { releasesOf, filterReleases } from '../app/lib/phoneLibrary'
import { editVinylTrack } from '../app/lib/vinylTracks'
import type { DiscogsCollectionEntry, HistoryEntry, PlaylistLibrary, Song, SyncRecord, SyncRecordType, VinylReleaseData, VinylStore, VinylTrackEntry } from '../app/types'

const rnd = (n: number) => new Uint8Array(randomBytes(n))
const ALL = new Set<SyncRecordType>(['track', 'playlist', 'folder', 'set', 'vinylTrack', 'gigLead', 'release'])
const copy = (): Outboxed => ({ state: emptySyncState('phone'), outbox: [] })

describe('outbox', () => {
  it('writeLocal stamps edits, stores them and queues each key once', () => {
    let c = writeLocal(copy(), [{ type: 'set', id: 'live-1', data: { name: 'A' } }], 100)
    c = writeLocal(c, [{ type: 'set', id: 'live-1', data: { name: 'B' } }, { type: 'vinylTrack', id: '42', data: { tracks: [] } }], 100)
    expect(c.outbox).toEqual(['set:live-1', 'vinylTrack:42'])
    expect(liveData<{ name: string }>(c.state, 'set')[0].data.name).toBe('B')
    const recs = outgoingRecords(c)
    expect(recs.map(r => r.hlc.c)).toEqual([1, 2])   // same wall time → logical counter increases
    expect(recs.every(r => r.hlc.d === 'phone')).toBe(true)
  })

  it('writeLocal can delete, and returns the same copy for no edits', () => {
    const c0 = copy()
    expect(writeLocal(c0, [], 1)).toBe(c0)
    let c = writeLocal(c0, [{ type: 'set', id: 's', data: { name: 'x' } }], 1)
    c = writeLocal(c, [{ type: 'set', id: 's', deleted: true }], 2)
    expect(liveData(c.state, 'set')).toHaveLength(0)
    expect(outgoingRecords(c)[0].deleted).toBe(true)
  })

  it('applySyncRound clears sent keys, but keeps ones edited again during the round', () => {
    let c = writeLocal(copy(), [{ type: 'set', id: 'a', data: 1 }, { type: 'set', id: 'b', data: 1 }], 10)
    const sent = outgoingRecords(c)
    c = writeLocal(c, [{ type: 'set', id: 'b', data: 2 }], 11)     // edited while the round ran
    const after = applySyncRound(c, [], sent, 12)
    expect(after.outbox).toEqual(['set:b'])
    expect(after.state.records[recordKey({ type: 'set', id: 'b' })].data).toBe(2)
  })

  it('applySyncRound merges pulled records into the latest copy (local edits made meanwhile survive)', () => {
    let c = copy()
    c = writeLocal(c, [{ type: 'vinylTrack', id: '7', data: { tracks: [] } }], 50)
    const pulled: SyncRecord[] = [{ type: 'playlist', id: 'p', hlc: { t: 40, c: 0, d: 'desk' }, data: { name: 'P' } }]
    const after = applySyncRound(c, pulled, [], 60)
    expect(liveData(after.state, 'playlist').map(x => x.id)).toEqual(['p'])
    expect(liveData(after.state, 'vinylTrack').map(x => x.id)).toEqual(['7'])
    expect(after.outbox).toEqual(['vinylTrack:7'])
  })

  it('a newer remote edit wins over a queued local one, and the key is dropped once sent', () => {
    let c = writeLocal(copy(), [{ type: 'set', id: 's', data: 'phone' }], 10)
    const remote: SyncRecord = { type: 'set', id: 's', hlc: { t: 20, c: 0, d: 'desk' }, data: 'desk' }
    c = applySyncRound(c, [remote], [], 21)
    expect(c.state.records['set:s'].data).toBe('desk')
    // What gets sent next is the current (winning) record — harmless for the other side
    const sent = outgoingRecords(c)
    expect(applySyncRound(c, [], sent, 22).outbox).toEqual([])
  })
})

describe('phone edits reach the desktop', () => {
  const store = memoryStorage()
  const relay = createRelay(store, () => Date.now())
  beforeEach(() => {
    localStorage.clear()
    for (const k of [...store.dump().keys()]) store.dump().delete(k)
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input))
      const r = await relay.handle(init?.method ?? 'GET', u.pathname, u.searchParams, String(init?.body ?? ''))
      return new Response(JSON.stringify(r.body), { status: r.status })
    }) as typeof fetch
  })

  const song: Song = { file: 'a.mp3', artist: 'Kerri Chandler', title: 'Rain', bpm: 122, key: 'A Minor', camelot: '8A', energy: 0.5, genres: ['House'] }
  const lib: PlaylistLibrary = { schemaVersion: 1, playlists: [], folders: [] }
  const collection: DiscogsCollectionEntry = {
    id: 'discogs-collection', username: 'me', syncedAt: 0, totalReleases: 1,
    releases: [{ releaseId: 42, title: 'Atmosphere EP', artist: 'Kerri Chandler', year: 1998, formats: ['Vinyl', '12"'], genres: ['Electronic'], styles: ['Deep House'], inLibrary: false, thumb: 'https://img/x.jpg' }],
  }

  it('a live set log and a vinyl key typed on the phone are applied on the desktop; releases reach the phone', async () => {
    // Desktop pairs and uploads its snapshot (library + Discogs releases)
    const pairing = createPairing('https://relay.test')
    const history: HistoryEntry[] = []
    let vinyl: VinylStore = {}
    const items = () => [...trackItems([song]), ...playlistItems(lib), ...setItems(history), ...vinylItems(vinyl), ...releaseItems(collection)]
    await syncNow(items())

    // Phone: first pull (as phoneSync.syncOnce does), sees the release by name — no image URL
    const t = httpTransport(pairing, globalThis.fetch)
    const first = await pullChanges(t, pairing, emptySyncState('phone'), null, ALL, Date.now())
    let phone = { state: first.state, outbox: [] as string[] }
    const { releases } = releasesOf(phone.state)
    expect(releases).toEqual([{ id: '42', artist: 'Kerri Chandler', title: 'Atmosphere EP', year: 1998, formats: ['Vinyl', '12"'], genres: ['Electronic'], styles: ['Deep House'], tracks: 0, keyed: 0 }])
    expect(JSON.stringify(phone.state)).not.toContain('img/x.jpg')

    // Phone: gig log + a vinyl key, then push the outbox
    const log: SyncSet = { name: 'Played live: Friday', timestamp: 1000, tracks: [{ file: 'a.mp3', artist: song.artist, title: song.title, bpm: 122, camelot: '8A', energy: 0.5 }] }
    const vt: VinylTrackEntry = editVinylTrack({ id: '42-1', position: 'A1', aiFields: ['camelot'] }, { title: 'Atmosphere', camelot: '5A', bpm: 123 })
    phone = writeLocal(phone, [{ type: 'set', id: 'live-1000', data: log }, { type: 'vinylTrack', id: '42', data: { tracks: [vt] } satisfies VinylReleaseData }], Date.now())
    const sent = outgoingRecords(phone)
    await pushChanges(t, pairing, sent, first.cursor, rnd)
    phone = applySyncRound(phone, [], sent, Date.now())
    expect(phone.outbox).toEqual([])

    // Desktop: next sync pulls both and the app applies them
    const r = await syncNow(items())
    const songsByFile = new Map([[song.file, song]])
    const nextHistory = applySetRecords(history, r.applied, songsByFile, { prefs: {} as HistoryEntry['prefs'], curve: [] })
    vinyl = applyVinylRecords(vinyl, r.applied)
    expect(nextHistory.map(h => [h.id, h.name, h.tracks.map(x => x.file)])).toEqual([['live-1000', 'Played live: Friday', ['a.mp3']]])
    expect(vinyl[42].tracks[0]).toMatchObject({ position: 'A1', title: 'Atmosphere', camelot: '5A', bpm: 123 })
    expect(vinyl[42].tracks[0].aiFields).toBeUndefined()
    // The desktop never takes a release (Discogs data) from a phone
    expect(r.applied.some(x => x.type === 'release')).toBe(false)
  })

  it('the desktop ignores release records sent by a phone', async () => {
    const pairing = createPairing('https://relay.test')
    await syncNow([...trackItems([song]), ...releaseItems(collection)])
    const t = httpTransport(pairing, globalThis.fetch)
    await pushChanges(t, pairing, [{ type: 'release', id: '42', hlc: { t: Date.now() + 1e6, c: 0, d: 'phone' }, data: { artist: 'X', title: 'Y', formats: [], genres: [], styles: [] } }], 0, rnd)
    const r = await syncNow([...trackItems([song]), ...releaseItems(collection)])
    expect(r.applied).toEqual([])
  })
})

describe('releases on the phone', () => {
  it('counts keyed tracks per release and searches by artist, title, style and year', () => {
    let c = copy()
    c = writeLocal(c, [
      { type: 'release', id: '1', data: { artist: 'Moodymann', title: 'Silent Introduction', year: 1997, formats: [], genres: ['Electronic'], styles: ['Deep House'] } },
      { type: 'release', id: '2', data: { artist: 'basic channel', title: 'BCD', formats: [], genres: ['Electronic'], styles: ['Dub Techno'] } },
      { type: 'vinylTrack', id: '1', data: { tracks: [{ id: 'a', position: 'A1', camelot: '8A' }, { id: 'b', position: 'A2' }] } },
    ], 1)
    const { releases, vinylById } = releasesOf(c.state)
    expect(releases.map(r => [r.id, r.tracks, r.keyed])).toEqual([['2', 0, 0], ['1', 2, 1]])   // A–Z, case-insensitive
    expect(vinylById.get('1')?.tracks).toHaveLength(2)
    expect(filterReleases(releases, 'dub techno').map(r => r.id)).toEqual(['2'])
    expect(filterReleases(releases, '1997 moody').map(r => r.id)).toEqual(['1'])
    expect(filterReleases(releases, '  ')).toHaveLength(2)
  })
})

describe('editVinylTrack', () => {
  const base: VinylTrackEntry = { id: 't', position: 'A1', bpm: 120, camelot: '8A', aiFields: ['bpm', 'camelot', 'genre'], detectedFields: ['camelot'], keyConfidence: 0.8 }
  it('a hand-entered key is no longer AI-estimated or detected', () => {
    const t = editVinylTrack(base, { camelot: '9A' })
    expect(t).toMatchObject({ camelot: '9A', aiFields: ['bpm', 'genre'] })
    expect(t.detectedFields).toBeUndefined()
    expect(t.keyConfidence).toBeUndefined()
  })
  it('clearing the BPM removes it from the AI fields; title edits leave the flags alone', () => {
    const t = editVinylTrack(base, { bpm: undefined })
    expect(t.bpm).toBeUndefined()
    expect(t.aiFields).toEqual(['camelot', 'genre'])
    expect(t.detectedFields).toEqual(['camelot'])
    expect(editVinylTrack(base, { title: 'x' })).toEqual({ ...base, title: 'x' })
  })
})
