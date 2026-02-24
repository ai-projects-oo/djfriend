import type { Song, SetTrack, DJPreferences, CurvePoint, VenueType, OccasionType, AudiencePurpose } from '../types';
import { camelotHarmonyScore, isHarmonicWarning } from './camelot';
import { sampleCurve } from './curveInterpolation';

const GAP_SECONDS = 10;

// ─── Genre affinity map ────────────────────────────────────────────────────────

type AffinityKey =
  | 'club-dancing-peak'
  | 'bar-background'
  | 'wedding-birthday'
  | 'festival';

const GENRE_AFFINITY: Record<AffinityKey, string[]> = {
  'club-dancing-peak': ['techno', 'house', 'electronic', 'dance', 'edm', 'trance', 'disco'],
  'bar-background': ['soul', 'jazz', 'indie', 'chill', 'lounge', 'r&b', 'neo-soul'],
  'wedding-birthday': ['pop', 'classic soul', 'funk', 'motown', 'disco', 'r&b', 'soul'],
  festival: ['electronic', 'rock', 'indie', 'alternative', 'edm', 'dance'],
};

function getAffinityKey(
  venue: VenueType,
  purpose: AudiencePurpose,
  occasion: OccasionType,
): AffinityKey | null {
  if (venue === 'Club' && purpose === 'Dancing' && occasion === 'Peak time') {
    return 'club-dancing-peak';
  }
  if (venue === 'Bar' && purpose === 'Background') {
    return 'bar-background';
  }
  if (venue === 'Wedding' || occasion === 'Birthday') {
    return 'wedding-birthday';
  }
  if (venue === 'Festival') {
    return 'festival';
  }
  return null;
}

function genreAffinityBonus(song: Song, affinityKey: AffinityKey | null): number {
  if (!affinityKey) return 0;
  const preferred = GENRE_AFFINITY[affinityKey];
  const hasMatch = song.genres.some((g) =>
    preferred.some((p) => g.toLowerCase().includes(p)),
  );
  return hasMatch ? 0.15 : 0;
}

function matchesGenre(song: Song, genre: string): boolean {
  if (genre === 'Any') return true;
  const needle = genre.toLowerCase();
  return song.genres.some((g) => g.toLowerCase().includes(needle));
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function scoreTrack(
  song: Song,
  targetEnergy: number,
  prevCamelot: string | null,
  prevBpm: number | null,
  affinityKey: AffinityKey | null,
): number {
  // Energy score (weight 0.5)
  const energyScore = 1 - Math.abs(song.energy - targetEnergy);

  // Harmonic score (weight 0.3)
  const harmonicScore =
    prevCamelot !== null ? camelotHarmonyScore(prevCamelot, song.camelot) : 1.0;

  // BPM score (weight 0.2)
  const bpmScore =
    prevBpm !== null ? 1 - clamp(Math.abs(song.bpm - prevBpm) / 20, 0, 1) : 1.0;

  const base = energyScore * 0.5 + harmonicScore * 0.3 + bpmScore * 0.2;
  const bonus = genreAffinityBonus(song, affinityKey);

  return clamp(base + bonus, 0, 1.15); // bonus can push slightly above 1
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function generateSet(
  songs: Song[],
  prefs: DJPreferences,
  curve: CurvePoint[],
): SetTrack[] {
  if (songs.length === 0) return [];

  const genreFilteredSongs = songs.filter((song) => matchesGenre(song, prefs.genre));
  const candidatePool = genreFilteredSongs.length > 0 ? genreFilteredSongs : songs;

  const setDurationSeconds = prefs.setDuration * 60;

  // 1. Calculate track count based on average song duration + gap
  const FALLBACK_DURATION = 210; // 3.5 min fallback when duration is absent
  const avgDuration =
    candidatePool.reduce((sum, s) => sum + (s.duration ?? FALLBACK_DURATION), 0) / candidatePool.length;
  const trackSlotDuration = avgDuration + GAP_SECONDS;
  const trackCount = Math.max(1, Math.floor(setDurationSeconds / trackSlotDuration));
  const actualCount = Math.min(trackCount, candidatePool.length);

  const affinityKey = getAffinityKey(
    prefs.venueType,
    prefs.audiencePurpose,
    prefs.occasionType,
  );

  const result: SetTrack[] = [];
  const used = new Set<string>();

  for (let slot = 0; slot < actualCount; slot++) {
    // 2. Sample the energy curve for this slot
    const slotProgress = actualCount === 1 ? 0.5 : slot / (actualCount - 1);
    const targetEnergy = sampleCurve(curve, slotProgress);

    const prevTrack = result.length > 0 ? result[result.length - 1] : null;
    const prevCamelot = prevTrack?.camelot ?? null;
    const prevBpm = prevTrack?.bpm ?? null;

    // 3. Score all unused songs and pick the best
    let bestSong: Song | null = null;
    let bestScore = -Infinity;

    for (const song of candidatePool) {
      if (used.has(song.file)) continue;

      const score = scoreTrack(song, targetEnergy, prevCamelot, prevBpm, affinityKey);
      if (score > bestScore) {
        bestScore = score;
        bestSong = song;
      }
    }

    if (!bestSong) break;

    used.add(bestSong.file);
    result.push({
      ...bestSong,
      slot,
      targetEnergy,
      harmonicWarning: prevCamelot !== null
        ? isHarmonicWarning(prevCamelot, bestSong.camelot)
        : false,
    });
  }

  return result;
}
