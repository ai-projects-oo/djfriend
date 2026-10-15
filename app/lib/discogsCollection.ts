import type { Song } from '../types';
import type { DiscogsRelease, DiscogsCollectionEntry, DiscogsMode } from '../types';

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
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

/**
 * Which files the set generator may draw from, given the media mode:
 * - Digital ('library'): the playlist filter if any, else everything.
 * - Vinyl ('crates'): only vinyl (records matched to library files + vinyl-only records), within the playlist if one is selected.
 * - Mixed ('crates-first'): digital AND vinyl — the playlist (if any) limits the digital side, vinyl-only records
 *   always stay eligible. Vinyl is favoured by the crates-first score bonus, not by excluding digital tracks.
 * `undefined` = no restriction.
 */
export function generatorFilterFiles(
  mode: DiscogsMode,
  crateFiles: Set<string> | undefined,
  playlistFiles: Set<string> | undefined,
  vinylOnlyFiles: Iterable<string>,
): Set<string> | undefined {
  if (mode === 'crates' && crateFiles) {
    if (!playlistFiles) return crateFiles.size > 0 ? crateFiles : undefined;
    const both = new Set([...playlistFiles].filter(f => crateFiles.has(f)));
    return both.size > 0 ? both : undefined;
  }
  if (mode === 'crates-first' && playlistFiles) return new Set([...playlistFiles, ...vinylOnlyFiles]);
  return playlistFiles;
}
