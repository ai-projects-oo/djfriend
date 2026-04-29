import type { Song, SetTrack, DJPreferences, CurvePoint, VenueType, SetPhase, TagFilters, ScoringWeights, HistoryEntry } from '../types';
import { camelotHarmonyScore, isHarmonicWarning, isCamelotClockwise } from './camelot';
import { computePlayStats, familiarityScore } from './historyStats';
import { sampleCurve } from './curveInterpolation';
import { matchesGenrePrefs } from './genreUtils';
import type { ModelWeights } from './mlModel';
import { mlpForward } from './mlModel';
import { transitionFeatures } from './mlFeatures';

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
  return hasMatch ? 0.06 : 0;
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
  /**
   * Softmax temperature for top-k candidate sampling (0 = always pick best, 1 = broad variation).
   * Default 0 (deterministic). Use ~0.25 for varied-but-good generation.
   */
  variation?: number;
  /** @deprecated use variation instead */
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
  /** trained ML model weights — when present, blends learned score with rule-based */
  mlWeights?: ModelWeights | null;
  /**
   * Number of independent generation passes. Each pass uses variation-based sampling
   * to explore different valid orderings; the highest-scoring set wins.
   * Default 1 (single pass). Use 8–12 for best quality.
   */
  passes?: number;
}

import { computeSetScore } from './setScore';

/** Single greedy pass — called N times by generateSet for tournament selection. */
function generateSetOnce(
  songs: Song[],
  prefs: DJPreferences,
  curve: CurvePoint[],
  options?: GenerateOptions,
): SetTrack[] {
  if (songs.length === 0) return [];

  const genreFilteredSongs = songs.filter((song) => matchesGenrePrefs(song, prefs.genres));
  let candidatePool = genreFilteredSongs.length > 0 ? genreFilteredSongs : songs;

  // BPM range hard filter — applied after genre filter, before date filter
  if (prefs.bpmMin != null || prefs.bpmMax != null) {
    const lo = prefs.bpmMin ?? 0;
    const hi = prefs.bpmMax ?? Infinity;
    const bpmFiltered = candidatePool.filter(s => s.bpm >= lo && s.bpm <= hi);
    if (bpmFiltered.length > 0) candidatePool = bpmFiltered;
  }

  // Date filter — works on dateAdded (Unix seconds) or year (ID3 release year)
  const df = prefs.dateFilter ?? { field: 'dateAdded' as const, preset: 'all' as const };
  if (df.preset !== 'all') {
    const currentYear = new Date().getFullYear();
    const dateFiltered = candidatePool.filter(s => {
      const year = df.field === 'releaseYear'
        ? s.year
        : s.dateAdded != null ? new Date(s.dateAdded * 1000).getFullYear() : undefined;
      if (year == null) return true; // no data → include
      if (df.preset === 'thisYear') return year === currentYear;
      if (df.preset === 'lastYear') return year === currentYear - 1;
      if (df.preset === 'older')    return year < currentYear - 1;
      if (df.preset === 'range') {
        if (df.field === 'releaseYear') {
          const fromYear = df.rangeFrom ? new Date(df.rangeFrom).getFullYear() : 0;
          const toYear   = df.rangeTo   ? new Date(df.rangeTo).getFullYear()   : currentYear;
          return year != null ? (year >= fromYear && year <= toYear) : true;
        } else {
          if (s.dateAdded == null) return true;
          const trackDate = new Date(s.dateAdded * 1000);
          const fromDate  = df.rangeFrom ? new Date(df.rangeFrom + 'T00:00:00') : new Date(0);
          const toDate    = df.rangeTo   ? new Date(df.rangeTo   + 'T23:59:59') : new Date();
          return trackDate >= fromDate && trackDate <= toDate;
        }
      }
      return true;
    });
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
  const unlimited = prefs.setDuration === null && options?.maxDurationSeconds == null;
  const budgetSeconds = options?.maxDurationSeconds ?? (prefs.setDuration != null ? prefs.setDuration * 60 : Infinity);

  // 1. Estimate track count from average duration (upper bound; actual loop stops on budget)
  const avgDuration =
    candidatePool.reduce((sum, s) => sum + (s.duration ?? FALLBACK_DURATION), 0) / candidatePool.length;
  const trackSlotDuration = avgDuration + GAP_SECONDS;
  const estCount = unlimited ? candidatePool.length : Math.max(1, Math.floor(budgetSeconds / trackSlotDuration));
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

    // 4. Score every candidate in the energy neighbourhood
    type R = { text: string; quality: 'good' | 'ok' | 'bad' | 'bonus' | 'info' };
    type Scored = { song: Song; score: number; reasons: R[] };
    const scored: Scored[] = [];

    const wH = options?.weights?.harmonicWeight   ?? 0.45;
    const wB = options?.weights?.bpmWeight        ?? 0.22;
    const wT = options?.weights?.transitionWeight ?? 0.08;
    const wE = options?.weights?.energyWeight     ?? 0.25;

    for (const song of energyNeighbours) {
      const harmonicScore =
        prevCamelot !== null ? camelotHarmonyScore(prevCamelot, song.camelot) : 1.0;
      const bpmScore =
        prevBpm !== null ? 1 - clamp(Math.abs(song.bpm - prevBpm) / 20, 0, 1) : 1.0;
      const transitionScore = prevTrack !== null
        ? (prevTrack.energyProfile && song.energyProfile
            ? 1 - Math.abs(prevTrack.energyProfile.outro - song.energyProfile.intro)
            : 1 - clamp(Math.abs(song.energy - prevTrack.energy) / 0.4, 0, 1))
        : 1.0;
      const affinityBonus = genreAffinityBonus(song, affinityKey);
      const semBonus = semanticAffinityBonus(song, prefs.venueType, prefs.setPhase);
      const tagBonus = tagFilterBonus(song, prefs.tagFilters);
      const boostBonus = slopeRising && prevCamelot !== null && isCamelotClockwise(prevCamelot, song.camelot)
        && (prevTrack === null || song.energy >= prevTrack.energy - 0.05) ? 0.05 : 0;
      const playCount = options?.history ? computePlayStats(options.history, song.file).playCount : 0;
      const famBonus = options?.history ? (familiarityScore(playCount) - 0.5) * 0.06 : 0;
      const energyScore = Math.max(0, 1 - Math.abs(song.energy - targetEnergy) / 0.28);
      const ruleScore = harmonicScore * wH + bpmScore * wB + transitionScore * wT + energyScore * wE;
      const mlScore = options?.mlWeights && prevTrack
        ? mlpForward(transitionFeatures(
            prevTrack, song, targetEnergy,
            maxCount > 1 ? slot / (maxCount - 1) : 0.5,
          ), options.mlWeights)
        : null;
      const baseScore = mlScore !== null ? ruleScore * 0.7 + mlScore * 0.3 : ruleScore;
      // legacy jitter support
      const jitter = options?.jitter ? Math.random() * options.jitter : 0;
      const score = baseScore + affinityBonus + semBonus + tagBonus + boostBonus + famBonus + jitter;

      const reasons: R[] = [];
      if (prevCamelot !== null) {
        if (harmonicScore >= 1.0)       reasons.push({ text: `Key ${prevCamelot}→${song.camelot} — perfect match`, quality: 'good' });
        else if (harmonicScore >= 0.75) reasons.push({ text: `Key ${prevCamelot}→${song.camelot} — compatible`, quality: 'ok' });
        else if (harmonicScore >= 0.5)  reasons.push({ text: `Key ${prevCamelot}→${song.camelot} — energy boost`, quality: 'bonus' });
        else                            reasons.push({ text: `Key ${prevCamelot}→${song.camelot} — key jump`, quality: 'bad' });
      }
      const eDelta = Math.abs(song.energy - targetEnergy);
      const eQuality: R['quality'] = eDelta <= 0.05 ? 'good' : eDelta <= 0.15 ? 'ok' : 'bad';
      reasons.push({ text: `Energy ${Math.round(song.energy * 100)} → target ${Math.round(targetEnergy * 100)}`, quality: eQuality });
      if (prevBpm !== null) {
        const delta = Math.round(song.bpm - prevBpm);
        reasons.push({ text: `BPM ${Math.round(song.bpm)}  ${delta >= 0 ? '+' : ''}${delta} from prev`, quality: 'info' });
      }
      if (boostBonus > 0)  reasons.push({ text: 'Clockwise energy boost', quality: 'bonus' });
      if (affinityBonus > 0) reasons.push({ text: 'Genre affinity', quality: 'bonus' });
      if (semBonus > 0)    reasons.push({ text: 'Vibe match', quality: 'bonus' });
      if (tagBonus > 0)    reasons.push({ text: 'Tag filter match', quality: 'bonus' });
      if (options?.history) {
        if (playCount === 0)       reasons.push({ text: 'First time in a set', quality: 'info' });
        else if (playCount >= 10)  reasons.push({ text: `Played ${playCount}× — cooling down`, quality: 'ok' });
        else                       reasons.push({ text: `Played ${playCount}× — familiar`, quality: 'good' });
      }

      scored.push({ song, score, reasons });
    }

    // 5. Pick the winner — deterministic (best score) or softmax-sampled top-k for variation
    scored.sort((a, b) => b.score - a.score);
    let winner: Scored;
    const variation = options?.variation ?? 0;
    if (variation > 0 && scored.length > 1) {
      // Sample from top-3 using softmax-weighted probability
      const topK = scored.slice(0, Math.min(3, scored.length));
      const temp = Math.max(0.01, variation * 0.5); // scale: variation=0.5 → temp=0.25
      const exps = topK.map(c => Math.exp(c.score / temp));
      const total = exps.reduce((s, e) => s + e, 0);
      const r = Math.random() * total;
      let cumulative = 0;
      winner = topK[topK.length - 1]; // fallback to last if loop doesn't break
      for (let i = 0; i < topK.length; i++) {
        cumulative += exps[i];
        if (r <= cumulative) { winner = topK[i]; break; }
      }
    } else {
      winner = scored[0];
    }

    const bestSong = winner.song;
    const bestReasons = winner.reasons;

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
      selectionReason: bestReasons.length > 0 ? bestReasons : undefined,
    });
  }

  return result;
}

/**
 * Generate a DJ set by running multiple greedy passes and returning the highest-scoring result.
 * `options.passes` (default 1) controls how many alternatives are explored.
 * With passes > 1, each pass uses variation-based sampling so they diverge;
 * the winner is the set with the highest computeSetScore total.
 */
export function generateSet(
  songs: Song[],
  prefs: DJPreferences,
  curve: CurvePoint[],
  options?: GenerateOptions,
): SetTrack[] {
  const passes = options?.passes ?? 1;

  if (passes <= 1) return generateSetOnce(songs, prefs, curve, options);

  // First pass: deterministic best (no variation) — always included as baseline
  const baselineOpts = { ...options, variation: 0 };
  let best = generateSetOnce(songs, prefs, curve, baselineOpts);
  let bestScore = computeSetScore(best)?.total ?? 0;

  // Remaining passes: use variation so each explores a different ordering
  const variationOpts = { ...options, variation: options?.variation ?? 0.5 };
  for (let i = 1; i < passes; i++) {
    const candidate = generateSetOnce(songs, prefs, curve, variationOpts);
    const score = computeSetScore(candidate)?.total ?? 0;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}
