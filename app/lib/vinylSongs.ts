import type { DiscogsCollectionEntry, DiscogsRelease, ManualData, Song, VinylReleaseData } from '../types';
import { CAMELOT_TO_KEY } from './camelot';

export const VINYL_FILE_PREFIX = 'vinyl:';

/** Stable pseudo-file key for a vinyl-only track — used wherever the generator keys songs by `file`. */
export function vinylFileKey(releaseId: number, position: string): string {
  return `${VINYL_FILE_PREFIX}${releaseId}:${position}`;
}

const LOW_ENERGY_GENRES  = ['ambient', 'downtempo', 'chill', 'lounge', 'balearic', 'dub', 'jazz', 'soul', 'trip hop', 'lo-fi'];
const HIGH_ENERGY_GENRES = ['techno', 'hard', 'trance', 'drum and bass', 'drum & bass', 'jungle', 'breakbeat', 'gabber', 'electro'];

/**
 * Rough energy (0–1) for a record we can't analyse — vinyl has no audio file.
 * Faster tempos and harder genres read as higher energy; the result is clamped to 0.2–0.9
 * so an estimate never claims the extremes of the curve.
 */
export function estimateVinylEnergy(bpm: number, genres: string[]): number {
  // 90 BPM → 0.35, 120 → 0.55, 130 → 0.65, 140 → 0.75
  let energy = 0.35 + (bpm - 90) * 0.0075;
  const g = genres.join(' ').toLowerCase();
  if (LOW_ENERGY_GENRES.some(k => g.includes(k)))  energy -= 0.1;
  if (HIGH_ENERGY_GENRES.some(k => g.includes(k))) energy += 0.05;
  return Math.round(Math.min(0.9, Math.max(0.2, energy)) * 100) / 100;
}

function releaseGenres(release: DiscogsRelease, store: VinylReleaseData | undefined, manual: ManualData | undefined, trackGenre?: string): string[] {
  const primary = trackGenre ?? store?.genre ?? manual?.aiGenre;
  const fallback = release.styles.length > 0 ? release.styles : release.genres;
  return primary ? [primary] : [...fallback];
}

/**
 * Turns vinyl records with no digital copy into Songs the set generator can use.
 * A track qualifies when it has a BPM and a Camelot key (from the per-track AI pass or entered by hand).
 * Records already linked to a library file are skipped — the digital copy is in the pool already.
 */
export function buildVinylSongs(
  collection: DiscogsCollectionEntry | null | undefined,
  vinylStore: Record<number, VinylReleaseData>,
  manualData: Map<number, ManualData>,
  rejected: Set<number>,
  libraryFiles: Set<string>,
): Song[] {
  if (!collection) return [];
  const songs: Song[] = [];
  for (const release of collection.releases) {
    if (rejected.has(release.releaseId)) continue;
    const manual = manualData.get(release.releaseId);
    const linked = release.matchedFile ?? manual?.matchedFile;
    if (linked && libraryFiles.has(linked)) continue;

    const store = vinylStore[release.releaseId];
    for (const track of store?.tracks ?? []) {
      const camelot = track.camelot?.trim().toUpperCase();
      if (!track.bpm || track.bpm <= 0 || !camelot) continue;
      const key = CAMELOT_TO_KEY[camelot.toLowerCase()];
      if (!key) continue;
      const genres = releaseGenres(release, store, manual, track.genre);
      songs.push({
        file: vinylFileKey(release.releaseId, track.position || track.id),
        artist: release.artist,
        title: track.title?.trim() || `${release.title} (${track.position})`,
        bpm: track.bpm,
        key,
        camelot,
        energy: estimateVinylEnergy(track.bpm, genres),
        genres,
        ...(release.year ? { year: release.year } : {}),
        ...(track.comment ? { comment: track.comment } : {}),
        discogsReleaseId: release.releaseId,
        vinylOnly: true,
      });
    }
  }
  return songs;
}
