// OpenStreetMap Overpass API — free venue discovery, no auth required.
// Returns structured venue data (bars, clubs, restaurants, hotels, event venues)
// in a bounding radius, with tags like website / phone / contact:instagram.

export interface OverpassVenue {
  osmId: string
  osmType: 'node' | 'way' | 'relation'
  name: string
  amenity: string             // e.g. 'nightclub', 'bar', 'restaurant', 'hotel'
  lat: number
  lon: number
  website?: string
  phone?: string
  email?: string
  instagram?: string          // handle without @
  facebook?: string
  addressStreet?: string
  addressCity?: string
  descriptionParts: string[]  // free-form tags used to build a snippet
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

interface OverpassResponse {
  elements?: OverpassElement[]
}

const AMENITY_TYPES = [
  'nightclub', 'bar', 'pub', 'biergarten',
  'restaurant', 'cafe', 'events_venue',
  'theatre', 'music_venue', 'stripclub', 'casino',
]
const TOURISM_TYPES = ['hotel', 'guest_house', 'hostel']
const LEISURE_TYPES = ['dance', 'beach_resort']

function extractInstagramHandle(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const m = /(?:instagram\.com\/|@)([a-zA-Z0-9._]{2,30})/.exec(raw)
  return m ? m[1] : raw.replace(/^@/, '').trim() || undefined
}

function elementToVenue(el: OverpassElement): OverpassVenue | null {
  const tags = el.tags ?? {}
  const name = tags.name ?? tags['name:en'] ?? tags['name:he']
  if (!name) return null

  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (lat === undefined || lon === undefined) return null

  const amenity = tags.amenity ?? tags.tourism ?? tags.leisure ?? 'venue'

  const descriptionParts: string[] = []
  if (tags.description) descriptionParts.push(tags.description)
  if (tags.cuisine) descriptionParts.push(`cuisine: ${tags.cuisine}`)
  if (tags['opening_hours']) descriptionParts.push(`hours: ${tags['opening_hours']}`)
  if (amenity) descriptionParts.push(amenity.replace(/_/g, ' '))

  return {
    osmId: String(el.id),
    osmType: el.type,
    name,
    amenity,
    lat,
    lon,
    website: tags.website ?? tags['contact:website'] ?? undefined,
    phone: tags.phone ?? tags['contact:phone'] ?? undefined,
    email: tags.email ?? tags['contact:email'] ?? undefined,
    instagram: extractInstagramHandle(tags['contact:instagram'] ?? tags.instagram),
    facebook: tags['contact:facebook'] ?? tags.facebook ?? undefined,
    addressStreet: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || undefined,
    addressCity: tags['addr:city'] ?? undefined,
    descriptionParts,
  }
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

/**
 * Query the Overpass API for venues within a radius (metres) of a lat/lon.
 * Falls back through mirror endpoints if the primary times out.
 */
export interface OverpassResult {
  venues: OverpassVenue[]
  endpoint?: string
  error?: string
}

export async function queryOverpassVenues(
  centerLat: number,
  centerLon: number,
  radiusMeters: number,
): Promise<OverpassResult> {
  const amenities = AMENITY_TYPES.join('|')
  const tourism = TOURISM_TYPES.join('|')
  const leisure = LEISURE_TYPES.join('|')
  const query = `
    [out:json][timeout:45];
    (
      node["amenity"~"^(${amenities})$"](around:${radiusMeters},${centerLat},${centerLon});
      way["amenity"~"^(${amenities})$"](around:${radiusMeters},${centerLat},${centerLon});
      node["tourism"~"^(${tourism})$"](around:${radiusMeters},${centerLat},${centerLon});
      way["tourism"~"^(${tourism})$"](around:${radiusMeters},${centerLat},${centerLon});
      node["leisure"~"^(${leisure})$"](around:${radiusMeters},${centerLat},${centerLon});
      way["leisure"~"^(${leisure})$"](around:${radiusMeters},${centerLat},${centerLon});
    );
    out center tags;
  `.trim()

  let lastError = ''
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'DJFriend/1.0 (github.com/ozben/djfriend)',
          'Accept': 'application/json',
        },
        body: `data=${encodeURIComponent(query)}`,
      })
      if (!resp.ok) {
        lastError = `${endpoint} → HTTP ${resp.status}`
        continue
      }
      const data = await resp.json() as OverpassResponse
      const venues: OverpassVenue[] = []
      for (const el of data.elements ?? []) {
        const v = elementToVenue(el)
        if (v) venues.push(v)
      }
      return { venues, endpoint }
    } catch (err) {
      lastError = `${endpoint} → ${err instanceof Error ? err.message : String(err)}`
    }
  }
  return { venues: [], error: lastError || 'All Overpass mirrors failed' }
}

/** Haversine distance between two lat/lon points, in kilometres. */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}
