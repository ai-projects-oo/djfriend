import type { Song } from '../types';

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

export function parsePlaylistId(input: string): string | null {
  const urlMatch = input.match(/playlist\/([A-Za-z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[A-Za-z0-9]{22}$/.test(input.trim())) return input.trim();
  return null;
}

async function spotifyGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Spotify error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface SpotifyUserPlaylist {
  id: string;
  name: string;
  trackCount: number;
  imageUrl: string | null;
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

export interface SpotifyImportTrack {
  spotifyId: string;
  title: string;
  artist: string;
  unavailable?: boolean;
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

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function findSongsForImport(tracks: import('../types').ImportTrack[], library: Song[]): Song[] {
  const seen = new Set<string>();
  return tracks
    .filter(t => t.inLibrary && !t.unavailable)
    .reduce<Song[]>((acc, t) => {
      const found = library.find(s =>
        s.spotifyId === t.spotifyId ||
        (norm(s.spotifyTitle ?? s.title) === norm(t.title) &&
          (norm(s.spotifyArtist ?? s.artist) === norm(t.artist) ||
           norm(s.spotifyArtist ?? s.artist).includes(norm(t.artist)) ||
           norm(t.artist).includes(norm(s.spotifyArtist ?? s.artist))))
      );
      if (found && !seen.has(found.file)) {
        seen.add(found.file);
        acc.push(found);
      }
      return acc;
    }, []);
}

// Returns 'exact' (clean match), 'stripped' (needed parenthetical stripping), or false
function titlesMatch(a: string, b: string): 'exact' | 'stripped' | false {
  if (a === b) return 'exact';
  // One is a leading substring of the other (handles " (Dub Mix)" suffix on one side)
  if (b.startsWith(a) || a.startsWith(b)) return 'stripped';
  // Strip trailing parenthetical and compare again
  const strip = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const as = strip(a), bs = strip(b);
  if (as.length > 2 && (as === bs || bs.startsWith(as) || as.startsWith(bs))) return 'stripped';
  return false;
}

export function matchInLibrary(spotifyId: string, title: string, artist: string, library: Song[]): 'exact' | 'fuzzy' | 'partial' | false {
  if (library.some((s) => s.spotifyId === spotifyId)) return 'exact';
  const nTitle = norm(title);
  const nArtist = norm(artist);
  let best: 'fuzzy' | 'partial' | false = false;
  for (const s of library) {
    const sTitle = norm(s.spotifyTitle ?? s.title);
    const sArtist = norm(s.spotifyArtist ?? s.artist);
    const artistOk = sArtist === nArtist || sArtist.includes(nArtist) || nArtist.includes(sArtist);
    if (!artistOk) continue;
    const tm = titlesMatch(sTitle, nTitle);
    if (tm === 'exact') return 'fuzzy';     // clean title/artist match → green
    if (tm === 'stripped') best = 'partial'; // needed stripping → yellow
  }
  return best;
}
