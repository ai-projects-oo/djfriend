import type { SetTrack } from '../types';

declare const __SPOTIFY_CLIENT_ID__: string;

const STORAGE_PREFIX = 'djfriend-spotify';
const TOKEN_KEY = `${STORAGE_PREFIX}-token`;
const TOKEN_EXPIRY_KEY = `${STORAGE_PREFIX}-token-expiry`;
const VERIFIER_KEY = `${STORAGE_PREFIX}-verifier`;
const PENDING_SET_KEY = `${STORAGE_PREFIX}-pending-set`;
const PENDING_NAME_KEY = `${STORAGE_PREFIX}-pending-name`;

function getRedirectUri(): string {
  return 'http://127.0.0.1:8888/callback';
}

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join('');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function getStoredToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!token || !expiry) return null;
  if (Date.now() > parseInt(expiry, 10)) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    return null;
  }
  return token;
}

export function storeToken(accessToken: string, expiresIn: number): void {
  localStorage.setItem(TOKEN_KEY, accessToken);
  // Subtract 60s to avoid using a token right as it expires
  localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + (expiresIn - 60) * 1000));
}

export function storePendingExport(tracks: SetTrack[], name: string): void {
  sessionStorage.setItem(PENDING_SET_KEY, JSON.stringify(tracks));
  sessionStorage.setItem(PENDING_NAME_KEY, name);
}

export function getPendingExport(): { tracks: SetTrack[]; name: string } | null {
  const raw = sessionStorage.getItem(PENDING_SET_KEY);
  const name = sessionStorage.getItem(PENDING_NAME_KEY);
  if (!raw || !name) return null;
  try {
    return { tracks: JSON.parse(raw) as SetTrack[], name };
  } catch {
    return null;
  }
}

export function clearPendingExport(): void {
  sessionStorage.removeItem(PENDING_SET_KEY);
  sessionStorage.removeItem(PENDING_NAME_KEY);
}

export async function redirectToSpotifyLogin(): Promise<void> {
  const clientId = __SPOTIFY_CLIENT_ID__;
  if (!clientId) throw new Error('SPOTIFY_CLIENT_ID is not configured in .env');

  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem(VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: 'playlist-modify-public playlist-modify-private playlist-read-private playlist-read-collaborative',
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

export async function exchangeCodeForToken(code: string): Promise<{ access_token: string; expires_in: number }> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new Error('No code verifier found. Please try again.');
  sessionStorage.removeItem(VERIFIER_KEY);

  const body = new URLSearchParams({
    client_id: __SPOTIFY_CLIENT_ID__,
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: verifier,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((err['error_description'] as string) ?? 'Failed to exchange authorization code.');
  }

  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function spotifyFetch<T>(url: string, token: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    const msg = err.error?.message ?? res.statusText;
    throw new Error(`Spotify: ${msg}`);
  }
  return res.json() as Promise<T>;
}

async function getSpotifyUserId(token: string): Promise<string> {
  const data = await spotifyFetch<{ id: string }>('https://api.spotify.com/v1/me', token);
  return data.id;
}

function cleanSearchStr(str: string): string {
  return str.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').trim();
}

function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True if the candidate has sufficient word overlap with original. */
function hasWordOverlap(original: string, candidate: string): boolean {
  const orig = normalizeStr(original);
  const cand = normalizeStr(candidate);
  if (orig === cand) return true;
  if (cand.includes(orig) || orig.includes(cand)) return true;
  const words = orig.split(' ').filter((w) => w.length > 2);
  if (words.length === 0) return orig === cand.split(' ')[0];
  const matched = words.filter((w) => cand.includes(w)).length;
  return matched >= Math.ceil(words.length * 0.6);
}

/** Rejects results where title or artist don't match what we searched for. */
function isConfidentMatch(
  origTitle: string, origArtist: string,
  spotTitle: string, spotArtists: string,
): boolean {
  return hasWordOverlap(origTitle, spotTitle) && hasWordOverlap(origArtist, spotArtists);
}

interface SpotifyTrackResult {
  uri: string;
  name: string;
  artists: string;
}

/** 'exact' = full titles match after normalization; 'partial' = version/edit differs */
function matchConfidence(origTitle: string, spotTitle: string): 'exact' | 'partial' {
  return normalizeStr(origTitle) === normalizeStr(spotTitle) ? 'exact' : 'partial';
}

export interface SpotifyMatchResult {
  track: SetTrack;
  match: SpotifyTrackResult | null;
  confidence: 'exact' | 'partial' | null; // null when not found
  excluded: boolean;
}

async function searchSpotify(q: string, token: string): Promise<SpotifyTrackResult | null> {
  const data = await spotifyFetch<{
    tracks: { items: Array<{ uri: string; name: string; artists: Array<{ name: string }> }> };
  }>(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=1`,
    token,
  );
  const item = data.tracks.items[0];
  if (!item) return null;
  return { uri: item.uri, name: item.name, artists: item.artists.map((a) => a.name).join(', ') };
}

async function searchTrack(artist: string, title: string, token: string): Promise<SpotifyTrackResult | null> {
  const cleanTitle = cleanSearchStr(title);
  const cleanArtist = cleanSearchStr(artist);

  for (const q of [
    `track:${cleanTitle} artist:${cleanArtist}`,
    `${cleanArtist} ${cleanTitle}`,
  ]) {
    const result = await searchSpotify(q, token);
    if (result && isConfidentMatch(cleanTitle, cleanArtist, result.name, result.artists)) {
      return result;
    }
  }

  return null;
}

async function createPlaylist(
  userId: string,
  name: string,
  token: string,
): Promise<{ id: string; external_urls: { spotify: string } }> {
  return spotifyFetch(
    `https://api.spotify.com/v1/users/${encodeURIComponent(userId)}/playlists`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ name, public: false, description: 'Created by DJFriend' }),
    },
  );
}

async function addTracksToPlaylist(playlistId: string, uris: string[], token: string): Promise<void> {
  // Spotify allows max 100 tracks per request; pass explicit position so order is guaranteed
  for (let i = 0; i < uris.length; i += 100) {
    await spotifyFetch(
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
      token,
      { method: 'POST', body: JSON.stringify({ uris: uris.slice(i, i + 100), position: i }) },
    );
  }
}

export async function searchTracksOnSpotify(
  tracks: SetTrack[],
  token: string,
  onProgress: (completed: number, total: number) => void,
): Promise<SpotifyMatchResult[]> {
  const ordered = [...tracks].sort((a, b) => a.slot - b.slot);
  const results: SpotifyMatchResult[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const track = ordered[i];
    // Always use local ID3 tag values — spotifyArtist/spotifyTitle may already be a wrong match
    const match = await searchTrack(track.artist, track.title, token);
    const confidence = match ? matchConfidence(track.title, match.name) : null;
    results.push({ track, match, confidence, excluded: false });
    onProgress(i + 1, ordered.length);
  }

  return results;
}

export async function createPlaylistFromMatches(
  matches: SpotifyMatchResult[],
  playlistName: string,
  token: string,
): Promise<{ playlistUrl: string; matched: number; total: number }> {
  const userId = await getSpotifyUserId(token);
  const uris = matches.filter((m) => m.match && !m.excluded).map((m) => m.match!.uri);
  const playlist = await createPlaylist(userId, playlistName, token);
  if (uris.length > 0) {
    await addTracksToPlaylist(playlist.id, uris, token);
  }
  return { playlistUrl: playlist.external_urls.spotify, matched: uris.length, total: matches.length };
}
