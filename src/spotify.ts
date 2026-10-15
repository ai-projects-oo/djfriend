import axios from 'axios';
import { stripKeyPrefix, stripFeatured, pickConfidentMatch, pickTitleOnlyMatch } from './spotify-text.js';
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

async function searchSpotify(q: string, token: string, limit = 10): Promise<SpotifyItem[]> {
  const response = await axios.get('https://api.spotify.com/v1/search', {
    params: { q, type: 'track', limit },
    headers: { Authorization: `Bearer ${token}` },
  });
  return (response.data.tracks?.items ?? []) as SpotifyItem[];
}

export async function searchTrack(
  artist: string | null,
  title: string,
  token: string
): Promise<SearchResult | null> {
  const rawTitle = stripKeyPrefix(title);

  // Strip parentheticals and brackets for a cleaner title
  const cleanTitle = stripFeatured(rawTitle.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '')).trim();
  const cleanArtist = artist ? stripFeatured(artist).trim() : '';

  // If the filename embeds "Artist - Title", extract both halves
  const dashParts = rawTitle.split(' - ');
  const embeddedArtist = dashParts.length >= 2 ? dashParts[0].trim() : null;
  const titleAfterDash = dashParts.length >= 2
    ? dashParts.slice(1).join(' - ').replace(/\s*\([^)]*\)/g, '').trim()
    : null;

  // Build ordered query list: most specific first
  const queries: string[] = [];

  if (cleanArtist) {
    // Spotify field syntax — most precise
    queries.push(`artist:"${cleanArtist}" track:"${cleanTitle}"`);
    if (titleAfterDash && titleAfterDash !== cleanTitle)
      queries.push(`artist:"${cleanArtist}" track:"${titleAfterDash}"`);

    // Plain keyword fallbacks
    queries.push(`${cleanArtist} ${cleanTitle}`);
    if (rawTitle !== cleanTitle) queries.push(`${cleanArtist} ${rawTitle}`);
    if (titleAfterDash && titleAfterDash !== cleanTitle)
      queries.push(`${cleanArtist} ${titleAfterDash}`);
  }

  // If filename has embedded artist (e.g. "Theo - Wrong Perception"), try that artist too
  if (embeddedArtist && embeddedArtist !== cleanArtist && titleAfterDash) {
    queries.push(`artist:"${embeddedArtist}" track:"${titleAfterDash}"`);
    queries.push(`${embeddedArtist} ${titleAfterDash}`);
  }

  // Title-only fallbacks — useful when artist field is actually a label
  queries.push(`"${cleanTitle}"`);
  if (titleAfterDash && titleAfterDash !== cleanTitle) queries.push(`"${titleAfterDash}"`);
  queries.push(cleanTitle);
  if (rawTitle !== cleanTitle) queries.push(rawTitle);

  const seen = new Set<string>();
  for (const q of queries) {
    const qTrim = q.trim();
    if (!qTrim || seen.has(qTrim)) continue;
    seen.add(qTrim);

    const items = await searchSpotify(qTrim, token, 10);

    // Try strict match (artist + title) first
    const strictMatch = pickConfidentMatch(cleanArtist || embeddedArtist || rawTitle, cleanTitle, items);
    if (strictMatch) {
      return {
        spotifyId: strictMatch.id,
        artistId: strictMatch.artists[0]?.id ?? '',
        spotifyArtist: strictMatch.artists[0]?.name ?? '',
        spotifyTitle: strictMatch.name,
      };
    }

    // Title-only match — accept when artist field is likely a label (no strict match found)
    if (!cleanArtist || q.startsWith('"') || !q.includes(cleanArtist)) {
      const titleMatch = pickTitleOnlyMatch(titleAfterDash ?? cleanTitle, items);
      if (titleMatch) {
        return {
          spotifyId: titleMatch.id,
          artistId: titleMatch.artists[0]?.id ?? '',
          spotifyArtist: titleMatch.artists[0]?.name ?? '',
          spotifyTitle: titleMatch.name,
        };
      }
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

export interface AudioFeatures {
  bpm: number;
  key: number;
  mode: number;
  energy: number;
}

export async function getAudioFeatures(spotifyId: string, token: string): Promise<AudioFeatures | null> {
  try {
    const response = await axios.get(`https://api.spotify.com/v1/audio-features/${spotifyId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = response.data;
    if (!d || d.tempo == null) return null;
    return { bpm: Math.round(d.tempo), key: d.key as number, mode: d.mode as number, energy: d.energy as number };
  } catch {
    return null;
  }
}

