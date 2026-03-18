import axios from 'axios';
import { stripMixedInKeyPrefix, stripFeatured, pickConfidentMatch } from './spotify-text.js';
import type { SpotifyItem } from './spotify-text.js';

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

async function searchSpotify(q: string, token: string): Promise<SpotifyItem[]> {
  const response = await axios.get('https://api.spotify.com/v1/search', {
    params: { q, type: 'track', limit: 5 },
    headers: { Authorization: `Bearer ${token}` },
  });
  return (response.data.tracks?.items ?? []) as SpotifyItem[];
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

