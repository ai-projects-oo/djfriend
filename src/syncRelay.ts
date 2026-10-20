// Device-sync relay (Phase 9). Stores only what paired devices upload: encrypted envelopes under a
// random sync id. It cannot read them — no keys, track names, emails or device identifiers ever reach it.
//
//   PUT    /api/sync/:id/snapshot   { env, seq? } → { seq }     replace the full encrypted snapshot (seq = last batch it includes)
//   GET    /api/sync/:id/snapshot            → { seq, env }
//   POST   /api/sync/:id/changes    { env }  → { seq }          append an encrypted change batch
//   GET    /api/sync/:id/changes?since=N     → { batches: [{ seq, env }], latest, oldest }
//   DELETE /api/sync/:id                     → { ok }           unpair / wipe
import fs from 'fs'
import path from 'path'

export interface RelayStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  del(key: string): Promise<void>
  keys(prefix: string): Promise<string[]>
  /** True when the storage expires idle keys itself (Upstash TTL) — the inactivity sweep is then skipped. */
  readonly expires?: boolean
}

export const RELAY_LIMITS = {
  snapshotBytes: 10 * 1024 * 1024,
  batchBytes: 256 * 1024,
  keepBatches: 2000,
  requestsPerMinute: 60,
  inactiveDays: 90,
}

interface Envelope { n: string; c: string }
interface Meta { seq: number; oldest: number; lastActive: number }
export interface RelayResponse { status: number; body: unknown }

const ID_RE = /^[A-Za-z0-9_-]{22}$/           // 16 random bytes, base64url
const B64URL = /^[A-Za-z0-9_-]+$/

function isEnvelope(v: unknown): v is Envelope {
  const e = v as Envelope
  return !!e && typeof e.n === 'string' && e.n.length === 32 && B64URL.test(e.n) && typeof e.c === 'string' && e.c.length > 0 && B64URL.test(e.c)
}

/** File-backed storage (one small JSON file per key). */
export function fileStorage(dir: string): RelayStorage {
  const file = (k: string) => path.join(dir, `${k.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`)
  return {
    async get(k) { try { return await fs.promises.readFile(file(k), 'utf-8') } catch { return null } },
    async set(k, v) { await fs.promises.mkdir(dir, { recursive: true }); const tmp = `${file(k)}.tmp`; await fs.promises.writeFile(tmp, v, 'utf-8'); await fs.promises.rename(tmp, file(k)) },
    async del(k) { await fs.promises.rm(file(k), { force: true }) },
    async keys(prefix) {
      try { return (await fs.promises.readdir(dir)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(k => k.startsWith(prefix.replace(/[^A-Za-z0-9_.-]/g, '_'))) }
      catch { return [] }
    },
  }
}

/** In-memory storage (tests). */
export function memoryStorage(): RelayStorage & { dump(): Map<string, string> } {
  const m = new Map<string, string>()
  return {
    async get(k) { return m.get(k) ?? null }, async set(k, v) { m.set(k, v) }, async del(k) { m.delete(k) },
    async keys(prefix) { return [...m.keys()].filter(k => k.startsWith(prefix)) }, dump: () => m,
  }
}

export function createRelay(storage: RelayStorage, now: () => number = Date.now) {
  const hits = new Map<string, number[]>()
  const metaKey = (id: string) => `sync_${id}_meta`
  const snapKey = (id: string) => `sync_${id}_snap`
  const batchKey = (id: string, seq: number) => `sync_${id}_b${seq}`

  const loadMeta = async (id: string): Promise<Meta> => {
    const raw = await storage.get(metaKey(id))
    return raw ? JSON.parse(raw) as Meta : { seq: 0, oldest: 1, lastActive: now() }
  }
  const saveMeta = (id: string, m: Meta) => storage.set(metaKey(id), JSON.stringify({ ...m, lastActive: now() }))
  // Reads only refresh `lastActive` hourly, so polling phones don't cost a write each time
  const touchMeta = async (id: string, m: Meta) => { if (now() - m.lastActive > 3_600_000) await saveMeta(id, m) }

  const wipe = async (id: string) => { for (const k of await storage.keys(`sync_${id}_`)) await storage.del(k) }

  const limited = (id: string): boolean => {
    const t = now(), list = (hits.get(id) ?? []).filter(x => t - x < 60_000)
    list.push(t); hits.set(id, list)
    return list.length > RELAY_LIMITS.requestsPerMinute
  }

  /** Removes sync spaces with no activity for `inactiveDays`. */
  async function sweep(): Promise<number> {
    if (storage.expires) return 0
    let removed = 0
    for (const k of await storage.keys('sync_')) {
      if (!k.endsWith('_meta')) continue
      const raw = await storage.get(k); if (!raw) continue
      const m = JSON.parse(raw) as Meta
      if (now() - m.lastActive > RELAY_LIMITS.inactiveDays * 86_400_000) { await wipe(k.slice(5, -5)); removed++ }
    }
    return removed
  }

  async function handle(method: string, pathname: string, query: URLSearchParams, rawBody: string): Promise<RelayResponse> {
    const m = pathname.match(/^\/api\/sync\/([^/]+)(?:\/(snapshot|changes))?\/?$/)
    if (!m) return { status: 404, body: { error: 'Not found' } }
    const [, id, part] = m
    if (!ID_RE.test(id)) return { status: 400, body: { error: 'Invalid sync id' } }
    if (limited(id)) return { status: 429, body: { error: 'Too many requests' } }

    if (method === 'DELETE' && !part) { await wipe(id); return { status: 200, body: { ok: true } } }

    if (part === 'snapshot' && method === 'GET') {
      const raw = await storage.get(snapKey(id))
      if (!raw) return { status: 404, body: { error: 'No snapshot' } }
      const meta = await loadMeta(id); await touchMeta(id, meta)
      return { status: 200, body: JSON.parse(raw) }
    }
    if (part === 'snapshot' && method === 'PUT') {
      if (rawBody.length > RELAY_LIMITS.snapshotBytes) return { status: 413, body: { error: 'Snapshot too large' } }
      let body: { env?: unknown; seq?: unknown }; try { body = JSON.parse(rawBody) as typeof body } catch { return { status: 400, body: { error: 'Invalid JSON' } } }
      const env = body?.env
      if (!isEnvelope(env)) return { status: 400, body: { error: 'Expected an encrypted envelope' } }
      const meta = await loadMeta(id)
      // `seq` = last batch the uploader had merged; batches after it are replayed on top of the snapshot
      const seq = typeof body.seq === 'number' && Number.isInteger(body.seq) && body.seq >= 0 && body.seq <= meta.seq ? body.seq : meta.seq
      await storage.set(snapKey(id), JSON.stringify({ seq, env }))
      await saveMeta(id, meta)
      return { status: 200, body: { seq } }
    }
    if (part === 'changes' && method === 'POST') {
      if (rawBody.length > RELAY_LIMITS.batchBytes) return { status: 413, body: { error: 'Batch too large' } }
      let env: unknown; try { env = (JSON.parse(rawBody) as { env?: unknown }).env } catch { return { status: 400, body: { error: 'Invalid JSON' } } }
      if (!isEnvelope(env)) return { status: 400, body: { error: 'Expected an encrypted envelope' } }
      const meta = await loadMeta(id)
      const seq = meta.seq + 1
      await storage.set(batchKey(id, seq), JSON.stringify(env))
      let oldest = meta.oldest
      while (seq - oldest + 1 > RELAY_LIMITS.keepBatches) { await storage.del(batchKey(id, oldest)); oldest++ }
      await saveMeta(id, { seq, oldest, lastActive: now() })
      return { status: 200, body: { seq } }
    }
    if (part === 'changes' && method === 'GET') {
      const since = Math.max(0, Number(query.get('since') ?? 0) || 0)
      const meta = await loadMeta(id)
      const from = Math.max(since + 1, meta.oldest)
      const batches: { seq: number; env: Envelope }[] = []
      let oldest = meta.oldest
      for (let s = from; s <= meta.seq && batches.length < 200; s++) {
        const raw = await storage.get(batchKey(id, s))
        if (raw) batches.push({ seq: s, env: JSON.parse(raw) as Envelope })
        // Batches expire oldest-first (storage TTL): a missing one means everything up to it is gone —
        // report it so readers fall back to the snapshot
        else if (!batches.length) oldest = s + 1
      }
      if (oldest !== meta.oldest) await saveMeta(id, { ...meta, oldest })
      else await touchMeta(id, meta)
      return { status: 200, body: { batches, latest: meta.seq, oldest } }
    }
    return { status: 405, body: { error: 'Method not allowed' } }
  }

  return { handle, sweep }
}
