import type { Song, SetTrack, DJPreferences, CurvePoint, VenueType, SetPhase, TagFilters } from '../types';
import { camelotHarmonyScore, isHarmonicWarning } from './camelot';
import { sampleCurve } from './curveInterpolation';

const GAP_SECONDS = 10;

// ─── Genre affinity map ────────────────────────────────────────────────────────

type AffinityKey =
  | 'club-peak'
  | 'bar-background'
  | 'wedding-birthday'
  | 'festival';

const GENRE_AFFINITY: Record<AffinityKey, string[]> = {
  'club-peak': ['techno', 'house', 'electronic', 'dance', 'edm', 'trance', 'disco'],
  'bar-background': ['soul', 'jazz', 'indie', 'chill', 'lounge', 'r&b', 'neo-soul'],
  'wedding-birthday': ['pop', 'classic soul', 'funk', 'motown', 'disco', 'r&b', 'soul'],
  festival: ['electronic', 'rock', 'indie', 'alternative', 'edm', 'dance'],
};

function getAffinityKey(venue: VenueType, setPhase: SetPhase): AffinityKey | null {
  if (venue === 'Club' && setPhase === 'Peak time') return 'club-peak';
  if (venue === 'Bar') return 'bar-background';
  if (venue === 'Wedding') return 'wedding-birthday';
  if (venue === 'Festival') return 'festival';
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

const VENUE_TAG_MAP: Partial<Record<VenueType, string[]>> = {
  Club: ['club', 'warehouse'],
  Festival: ['festival', 'outdoor'],
  Bar: ['bar', 'lounge', 'intimate'],
  Wedding: ['intimate'],
  'Private event': ['intimate'],
}

const TIME_TAG_MAP: Partial<Record<SetPhase, string[]>> = {
  'Warm-up': ['opening', 'warm-up'],
  'Peak time': ['peak-time'],
  'Cool-down': ['closing', 'after-hours'],
  'After-party': ['after-hours'],
}

function semanticAffinityBonus(song: Song, venue: VenueType, setPhase: SetPhase): number {
  if (!song.semanticTags) return 0
  const { venueTags, timeOfNightTags } = song.semanticTags
  const expectedVenueTags = VENUE_TAG_MAP[venue] ?? []
  const expectedTimeTags = TIME_TAG_MAP[setPhase] ?? []
  const venueMatch = expectedVenueTags.length > 0 && venueTags.some(t => expectedVenueTags.includes(t))
  const timeMatch = expectedTimeTags.length > 0 && timeOfNightTags.some(t => expectedTimeTags.includes(t))
  return (venueMatch ? 0.05 : 0) + (timeMatch ? 0.05 : 0)
}

function tagFilterBonus(song: Song, filters: TagFilters): number {
  const { vibeTags, moodTags, vocalTypes, venueTags, timeOfNightTags } = filters;
  const hasAny = vibeTags.length + moodTags.length + vocalTypes.length + venueTags.length + timeOfNightTags.length > 0;
  if (!hasAny) return 0;
  if (!song.semanticTags) return 0;
  const t = song.semanticTags;
  let matches = 0;
  let categories = 0;
  if (vibeTags.length > 0) { categories++; if (t.vibeTags.some(v => vibeTags.includes(v))) matches++; }
  if (moodTags.length > 0) { categories++; if (t.moodTags.some(v => moodTags.includes(v))) matches++; }
  if (vocalTypes.length > 0) { categories++; if (vocalTypes.includes(t.vocalType)) matches++; }
  if (venueTags.length > 0) { categories++; if (t.venueTags.some(v => venueTags.includes(v))) matches++; }
  if (timeOfNightTags.length > 0) { categories++; if (t.timeOfNightTags.some(v => timeOfNightTags.includes(v))) matches++; }
  return (matches / categories) * 0.2;
}

function matchesGenre(song: Song, genre: string): boolean {
  if (genre === 'Any') return true;
  const needle = genre.toLowerCase();
  return song.genres.some((g) => g.toLowerCase().includes(needle));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
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

  const affinityKey = getAffinityKey(prefs.venueType, prefs.setPhase);

  const result: SetTrack[] = [];
  const used = new Set<string>();

  for (let slot = 0; slot < actualCount; slot++) {
    // 2. Sample the energy curve for this slot
    const slotProgress = actualCount === 1 ? 0.5 : slot / (actualCount - 1);
    const targetEnergy = sampleCurve(curve, slotProgress);

    const prevTrack = result.length > 0 ? result[result.length - 1] : null;
    const prevCamelot = prevTrack?.camelot ?? null;
    const prevBpm = prevTrack?.bpm ?? null;

    const available = candidatePool.filter((s) => !used.has(s.file));
    if (available.length === 0) break;

    // 3. Energy-first selection:
    //    Sort all available songs by energy proximity, take the closest K as the
    //    energy neighbourhood, then pick the best harmonic/BPM fit among them.
    available.sort(
      (a, b) => Math.abs(a.energy - targetEnergy) - Math.abs(b.energy - targetEnergy),
    );
    const K = Math.max(5, Math.ceil(available.length * 0.15));
    const energyNeighbours = available.slice(0, K);

    // 4. Within the energy neighbourhood, score by harmonic + BPM + affinity
    let bestSong = energyNeighbours[0];
    let bestScore = -Infinity;

    for (const song of energyNeighbours) {
      const harmonicScore =
        prevCamelot !== null ? camelotHarmonyScore(prevCamelot, song.camelot) : 1.0;
      const bpmScore =
        prevBpm !== null ? 1 - clamp(Math.abs(song.bpm - prevBpm) / 20, 0, 1) : 1.0;
      const affinityBonus = genreAffinityBonus(song, affinityKey);
      const semBonus = semanticAffinityBonus(song, prefs.venueType, prefs.setPhase);
      const tagBonus = tagFilterBonus(song, prefs.tagFilters);
      const score = harmonicScore * 0.6 + bpmScore * 0.3 + affinityBonus + semBonus + tagBonus;
      if (score > bestScore) {
        bestScore = score;
        bestSong = song;
      }
    }

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
