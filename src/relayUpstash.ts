// Upstash Redis storage for the device-sync relay — survives Render restarts on the free plan.
// Keys expire after the relay's inactivity window (every write refreshes its own key), and values
// over CHUNK_BYTES are split so no single request gets near Upstash's request-size limit.
import type { RelayStorage } from './syncRelay.js'

export type RedisCommand = (args: (string | number)[]) => Promise<unknown>

export const CHUNK_BYTES = 512 * 1024
const NS = 'djfriend:relay:'
const PART = '~'   // chunk keys: <key>~0, <key>~1, … (never returned by keys())
const MARKER = '{"$chunks":'

export function upstashStorage(cmd: RedisCommand, ttlSeconds: number): RelayStorage {
  const k = (key: string) => NS + key
  const chunkCount = (raw: unknown): number => {
    if (typeof raw !== 'string' || !raw.startsWith(MARKER)) return 0
    try { return Number((JSON.parse(raw) as { $chunks: number }).$chunks) || 0 } catch { return 0 }
  }
  const delParts = async (key: string, from: number, to: number) => {
    for (let i = from; i < to; i++) await cmd(['DEL', `${k(key)}${PART}${i}`])
  }

  return {
    expires: true,
    async get(key) {
      const raw = await cmd(['GET', k(key)])
      if (typeof raw !== 'string') return null
      const n = chunkCount(raw)
      if (!n) return raw
      const parts: string[] = []
      for (let i = 0; i < n; i++) {
        const p = await cmd(['GET', `${k(key)}${PART}${i}`])
        if (typeof p !== 'string') return null   // partly expired — treat as missing
        parts.push(p)
      }
      return parts.join('')
    },
    async set(key, value) {
      const before = chunkCount(await cmd(['GET', k(key)]))
      if (value.length <= CHUNK_BYTES) {
        await cmd(['SET', k(key), value, 'EX', ttlSeconds])
        await delParts(key, 0, before)
        return
      }
      const n = Math.ceil(value.length / CHUNK_BYTES)
      // Parts first, marker last: a reader never sees a marker whose parts aren't written yet
      for (let i = 0; i < n; i++) await cmd(['SET', `${k(key)}${PART}${i}`, value.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES), 'EX', ttlSeconds])
      await cmd(['SET', k(key), `${MARKER}${n}}`, 'EX', ttlSeconds])
      await delParts(key, n, before)
    },
    async del(key) {
      const n = chunkCount(await cmd(['GET', k(key)]))
      await cmd(['DEL', k(key)])
      await delParts(key, 0, n)
    },
    async keys(prefix) {
      const out: string[] = []
      let cursor = '0'
      do {
        const r = await cmd(['SCAN', cursor, 'MATCH', `${k(prefix)}*`, 'COUNT', 1000]) as [string, string[]]
        cursor = String(r?.[0] ?? '0')
        for (const key of r?.[1] ?? []) if (!key.includes(PART)) out.push(key.slice(NS.length))
      } while (cursor !== '0')
      return out
    },
  }
}
