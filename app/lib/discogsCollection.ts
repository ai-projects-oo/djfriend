import type { Song } from '../types';
import type { DiscogsRelease, DiscogsCollectionEntry } from '../types';
import { apiFetch } from './apiFetch';

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function fetchDiscogsCollection(
  onProgress?: (loaded: number, total: number) => void,
): Promise<DiscogsRelease[]> {
  const res = await apiFetch('/api/discogs/sync', { method: 'POST' });
  if (!res.ok && res.status !== 200) {
    throw new Error(`Sync request failed: ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buf = '';
  const releases: DiscogsRelease[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { type: string; loaded?: number; total?: number; releases?: DiscogsRelease[]; message?: string };
      if (event.type === 'progress') {
        onProgress?.(event.loaded ?? 0, event.total ?? 0);
      } else if (event.type === 'done') {
        releases.push(...(event.releases ?? []));
      } else if (event.type === 'error') {
        throw new Error(event.message ?? 'Discogs sync failed');
      }
    }
  }

  return releases;
}

export function matchDiscogsCollection(
  releases: DiscogsRelease[],
  library: Song[],
): DiscogsRelease[] {
  return releases.map(release => {
    const normTitle  = norm(release.title);
    const normArtist = norm(release.artist);

    let match: { confidence: 'exact' | 'fuzzy'; song: Song } | null = null;

    for (const song of library) {
      const songTitle  = norm(song.spotifyTitle ?? song.title);
      const songArtist = norm(song.spotifyArtist ?? song.artist);

      if (songTitle === normTitle && songArtist === normArtist) {
        match = { confidence: 'exact', song };
        break;
      }

      if (
        songTitle === normTitle &&
        (songArtist.includes(normArtist) || normArtist.includes(songArtist))
      ) {
        match = { confidence: 'fuzzy', song };
      }
    }

    if (match) {
      return {
        ...release,
        inLibrary:       true,
        matchConfidence: match.confidence,
        matchedFile:     match.song.file,
        bpm:             match.song.bpm   || undefined,
        camelot:         match.song.camelot || undefined,
        energy:          match.song.energy ?? undefined,
      };
    }
    return release;
  });
}

export function findSongsForDiscogsCollection(
  collection: DiscogsCollectionEntry,
  library: Song[],
): Song[] {
  const seen = new Set<string>();
  const result: Song[] = [];

  for (const release of collection.releases) {
    if (!release.inLibrary) continue;
    const normTitle  = norm(release.title);
    const normArtist = norm(release.artist);

    for (const song of library) {
      if (seen.has(song.file)) continue;
      const songTitle  = norm(song.spotifyTitle ?? song.title);
      const songArtist = norm(song.spotifyArtist ?? song.artist);

      if (
        songTitle === normTitle &&
        (songArtist === normArtist ||
          songArtist.includes(normArtist) ||
          normArtist.includes(songArtist))
      ) {
        seen.add(song.file);
        result.push(song);
        break;
      }
    }
  }

  return result;
}

export function getDiscogsMatchedFiles(
  collection: DiscogsCollectionEntry,
  library: Song[],
): Set<string> {
  const songs = findSongsForDiscogsCollection(collection, library);
  return new Set(songs.map(s => s.file));
}
