import type { Song, SetTrack, DJPreferences, CurvePoint, VenueType, SetPhase, TagFilters, ScoringWeights, HistoryEntry } from '../types';
import { camelotHarmonyScore, isHarmonicWarning, isCamelotClockwise } from './camelot';
import { computePlayStats, familiarityScore } from './historyStats';
import { sampleCurve } from './curveInterpolation';
import { matchesGenrePref } from './genreUtils';

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

export function getAffinityKey(venue: VenueType, setPhase: SetPhase): AffinityKey | null {
  if (venue === 'Club' && setPhase === 'Peak time') return 'club-peak';
  if (venue === 'Bar') return 'bar-background';
  if (venue === 'Wedding') return 'wedding-birthday';
  if (venue === 'Festival') return 'festival';
  return null;
}

export function genreAffinityBonus(song: Song, affinityKey: AffinityKey | null): number {
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

export function semanticAffinityBonus(song: Song, venue: VenueType, setPhase: SetPhase): number {
  if (!song.semanticTags) return 0
  const { venueTags, timeOfNightTags } = song.semanticTags
  const expectedVenueTags = VENUE_TAG_MAP[venue] ?? []
  const expectedTimeTags = TIME_TAG_MAP[setPhase] ?? []
  const venueMatch = expectedVenueTags.length > 0 && venueTags.some(t => expectedVenueTags.includes(t))
  const timeMatch = expectedTimeTags.length > 0 && timeOfNightTags.some(t => expectedTimeTags.includes(t))
  return (venueMatch ? 0.05 : 0) + (timeMatch ? 0.05 : 0)
}

// Expand merged tags like "dark / intense" into ["dark", "intense"]
function expandTags(tags: string[]): string[] {
  return tags.flatMap(t => t.includes(' / ') ? t.split(' / ').map(p => p.trim()) : [t]);
}

function tagFilterBonus(song: Song, filters: TagFilters | undefined): number {
  if (!filters) return 0;
  const { vibeTags, moodTags, vocalTypes, venueTags, timeOfNightTags } = filters;
  const hasAny = vibeTags.length + moodTags.length + vocalTypes.length + venueTags.length + timeOfNightTags.length > 0;
  if (!hasAny) return 0;
  if (!song.semanticTags) return 0;
  const t = song.semanticTags;
  let matches = 0;
  let categories = 0;
  if (vibeTags.length > 0) { categories++; if (t.vibeTags.some(v => expandTags(vibeTags).includes(v))) matches++; }
  if (moodTags.length > 0) { categories++; if (t.moodTags.some(v => expandTags(moodTags).includes(v))) matches++; }
  if (vocalTypes.length > 0) { categories++; if (expandTags(vocalTypes).includes(t.vocalType)) matches++; }
  if (venueTags.length > 0) { categories++; if (t.venueTags.some(v => expandTags(venueTags).includes(v))) matches++; }
  if (timeOfNightTags.length > 0) { categories++; if (t.timeOfNightTags.some(v => expandTags(timeOfNightTags).includes(v))) matches++; }
  return (matches / categories) * 0.2;
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface GenerateOptions {
  /** 0–1 random bonus added to each song's score — produces a different result each call */
  jitter?: number;
  /** songs to exclude from the candidate pool (for "generate new" from remaining tracks) */
  excludeFiles?: Set<string>;
  /** restrict pool to only these files (playlist filter) */
  playlistFilterFiles?: Set<string>;
  /** hard cap in seconds — stop adding tracks once cumulative duration would exceed this */
  maxDurationSeconds?: number;
  /** scoring weight overrides — defaults reproduce existing behaviour */
  weights?: ScoringWeights;
  /** set history used to compute per-track familiarity scores */
  history?: HistoryEntry[];
}

export function generateSet(
  songs: Song[],
  prefs: DJPreferences,
  curve: CurvePoint[],
  options?: GenerateOptions,
): SetTrack[] {
  if (songs.length === 0) return [];

  const genreFilteredSongs = songs.filter((song) => matchesGenrePref(song, prefs.genre));
  let candidatePool = genreFilteredSongs.length > 0 ? genreFilteredSongs : songs;

  // Date added filter — only applied when tracks actually have dateAdded set
  const filter = prefs.addedTimeFilter ?? 'all';
  if (filter !== 'all') {
    const nowSec = Date.now() / 1000;
    const cutoff = filter === 'year'
      ? new Date(new Date().getFullYear(), 0, 1).getTime() / 1000
      : nowSec - (filter === '30d' ? 30 : filter === '90d' ? 90 : 120) * 86400;
    const dateFiltered = candidatePool.filter(s => s.dateAdded == null || s.dateAdded >= cutoff);
    if (dateFiltered.length > 0) candidatePool = dateFiltered;
  }

  if (options?.playlistFilterFiles?.size) {
    const filtered = candidatePool.filter(s => options.playlistFilterFiles!.has(s.file));
    if (filtered.length > 0) candidatePool = filtered;
  }

  if (options?.excludeFiles?.size) {
    const remaining = candidatePool.filter(s => !options.excludeFiles!.has(s.file));
    if (remaining.length > 0) candidatePool = remaining;
  }

  const FALLBACK_DURATION = 210; // 3.5 min fallback when duration is absent
  const budgetSeconds = options?.maxDurationSeconds ?? prefs.setDuration * 60;

  // 1. Estimate track count from average duration (upper bound; actual loop stops on budget)
  const avgDuration =
    candidatePool.reduce((sum, s) => sum + (s.duration ?? FALLBACK_DURATION), 0) / candidatePool.length;
  const trackSlotDuration = avgDuration + GAP_SECONDS;
  const estCount = Math.max(1, Math.floor(budgetSeconds / trackSlotDuration));
  const maxCount = Math.min(estCount, candidatePool.length);

  const affinityKey = getAffinityKey(prefs.venueType, prefs.setPhase);

  const result: SetTrack[] = [];
  const used = new Set<string>();
  let cumulativeSeconds = 0;

  for (let slot = 0; slot < maxCount; slot++) {
    // 2. Sample the energy curve for this slot (use maxCount so curve shape is preserved)
    const slotProgress = maxCount === 1 ? 0.5 : slot / (maxCount - 1);
    const targetEnergy = sampleCurve(curve, slotProgress);

    const prevTrack = result.length > 0 ? result[result.length - 1] : null;
    const prevCamelot = prevTrack?.camelot ?? null;
    const prevBpm = prevTrack?.bpm ?? null;

    // Slope-aware energy boost: when the curve is rising (≥ 0.05 delta),
    // apply a small bonus to tracks that move clockwise on the Camelot wheel.
    const prevTargetEnergy = prevTrack?.targetEnergy ?? targetEnergy;
    const slopeRising = targetEnergy - prevTargetEnergy >= 0.05;

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
      // Transition smoothness: match end of previous track to start of this track.
      // Falls back to overall energy delta when energyProfile is absent (old scans).
      const transitionScore = prevTrack !== null
        ? (prevTrack.energyProfile && song.energyProfile
            ? 1 - Math.abs(prevTrack.energyProfile.outro - song.energyProfile.intro)
            : 1 - clamp(Math.abs(song.energy - prevTrack.energy) / 0.4, 0, 1))
        : 1.0;
      const affinityBonus = genreAffinityBonus(song, affinityKey);
      const semBonus = semanticAffinityBonus(song, prefs.venueType, prefs.setPhase);
      const tagBonus = tagFilterBonus(song, prefs.tagFilters);
      // Clockwise Camelot move bonus: on rising curve slopes, prefer tracks that
      // step forward on the wheel (energy boost direction per MixedInKey).
      const boostBonus = slopeRising && prevCamelot !== null && isCamelotClockwise(prevCamelot, song.camelot) ? 0.08 : 0;
      // Familiarity: small bonus for tracks the DJ knows well; slight penalty for overplayed ones.
      // Max contribution: (1.0 - 0.5) * 0.06 = +0.03; min: (0.3 - 0.5) * 0.06 = -0.012
      const famBonus = options?.history
        ? (familiarityScore(computePlayStats(options.history, song.file).playCount) - 0.5) * 0.06
        : 0;
      const jitter = options?.jitter ? Math.random() * options.jitter : 0;
      const wH = options?.weights?.harmonicWeight   ?? 0.55;
      const wB = options?.weights?.bpmWeight        ?? 0.25;
      const wT = options?.weights?.transitionWeight ?? 0.10;
      const score = harmonicScore * wH + bpmScore * wB + transitionScore * wT + affinityBonus + semBonus + tagBonus + boostBonus + famBonus + jitter;
      if (score > bestScore) {
        bestScore = score;
        bestSong = song;
      }
    }

    // 5. Hard duration cap — stop before exceeding the budget
    const trackDur = (bestSong.duration ?? FALLBACK_DURATION) + GAP_SECONDS;
    if (result.length > 0 && cumulativeSeconds + trackDur > budgetSeconds) break;

    cumulativeSeconds += trackDur;
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
