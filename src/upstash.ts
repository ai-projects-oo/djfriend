// Upstash Redis REST API — no npm deps, pure fetch.
// Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in env to enable.

const url   = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN

export const upstashEnabled = !!(url && token)

async function command(args: (string | number)[]): Promise<unknown> {
  if (!url || !token) return null
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`)
  const data = await res.json() as { result: unknown }
  return data.result
}

export async function redisGet(key: string): Promise<string | null> {
  const result = await command(['GET', key])
  return typeof result === 'string' ? result : null
}

export async function redisSet(key: string, value: string): Promise<void> {
  await command(['SET', key, value])
}
