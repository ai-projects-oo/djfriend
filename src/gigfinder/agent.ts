import crypto from 'crypto'
import type { GigFinderProfile, GigLead, GigContact, EvidenceItem, EvidenceFreshness, SearchSession } from './types.js'
import { generateSearchQueries } from './searchEngine.js'
import {
  locationFitScore,
  locationClass,
  overallScore,
  freshnessMultiplier,
  detectOpportunity,
  classifyGenre,
  potentialValueScore,
} from './scoring.js'
import { upsertLead } from './store.js'
import { queryOverpassVenues, haversineKm, type OverpassVenue } from './overpass.js'
import { enrichPage, splitTitleForVenue, type EnrichedPage } from './pageEnricher.js'
import { batchLookupInstagram, shouldPromoteLead } from './instagramSearchEngine.js'

export type ProgressEvent =
  | { type: 'log'; message: string }
  | { type: 'lead'; lead: GigLead }
  | { type: 'done'; session: SearchSession }
  | { type: 'error'; message: string }

// ─── Search result type ───────────────────────────────────────────────────────

interface SearchResult {
  title: string
  url: string
  snippet: string
  isInstagram: boolean
  instagramHandle?: string
  source: 'ddg' | 'brave' | 'eventbrite'
}

function annotateResult(r: Omit<SearchResult, 'isInstagram' | 'instagramHandle'>): SearchResult {
  const igMatch = /instagram\.com\/([a-zA-Z0-9._]{2,30})\/?/.exec(r.url)
  const handle = igMatch?.[1]
  const skip = ['p', 'tv', 'reel', 'explore', 'stories', 'accounts', 'direct']
  return {
    ...r,
    isInstagram: !!igMatch && !skip.includes(handle?.toLowerCase() ?? ''),
    instagramHandle: igMatch && !skip.includes(handle?.toLowerCase() ?? '') ? handle : undefined,
  }
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim()
}

// ─── DuckDuckGo scraper (no API key) ─────────────────────────────────────────

export function parseDDGLite(html: string, count: number): SearchResult[] {
  const results: SearchResult[] = []
  // Extract real http(s) links — skip DDG-internal redirect URLs
  const linkRe = /<a\s[^>]*href="(https?:\/\/(?!duckduckgo\.com)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetRe = /<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/gi

  const links: { url: string; title: string }[] = []
  const snippets: string[] = []

  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) !== null && links.length < count) {
    const title = stripTags(m[2]).trim()
    if (title.length >= 3) links.push({ url: m[1], title })
  }
  while ((m = snippetRe.exec(html)) !== null && snippets.length < count) {
    snippets.push(stripTags(m[1]).trim())
  }

  for (let i = 0; i < Math.min(links.length, count); i++) {
    results.push(annotateResult({ title: links[i].title, url: links[i].url, snippet: snippets[i] ?? '', source: 'ddg' }))
  }
  return results
}

async function webSearch(query: string, count = 8): Promise<SearchResult[]> {
  try {
    const params = new URLSearchParams({ q: query, kl: 'il-he' })
    const resp = await fetch(`https://lite.duckduckgo.com/lite/?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9,he;q=0.8',
      },
    })
    if (!resp.ok) return []
    const html = await resp.text()
    return parseDDGLite(html, count)
  } catch {
    return []
  }
}

// ─── Eventbrite scraper ───────────────────────────────────────────────────────

interface EventbriteEvent {
  name: string
  startDate: string
  url: string
  description: string
  venueName: string
  venueAddress: string
  city: string
  organizer: string
}

const EVENTBRITE_TERMS = [
  'dj-night', 'house-music', 'electronic-music', 'disco-party',
  'dj-music', 'nightclub', 'dj-set', 'dance-music',
]

function eventbriteSlug(baseLocation: string): string {
  const lower = baseLocation.toLowerCase()
  if (lower.includes('jerusalem')) return 'israel--jerusalem'
  if (lower.includes('haifa')) return 'israel--haifa'
  if (lower.includes('beer sheva') || lower.includes('beersheba')) return 'israel--beer-sheva'
  if (lower.includes('eilat')) return 'israel--eilat'
  return 'israel--tel-aviv'
}

async function scrapeEventbrite(profile: GigFinderProfile): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const seen = new Set<string>()
  const locationSlug = eventbriteSlug(profile.baseLocation)

  for (const term of EVENTBRITE_TERMS) {
    try {
      const url = `https://www.eventbrite.com/d/${locationSlug}/${term}/`
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      })
      if (!resp.ok) continue
      const html = await resp.text()
      const events = parseEventbriteListPage(html)
      for (const ev of events) {
        if (seen.has(ev.url)) continue
        seen.add(ev.url)
        // Build a rich snippet so downstream scoring has good signal
        const snippet = [ev.description, ev.venueName, ev.venueAddress, ev.organizer ? `Organiser: ${ev.organizer}` : ''].filter(Boolean).join(' | ')
        results.push(annotateResult({
          title: ev.name,
          url: ev.url,
          snippet: snippet.slice(0, 300),
          source: 'eventbrite',
        }))
      }
      await new Promise(r => setTimeout(r, 300))
    } catch { /* skip failed terms */ }
  }

  void profile // used for future genre-aware filtering
  return results
}

export function parseEventbriteListPage(html: string): EventbriteEvent[] {
  const events: EventbriteEvent[] = []
  try {
    const schemas = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? []
    for (const block of schemas) {
      const json = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '')
      const d = JSON.parse(json) as { itemListElement?: { item?: Record<string, unknown> }[] }
      if (!d.itemListElement) continue
      for (const entry of d.itemListElement) {
        const ev = entry.item
        if (!ev) continue
        const loc = ev.location as Record<string, unknown> | undefined
        const addr = (loc?.address as Record<string, unknown> | undefined) ?? {}
        // Extract organizer from meta description pattern "Eventbrite - [ORG] presents"
        const descMatch = /Eventbrite\s*[-–]\s*(.+?)\s+presents\s/i.exec(html)
        events.push({
          name: String(ev.name ?? '').slice(0, 80),
          startDate: String(ev.startDate ?? ''),
          url: String(ev.url ?? ''),
          description: String(ev.description ?? '').slice(0, 150),
          venueName: String(loc?.name ?? ''),
          venueAddress: String(addr.streetAddress ?? ''),
          city: String(addr.addressLocality ?? 'Tel Aviv'),
          organizer: descMatch?.[1] ?? '',
        })
      }
    }
  } catch { /* malformed JSON */ }
  return events
}

// ─── Candidate extraction ─────────────────────────────────────────────────────

const SKIP_DOMAINS = [
  'wikipedia.org', 'yelp.com', 'foursquare.com', 'tripadvisor.com',
  'google.com/maps', 'maps.google', 'timeout.com', 'zap.co.il/ads',
  'waze.com', 'booking.com', 'airbnb.com',
]

// Signals that raise confidence this is a real opportunity
const POSITIVE_SIGNALS = [
  'club', 'bar', 'rooftop', 'hotel', 'beach', 'venue', 'festival', 'restaurant',
  'lounge', 'nightclub', 'terrace', 'garden', 'party', 'event', 'night', 'dj',
  'concert', 'gig', 'lineup', 'promoter', 'booking', 'music',
  'גג', 'מועדון', 'מסיבה', 'ערב', 'אירוע', 'תקליטן',
]

interface Candidate {
  venueName: string
  city: string
  country: string
  sourceUrl: string
  snippet: string
  instagramHandle?: string
  // Structured data from OpenStreetMap (only present for Overpass candidates)
  osm?: {
    lat: number
    lon: number
    website?: string
    phone?: string
    email?: string
    facebook?: string
    amenity: string
  }
}

const ENRICH_SKIP_HOSTS = [
  'duckduckgo.com', 'google.com', 'bing.com',
  'openstreetmap.org', 'wikipedia.org',
  'facebook.com/tr', 'youtube.com', 'youtu.be',
]

/**
 * Follow the candidate's source URL to extract Open Graph data + contacts.
 * Skips search-engine and non-content URLs.
 */
async function enrichCandidateUrl(candidate: Candidate): Promise<EnrichedPage | null> {
  const url = candidate.sourceUrl
  if (!url || !/^https?:\/\//.test(url)) return null
  if (ENRICH_SKIP_HOSTS.some(h => url.includes(h))) return null
  // Instagram profile HTML strips useful data; skip
  if (url.includes('instagram.com/') && !url.includes('/p/')) return null
  const page = await enrichPage(url, 10000)
  // OSM candidates have a definitive name from the OSM `name` tag — never overwrite it.
  // For web-sourced candidates only: if OG title has "party @ venue" format, prefer the
  // venue segment. Also strip pipe-delimited suffixes from raw page titles used as names.
  if (!candidate.osm && page?.ogTitle) {
    const { venue } = splitTitleForVenue(page.ogTitle)
    if (venue && venue.length > 2 && venue.length < 80 && venue.toLowerCase() !== candidate.venueName.toLowerCase()) {
      // Only override if the new name looks like a proper venue (not the party title)
      if (/^[A-Z֐-׿]/.test(venue) && !/festival|party|event|night|opening|closing/i.test(venue.split(/\s+/)[0])) {
        candidate.venueName = venue
      }
    }
  }
  return page
}

// ─── Non-venue page detection ─────────────────────────────────────────────────

// Signals that indicate the page / candidate is not a physical venue that books DJs.
// These are applied to the enriched page title + description + candidate name.
const NON_VENUE_SIGNALS = [
  // Dating and social networking
  'dating', 'date site', 'אתר היכרויות', 'אתר הכרויות', 'swipe', 'match profile',
  // Running / fitness events
  'running club', 'run club', 'marathon', 'half marathon', '5k run', '10k run',
  'triathlon', 'mud run', 'obstacle race',
  // Tech / startup events (networking, pitch nights)
  'pitch night', 'startup pitch', 'hackerx', 'hacker x', 'tech meetup', 'developer meetup',
  'networking event', 'product hunt', 'demo day', 'investor pitch',
  // Government / political / NGO
  'government', 'municipality', 'city hall', 'political party', 'nonprofit', 'ngo',
  // E-commerce / retail
  'online shop', 'online store', 'add to cart', 'checkout', 'free shipping',
  // Job boards / recruiting
  'job board', 'job listing', 'job posting', 'apply now', 'upload resume', 'upload cv',
  // News / media sites
  'breaking news', 'latest news', 'read more articles',
]

/**
 * Returns true if the enriched page signals this is not a bookable venue.
 * Applied AFTER enrichment so we have page title/description to inspect.
 */
function isNonVenuePage(candidateName: string, enrich: EnrichedPage | null): boolean {
  const title = (enrich?.ogTitle ?? enrich?.pageTitle ?? '').toLowerCase()
  const desc = (enrich?.ogDescription ?? '').toLowerCase()
  const siteName = (enrich?.ogSiteName ?? '').toLowerCase()
  const combined = `${candidateName.toLowerCase()} ${title} ${desc} ${siteName}`

  return NON_VENUE_SIGNALS.some(s => combined.includes(s))
}

// Map a user-facing preferred venue type to text tokens that should count as a match.
// Bar matches pub/biergarten, Cafe matches café/coffee/coffee shop, Wine bars ⊃ "wine", etc.
const VENUE_TYPE_SYNONYMS: Record<string, string[]> = {
  'bar': ['bar', 'pub', 'biergarten', 'tavern'],
  'wine bar': ['wine bar', 'wine cellar', 'wine', 'natural wine', 'enoteca'],
  'cocktail bar': ['cocktail', 'mixology', 'speakeasy'],
  'speakeasie': ['speakeasy', 'hidden bar'],
  'beer garden': ['beer garden', 'biergarten', 'brewery', 'brewpub'],
  'cafe': ['cafe', 'café', 'coffee', 'coffee shop', 'espresso'],
  'coffee bar': ['coffee', 'espresso', 'cafe', 'café'],
  'restaurant': ['restaurant', 'bistro', 'eatery', 'dining'],
  'bistro': ['bistro', 'brasserie'],
  'club': ['club', 'nightclub'],
  'nightclub': ['nightclub', 'club', 'discoteca'],
  'rooftop': ['rooftop', 'roof top', 'terrace', 'sky bar', 'skybar'],
  'terrace': ['terrace', 'rooftop'],
  'garden': ['garden', 'courtyard'],
  'beach venue': ['beach', 'seaside', 'sea front', 'seafront'],
  'boat party': ['boat', 'yacht', 'cruise'],
  'yacht': ['yacht', 'boat', 'cruise'],
  'hotel': ['hotel', 'resort', 'guest house', 'hostel'],
  'event venue': ['event venue', 'events venue', 'venue'],
  'warehouse party': ['warehouse', 'industrial'],
  'jazz club': ['jazz club', 'jazz bar', 'jazz'],
  'live music venue': ['live music', 'music venue', 'concert'],
  'festival': ['festival', 'fest'],
  'promoter': ['promoter', 'production', 'productions', 'agency', 'collective'],
  'party collective': ['collective', 'crew', 'party series'],
  'party series': ['party series', 'residency', 'weekly', 'monthly'],
  'private event': ['private event', 'private party'],
  'corporate event': ['corporate', 'company event'],
}

function tokensFor(preferredType: string): string[] {
  const stem = preferredType.toLowerCase().replace(/s$/, '').trim()
  return VENUE_TYPE_SYNONYMS[stem] ?? [stem]
}

/**
 * Return true if the combined text mentions ANY of the user's preferred venue types.
 * Empty preferredVenueTypes = accept everything. Applies synonyms so Bar matches pub etc.
 */
function matchesVenueType(text: string, preferredVenueTypes: string[]): boolean {
  if (preferredVenueTypes.length === 0) return true
  const lower = text.toLowerCase()
  for (const type of preferredVenueTypes) {
    for (const token of tokensFor(type)) {
      if (lower.includes(token)) return true
    }
  }
  return false
}

// Rank candidates so DJ-likely venues (nightclubs, bars, event/music venues,
// venues with IG handles) are researched BEFORE cafés and random restaurants.
// Higher score = researched earlier.
function candidatePriority(c: Candidate): number {
  let score = 0
  // Co-mention with a seed handle is the strongest possible signal — the DJ knows
  // one venue in this scene, and this candidate keeps company with it publicly.
  if (c.snippet.startsWith('[co-mentioned with')) score += 120
  if (c.instagramHandle) score += 40
  if (!c.osm) score += 20  // web-search / crawl-discovered candidates are already vetted
  const amenity = (c.osm?.amenity ?? '').toLowerCase()
  if (['nightclub', 'stripclub', 'dance'].includes(amenity)) score += 60
  else if (['bar', 'pub', 'biergarten', 'events_venue', 'music_venue', 'theatre'].includes(amenity)) score += 35
  else if (['beach_resort'].includes(amenity)) score += 25
  else if (['cafe', 'restaurant'].includes(amenity)) score += 5
  else if (['hotel', 'guest_house', 'hostel'].includes(amenity)) score += 15
  return score
}

/**
 * Instagram-first venues (small IG-native bars, promoters, party series) rarely
 * have DJ-keyword text on their web presence — but a hit on site:instagram.com
 * for a small bar/club IS the DJ signal. Trust it instead of requiring textual proof.
 */
function isInstagramSourced(candidate: Candidate, enrich: EnrichedPage | null): boolean {
  if (candidate.sourceUrl.includes('instagram.com/')) return true
  if (candidate.instagramHandle) return true
  if (enrich?.instagramHandles.length) return true
  return false
}

function overpassToCandidate(v: OverpassVenue): Candidate {
  const snippetParts = [
    v.amenity.replace(/_/g, ' '),
    v.addressStreet,
    v.addressCity,
    ...v.descriptionParts,
    v.website ? `web: ${v.website}` : '',
    v.phone ? `phone: ${v.phone}` : '',
    v.email ? `email: ${v.email}` : '',
    v.instagram ? `instagram: @${v.instagram}` : '',
  ].filter(Boolean)

  const sourceUrl = v.website
    ?? `https://www.openstreetmap.org/${v.osmType}/${v.osmId}`

  return {
    venueName: v.name,
    city: v.addressCity ?? 'Tel Aviv',
    country: 'Israel',
    sourceUrl,
    snippet: snippetParts.join(' | ').slice(0, 300),
    instagramHandle: v.instagram,
    osm: {
      lat: v.lat,
      lon: v.lon,
      website: v.website,
      phone: v.phone,
      email: v.email,
      facebook: v.facebook,
      amenity: v.amenity,
    },
  }
}

function isUsableResult(result: SearchResult): boolean {
  if (SKIP_DOMAINS.some(d => result.url.includes(d))) return false
  if (!result.title || result.title.length < 4) return false
  // Instagram results are always usable
  if (result.isInstagram) return true
  // For web results, accept anything with a positive signal or a meaningful snippet
  const text = (result.title + ' ' + result.snippet).toLowerCase()
  return POSITIVE_SIGNALS.some(s => text.includes(s)) || result.snippet.length > 30
}

function extractVenueName(result: SearchResult): string {
  if (result.instagramHandle) {
    // For Instagram: prettify the handle
    return result.instagramHandle.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()
  }
  return result.title
    .replace(/\s*[|–—]\s*.*/u, '')
    .replace(/\s*[-–]\s*(Home|Events|Official|Instagram|Facebook|About|LinkedIn).*$/i, '')
    .replace(/\s*\(@[^)]+\)/, '')
    .trim()
    .slice(0, 60)
}

function inferCity(text: string): { city: string; country: string } {
  const israeliCities: [string, string][] = [
    ['Tel Aviv', 'Israel'], ['Jerusalem', 'Israel'], ['Haifa', 'Israel'],
    ['Beer Sheva', 'Israel'], ['Eilat', 'Israel'], ['Herzliya', 'Israel'],
    ['Petah Tikva', 'Israel'], ['Rishon LeZion', 'Israel'], ['Ramat Gan', 'Israel'],
    ['Givatayim', 'Israel'], ['Holon', 'Israel'], ['Bnei Brak', 'Israel'],
    ['Netanya', 'Israel'], ['Kfar Saba', 'Israel'], ["Ra'anana", 'Israel'],
    ['Ashdod', 'Israel'], ['Ashkelon', 'Israel'], ['Rehovot', 'Israel'],
    ['Bat Yam', 'Israel'], ['Modiin', 'Israel'],
    ['תל אביב', 'Israel'], ['ירושלים', 'Israel'], ['חיפה', 'Israel'],
    ['אילת', 'Israel'], ['הרצליה', 'Israel'],
  ]
  const lower = text.toLowerCase()
  for (const [city, country] of israeliCities) {
    if (lower.includes(city.toLowerCase())) return { city, country }
  }
  // Default to Tel Aviv if we can't detect — most queries are Tel Aviv focused
  return { city: 'Tel Aviv', country: 'Israel' }
}

function normalizeVenueKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function buildCandidates(results: SearchResult[], seedCandidates: Candidate[] = []): Candidate[] {
  const seen = new Set<string>()
  const candidates: Candidate[] = []

  for (const seed of seedCandidates) {
    const key = normalizeVenueKey(seed.venueName)
    if (!key || seen.has(key)) continue
    seen.add(key)
    candidates.push(seed)
  }

  for (const r of results) {
    if (!isUsableResult(r)) continue
    const venueName = extractVenueName(r)
    if (!venueName || venueName.length < 3) continue
    const key = normalizeVenueKey(venueName)
    if (seen.has(key)) continue
    seen.add(key)
    const { city, country } = inferCity(r.title + ' ' + r.snippet + ' ' + r.url)
    candidates.push({
      venueName,
      city,
      country,
      sourceUrl: r.url,
      snippet: r.snippet || r.title,
      instagramHandle: r.instagramHandle,
    })
  }

  return candidates
}

// ─── Contact extraction ───────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
const IG_RE = /(?:instagram\.com\/|@)([a-zA-Z0-9._]{3,30})/gi
const PHONE_RE = /(?:\+972|0)[\s\-]?(?:\d[\s\-]?){8,9}/g
const WHATSAPP_RE = /(?:wa\.me\/|whatsapp[^\d]*)([\d+\s\-]{7,16})/gi

function extractContact(texts: string[], knownInstagramHandle?: string): GigContact {
  const combined = texts.join(' ')

  const emails = [...new Set(combined.match(EMAIL_RE) ?? [])].filter(
    e => !e.includes('example') && !e.includes('yourname') && !e.includes('email@')
  )
  const igHandles = [
    ...(knownInstagramHandle ? [knownInstagramHandle] : []),
    ...[...new Set([...combined.matchAll(IG_RE)].map(m => m[1]))]
      .filter(h => !['stories', 'reels', 'explore', 'p', 'tv', 'accounts', 'direct'].includes(h.toLowerCase())),
  ]
  const phones = [...new Set(combined.match(PHONE_RE) ?? [])]
  const waMatches = [...combined.matchAll(WHATSAPP_RE)].map(m => m[1].trim())

  const email = emails[0]
  const instagram = igHandles[0]
  const phone = phones[0]
  const whatsapp = waMatches[0] ?? phones[0]

  let bestChannel = 'Research required'
  let bestChannelReason = 'No direct contact found in public information.'
  let confidence = 10

  if (email) {
    bestChannel = 'Email'
    bestChannelReason = `Found email: ${email}`
    confidence = 80
  } else if (whatsapp && waMatches.length > 0) {
    bestChannel = 'WhatsApp'
    bestChannelReason = 'Found WhatsApp contact in public listing'
    confidence = 75
  } else if (instagram) {
    bestChannel = 'Instagram DM'
    bestChannelReason = `Instagram: @${instagram}`
    confidence = knownInstagramHandle ? 70 : 60
  } else if (phone) {
    bestChannel = 'Phone'
    bestChannelReason = `Phone: ${phone}`
    confidence = 45
  }

  return {
    email: email ?? undefined,
    instagram: instagram ? `@${instagram}` : undefined,
    phone: phone ?? undefined,
    whatsapp: whatsapp ?? undefined,
    confidence,
    whyThisContact: confidence > 10
      ? 'Contact found in public venue/event information.'
      : 'No direct contact found. Try searching the venue website directly.',
    bestChannel,
    bestChannelReason,
  }
}

// ─── Base coordinate resolution ───────────────────────────────────────────────

// Fallback lat/lon for known Israeli cities — used when profile has no explicit coords
const CITY_COORDS: Record<string, [number, number]> = {
  'petah tikva': [32.089, 34.887], 'tel aviv': [32.085, 34.782],
  'ramat gan': [32.082, 34.813], 'givatayim': [32.071, 34.812],
  'herzliya': [32.166, 34.844], 'bnei brak': [32.083, 34.834],
  'holon': [32.011, 34.779], 'bat yam': [32.002, 34.750],
  'rishon lezion': [31.971, 34.789], 'rehovot': [31.895, 34.811],
  'netanya': [32.329, 34.860], 'kfar saba': [32.175, 34.907],
  'raanana': [32.184, 34.872], 'ashdod': [31.804, 34.650],
  'ashkelon': [31.665, 34.571], 'modiin': [31.898, 35.010],
  'jerusalem': [31.768, 35.214], 'haifa': [32.794, 34.990],
  'beer sheva': [31.252, 34.791], 'eilat': [29.558, 34.952],
}

function resolveBaseCoords(profile: GigFinderProfile): { lat: number; lon: number } | null {
  if (typeof profile.baseLat === 'number' && typeof profile.baseLon === 'number') {
    return { lat: profile.baseLat, lon: profile.baseLon }
  }
  const norm = profile.baseLocation.toLowerCase().replace(/,.*/, '').trim()
  for (const [city, coords] of Object.entries(CITY_COORDS)) {
    if (norm.includes(city) || city.includes(norm)) {
      return { lat: coords[0], lon: coords[1] }
    }
  }
  return null
}

// ─── Distance lookup ──────────────────────────────────────────────────────────

// Approximate distances in km from central Israel (Petah Tikva / Tel Aviv area)
const CITY_DISTANCES: Record<string, number> = {
  'petah tikva': 0, 'petah-tikva': 0,
  'tel aviv': 14, 'telaviv': 14, 'tel-aviv': 14,
  'ramat gan': 8, 'givatayim': 10, 'bnei brak': 5,
  'herzliya': 20, 'raanana': 22, 'kfar saba': 28,
  'netanya': 38, 'holon': 18, 'bat yam': 20,
  'rishon lezion': 22, 'rishon': 22, 'rehovot': 28, 'ashdod': 45,
  'ashkelon': 55, 'modiin': 40, 'jerusalem': 60, 'haifa': 90,
  'beer sheva': 100, 'eilat': 280, 'tiberias': 110, 'nazareth': 100,
}

function estimateDistance(city: string, baseLocation: string): number | undefined {
  const cityNorm = city.toLowerCase().replace(/[^a-z ]/g, '').trim()
  const baseNorm = baseLocation.toLowerCase()

  // If base is in Tel Aviv area, use table as-is
  const isBaseTAArea = ['petah', 'tel aviv', 'ramat gan'].some(s => baseNorm.includes(s))
  if (isBaseTAArea) {
    return CITY_DISTANCES[cityNorm]
  }

  // If base is in the same city as venue
  if (baseNorm.includes(cityNorm) || cityNorm.includes(baseNorm.split(',')[0].trim())) return 0

  // Return table value as rough estimate for now
  return CITY_DISTANCES[cityNorm]
}

// ─── Main agent ───────────────────────────────────────────────────────────────

export async function runGigFinderAgent(
  profile: GigFinderProfile,
  onProgress: (event: ProgressEvent) => void
): Promise<GigLead[]> {
  const sessionId = crypto.randomUUID()
  const startedAt = new Date().toISOString()

  const session: SearchSession = {
    id: sessionId,
    startedAt,
    status: 'RUNNING',
    queriesRun: 0,
    leadsFound: 0,
    leadsQualified: 0,
  }

  // Phase 1a: OpenStreetMap Overpass — real venue discovery
  const baseCoords = resolveBaseCoords(profile)
  const overpassCandidates: Candidate[] = []
  if (baseCoords) {
    const radiusMeters = Math.max(profile.searchRadiusKm, 5) * 1000
    onProgress({ type: 'log', message: `Querying OpenStreetMap for venues within ${profile.searchRadiusKm} km of ${profile.baseLocation}...` })
    const { venues, endpoint, error } = await queryOverpassVenues(baseCoords.lat, baseCoords.lon, radiusMeters)
    if (error) {
      onProgress({ type: 'log', message: `  ⚠ OpenStreetMap query failed: ${error}` })
    } else {
      onProgress({ type: 'log', message: `  → ${venues.length} venues from OpenStreetMap${endpoint ? ` (${new URL(endpoint).hostname})` : ''}` })
    }
    for (const v of venues) {
      overpassCandidates.push(overpassToCandidate(v))
    }

    // Phase 1a.5: Instagram handle lookup for OSM venues that don't already
    // have a `contact:instagram` tag. DDG-based, aggressively cached to disk
    // (~/Music/djfriend-instagram-cache.json). Progressive across runs.
    const needsLookup = overpassCandidates.filter(c => !c.instagramHandle)
    if (needsLookup.length > 0) {
      onProgress({ type: 'log', message: `Looking up Instagram handles for ${needsLookup.length} venues without OSM Instagram tags...` })
      const igResults = await batchLookupInstagram(
        needsLookup.map(c => ({ name: c.venueName, city: c.city, osmType: c.osm?.amenity })),
        (done, total) => {
          if (done % 30 === 0 || done === total) onProgress({ type: 'log', message: `    ... ${done}/${total} looked up` })
        },
      )
      let attached = 0
      for (const c of needsLookup) {
        const r = igResults.get(c.venueName)
        if (r?.handle) {
          c.instagramHandle = r.handle
          attached++
        }
      }
      onProgress({ type: 'log', message: `  → attached ${attached} Instagram handles to OSM venues (${overpassCandidates.filter(c => c.instagramHandle).length}/${overpassCandidates.length} total now have IG)` })
    }
  } else {
    onProgress({ type: 'log', message: 'No base coordinates set — skipping OpenStreetMap lookup. Drag the marker on the map to set your location.' })
  }

  // Phase 1b: DuckDuckGo web search
  const queries = generateSearchQueries(profile).slice(0, 25)
  const allResults: SearchResult[] = []

  onProgress({ type: 'log', message: `Running ${queries.length} searches...` })
  for (const query of queries) {
    onProgress({ type: 'log', message: `  🔍 ${query}` })
    const results = await webSearch(query, 8)
    const igCount = results.filter(r => r.isInstagram).length
    if (results.length > 0) onProgress({ type: 'log', message: `     → ${results.length} results${igCount ? `, ${igCount} Instagram` : ''}` })
    allResults.push(...results)
    session.queriesRun++
    await new Promise(r => setTimeout(r, 700))
  }

  // Phase 1c: Eventbrite scraper (parallel source)
  onProgress({ type: 'log', message: 'Scraping Eventbrite for upcoming events...' })
  const ebResults = await scrapeEventbrite(profile)
  onProgress({ type: 'log', message: `  → ${ebResults.length} Eventbrite events found` })
  allResults.push(...ebResults)

  onProgress({ type: 'log', message: `Total: ${allResults.length} web results + ${overpassCandidates.length} OSM venues. Expanding via page crawl...` })

  // Phase 1d: Crawl expansion — follow the top N search-result URLs, scrape each
  // page for mentioned @handles and Facebook pages. These become new candidates
  // (venues the DJ has never heard of, discovered from articles/aggregator pages).
  const crawlSeedUrls = [...new Set(
    allResults
      .filter(r => !r.isInstagram && !SKIP_DOMAINS.some(d => r.url.includes(d)))
      .map(r => r.url)
  )].slice(0, 15)

  const seedHandles = new Set((profile.seedInstagramHandles ?? []).map(h => h.replace(/^@/, '').toLowerCase().trim()).filter(Boolean))
  interface Discovered { source: string; context: string; coMentionedSeeds: Set<string>; pagesMentioning: number }
  const discoveredHandles = new Map<string, Discovered>()

  onProgress({ type: 'log', message: `Crawling ${crawlSeedUrls.length} pages to discover mentioned venues${seedHandles.size ? ` (${seedHandles.size} seeds active)` : ''}...` })
  const BATCH = 4
  for (let i = 0; i < crawlSeedUrls.length; i += BATCH) {
    const batch = crawlSeedUrls.slice(i, i + BATCH)
    const enriched = await Promise.all(batch.map(u => enrichPage(u, 10000)))
    for (let j = 0; j < enriched.length; j++) {
      const page = enriched[j]
      if (!page) continue
      const referrer = batch[j]
      const context = [page.ogTitle, page.ogDescription, page.pageTitle].filter(Boolean).join(' — ').slice(0, 200)
      const handlesOnThisPage = new Set(page.instagramHandles.map(h => h.toLowerCase()))
      // Which seeds does this page mention?
      const seedsOnPage = [...handlesOnThisPage].filter(h => seedHandles.has(h))
      for (const handle of handlesOnThisPage) {
        if (seedHandles.has(handle)) continue  // don't re-discover seeds
        let entry = discoveredHandles.get(handle)
        if (!entry) {
          entry = { source: referrer, context, coMentionedSeeds: new Set(), pagesMentioning: 0 }
          discoveredHandles.set(handle, entry)
        }
        entry.pagesMentioning++
        for (const s of seedsOnPage) entry.coMentionedSeeds.add(s)
      }
    }
  }
  const withCoMention = [...discoveredHandles.values()].filter(d => d.coMentionedSeeds.size > 0).length
  onProgress({ type: 'log', message: `  → discovered ${discoveredHandles.size} Instagram handles (${withCoMention} co-mentioned with a seed)` })

  // Turn each discovered handle into a candidate. Handles co-mentioned with seeds
  // ride to the top of the priority queue via a snippet marker.
  const discoveryCandidates: Candidate[] = []
  for (const [handle, meta] of discoveredHandles) {
    const venueName = handle.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()
    if (venueName.length < 3) continue
    const coMentionCount = meta.coMentionedSeeds.size
    const coMentionTag = coMentionCount > 0 ? `[co-mentioned with ${[...meta.coMentionedSeeds].join(', ')}] ` : ''
    let crawlHost: string
    try { crawlHost = new URL(meta.source).hostname } catch { crawlHost = meta.source }
    discoveryCandidates.push({
      venueName,
      city: 'Tel Aviv',
      country: 'Israel',
      sourceUrl: `https://www.instagram.com/${handle}/`,
      snippet: `${coMentionTag}Discovered via crawl of ${crawlHost}: ${meta.context}`.slice(0, 300),
      instagramHandle: handle,
    })
  }

  // Phase 2: Candidate extraction — OSM venues seeded first, then discovered
  // handles, then web results. Deduplication is by normalized venue name.
  const candidates = buildCandidates(allResults, [...overpassCandidates, ...discoveryCandidates])
  session.leadsFound = candidates.length
  onProgress({ type: 'log', message: `${candidates.length} unique candidates (${candidates.filter(c => c.osm).length} from OSM, ${discoveryCandidates.length} discovered via crawl, ${candidates.filter(c => c.instagramHandle).length} with Instagram). Starting research...` })

  if (candidates.length === 0) {
    onProgress({ type: 'log', message: 'No candidates found. DuckDuckGo may be rate-limiting — try again in a few minutes.' })
  }

  // Phase 3: Deep research per candidate
  // Sort by DJ-likelihood so nightclubs/bars/IG-having venues get researched
  // before random cafés and restaurants that surface first from Overpass.
  const rankedCandidates = [...candidates].sort((a, b) => candidatePriority(b) - candidatePriority(a))
  const qualifiedLeads: GigLead[] = []
  const maxCandidates = Math.min(rankedCandidates.length, 80)
  onProgress({ type: 'log', message: `Researching top ${maxCandidates} of ${rankedCandidates.length} candidates (sorted by DJ-likelihood)...` })

  for (let i = 0; i < maxCandidates; i++) {
    const candidate = rankedCandidates[i]
    const igLabel = candidate.instagramHandle ? ` @${candidate.instagramHandle}` : ''
    onProgress({ type: 'log', message: `Researching: ${candidate.venueName}${igLabel} (${candidate.city})...` })

    try {
      // Deep searches — run in parallel for speed
      // Deep searches + page enrichment in parallel. Enrichment fetches the
      // candidate's own source URL to extract OG title/description and any
      // emails/phones/handles directly from the venue's own page markup.
      const amenity = candidate.osm?.amenity ?? ''
      const weakNightlife = ['bar', 'pub', 'biergarten', 'beach_resort', 'theatre', 'hotel', 'guest_house'].includes(amenity)

      // For bars/pubs run a dedicated 4th search targeting past DJ events and music nights.
      // Nightclubs don't need it — they're inherently DJ spaces.
      const r4Query = weakNightlife
        ? (candidate.instagramHandle
            ? `"@${candidate.instagramHandle}" OR "${candidate.venueName}" dj music night events party`
            : `"${candidate.venueName}" dj night music events party`)
        : null

      const [r1, r2, r3, r4, enrich] = await Promise.all([
        webSearch(`"${candidate.venueName}" DJ booking events Israel`, 5),
        webSearch(`"${candidate.venueName}" music DJ lineup contact`, 5),
        candidate.instagramHandle
          ? webSearch(`site:instagram.com "${candidate.instagramHandle}" DJ events booking`, 5)
          : webSearch(`"${candidate.venueName}" events manager contact email Israel`, 5),
        r4Query ? webSearch(r4Query, 5) : Promise.resolve([] as SearchResult[]),
        enrichCandidateUrl(candidate),
      ])
      await new Promise(r => setTimeout(r, 400))

      const enrichmentText = enrich ? [
        enrich.ogTitle, enrich.ogDescription, enrich.ogSiteName, enrich.pageTitle,
      ].filter(Boolean).join(' ') : ''

      const combinedText = [
        candidate.snippet,
        enrichmentText,
        ...[...r1, ...r2, ...r3, ...r4].map(r => `${r.title} ${r.snippet}`),
      ].join(' ')

      // Hard filter: reject pages that are clearly non-venues (dating sites, running
      // clubs, tech meetup sites, etc.) regardless of any other signals.
      if (isNonVenuePage(candidate.venueName, enrich)) {
        onProgress({ type: 'log', message: `Skipped "${candidate.venueName}" — page is not a bookable venue` })
        continue
      }

      // Hard filter: if the DJ picked venue types, drop candidates whose combined
      // text doesn't mention any of them. Empty list = accept everything.
      if (!matchesVenueType(combinedText + ' ' + amenity, profile.preferredVenueTypes)) {
        onProgress({ type: 'log', message: `Skipped "${candidate.venueName}" — doesn't match preferred venue types` })
        continue
      }

      const genre = classifyGenre(combinedText, profile)
      let { tier, score: oppScore, description: oppDesc } = detectOpportunity(combinedText)

      const igSourced = isInstagramSourced(candidate, enrich)
      const igHandle = candidate.instagramHandle ?? enrich?.instagramHandles[0] ?? null

      const promo = shouldPromoteLead({
        // Prepend original venue name so NON_DJ_SIGNALS catches "Board Games Club",
        // "Wine Shop" etc. even after venueName gets overwritten by OG enrichment
        combinedText: `${candidate.venueName} ${combinedText}`,
        osmType: candidate.osm?.amenity,
        instagramHandle: igSourced ? igHandle : null,
        currentTier: tier,
      })

      if (promo.promoted) {
        tier = promo.tier as typeof tier
        oppScore = Math.max(oppScore, promo.score)
        oppDesc = promo.reason
      } else if (promo.tier === 'REJECT' && promo.reason === 'NON_DJ_SIGNAL') {
        onProgress({ type: 'log', message: `Skipped "${candidate.venueName}" — non-DJ venue type` })
        continue
      }

      if (tier === 'REJECT') {
        onProgress({ type: 'log', message: `Skipped "${candidate.venueName}" — no DJ signals` })
        continue
      }

      const contact = extractContact(
        [candidate.snippet, enrichmentText, ...[...r1, ...r2, ...r3].map(r => r.snippet + ' ' + r.url)],
        candidate.instagramHandle ?? enrich?.instagramHandles[0]
      )
      // Overlay page enrichment — hits directly on the venue's own page beat regex on DDG snippets
      if (enrich) {
        if (enrich.emails[0] && !contact.email) {
          contact.email = enrich.emails[0]
          contact.bestChannel = 'Email'
          contact.bestChannelReason = `Email from venue page: ${enrich.emails[0]}`
          contact.confidence = Math.max(contact.confidence, 80)
        }
        if (enrich.phones[0] && !contact.phone) contact.phone = enrich.phones[0]
        if (enrich.instagramHandles[0] && !contact.instagram) {
          contact.instagram = `@${enrich.instagramHandles[0]}`
        }
        if (enrich.facebookPages[0] && !contact.facebook) contact.facebook = `https://${enrich.facebookPages[0]}`
      }
      // Overlay OSM's structured contact data — it's more trustworthy than snippet regex hits
      if (candidate.osm) {
        if (candidate.osm.email && !contact.email) {
          contact.email = candidate.osm.email
          contact.bestChannel = 'Email'
          contact.bestChannelReason = `Email from OpenStreetMap: ${candidate.osm.email}`
          contact.confidence = Math.max(contact.confidence, 85)
        }
        if (candidate.osm.phone && !contact.phone) {
          contact.phone = candidate.osm.phone
          if (contact.confidence < 50) {
            contact.confidence = 50
            contact.bestChannel = 'Phone'
            contact.bestChannelReason = `Phone from OpenStreetMap: ${candidate.osm.phone}`
          }
        }
        if (candidate.osm.website && !contact.website) {
          contact.website = candidate.osm.website
          if (contact.confidence < 50) {
            contact.confidence = 50
            contact.bestChannel = 'Website'
            contact.bestChannelReason = `Contact via venue website: ${candidate.osm.website}`
          }
        }
        if (candidate.osm.facebook && !contact.facebook) contact.facebook = candidate.osm.facebook
      }

      const potValue = potentialValueScore(combinedText)
      // Prefer haversine from OSM coords, fall back to city-lookup table
      let distanceKm: number | undefined
      if (candidate.osm && baseCoords) {
        distanceKm = Math.round(haversineKm(baseCoords.lat, baseCoords.lon, candidate.osm.lat, candidate.osm.lon) * 10) / 10
      } else {
        distanceKm = estimateDistance(candidate.city, profile.baseLocation)
      }
      const locClass = locationClass(distanceKm, profile.searchRadiusKm)
      const locFit = locationFitScore(distanceKm, profile.locationFitThresholds)

      // Build evidence items
      const evidenceItems: EvidenceItem[] = [
        {
          sourceUrl: candidate.sourceUrl,
          sourceType: candidate.osm ? 'OpenStreetMap' : 'Web search',
          discoveredAt: new Date().toISOString(),
          summary: candidate.snippet.slice(0, 200),
          freshness: 'MODERATE' as EvidenceFreshness,
        },
        ...[...r1, ...r2, ...r3].slice(0, 5).map(r => ({
          sourceUrl: r.url,
          sourceType: 'Deep research',
          discoveredAt: new Date().toISOString(),
          summary: r.snippet.slice(0, 200),
          freshness: 'MODERATE' as EvidenceFreshness,
        })),
      ]

      const bestFreshness: EvidenceFreshness = 'MODERATE'
      const opportunityAdjusted = Math.round(oppScore * freshnessMultiplier(bestFreshness) * 10) / 10

      const partialScores = {
        opportunity: opportunityAdjusted,
        contactability: contact.confidence,
        potentialValue: potValue,
        locationFit: locFit,
      }

      const overall = overallScore(partialScores, profile.scoringWeights)

      const whyItFits: string[] = []
      if (genre.genres[0] !== 'Unknown') whyItFits.push(`Genre match: ${genre.genres.slice(0, 2).join(' / ')}`)
      if (tier === 'HIGH_CONFIDENCE' || tier === 'POTENTIAL') whyItFits.push(oppDesc)
      if (distanceKm !== undefined) whyItFits.push(`${distanceKm} km from base (${locClass})`)
      if (contact.email || contact.instagram) whyItFits.push(`Contact found via ${contact.bestChannel}`)
      const charHits = profile.preferredCharacteristics.filter(c =>
        combinedText.toLowerCase().includes(c.toLowerCase())
      )
      if (charHits.length > 0) whyItFits.push(`Preferred characteristics: ${charHits.slice(0, 2).join(', ')}`)

      const lead: GigLead = {
        id: crypto.randomUUID(),
        venueName: candidate.venueName,
        city: candidate.city,
        country: candidate.country,
        distanceKm,
        locationClass: locClass,
        opportunityDescription: oppDesc,
        opportunityTier: tier,
        genre,
        scores: { ...partialScores, overall },
        contact,
        whyItFits,
        evidence: evidenceItems,
        status: 'NEW',
        discoveredAt: new Date().toISOString(),
      }

      if (overall >= profile.minimumLeadScore) {
        upsertLead(lead)
        onProgress({ type: 'lead', lead })
        qualifiedLeads.push(lead)
      } else {
        const w = profile.scoringWeights
        const breakdown = `Opp ${partialScores.opportunity}×${w.opportunity}=${Math.round(partialScores.opportunity*w.opportunity*10)/10}  Contact ${partialScores.contactability}×${w.contactability}=${Math.round(partialScores.contactability*w.contactability*10)/10}  Value ${partialScores.potentialValue}×${w.potentialValue}=${Math.round(partialScores.potentialValue*w.potentialValue*10)/10}  Loc ${partialScores.locationFit}×${w.locationFit}=${Math.round(partialScores.locationFit*w.locationFit*10)/10}`
        onProgress({ type: 'log', message: `Skipped "${lead.venueName}" — ${overall} < ${profile.minimumLeadScore}  [${breakdown}]` })
      }
    } catch (err) {
      onProgress({ type: 'log', message: `Warning: failed to research "${candidate.venueName}" — ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  qualifiedLeads.sort((a, b) => b.scores.overall - a.scores.overall)

  session.status = 'COMPLETED'
  session.completedAt = new Date().toISOString()
  session.leadsQualified = qualifiedLeads.length

  onProgress({ type: 'done', session })
  return qualifiedLeads
}
