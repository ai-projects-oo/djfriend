import axios from 'axios';

interface SearchResult {
  spotifyId: string;
  artistId: string;
  spotifyArtist: string;
  spotifyTitle: string;
}

export async function authenticate(clientId: string, clientSecret: string): Promise<string> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  return response.data.access_token as string;
}

function stripMixedInKeyPrefix(str: string): string {
  return str.replace(/^[0-9]{1,2}[AB]\s*-\s*[0-9]+\s*-\s*/i, '').trim();
}

function stripFeatured(str: string): string {
  return str.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*/i, '').trim();
}

function normalizeStr(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasWordOverlap(original: string, candidate: string): boolean {
  const orig = normalizeStr(original);
  const cand = normalizeStr(candidate);
  if (!orig || !cand) return false;
  if (orig === cand) return true;
  if (cand.includes(orig) || orig.includes(cand)) return true;
  const words = orig.split(' ').filter(w => w.length > 2);
  if (words.length === 0) return orig === cand.split(' ')[0];
  const matched = words.filter(w => cand.includes(w)).length;
  return matched >= Math.ceil(words.length * 0.6);
}

interface SpotifyItem {
  id: string;
  name: string;
  artists: Array<{ id: string; name: string }>;
}

async function searchSpotify(q: string, token: string): Promise<SpotifyItem[]> {
  const response = await axios.get('https://api.spotify.com/v1/search', {
    params: { q, type: 'track', limit: 5 },
    headers: { Authorization: `Bearer ${token}` },
  });
  return (response.data.tracks?.items ?? []) as SpotifyItem[];
}

function pickConfidentMatch(
  origArtist: string,
  origTitle: string,
  items: SpotifyItem[],
): SpotifyItem | null {
  const cleanArtist = stripFeatured(normalizeStr(origArtist));
  const cleanTitle = normalizeStr(stripFeatured(origTitle));
  for (const item of items) {
    const spotArtists = item.artists.map(a => normalizeStr(a.name)).join(' ');
    const spotTitle = normalizeStr(item.name);
    if (hasWordOverlap(cleanTitle, spotTitle) && hasWordOverlap(cleanArtist, spotArtists)) {
      return item;
    }
  }
  return null;
}

export async function searchTrack(
  artist: string | null,
  title: string,
  token: string
): Promise<SearchResult | null> {
  const rawTitle = stripMixedInKeyPrefix(title);
  const cleanTitle = stripFeatured(rawTitle.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '')).trim();
  const cleanArtist = artist ? stripFeatured(artist) : '';

  // Extract "Title Only" if filename has "Artist - Title" embedded after MIK strip
  const dashIdx = rawTitle.lastIndexOf(' - ');
  const titleOnly = dashIdx !== -1 ? rawTitle.slice(dashIdx + 3).replace(/\s*\([^)]*\)/g, '').trim() : null;

  const queries: string[] = [];
  if (cleanArtist) {
    queries.push(`${cleanArtist} ${cleanTitle}`);
    if (rawTitle !== cleanTitle) queries.push(`${cleanArtist} ${rawTitle}`);
    if (titleOnly) queries.push(`${cleanArtist} ${titleOnly}`);
    queries.push(cleanTitle);
  } else {
    queries.push(cleanTitle);
    if (rawTitle !== cleanTitle) queries.push(rawTitle);
  }

  const seen = new Set<string>();
  for (const q of queries) {
    if (seen.has(q)) continue;
    seen.add(q);
    const items = await searchSpotify(q, token);
    const match = pickConfidentMatch(cleanArtist || rawTitle, rawTitle, items);
    if (match) {
      return {
        spotifyId: match.id,
        artistId: match.artists[0]?.id ?? '',
        spotifyArtist: match.artists[0]?.name ?? '',
        spotifyTitle: match.name,
      };
    }
  }

  return null;
}

export async function getArtistGenres(artistId: string, token: string): Promise<string[]> {
  const response = await axios.get(`https://api.spotify.com/v1/artists/${artistId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data.genres ?? [];
}
