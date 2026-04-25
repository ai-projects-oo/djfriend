import type { SetTrack, DJPreferences, CrateGap } from '../types';
import { parseCamelot } from './camelot';
import { computeSetScore } from './setScore';

const ENERGY_GAP_THRESHOLD = 0.15;
// Dedup radius: adjacent flagged slots within this distance collapse into one suggestion.
// O(g²) over gap count g which is bounded by set length — acceptable for typical set sizes.
const DEDUP_SLOT_RADIUS = 2;
const BPM_TOLERANCE = 0.03;

// Panel-level gate: only surface suggestions when the set has meaningful aggregate issues.
const HARMONIC_RATE_GATE = 0.20;
const ENERGY_ERROR_GATE = 0.15;

function camelotNeighbors(camelot: string): string[] {
  const p = parseCamelot(camelot);
  if (!p) return [];
  const prev = p.num === 1 ? 12 : p.num - 1;
  const next = p.num === 12 ? 1 : p.num + 1;
  const other: 'A' | 'B' = p.letter === 'A' ? 'B' : 'A';
  // Three distinct neighbors: ±1 same letter, same number other letter
  return [`${prev}${p.letter}`, `${next}${p.letter}`, `${p.num}${other}`];
}

function adjacentKeys(prev: SetTrack | null, next: SetTrack | null): string[] {
  const keys = new Set<string>();
  if (prev) camelotNeighbors(prev.camelot).forEach(k => keys.add(k));
  if (next) camelotNeighbors(next.camelot).forEach(k => keys.add(k));
  return [...keys];
}

function safeBpm(b: number | undefined): number | null {
  return b != null && b > 0 ? b : null;
}

export function findCrateGaps(set: SetTrack[], prefs: DJPreferences): CrateGap[] {
  if (set.length < 2) return [];

  // Gate: only show the panel when the set has aggregate quality issues
  const score = computeSetScore(set);
  if (score && score.harmonicRate <= HARMONIC_RATE_GATE && score.avgEnergyError <= ENERGY_ERROR_GATE) {
    return [];
  }

  const genres = prefs.genres ?? [];
  const genreLabel = genres.length === 1 ? genres[0] : genres.length > 1 ? genres.join('/') : '';

  const rawGaps: Array<{ slot: number; energyDelta: number; gap: CrateGap }> = [];

  for (let i = 0; i < set.length; i++) {
    const track = set[i];
    const energyDelta = Math.abs(track.energy - track.targetEnergy);
    const flagged = track.harmonicWarning === true || energyDelta > ENERGY_GAP_THRESHOLD;
    if (!flagged) continue;

    const prev = i > 0 ? set[i - 1] : null;
    const next = i < set.length - 1 ? set[i + 1] : null;

    const prevBpm = safeBpm(prev?.bpm) ?? safeBpm(track.bpm);
    const nextBpm = safeBpm(next?.bpm) ?? safeBpm(track.bpm);
    const bpmRange = prevBpm != null && nextBpm != null
      ? {
          min: Math.round(Math.min(prevBpm, nextBpm) * (1 - BPM_TOLERANCE)),
          max: Math.round(Math.max(prevBpm, nextBpm) * (1 + BPM_TOLERANCE)),
        }
      : null;

    const camelotNeeded = adjacentKeys(prev, next);
    const keyStr = camelotNeeded.slice(0, 3).join('/');
    const energyStr = track.targetEnergy.toFixed(1);
    const suggestedSearch = [
      genreLabel,
      bpmRange ? `${bpmRange.min}–${bpmRange.max} BPM` : '',
      keyStr ? `key ${keyStr}` : '',
      `energy ${energyStr}+`,
    ].filter(Boolean).join(' ');

    rawGaps.push({
      slot: i,
      energyDelta,
      gap: {
        slot: i,
        setPosition: i / (set.length - 1),
        targetEnergy: track.targetEnergy,
        camelotNeeded,
        bpmRange,
        suggestedSearch,
      },
    });
  }

  // Deduplicate: within DEDUP_SLOT_RADIUS, keep the entry with the largest energy delta
  const kept: typeof rawGaps = [];
  for (const candidate of rawGaps) {
    const nearby = kept.findIndex(k => Math.abs(k.slot - candidate.slot) <= DEDUP_SLOT_RADIUS);
    if (nearby === -1) {
      kept.push(candidate);
    } else if (candidate.energyDelta > kept[nearby].energyDelta) {
      kept[nearby] = candidate;
    }
  }

  return kept.map(k => k.gap);
}
