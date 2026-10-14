import { spotifyRateLimited } from './spotifyRateLimit';
import type { SpotifyUserPlaylist, SpotifyImportTrack, SpotifyAudioFeatures } from '../lib/spotifyImport';

const PENDING_IMPORT_KEY = 'djfriend-spotify-pending-import';

export function storePendingImport(url: string): void {
  sessionStorage.setItem(PENDING_IMPORT_KEY, url);
}

export function getPendingImport(): string | null {
  return sessionStorage.getItem(PENDING_IMPORT_KEY);
}

export function clearPendingImport(): void {
  sessionStorage.removeItem(PENDING_IMPORT_KEY);
}

async function spotifyGet<T>(url: string, token: string): Promise<T> {
  const res = await spotifyRateLimited(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Spotify error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type PlaylistPage = {
  items: Array<{ id: string; name: string; tracks: { total: number }; images: Array<{ url: string }> | null }>;
  next: string | null;
};

export async function fetchUserPlaylists(token: string): Promise<SpotifyUserPlaylist[]> {
  const playlists: SpotifyUserPlaylist[] = [];
  let url: string | null = 'https://api.spotify.com/v1/me/playlists?limit=50';

  while (url) {
    const data: PlaylistPage = await spotifyGet<PlaylistPage>(url, token);

    for (const item of data.items) {
      playlists.push({
        id: item.id,
        name: item.name,
        trackCount: item.tracks.total,
        imageUrl: item.images?.[0]?.url ?? null,
      });
    }

    url = data.next;
  }

  return playlists;
}

export async function fetchPlaylistTracks(
  playlistId: string,
  token: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ playlistName: string; tracks: SpotifyImportTrack[] }> {
  const meta = await spotifyGet<{ name: string; tracks: { total: number } }>(
    `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}`,
    token,
  );

  const total = meta.tracks.total;
  const playlistName = meta.name;
  const tracks: SpotifyImportTrack[] = [];
  let offset = 0;
  const limit = 100;

  while (offset < total) {
    const data = await spotifyGet<{
      items: Array<{ track: { id: string; name: string; artists: Array<{ name: string }> } | null } | null>;
    }>(
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=${limit}&offset=${offset}`,
      token,
    );

    for (const item of data.items) {
      if (!item || !item.track) {
        tracks.push({ spotifyId: '', title: 'Unavailable track', artist: '', unavailable: true });
        continue;
      }
      tracks.push({
        spotifyId: item.track.id,
        title: item.track.name,
        artist: item.track.artists.map((a) => a.name).join(', '),
      });
    }

    offset += limit;
    onProgress?.(Math.min(offset, total), total);
  }

  return { playlistName, tracks };
}

export async function fetchAudioFeatures(
  spotifyIds: string[],
  token: string,
): Promise<Map<string, SpotifyAudioFeatures>> {
  const result = new Map<string, SpotifyAudioFeatures>();
  const BATCH = 100;
  for (let i = 0; i < spotifyIds.length; i += BATCH) {
    const ids = spotifyIds.slice(i, i + BATCH).join(',');
    const data = await spotifyGet<{ audio_features: (SpotifyAudioFeatures | null)[] }>(
      `https://api.spotify.com/v1/audio-features?ids=${encodeURIComponent(ids)}`,
      token,
    );
    for (const f of data.audio_features) {
      if (f) result.set(f.id, f);
    }
  }
  return result;
}
