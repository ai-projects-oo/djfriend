// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomBytes } from 'crypto'
import { createRelay, memoryStorage, RELAY_LIMITS } from '../src/syncRelay'
import { createPairing, getPairing, syncNow, unpair } from '../app/services/deviceSync'
import { decryptJson, encryptJson } from '../app/lib/sync/crypto'
import { emptySyncState, mergeRemote, recordLocalChanges, liveData } from '../app/lib/sync/merge'
import { trackItems, playlistItems, vinylItems } from '../app/lib/sync/records'
import type { PlaylistLibrary, Song, SyncEnvelope, SyncRecord } from '../app/types'

const rnd = (n: number) => new Uint8Array(randomBytes(n))
const ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const env = (): SyncEnvelope => ({ n: 'n'.repeat(32), c: 'cipher' })

let t = 1_000_000
const clock = () => t

describe('relay', () => {
  it('stores and returns snapshots and change batches', async () => {
    const r = createRelay(memoryStorage(), clock)
    expect((await r.handle('GET', `/api/sync/${ID}/snapshot`, new URLSearchParams(), '')).status).toBe(404)
    expect(await r.handle('POST', `/api/sync/${ID}/changes`, new URLSearchParams(), JSON.stringify({ env: env() }))).toEqual({ status: 200, body: { seq: 1 } })
    expect(await r.handle('POST', `/api/sync/${ID}/changes`, new URLSearchParams(), JSON.stringify({ env: env() }))).toEqual({ status: 200, body: { seq: 2 } })
    expect((await r.handle('PUT', `/api/sync/${ID}/snapshot`, new URLSearchParams(), JSON.stringify({ env: env() }))).body).toEqual({ seq: 2 })
    const page = await r.handle('GET', `/api/sync/${ID}/changes`, new URLSearchParams('since=1'), '')
    expect(page.body).toMatchObject({ latest: 2, oldest: 1, batches: [{ seq: 2 }] })
  })
  it('rejects bad ids, plaintext bodies and oversized payloads', async () => {
    const r = createRelay(memoryStorage(), clock)
    expect((await r.handle('GET', '/api/sync/short/changes', new URLSearchParams(), '')).status).toBe(400)
    expect((await r.handle('POST', `/api/sync/${ID}/changes`, new URLSearchParams(), JSON.stringify({ env: { title: 'plain' } }))).status).toBe(400)
    expect((await r.handle('POST', `/api/sync/${ID}/changes`, new URLSearchParams(), 'x'.repeat(RELAY_LIMITS.batchBytes + 1))).status).toBe(413)
  })
  it('rate-limits a sync id', async () => {
    const r = createRelay(memoryStorage(), clock)
    let last = 0
    for (let i = 0; i <= RELAY_LIMITS.requestsPerMinute; i++) last = (await r.handle('GET', `/api/sync/${ID}/changes`, new URLSearchParams(), '')).status
    expect(last).toBe(429)
  })
  it('unpair wipes everything for that id; inactive spaces are swept', async () => {
    const store = memoryStorage()
    const r = createRelay(store, clock)
    await r.handle('POST', `/api/sync/${ID}/changes`, new URLSearchParams(), JSON.stringify({ env: env() }))
    await r.handle('DELETE', `/api/sync/${ID}`, new URLSearchParams(), '')
    expect(store.dump().size).toBe(0)
    const other = 'BBBBBBBBBBBBBBBBBBBBBB'
    await r.handle('POST', `/api/sync/${other}/changes`, new URLSearchParams(), JSON.stringify({ env: env() }))
    t += (RELAY_LIMITS.inactiveDays + 1) * 86_400_000
    expect(await r.sweep()).toBe(1)
    expect(store.dump().size).toBe(0)
  })
})

describe('desktop ↔ phone through the relay', () => {
  const store = memoryStorage()
  const relay = createRelay(store, () => Date.now())
  beforeEach(() => {
    localStorage.clear()
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input))
      const r = await relay.handle(init?.method ?? 'GET', u.pathname, u.searchParams, String(init?.body ?? ''))
      return new Response(JSON.stringify(r.body), { status: r.status })
    }) as typeof fetch
  })

  it('full round trip; the relay never holds anything readable; unpair cuts the phone off', async () => {
    const library: Song[] = [{ file: 'a.mp3', filePath: '/Users/dj/a.mp3', artist: 'Unique Artist Name', title: 'Very Secret Title', bpm: 124, key: 'A Minor', camelot: '8A', energy: 0.6, genres: ['House'] }]
    const lib: PlaylistLibrary = { schemaVersion: 1, playlists: [{ id: 'p1', name: 'Warmup Playlist', tracks: ['a.mp3'], createdAt: 0, updatedAt: 0 }], folders: [] }
    const pairing = createPairing('https://relay.test')

    // Desktop: first sync uploads the encrypted snapshot
    const first = await syncNow([...trackItems(library), ...playlistItems(lib), ...vinylItems({})])
    expect(first.pushed).toBe(2)

    // Phone: read the snapshot, detect a vinyl key, post it as a change
    const snapRes = await fetch(`${pairing.relay}/api/sync/${pairing.syncId}/snapshot`).then(r => r.json()) as { seq: number; env: SyncEnvelope }
    let phone = mergeRemote(emptySyncState('phone'), decryptJson<SyncRecord[]>(pairing, snapRes.env), Date.now()).state
    expect(liveData<{ title: string }>(phone, 'track')[0].data.title).toBe('Very Secret Title')
    const detected = recordLocalChanges(phone, [{ type: 'vinylTrack', id: '42', data: { tracks: [{ id: 'x', position: 'A1', camelot: '8A', detectedFields: ['camelot'] }] } }], ['vinylTrack'], Date.now())
    phone = detected.state
    await fetch(`${pairing.relay}/api/sync/${pairing.syncId}/changes`, { method: 'POST', body: JSON.stringify({ env: encryptJson(pairing, detected.outgoing, rnd) }) })

    // Desktop: next sync pulls the phone's vinyl key
    const second = await syncNow([...trackItems(library), ...playlistItems(lib), ...vinylItems({})])
    expect(second.applied.map(r => [r.type, r.id])).toEqual([['vinylTrack', '42']])

    // Nothing stored on the relay is readable
    const everything = [...store.dump().values()].join('\n')
    for (const secret of ['Very Secret Title', 'Unique Artist Name', 'Warmup Playlist', '/Users/dj', pairing.key]) expect(everything).not.toContain(secret)

    // Unpair: relay data wiped, local pairing gone
    await unpair()
    expect([...store.dump().keys()].some(k => k.includes(pairing.syncId))).toBe(false)
    expect(getPairing()).toBeNull()
  })

  it('a track record sent by the phone cannot overwrite desktop analysis', async () => {
    const library: Song[] = [{ file: 'a.mp3', artist: 'A', title: 'T', bpm: 124, key: 'A Minor', camelot: '8A', energy: 0.6, genres: [] }]
    const pairing = createPairing('https://relay.test')
    await syncNow(trackItems(library))
    const fake: SyncRecord[] = [{ type: 'track', id: 'a.mp3', hlc: { t: Date.now() + 1e9, c: 0, d: 'phone' }, data: { bpm: 999 } }]
    await fetch(`${pairing.relay}/api/sync/${pairing.syncId}/changes`, { method: 'POST', body: JSON.stringify({ env: encryptJson(pairing, fake, rnd) }) })
    const r = await syncNow(trackItems(library))
    expect(r.applied).toEqual([])
  })
})
