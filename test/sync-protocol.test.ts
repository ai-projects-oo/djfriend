// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomBytes } from 'crypto'
import { createRelay, memoryStorage, RELAY_LIMITS } from '../src/syncRelay'
import { httpTransport, pullChanges, pushChanges, pushSnapshot, RelayError, type RelayTransport } from '../app/services/syncProtocol'
import { createPairing, syncNow } from '../app/services/deviceSync'
import { newPairing } from '../app/lib/sync/crypto'
import { emptySyncState, liveData, recordLocalChanges } from '../app/lib/sync/merge'
import { playlistItems, trackItems } from '../app/lib/sync/records'
import type { PairingPayload, PlaylistLibrary, Song, SyncRecord, SyncRecordType } from '../app/types'

const rnd = (n: number) => new Uint8Array(randomBytes(n))
const ALL = new Set<SyncRecordType>(['track', 'playlist', 'folder', 'set', 'vinylTrack', 'gigLead'])

function setup() {
  const store = memoryStorage()
  const relay = createRelay(store, () => Date.now())
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input))
    const r = await relay.handle(init?.method ?? 'GET', u.pathname, u.searchParams, String(init?.body ?? ''))
    return new Response(JSON.stringify(r.body), { status: r.status })
  }) as typeof fetch
  const p = newPairing(rnd, 'https://relay.test')
  return { store, relay, fetchFn, p, t: httpTransport(p, fetchFn) }
}

const rec = (id: string, t: number, data: unknown = { name: id }): SyncRecord => ({ type: 'playlist', id, hlc: { t, c: 0, d: 'desk' }, data })

describe('sync protocol', () => {
  it('a newly paired phone starts from the snapshot, then replays later batches', async () => {
    const { p, t } = setup()
    await pushChanges(t, p, [rec('old', 1)], 0, rnd)                     // seq 1 — already in the snapshot
    await pushSnapshot(t, p, [rec('old', 1), rec('snap', 2)], 1, rnd)
    await pushChanges(t, p, [rec('later', 3)], 1, rnd)                   // seq 2 — after the snapshot

    const r = await pullChanges(t, p, emptySyncState('phone'), null, ALL, 10)
    expect(r.cursor).toBe(2)
    expect(r.reset).toBe(false)
    expect(liveData(r.state, 'playlist').map(x => x.id).sort()).toEqual(['later', 'old', 'snap'])
  })

  it('without a snapshot, a fresh phone reads batches from the start', async () => {
    const { p, t } = setup()
    await pushChanges(t, p, [rec('a', 1)], 0, rnd)
    const r = await pullChanges(t, p, emptySyncState('phone'), null, ALL, 10)
    expect(r.cursor).toBe(1)
    expect(r.applied.map(x => x.id)).toEqual(['a'])
  })

  it('a phone batch posted while the desktop builds its snapshot is not skipped by a new phone', async () => {
    const { p, t } = setup()
    await pushChanges(t, p, [rec('desk', 1)], 0, rnd)                    // seq 1, desktop has merged it
    await pushChanges(t, p, [{ ...rec('phoneEdit', 2), hlc: { t: 2, c: 0, d: 'phone' } }], 1, rnd)   // seq 2, desktop hasn't seen it
    await pushSnapshot(t, p, [rec('desk', 1)], 1, rnd)                   // desktop's cursor is still 1
    const r = await pullChanges(t, p, emptySyncState('phone2'), null, ALL, 10)
    expect(liveData(r.state, 'playlist').map(x => x.id).sort()).toEqual(['desk', 'phoneEdit'])
  })

  it('only merges accepted record types', async () => {
    const { p, t } = setup()
    await pushChanges(t, p, [rec('pl', 1), { type: 'track', id: 'x.mp3', hlc: { t: 1, c: 0, d: 'phone' }, data: { bpm: 999 } }], 0, rnd)
    const r = await pullChanges(t, p, emptySyncState('desk'), 0, new Set<SyncRecordType>(['playlist']), 10)
    expect(r.applied.map(x => x.type)).toEqual(['playlist'])
    expect(r.pulled).toBe(1)
  })

  it('detects a wiped relay and re-reads from the start', async () => {
    const { p, t, relay } = setup()
    for (let i = 1; i <= 3; i++) await pushChanges(t, p, [rec(`r${i}`, i)], i - 1, rnd)
    const first = await pullChanges(t, p, emptySyncState('phone'), null, ALL, 10)
    expect(first.cursor).toBe(3)

    await relay.handle('DELETE', `/api/sync/${p.syncId}`, new URLSearchParams(), '')   // relay restarted without storage
    await pushChanges(t, p, [rec('after', 10)], 0, rnd)                                   // seq 1 again

    const second = await pullChanges(t, p, first.state, first.cursor, ALL, 20)
    expect(second.reset).toBe(true)
    expect(second.cursor).toBe(1)
    expect(second.applied.map(x => x.id)).toEqual(['after'])
  })

  it('falls back to the snapshot when the needed batches were pruned', async () => {
    const keep = RELAY_LIMITS.keepBatches
    RELAY_LIMITS.keepBatches = 2
    try {
      const { p, t } = setup()
      for (let i = 1; i <= 4; i++) await pushChanges(t, p, [rec(`b${i}`, i)], i - 1, rnd)   // keeps seq 3–4
      await pushSnapshot(t, p, [rec('b1', 1), rec('b2', 2), rec('b3', 3)], 3, rnd)
      const r = await pullChanges(t, p, emptySyncState('phone'), 1, ALL, 10)
      expect(r.cursor).toBe(4)
      expect(liveData(r.state, 'playlist').map(x => x.id).sort()).toEqual(['b1', 'b2', 'b3', 'b4'])
    } finally { RELAY_LIMITS.keepBatches = keep }
  })

  it('splits large pushes into several batches and advances the cursor past its own batches', async () => {
    const { p, t } = setup()
    const big = Array.from({ length: 30 }, (_, i) => rec(`p${i}`, i + 1, { name: 'x'.repeat(1000) }))
    const cursor = await pushChanges(t, p, big, 0, rnd, 5_000)
    expect(cursor).toBeGreaterThan(5)
    const page = await t.getChanges(0)
    expect(page.latest).toBe(cursor)
  })

  it('does not advance the cursor over a batch from another device', async () => {
    const { p, t } = setup()
    await pushChanges(t, p, [rec('other', 1)], 0, rnd)        // another device's batch: seq 1
    const cursor = await pushChanges(t, p, [rec('mine', 2)], 0, rnd)   // ours: seq 2, but we haven't read seq 1
    expect(cursor).toBe(0)
  })

  it('getSnapshot: 404 → null, other errors throw', async () => {
    const { p, t } = setup()
    expect(await t.getSnapshot()).toBeNull()
    const failing = httpTransport(p, (async () => new Response('{}', { status: 500 })) as typeof fetch)
    await expect(failing.getSnapshot()).rejects.toBeInstanceOf(RelayError)
    await expect(failing.getChanges(0)).rejects.toMatchObject({ status: 500 })
  })
})

describe('relay snapshot seq', () => {
  const put = async (relay: ReturnType<typeof setup>['relay'], p: PairingPayload, body: unknown) =>
    (await relay.handle('PUT', `/api/sync/${p.syncId}/snapshot`, new URLSearchParams(), JSON.stringify(body))).body
  const env = { n: 'n'.repeat(32), c: 'cipher' }

  it('stores the uploader seq, clamped to the latest batch; ignores invalid values', async () => {
    const { relay, p, t } = setup()
    for (let i = 1; i <= 3; i++) await pushChanges(t, p, [rec(`r${i}`, i)], i - 1, rnd)
    expect(await put(relay, p, { env, seq: 1 })).toEqual({ seq: 1 })
    expect(await put(relay, p, { env, seq: 99 })).toEqual({ seq: 3 })
    expect(await put(relay, p, { env, seq: -1 })).toEqual({ seq: 3 })
    expect(await put(relay, p, { env, seq: 1.5 })).toEqual({ seq: 3 })
    expect(await put(relay, p, { env })).toEqual({ seq: 3 })
  })
})

describe('desktop after a relay reset', () => {
  const { relay, store } = setup()
  beforeEach(() => {
    localStorage.clear()
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input))
      const r = await relay.handle(init?.method ?? 'GET', u.pathname, u.searchParams, String(init?.body ?? ''))
      return new Response(JSON.stringify(r.body), { status: r.status })
    }) as typeof fetch
  })

  it('re-uploads the full snapshot so phones can start again', async () => {
    const library: Song[] = [{ file: 'a.mp3', artist: 'A', title: 'T', bpm: 124, key: 'A Minor', camelot: '8A', energy: 0.6, genres: [] }]
    let lib: PlaylistLibrary = { schemaVersion: 1, playlists: [{ id: 'p1', name: 'One', tracks: ['a.mp3'], createdAt: 0, updatedAt: 0 }], folders: [] }
    const pairing = createPairing('https://relay.test')
    await syncNow([...trackItems(library), ...playlistItems(lib)])
    // A few changes so the desktop's cursor moves past 0
    for (let i = 2; i <= 3; i++) {
      lib = { ...lib, playlists: [...lib.playlists, { id: `p${i}`, name: `P${i}`, tracks: [], createdAt: 0, updatedAt: 0 }] }
      await syncNow([...trackItems(library), ...playlistItems(lib)])
    }
    expect(JSON.parse(localStorage.getItem('djfriend-sync-cursor') ?? '0')).toBe(2)

    // Relay restarts with empty storage
    for (const k of [...store.dump().keys()]) store.dump().delete(k)
    await syncNow([...trackItems(library), ...playlistItems(lib)])

    const t = httpTransport(pairing, globalThis.fetch)
    const r = await pullChanges(t, pairing, emptySyncState('phone'), null, ALL, Date.now())
    expect(liveData(r.state, 'playlist').map(x => x.id).sort()).toEqual(['p1', 'p2', 'p3'])
    expect(liveData(r.state, 'track').map(x => x.id)).toEqual(['a.mp3'])
  })
})

describe('recordLocalChanges + push round trip', () => {
  it('a phone edit pushed through the protocol reaches another device', async () => {
    const { p, t } = setup()
    const phone = recordLocalChanges(emptySyncState('phone'), [{ type: 'set', id: 's1', data: { name: 'Live log', timestamp: 1, tracks: [] } }], ['set'], 5)
    await pushChanges(t, p, phone.outgoing, 0, rnd)
    const desk = await pullChanges(t, p, emptySyncState('desk'), 0, new Set<SyncRecordType>(['set']), 6)
    expect(desk.applied.map(r => r.id)).toEqual(['s1'])
  })

  it('uses the injected fetch, never a global one', async () => {
    const { p, fetchFn } = setup()
    const spy = vi.fn(fetchFn)
    const t: RelayTransport = httpTransport(p, spy as typeof fetch)
    await t.getChanges(0)
    expect(spy).toHaveBeenCalledOnce()
  })
})
