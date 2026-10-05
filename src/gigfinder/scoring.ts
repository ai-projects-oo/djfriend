import type { GigFinderProfile, LeadScores, LocationClass, EvidenceFreshness, OpportunityTier, GenreClassification } from './types.js'

export function locationFitScore(
  distanceKm: number | undefined,
  thresholds: GigFinderProfile['locationFitThresholds']
): number {
  if (distanceKm === undefined) return 50
  const threshold = thresholds.find(t => t.maxKm >= distanceKm)
  return threshold ? threshold.score : 20
}

export function locationClass(
  distanceKm: number | undefined,
  radiusKm: number
): LocationClass {
  if (distanceKm === undefined) return 'LOCAL'
  if (distanceKm <= radiusKm) return 'LOCAL'
  if (distanceKm <= radiusKm * 2.5) return 'TRAVEL'
  return 'DESTINATION'
}

export function evidenceFreshness(publishedAt: string | undefined): EvidenceFreshness {
  if (!publishedAt) return 'MODERATE'
  const now = Date.now()
  const published = new Date(publishedAt).getTime()
  if (isNaN(published)) return 'MODERATE'
  const daysDiff = (now - published) / (1000 * 60 * 60 * 24)
  if (daysDiff <= 7) return 'VERY_FRESH'
  if (daysDiff <= 30) return 'FRESH'
  if (daysDiff <= 90) return 'MODERATE'
  if (daysDiff <= 365) return 'OLD'
  return 'HISTORICAL'
}

export function freshnessMultiplier(f: EvidenceFreshness): number {
  switch (f) {
    case 'VERY_FRESH': return 1.0
    case 'FRESH': return 0.95
    case 'MODERATE': return 0.85
    case 'OLD': return 0.65
    case 'HISTORICAL': return 0.3
  }
}

export function overallScore(
  scores: Omit<LeadScores, 'overall'>,
  weights: GigFinderProfile['scoringWeights']
): number {
  const raw =
    scores.opportunity * weights.opportunity +
    scores.contactability * weights.contactability +
    scores.potentialValue * weights.potentialValue +
    scores.locationFit * weights.locationFit
  return Math.round(raw * 10) / 10
}

// ─── Opportunity detection ────────────────────────────────────────────────────

// Venue types that are confirmed non-DJ spaces — block IG promotion even if nightlife-tagged
export const NON_DJ_SIGNALS = [
  'sport', 'sports bar', 'ספורט', 'football', 'soccer', 'basketball', 'rugby',
  'board games', 'board game', 'משחקי קופסא', 'quiz night', 'trivia',
  'wine shop', 'bottle shop', 'off-license', 'חנות יין',
  'gift shop', 'מתנות', 'florist', 'pharmacy', 'bakery',
  'kindergarten', 'גן ילדים', 'daycare', 'gym', 'fitness',
]

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
  'club night', 'late night', 'after party', 'after-party', 'dance floor', 'dancefloor',
  'party series', 'party collective', 'ra.co', 'residentadvisor', 'facebook.com/events',
  'ליינאפ', 'ליין אפ', 'ערב מוזיקה', 'מסיבה', 'מועדון', 'אחרי המסיבה',
]
const WEAK_SIGNALS = [
  'live music', 'dj', 'events', 'nightlife', 'music',
  'bar', 'pub', 'lounge', 'nightclub', 'club', 'venue', 'cocktail', 'terrace', 'rooftop',
  'מועדון', 'בר', 'אירוע',
]

export function detectOpportunity(text: string): { tier: OpportunityTier; score: number; description: string } {
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
    return { tier: 'WEAK', score: 45, description: 'General music/events venue' }
  }

  return { tier: 'REJECT', score: 0, description: 'No relevant DJ/music signals found' }
}

// ─── Genre classification ─────────────────────────────────────────────────────

export const GENRE_KEYWORDS: Record<string, string[]> = {
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

export function classifyGenre(text: string, _profile: GigFinderProfile): GenreClassification {
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

// ─── Music fit scoring ────────────────────────────────────────────────────────

const NIGHTLIFE_AMENITIES = new Set([
  'nightclub', 'stripclub', 'dance', 'bar', 'pub', 'biergarten',
  'music_venue', 'events_venue', 'theatre', 'beach_resort',
])

export function isNightlifeVenue(osmAmenity: string | undefined, hasInstagram: boolean): boolean {
  if (osmAmenity && NIGHTLIFE_AMENITIES.has(osmAmenity)) return true
  return hasInstagram  // IG-only venues self-select as nightlife/events
}

export function musicFitScore(
  genre: GenreClassification,
  text: string,
  profile: GigFinderProfile,
  nightlife = false
): number {
  const lower = text.toLowerCase()

  const avoidHit = profile.avoidGenres.some(g => lower.includes(g.toLowerCase()))
  if (avoidHit) return 15

  // Nightlife venues (OSM nightclub/bar/music_venue or IG-native) default to 50 —
  // they're confirmed entertainment spaces even without genre keywords on their page.
  const base = nightlife ? 50 : 30

  const genreOverlap = genre.genres.filter(g =>
    profile.primaryGenres.some(pg => pg.toLowerCase() === g.toLowerCase())
  ).length
  const genreScore = Math.min(60, genreOverlap * 25)

  const charHits = profile.preferredCharacteristics.filter(c =>
    lower.includes(c.toLowerCase())
  ).length
  const charScore = Math.min(30, charHits * 10)

  const venueHit = profile.preferredVenueTypes.some(v => lower.includes(v.toLowerCase()))
  const venueBonus = venueHit ? 10 : 0

  return Math.min(98, base + genreScore + charScore + venueBonus)
}

// ─── Potential value scoring ──────────────────────────────────────────────────

const HIGH_VALUE_SIGNALS = [
  'recurring', 'weekly', 'monthly', 'residency', 'resident', 'regular',
  'corporate event', 'private event', 'hotel', 'festival', 'rooftop',
  'multiple locations', 'international', 'שבועי', 'חודשי', 'רצידנסי',
]
const MED_VALUE_SIGNALS = ['bar', 'restaurant', 'club', 'venue', 'lounge', 'party series']

export function potentialValueScore(text: string): number {
  const lower = text.toLowerCase()
  const highHits = HIGH_VALUE_SIGNALS.filter(s => lower.includes(s)).length
  const medHits = MED_VALUE_SIGNALS.filter(s => lower.includes(s)).length
  return Math.min(95, 30 + highHits * 15 + medHits * 5)
}
