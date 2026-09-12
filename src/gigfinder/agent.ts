import crypto from 'crypto'
import type { GigFinderProfile, GigLead, GigContact, EvidenceItem, EvidenceFreshness, SearchSession, OpportunityTier } from './types.js'
import { generateSearchQueries } from './searchEngine.js'
import {
  locationFitScore,
  locationClass,
  overallScore,
  freshnessMultiplier,
} from './scoring.js'
import { upsertLead } from './store.js'

export type ProgressEvent =
  | { type: 'log'; message: string }
  | { type: 'lead'; lead: GigLead }
  | { type: 'done'; session: SearchSession }
  | { type: 'error'; message: string }

// ─── DuckDuckGo search ────────────────────────────────────────────────────────

interface SearchResult {
  title: string
  url: string
  snippet: string
}

async function webSearch(query: string, maxResults = 8): Promise<SearchResult[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DJFriend/1.0; gig research tool)',
        'Accept': 'text/html',
      },
    })
    if (!resp.ok) return []
    const html = await resp.text()
    return parseDDGResults(html, maxResults)
  } catch {
    return []
  }
}

function parseDDGResults(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = []

  // Each result block starts with class="result "
  const blockRe = /<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g
  let match: RegExpExecArray | null

  while ((match = blockRe.exec(html)) !== null && results.length < max) {
    const block = match[1]

    // Title + URL
    const titleRe = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/
    const titleMatch = titleRe.exec(block)
    if (!titleMatch) continue

    const rawUrl = titleMatch[1]
    const title = stripTags(titleMatch[2]).trim()
    const url = decodeRedirectUrl(rawUrl)

    // Snippet
    const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/
    const snippetMatch = snippetRe.exec(block)
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).trim() : ''

    if (title && url) results.push({ title, url, snippet })
  }

  return results
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function decodeRedirectUrl(raw: string): string {
  // DDG wraps URLs in redirects — extract uddg param or return as-is
  try {
    const m = /uddg=([^&]+)/.exec(raw)
    if (m) return decodeURIComponent(m[1])
  } catch { /* ignore */ }
  return raw
}

// ─── Candidate extraction ─────────────────────────────────────────────────────

const VENUE_SIGNALS = [
  'club', 'bar', 'rooftop', 'hotel', 'beach', 'venue', 'festival', 'restaurant',
  'lounge', 'nightclub', 'terrace', 'garden', 'hall', 'studio', 'warehouse',
  'bar', 'pub', 'bistro', 'cafe', 'גג', 'מועדון', 'בית', 'מסעדה', 'מלון',
]
const EVENT_SIGNALS = [
  'party', 'event', 'night', 'dj', 'concert', 'gig', 'show', 'lineup',
  'מסיבה', 'ערב', 'אירוע', 'תקליטן',
]
const SKIP_DOMAINS = [
  'wikipedia', 'yelp.com', 'foursquare', 'tripadvisor', 'google.com/maps',
  'facebook.com/events', 'timeout.com', 'zap.co.il/ads',
]

interface Candidate {
  venueName: string
  city: string
  country: string
  sourceUrl: string
  snippet: string
}

function isVenueOrEvent(result: SearchResult): boolean {
  if (SKIP_DOMAINS.some(d => result.url.includes(d))) return false
  const text = (result.title + ' ' + result.snippet).toLowerCase()
  const hasVenue = VENUE_SIGNALS.some(s => text.includes(s))
  const hasEvent = EVENT_SIGNALS.some(s => text.includes(s))
  return hasVenue || hasEvent
}

function extractVenueName(title: string): string {
  return title
    .replace(/\s*[|–\-—]\s*.*/u, '')  // strip "Venue | Description"
    .replace(/\s*[-–]\s*(Home|Events|Official|Instagram|Facebook|About).*$/i, '')
    .replace(/\s*\(@[^)]+\)/, '')
    .trim()
    .slice(0, 60)
}

function inferCity(text: string): { city: string; country: string } {
  const israeliCities = [
    'Tel Aviv', 'Jerusalem', 'Haifa', 'Beer Sheva', 'Eilat', 'Herzliya',
    'Petah Tikva', 'Rishon LeZion', 'Ramat Gan', 'Givatayim', 'Holon',
    'Bnei Brak', 'Netanya', 'Kfar Saba', 'Ra\'anana', 'Ashdod', 'Ashkelon',
    'Rehovot', 'Bat Yam', 'Modiin',
    'תל אביב', 'ירושלים', 'חיפה', 'אילת', 'הרצליה', 'פתח תקווה',
  ]
  for (const city of israeliCities) {
    if (text.toLowerCase().includes(city.toLowerCase())) {
      return { city, country: 'Israel' }
    }
  }
  return { city: 'Unknown', country: 'Israel' }
}

function buildCandidates(results: SearchResult[]): Candidate[] {
  const seen = new Set<string>()
  const candidates: Candidate[] = []

  for (const r of results) {
    if (!isVenueOrEvent(r)) continue
    const venueName = extractVenueName(r.title)
    if (!venueName || venueName.length < 3) continue
    const key = venueName.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (seen.has(key)) continue
    seen.add(key)
    const { city, country } = inferCity(r.title + ' ' + r.snippet)
    candidates.push({ venueName, city, country, sourceUrl: r.url, snippet: r.snippet })
  }

  return candidates
}

// ─── Genre classification ─────────────────────────────────────────────────────

const GENRE_KEYWORDS: Record<string, string[]> = {
  'House':         ['house music', 'house dj', 'house night', 'house party', 'haus', 'בית'],
  'Disco House':   ['disco house', 'disco/house', 'house disco'],
  'Disco':         ['disco', 'דיסקו'],
  'Deep House':    ['deep house', 'deep dj'],
  'Afro House':    ['afro house', 'afro-house', 'afrobeats'],
  'Tech House':    ['tech house', 'tech-house'],
  'Melodic House': ['melodic house', 'melodic dj'],
  'Indie Dance':   ['indie dance', 'indie dj'],
  'Techno':        ['techno', 'industrial techno', 'טכנו'],
  'Trance':        ['trance', 'psytrance', 'psy-trance'],
  'Drum & Bass':   ['drum and bass', 'drum & bass', 'd&b', 'dnb'],
  'Hip-Hop':       ['hip hop', 'hip-hop', 'rap', 'hiphop'],
  'R&B':           ['r&b', 'rnb', 'rhythm and blues'],
  'Funk':          ['funk', 'funky', 'groove'],
  'Latin':         ['salsa', 'latin', 'bachata', 'reggaeton'],
  'Commercial':    ['commercial', 'top 40', 'mainstream', 'pop music', 'hits'],
  'Open Format':   ['open format', 'all genres', 'variety'],
}

function classifyGenre(text: string, _profile: GigFinderProfile): GigLead['genre'] {
  const lower = text.toLowerCase()
  const matches: { genre: string; hits: number }[] = []

  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    const hits = keywords.filter(k => lower.includes(k)).length
    if (hits > 0) matches.push({ genre, hits })
  }

  matches.sort((a, b) => b.hits - a.hits)
  const topGenres = matches.slice(0, 3).map(m => m.genre)
  const totalHits = matches.reduce((s, m) => s + m.hits, 0)
  const confidence = Math.min(95, 40 + totalHits * 15)
  const level = totalHits >= 2 ? 'VERIFIED' as const : totalHits === 1 ? 'INFERRED' as const : 'UNKNOWN' as const

  const evidenceBullets = matches
    .slice(0, 3)
    .map(m => `Keyword match: "${m.genre}" (${m.hits} signal${m.hits > 1 ? 's' : ''})`)

  const why = topGenres.length
    ? `Classified as ${topGenres.join(' / ')} based on ${totalHits} keyword signal${totalHits > 1 ? 's' : ''} in venue/event descriptions.`
    : 'No genre keywords found — classification unknown.'

  return {
    genres: topGenres.length ? topGenres : ['Unknown'],
    confidence: topGenres.length ? confidence : 20,
    level,
    evidenceBullets,
    why,
  }
}

// ─── Opportunity detection ────────────────────────────────────────────────────

const HIGH_CONF_SIGNALS = [
  'dj wanted', 'dj needed', 'looking for dj', 'booking dj', 'open call',
  'dj vacancy', 'seeking dj', 'dj applications', 'submit mix', 'send mix',
  'דרוש תקליטן', 'דרוש dj', 'מחפשים dj',
]
const POTENTIAL_SIGNALS = [
  'dj lineup', 'resident dj', 'rotating dj', 'upcoming events', 'tba',
  'to be announced', 'new venue', 'grand opening', 'new night', 'new party',
  'dj schedule', 'weekly dj', 'friday night dj', 'saturday dj', 'book a dj',
  'events team', 'entertainment team',
]
const WEAK_SIGNALS = ['live music', 'dj', 'events', 'nightlife', 'music']

function detectOpportunity(text: string): { tier: OpportunityTier; score: number; description: string } {
  const lower = text.toLowerCase()

  const highHits = HIGH_CONF_SIGNALS.filter(s => lower.includes(s))
  if (highHits.length > 0) {
    return {
      tier: 'HIGH_CONFIDENCE',
      score: Math.min(95, 75 + highHits.length * 10),
      description: `Explicit DJ opportunity signals: ${highHits.slice(0, 2).join(', ')}`,
    }
  }

  const potHits = POTENTIAL_SIGNALS.filter(s => lower.includes(s))
  if (potHits.length >= 2) {
    return {
      tier: 'POTENTIAL',
      score: Math.min(80, 50 + potHits.length * 8),
      description: `DJ programming signals: ${potHits.slice(0, 2).join(', ')}`,
    }
  }
  if (potHits.length === 1) {
    return { tier: 'POTENTIAL', score: 55, description: `DJ activity signal: ${potHits[0]}` }
  }

  const weakHits = WEAK_SIGNALS.filter(s => lower.includes(s))
  if (weakHits.length > 0) {
    return { tier: 'WEAK', score: 30, description: 'General music/events venue' }
  }

  return { tier: 'REJECT', score: 0, description: 'No relevant DJ/music signals found' }
}

// ─── Contact extraction ───────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
const IG_RE = /(?:instagram\.com\/|@)([a-zA-Z0-9._]{3,30})/gi
const PHONE_RE = /(?:\+972|0)[\s\-]?(?:\d[\s\-]?){8,9}/g
const WHATSAPP_RE = /(?:wa\.me\/|whatsapp[^\d]*)([\d+\s\-]{7,16})/gi

function extractContact(texts: string[]): GigContact {
  const combined = texts.join(' ')

  const emails = [...new Set(combined.match(EMAIL_RE) ?? [])].filter(
    e => !e.includes('example') && !e.includes('yourname') && !e.includes('email@')
  )
  const igHandles = [...new Set([...combined.matchAll(IG_RE)].map(m => m[1]))]
    .filter(h => !['stories', 'reels', 'explore', 'p', 'tv'].includes(h.toLowerCase()))
  const phones = [...new Set(combined.match(PHONE_RE) ?? [])]
  const waMatches = [...combined.matchAll(WHATSAPP_RE)].map(m => m[1].trim())

  const email = emails[0]
  const instagram = igHandles[0]
  const phone = phones[0]
  const whatsapp = waMatches[0] ?? phones[0]

  // Determine best channel
  let bestChannel = 'Research required'
  let bestChannelReason = 'No direct contact found in public information.'
  let confidence = 10

  if (email) {
    bestChannel = 'Email'
    bestChannelReason = `Found email address: ${email}`
    confidence = 80
  } else if (whatsapp && waMatches.length > 0) {
    bestChannel = 'WhatsApp'
    bestChannelReason = `Found WhatsApp contact in public listing`
    confidence = 75
  } else if (instagram) {
    bestChannel = 'Instagram DM'
    bestChannelReason = `Found Instagram: @${instagram}`
    confidence = 60
  } else if (phone) {
    bestChannel = 'Phone'
    bestChannelReason = `Found phone number: ${phone}`
    confidence = 45
  }

  return {
    email: email ?? undefined,
    instagram: instagram ? `@${instagram}` : undefined,
    phone: phone ?? undefined,
    whatsapp: whatsapp ?? undefined,
    confidence,
    whyThisContact: confidence > 10
      ? `Contact extracted from public venue/event information.`
      : 'No named decision-maker found. Try searching venue website directly.',
    bestChannel,
    bestChannelReason,
  }
}

// ─── Music fit scoring ────────────────────────────────────────────────────────

function musicFitScore(genre: GigLead['genre'], text: string, profile: GigFinderProfile): number {
  const lower = text.toLowerCase()

  // Penalize hard if avoid genres appear
  const avoidHit = profile.avoidGenres.some(g => lower.includes(g.toLowerCase()))
  if (avoidHit) return 15

  // Score genre overlap
  const genreOverlap = genre.genres.filter(g =>
    profile.primaryGenres.some(pg => pg.toLowerCase() === g.toLowerCase())
  ).length
  const genreScore = Math.min(60, genreOverlap * 25)

  // Score preferred characteristics
  const charHits = profile.preferredCharacteristics.filter(c =>
    lower.includes(c.toLowerCase())
  ).length
  const charScore = Math.min(30, charHits * 10)

  // Bonus for preferred venue types
  const venueHit = profile.preferredVenueTypes.some(v => lower.includes(v.toLowerCase()))
  const venueBonus = venueHit ? 10 : 0

  return Math.min(98, 20 + genreScore + charScore + venueBonus)
}

// ─── Potential value scoring ──────────────────────────────────────────────────

const HIGH_VALUE_SIGNALS = [
  'recurring', 'weekly', 'monthly', 'residency', 'resident', 'regular',
  'corporate event', 'private event', 'hotel', 'festival', 'rooftop',
  'multiple locations', 'international', 'שבועי', 'חודשי', 'רצידנסי',
]
const MED_VALUE_SIGNALS = ['bar', 'restaurant', 'club', 'venue', 'lounge', 'party series']

function potentialValueScore(text: string): number {
  const lower = text.toLowerCase()
  const highHits = HIGH_VALUE_SIGNALS.filter(s => lower.includes(s)).length
  const medHits = MED_VALUE_SIGNALS.filter(s => lower.includes(s)).length
  return Math.min(95, 30 + highHits * 15 + medHits * 5)
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

// ─── Outreach message template ────────────────────────────────────────────────

function generateOutreachMessage(
  venueName: string,
  opportunityDescription: string,
  genres: string[],
  profile: GigFinderProfile
): string {
  const genreStr = genres.filter(g => g !== 'Unknown').slice(0, 2).join(' / ') || profile.primaryGenres.slice(0, 2).join(' / ')
  const charStr = profile.preferredCharacteristics.slice(0, 3).join(', ')
  const opportunityRef = opportunityDescription.toLowerCase().includes('recurring')
    ? `your recurring DJ events`
    : opportunityDescription.toLowerCase().includes('rooftop')
    ? `your rooftop events`
    : `your events`

  return `Hi,

I came across ${venueName} and noticed ${opportunityRef} — the vibe and music direction really caught my attention.

I'm a ${genreStr} DJ based in ${profile.baseLocation.split(',')[0]}, with a style rooted in ${charStr}.

I think the sound could be a great fit for what you're building. I'd love to send over a recent mix if you're looking for DJs for upcoming dates.

Best,
${profile.djName}`
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

  // Phase 1: Discovery searches
  const queries = generateSearchQueries(profile).slice(0, 20)
  const allResults: SearchResult[] = []

  for (const query of queries) {
    onProgress({ type: 'log', message: `Searching: "${query}"...` })
    const results = await webSearch(query, 8)
    allResults.push(...results)
    session.queriesRun++
    // Polite delay between requests
    await new Promise(r => setTimeout(r, 800))
  }

  onProgress({ type: 'log', message: `Found ${allResults.length} raw results. Extracting candidates...` })

  // Phase 2: Candidate extraction
  const candidates = buildCandidates(allResults)
  session.leadsFound = candidates.length
  onProgress({ type: 'log', message: `Extracted ${candidates.length} unique candidates. Starting deep research...` })

  // Phase 3: Deep research per candidate
  const qualifiedLeads: GigLead[] = []
  const maxCandidates = Math.min(candidates.length, 15)

  for (let i = 0; i < maxCandidates; i++) {
    const candidate = candidates[i]
    onProgress({ type: 'log', message: `Researching: ${candidate.venueName} (${candidate.city})...` })

    try {
      // 3 targeted searches
      const [r1, r2, r3] = await Promise.all([
        webSearch(`"${candidate.venueName}" DJ booking events`, 5),
        webSearch(`"${candidate.venueName}" music genre DJ lineup`, 5),
        webSearch(`"${candidate.venueName}" contact events manager`, 5),
      ])
      await new Promise(r => setTimeout(r, 600))

      const combinedText = [
        candidate.snippet,
        ...[...r1, ...r2, ...r3].map(r => `${r.title} ${r.snippet}`),
      ].join(' ')

      const genre = classifyGenre(combinedText, profile)
      const { tier, score: oppScore, description: oppDesc } = detectOpportunity(combinedText)

      if (tier === 'REJECT') {
        onProgress({ type: 'log', message: `Skipped "${candidate.venueName}" — no DJ opportunity signals` })
        continue
      }

      const contact = extractContact([
        candidate.snippet,
        ...[...r1, ...r2, ...r3].map(r => r.snippet),
        ...[...r1, ...r2, ...r3].map(r => r.url),
      ])

      const musicFit = musicFitScore(genre, combinedText, profile)
      const potValue = potentialValueScore(combinedText)
      const distanceKm = estimateDistance(candidate.city, profile.baseLocation)
      const locClass = locationClass(distanceKm, profile.searchRadiusKm)
      const locFit = locationFitScore(distanceKm, profile.locationFitThresholds)

      // Build evidence items
      const evidenceItems: EvidenceItem[] = [
        {
          sourceUrl: candidate.sourceUrl,
          sourceType: 'Web search',
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
        musicFit,
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

      const suggestedMessage = generateOutreachMessage(
        candidate.venueName, oppDesc, genre.genres, profile
      )

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
        suggestedMessage,
        evidence: evidenceItems,
        status: 'NEW',
        discoveredAt: new Date().toISOString(),
      }

      if (overall >= profile.minimumLeadScore) {
        upsertLead(lead)
        onProgress({ type: 'lead', lead })
        qualifiedLeads.push(lead)
      } else {
        onProgress({ type: 'log', message: `Skipped "${lead.venueName}" — score ${overall} below minimum ${profile.minimumLeadScore}` })
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
