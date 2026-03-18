export interface SpotifyItem {
  id: string
  name: string
  artists: Array<{ id: string; name: string }>
}

export function stripMixedInKeyPrefix(str: string): string {
  return str.replace(/^[0-9]{1,2}[AB]\s*-\s*[0-9]+\s*-\s*/i, '').trim()
}

export function stripFeatured(str: string): string {
  return str.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*/i, '').trim()
}

export function normalizeStr(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function hasWordOverlap(original: string, candidate: string): boolean {
  const orig = normalizeStr(original)
  const cand = normalizeStr(candidate)
  if (!orig || !cand) return false
  if (orig === cand) return true
  if (cand.includes(orig) || orig.includes(cand)) return true
  const words = orig.split(' ').filter(w => w.length > 2)
  if (words.length === 0) return orig === cand.split(' ')[0]
  const matched = words.filter(w => cand.includes(w)).length
  return matched >= Math.ceil(words.length * 0.6)
}

export function pickConfidentMatch(
  origArtist: string,
  origTitle: string,
  items: SpotifyItem[],
): SpotifyItem | null {
  const cleanArtist = stripFeatured(normalizeStr(origArtist))
  const cleanTitle = normalizeStr(stripFeatured(origTitle))
  for (const item of items) {
    const spotArtists = item.artists.map(a => normalizeStr(a.name)).join(' ')
    const spotTitle = normalizeStr(item.name)
    if (hasWordOverlap(cleanTitle, spotTitle) && hasWordOverlap(cleanArtist, spotArtists)) {
      return item
    }
  }
  return null
}
