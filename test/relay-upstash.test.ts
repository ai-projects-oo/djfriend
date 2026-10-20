import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'
import { upstashStorage, CHUNK_BYTES, type RedisCommand } from '../src/relayUpstash'
import { createRelay, memoryStorage, RELAY_LIMITS, type RelayStorage } from '../src/syncRelay'
import { httpTransport, pullChanges, pushChanges, pushSnapshot } from '../app/services/syncProtocol'
import { newPairing } from '../app/lib/sync/crypto'
import { emptySyncState, liveData } from '../app/lib/sync/merge'
import type { SyncRecord, SyncRecordType } from '../app/types'

/** A tiny Redis: GET / SET [EX] / DEL / SCAN MATCH prefix*, with a request-size check like Upstash's. */
function fakeRedis(maxRequest = 1024 * 1024) {
  const data = new Map<string, string>()
  const ttl = new Map<string, number>()
  const calls: (string | number)[][] = []
  const cmd: RedisCommand = async args => {
    calls.push(args)
    if (JSON.stringify(args).length > maxRequest) throw new Error('Upstash HTTP 413')
    const [op, ...rest] = args
    switch (op) {
      case 'GET': return data.get(String(rest[0])) ?? null
      case 'SET': data.set(String(rest[0]), String(rest[1])); if (rest[2] === 'EX') ttl.set(String(rest[0]), Number(rest[3])); return 'OK'
      case 'DEL': return data.delete(String(rest[0])) ? 1 : 0
      case 'SCAN': {
        const prefix = String(rest[2]).replace(/\*$/, '')
        return ['0', [...data.keys()].filter(k => k.startsWith(prefix))]
      }
    }
    throw new Error(`unexpected ${op}`)
  }
  return { cmd, data, ttl, calls }
}

const rnd = (n: number) => new Uint8Array(randomBytes(n))
const ALL = new Set<SyncRecordType>(['track', 'playlist', 'folder', 'set', 'vinylTrack', 'gigLead', 'release'])

describe('upstashStorage', () => {
  it('round-trips small values under a namespace, with the TTL on every write', async () => {
    const r = fakeRedis()
    const s = upstashStorage(r.cmd, 600)
    await s.set('sync_x_meta', '{"seq":1}')
    expect(await s.get('sync_x_meta')).toBe('{"seq":1}')
    expect(r.data.has('djfriend:relay:sync_x_meta')).toBe(true)
    expect(r.ttl.get('djfriend:relay:sync_x_meta')).toBe(600)
    expect(await s.get('missing')).toBeNull()
  })

  it('splits large values into chunks that each fit in one request, and joins them back', async () => {
    const r = fakeRedis()
    const s = upstashStorage(r.cmd, 600)
    const big = 'x'.repeat(CHUNK_BYTES * 2 + 123)
    await s.set('sync_x_snap', big)
    expect(await s.get('sync_x_snap')).toBe(big)
    expect([...r.data.keys()].filter(k => k.includes('~'))).toHaveLength(3)
    expect(Math.max(...r.calls.map(c => JSON.stringify(c).length))).toBeLessThan(1024 * 1024)
    // keys() lists the value once, never its parts
    expect(await s.keys('sync_x_')).toEqual(['sync_x_snap'])
  })

  it('removes leftover parts when a value shrinks, and on delete', async () => {
    const r = fakeRedis()
    const s = upstashStorage(r.cmd, 600)
    await s.set('k', 'y'.repeat(CHUNK_BYTES * 3))
    await s.set('k', 'y'.repeat(CHUNK_BYTES + 1))
    expect([...r.data.keys()].filter(k => k.includes('~'))).toHaveLength(2)
    await s.set('k', 'small')
    expect([...r.data.keys()]).toEqual(['djfriend:relay:k'])
    await s.set('k', 'z'.repeat(CHUNK_BYTES * 2))
    await s.del('k')
    expect(r.data.size).toBe(0)
  })

  it('treats a value with an expired part as missing', async () => {
    const r = fakeRedis()
    const s = upstashStorage(r.cmd, 600)
    await s.set('k', 'q'.repeat(CHUNK_BYTES * 2))
    r.data.delete('djfriend:relay:k~1')
    expect(await s.get('k')).toBeNull()
  })

  it('carries a full relay round trip, including a snapshot over 1 MB', async () => {
    const r = fakeRedis()
    const relay = createRelay(upstashStorage(r.cmd, RELAY_LIMITS.inactiveDays * 86_400))
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input))
      const res = await relay.handle(init?.method ?? 'GET', u.pathname, u.searchParams, String(init?.body ?? ''))
      return new Response(JSON.stringify(res.body), { status: res.status })
    }) as typeof fetch
    const p = newPairing(rnd, 'https://relay.test')
    const t = httpTransport(p, fetchFn)
    // ~1.5 MB of records, as a large library's snapshot would be
    const records: SyncRecord[] = Array.from({ length: 6000 }, (_, i) => ({
      type: 'track', id: `t${i}.mp3`, hlc: { t: 1, c: i, d: 'desk' },
      data: { artist: `Artist ${i}`, title: `Title ${i} `.padEnd(120, '.'), bpm: 120, key: '', camelot: '8A', energy: 0.5, genres: [] },
    }))
    await pushSnapshot(t, p, records, 0, rnd)
    await pushChanges(t, p, [{ type: 'playlist', id: 'p1', hlc: { t: 2, c: 0, d: 'desk' }, data: { name: 'P' } }], 0, rnd)
    const got = await pullChanges(t, p, emptySyncState('phone'), null, ALL, 10)
    expect(liveData(got.state, 'track')).toHaveLength(6000)
    expect(liveData(got.state, 'playlist').map(x => x.id)).toEqual(['p1'])
  })

  it('the relay skips its inactivity sweep on self-expiring storage', async () => {
    const r = fakeRedis()
    const s = upstashStorage(r.cmd, 600)
    const relay = createRelay(s)
    expect(await relay.sweep()).toBe(0)
    expect(r.calls).toHaveLength(0)
  })
})

describe('relay on expiring storage', () => {
  function countingStorage(): RelayStorage & { writes: number; dump(): Map<string, string> } {
    const inner = memoryStorage()
    const s = { ...inner, writes: 0, async set(k: string, v: string) { s.writes++; await inner.set(k, v) } }
    return s
  }
  const id = 'A'.repeat(22)
  const env = () => JSON.stringify({ env: { n: 'n'.repeat(32), c: 'abc' } })

  it('reports batches that expired as pruned, so readers fall back to the snapshot', async () => {
    const store = countingStorage()
    const relay = createRelay(store)
    for (let i = 0; i < 3; i++) await relay.handle('POST', `/api/sync/${id}/changes`, new URLSearchParams(), env())
    store.dump().delete(`sync_${id}_b1`)
    store.dump().delete(`sync_${id}_b2`)
    const r = await relay.handle('GET', `/api/sync/${id}/changes`, new URLSearchParams('since=0'), '')
    expect(r.body).toMatchObject({ latest: 3, oldest: 3 })
    expect((r.body as { batches: { seq: number }[] }).batches.map(b => b.seq)).toEqual([3])
    // A reader whose cursor is inside the gap gets the gap reported too
    const r2 = await relay.handle('GET', `/api/sync/${id}/changes`, new URLSearchParams('since=1'), '')
    expect(r2.body).toMatchObject({ oldest: 3 })
  })

  it('polling reads do not write on every request', async () => {
    let t = 1_000_000
    const store = countingStorage()
    const relay = createRelay(store, () => t)
    await relay.handle('POST', `/api/sync/${id}/changes`, new URLSearchParams(), env())
    const before = store.writes
    for (let i = 0; i < 10; i++) { t += 600_000; await relay.handle('GET', `/api/sync/${id}/changes`, new URLSearchParams('since=1'), '') }
    expect(store.writes).toBe(before + 1)   // one refresh once an hour had passed
  })
})
