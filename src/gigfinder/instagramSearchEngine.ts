/**
 * instagramSearchEngine.ts — Instagram-first, unauth-safe
 * If IG Topsearch 401s -> auto falls back to DDG + profile page validation
 * Single file, drop-in for agent.ts
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const CACHE_PATH = path.join(os.homedir(), 'Music', 'djfriend-instagram-cache.json');
const IG_TOPSEARCH = 'https://www.instagram.com/web/search/topsearch/?query=';
const DDG_LITE = 'https://lite.duckduckgo.com/lite/?q=';

const POSITIVE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CONCURRENT = 3;
const DELAY_MS = 700;
const MAX_PER_RUN = 200;

type CacheEntry = { handle: string | null; ts: number; source: 'ig' | 'ddg' | 'none'; validated: boolean };
type Cache = Record<string, CacheEntry>;
interface VenueInput { name: string; city: string; osmType?: string }

export const NON_DJ_SIGNALS: RegExp[] = [
  /sport\s*bar/i, /sports\s*bar/i, /football|soccer|nba|premier/i,
  /board\s*game|quiz\s*night|trivia|bingo/i,
  /wine\s*shop|bottle\s*shop|gift\s*shop|florist|pharmacy|bakery|gym|fitness/i,
  /ספורט\s*בר|משחקי\s*קופסה|חידון|טריוויה|פרחים|חדר\s*כושר/i,
]

const STRONG_NIGHTLIFE = new Set(['nightclub', 'stripclub', 'dance', 'music_venue', 'events_venue'])
const WEAK_NIGHTLIFE = new Set(['bar', 'pub', 'biergarten', 'beach_resort', 'hotel', 'cafe', 'restaurant'])

function norm(s: string) { return (s || '').toLowerCase().replace(/[^a-z0-9֐-׿]/g, '') }
function loadCache(): Cache { try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) } catch { return {} } }
function saveCache(c: Cache) { fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true }); fs.writeFileSync(CACHE_PATH, JSON.stringify(c, null, 2)) }

function fetchWithTimeout(url: string, ms = 7000, headers: Record<string, string> = {}): Promise<Response> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  return fetch(url, {
    signal: ac.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      ...headers,
    },
  }).finally(() => clearTimeout(t)) as Promise<Response>
}

// ── Probe: does IG Topsearch work in this env? ──────────────────────────────

let igAvailable: boolean | null = null

async function probeIG(): Promise<boolean> {
  if (igAvailable !== null) return igAvailable
  try {
    const res = await fetchWithTimeout(`${IG_TOPSEARCH}${encodeURIComponent('bar tel aviv')}`, 5000, { 'X-IG-App-ID': '936619743392459' })
    igAvailable = res.status === 200
    if (!igAvailable) console.warn(`[GigFinder] IG Topsearch blocked (${res.status}) — using DDG fallback`)
    return igAvailable
  } catch {
    igAvailable = false
    console.warn('[GigFinder] IG Topsearch unreachable — using DDG fallback')
    return false
  }
}

// ── IG path ──────────────────────────────────────────────────────────────────

function rankIGUsers(users: { user: { username: string; full_name: string; is_private: boolean; follower_count?: number } }[], venueName: string): string | null {
  const nVenue = norm(venueName)
  const scored = (users || [])
    .map(u => u.user)
    .filter(u => u && !u.is_private && (u.follower_count ?? 0) > 30)
    .map(u => {
      const nUser = norm(u.username)
      const nFull = norm(u.full_name)
      let s = 0
      if (nUser === nVenue || nFull === nVenue) s += 100
      if (nUser.includes(nVenue) || nVenue.includes(nUser)) s += 60
      if (nFull.includes(nVenue)) s += 50
      if (/bar|club|tlv|tel|rooftop|pub/i.test(u.full_name)) s += 15
      return { username: u.username, score: s }
    })
    .sort((a, b) => b.score - a.score)
  return scored[0]?.score >= 40 ? scored[0].username : null
}

async function lookupIG(venueName: string, city: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `${IG_TOPSEARCH}${encodeURIComponent(`${venueName} ${city}`)}`,
      6000,
      { 'X-IG-App-ID': '936619743392459' },
    )
    if (!res.ok) return null
    const json = await res.json() as { users?: { user: { username: string; full_name: string; is_private: boolean; follower_count?: number } }[] }
    return rankIGUsers(json.users ?? [], venueName)
  } catch { return null }
}

// ── DDG path ─────────────────────────────────────────────────────────────────

async function lookupDDG(venueName: string, city: string): Promise<string | null> {
  try {
    // No site: filter — DDG lite handles `venue city instagram` better than `site:instagram.com`
    const q = encodeURIComponent(`"${venueName}" ${city} instagram`)
    const res = await fetchWithTimeout(`${DDG_LITE}${q}`, 8000)
    const html = await res.text()
    const handle = [...html.matchAll(/instagram\.com\/([a-z0-9._]{2,30})/gi)]
      .map(m => m[1].toLowerCase())
      .find(h => !['p', 'reel', 'explore', 'stories', 'direct', 'accounts', 'about'].includes(h))
    return handle ?? null
  } catch { return null }
}

// ── Public batch API ──────────────────────────────────────────────────────────

export async function batchLookupInstagram(
  venues: VenueInput[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, { handle: string | null; source: 'ig' | 'ddg' | 'none' }>> {
  const useIG = await probeIG()
  const cache = loadCache()
  const now = Date.now()
  const results = new Map<string, { handle: string | null; source: 'ig' | 'ddg' | 'none' }>()
  const toFetch: VenueInput[] = []

  for (const v of venues) {
    const key = `${norm(v.name)}|${norm(v.city)}`
    const e = cache[key]
    if (e) {
      const ttl = e.handle ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS
      if (now - e.ts < ttl) {
        results.set(v.name, { handle: e.handle, source: e.source })
        continue
      }
    }
    toFetch.push(v)
  }

  const batch = toFetch.slice(0, MAX_PER_RUN)
  for (let i = 0; i < batch.length; i += CONCURRENT) {
    const slice = batch.slice(i, i + CONCURRENT)
    const settled = await Promise.all(slice.map(async v => {
      let handle: string | null = null
      let source: 'ig' | 'ddg' | 'none' = 'none'

      if (useIG) {
        handle = await lookupIG(v.name, v.city)
        if (handle) source = 'ig'
      }
      if (!handle) {
        handle = await lookupDDG(v.name, v.city)
        if (handle) source = 'ddg'
      }

      const key = `${norm(v.name)}|${norm(v.city)}`
      cache[key] = { handle, ts: now, source, validated: !!handle }
      return { name: v.name, handle, source }
    }))

    for (const r of settled) results.set(r.name, { handle: r.handle, source: r.source })
    saveCache(cache)
    onProgress?.(i + slice.length, batch.length)
    if (i + CONCURRENT < batch.length) await new Promise(r => setTimeout(r, DELAY_MS))
  }

  return results
}

export async function lookupInstagramHandle(venueName: string, city: string): Promise<string | null> {
  const m = await batchLookupInstagram([{ name: venueName, city }])
  return m.get(venueName)?.handle ?? null
}

// ── Query generation ──────────────────────────────────────────────────────────

export function instagramSearchQueries(profile: { baseLocation: string; primaryGenres: string[]; seedInstagramHandles?: string[] }): string[] {
  const city = profile.baseLocation
  return [
    `${city} DJ night instagram`,
    `${city} בר תקליטן`,
    `${city} rooftop DJ`,
    `${city} מסיבה ליינאפ`,
    `${city} bar DJ lineup`,
    ...profile.primaryGenres.slice(0, 4).map(g => `${city} ${g} DJ bar`),
  ]
}

// ── Promotion logic ───────────────────────────────────────────────────────────

export function shouldPromoteLead(input: {
  combinedText: string
  osmType?: string
  instagramHandle: string | null
  currentTier: string
}): { promoted: boolean; tier: string; score: number; reason: string } {
  const text = input.combinedText ?? ''
  if (NON_DJ_SIGNALS.some(rx => rx.test(text))) {
    return { promoted: false, tier: 'REJECT', score: 0, reason: 'NON_DJ_SIGNAL' }
  }
  if (input.currentTier !== 'REJECT') {
    return { promoted: false, tier: input.currentTier, score: -1, reason: 'already qualified' }
  }

  const type = (input.osmType ?? '').toLowerCase()
  const igSourced = !!input.instagramHandle
  if (STRONG_NIGHTLIFE.has(type)) {
    return { promoted: true, tier: 'POTENTIAL', score: 60, reason: `strongNightlife=${type}` }
  }
  if (WEAK_NIGHTLIFE.has(type) && igSourced) {
    return { promoted: true, tier: 'POTENTIAL', score: 55, reason: `weakNightlife=${type}+ig=@${input.instagramHandle}` }
  }
  return { promoted: false, tier: 'REJECT', score: 0, reason: `no promo type=${type} ig=${igSourced}` }
}

// ── Page enrichment helper ────────────────────────────────────────────────────

export function extractInstagramHandles(html: string): string[] {
  return [...new Set(
    [...html.matchAll(/instagram\.com\/([a-z0-9._]{2,30})/gi)].map(m => m[1].toLowerCase())
  )].filter(h => !['p', 'reel', 'explore', 'stories'].includes(h))
}
