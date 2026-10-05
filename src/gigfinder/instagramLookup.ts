// DDG-based Instagram handle lookup for venues.
// For each venue without an explicit `contact:instagram` OSM tag, query
// DuckDuckGo once with the venue name and city, and pull the handle out of
// the first plausible instagram.com result. Aggressively cached to disk so
// subsequent runs are instant.

import fs from 'fs'
import path from 'path'
import os from 'os'

interface CacheEntry {
  handle: string | null   // null = confirmed no IG found
  checkedAt: string       // ISO
  sourceUrl?: string
}

const CACHE_PATH = path.join(os.homedir(), 'Music', 'djfriend-instagram-cache.json')
const POSITIVE_TTL_DAYS = 180
const NEGATIVE_TTL_DAYS = 30
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const IG_HANDLE_SKIP = new Set(['p', 'tv', 'reel', 'reels', 'explore', 'stories', 'accounts', 'direct', 'about', 'developer'])

// ─── Cache I/O ────────────────────────────────────────────────────────────────

type Cache = Record<string, CacheEntry>

function normalizeKey(venueName: string, city: string): string {
  return `${venueName.toLowerCase().trim()}|${city.toLowerCase().trim()}`
}

function loadCache(): Cache {
  try {
    if (!fs.existsSync(CACHE_PATH)) return {}
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) as Cache
  } catch {
    return {}
  }
}

function saveCache(cache: Cache): void {
  try {
    const dir = path.dirname(CACHE_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache), 'utf-8')
  } catch {
    /* non-fatal */
  }
}

function isFresh(entry: CacheEntry): boolean {
  const ageDays = (Date.now() - new Date(entry.checkedAt).getTime()) / (1000 * 60 * 60 * 24)
  const ttl = entry.handle ? POSITIVE_TTL_DAYS : NEGATIVE_TTL_DAYS
  return ageDays < ttl
}

// ─── DDG lookup + handle extraction ───────────────────────────────────────────

function extractHandleFromHtml(html: string): { handle: string; url: string } | null {
  // Prefer direct instagram.com/{handle} matches in href attributes
  const linkRe = /<a[^>]+href="(https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{2,30}))(?:\/|"|\?)/gi
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) !== null) {
    const handle = m[2].toLowerCase()
    if (IG_HANDLE_SKIP.has(handle)) continue
    return { handle, url: m[1] }
  }
  // Fallback: bare mention pattern
  const textRe = /instagram\.com\/([a-zA-Z0-9._]{2,30})(?=[/"?\s<]|$)/gi
  while ((m = textRe.exec(html)) !== null) {
    const handle = m[1].toLowerCase()
    if (IG_HANDLE_SKIP.has(handle)) continue
    return { handle, url: `https://www.instagram.com/${handle}/` }
  }
  return null
}

async function ddgLookup(venueName: string, city: string, timeoutMs = 8000): Promise<{ handle: string; url: string } | null> {
  const query = `"${venueName}" ${city} instagram`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const params = new URLSearchParams({ q: query, kl: 'il-he' })
    const resp = await fetch(`https://lite.duckduckgo.com/lite/?${params}`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9,he;q=0.8',
      },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!resp.ok) return null
    const html = await resp.text()
    return extractHandleFromHtml(html)
  } catch {
    return null
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface LookupResult {
  venueName: string
  handle: string | null
  fromCache: boolean
  sourceUrl?: string
}

/**
 * Look up Instagram handles for a batch of venues. Runs cache hits instantly,
 * and only makes DDG requests for uncached venues. Emits progress via onLog.
 *
 * @param venues — array of (venueName, city) tuples
 * @param maxLookups — cap for uncached network lookups per run (default 200)
 * @param concurrency — parallel DDG queries (default 3, DDG rate-limits above)
 * @param interBatchDelayMs — delay between concurrent batches (default 700ms)
 */
export async function lookupInstagramHandles(
  venues: { venueName: string; city: string }[],
  onProgress: (msg: string) => void,
  maxLookups = 200,
  concurrency = 3,
  interBatchDelayMs = 700,
): Promise<Map<string, LookupResult>> {
  const cache = loadCache()
  const results = new Map<string, LookupResult>()

  // Partition into cached vs to-lookup
  const toLookup: { venueName: string; city: string; key: string }[] = []
  for (const v of venues) {
    const key = normalizeKey(v.venueName, v.city)
    const cached = cache[key]
    if (cached && isFresh(cached)) {
      results.set(key, {
        venueName: v.venueName,
        handle: cached.handle,
        fromCache: true,
        sourceUrl: cached.sourceUrl,
      })
    } else {
      toLookup.push({ ...v, key })
    }
  }

  const cachedHits = [...results.values()].filter(r => r.handle).length
  onProgress(`  → ${cachedHits} handles from cache (${results.size} venues cached); ${toLookup.length} venues need lookup`)

  // Cap uncached lookups per run — progressive expansion across runs
  const budget = toLookup.slice(0, maxLookups)
  if (budget.length < toLookup.length) {
    onProgress(`  → limiting to ${budget.length} new lookups this run (budget); cache picks up the rest next time`)
  }

  let found = 0
  let saveTick = 0
  for (let i = 0; i < budget.length; i += concurrency) {
    const batch = budget.slice(i, i + concurrency)
    const looked = await Promise.all(batch.map(async v => {
      const hit = await ddgLookup(v.venueName, v.city)
      return { v, hit }
    }))
    for (const { v, hit } of looked) {
      const entry: CacheEntry = {
        handle: hit?.handle ?? null,
        checkedAt: new Date().toISOString(),
        sourceUrl: hit?.url,
      }
      cache[v.key] = entry
      results.set(v.key, {
        venueName: v.venueName,
        handle: entry.handle,
        fromCache: false,
        sourceUrl: entry.sourceUrl,
      })
      if (hit) found++
    }
    saveTick++
    if (saveTick >= 20) { saveCache(cache); saveTick = 0 }
    if (i % 30 === 0 && i > 0) {
      onProgress(`    ... ${i}/${budget.length} looked up, ${found} handles found so far`)
    }
    await new Promise(r => setTimeout(r, interBatchDelayMs))
  }
  saveCache(cache)

  onProgress(`  → found ${found} new handles this run (total in cache: ${Object.values(cache).filter(e => e.handle).length})`)
  return results
}
