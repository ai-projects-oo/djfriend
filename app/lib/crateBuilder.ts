import type { SetTrack, DJPreferences, CrateGap } from '../types';
import { parseCamelot } from './camelot';

const ENERGY_GAP_THRESHOLD = 0.15;
const DEDUP_SLOT_RADIUS = 2;
const BPM_TOLERANCE = 0.03;

function camelotNeighbors(camelot: string): string[] {
  const p = parseCamelot(camelot);
  if (!p) return [];
  const prev = p.num === 1 ? 12 : p.num - 1;
  const next = p.num === 12 ? 1 : p.num + 1;
  const other: 'A' | 'B' = p.letter === 'A' ? 'B' : 'A';
  return [
    `${prev}${p.letter}`,
    `${next}${p.letter}`,
    `${p.num}${other}`,
  ].filter((v, i, a) => a.indexOf(v) === i);
}

function adjacentKeys(prev: SetTrack | null, next: SetTrack | null): string[] {
  const keys = new Set<string>();
  if (prev) camelotNeighbors(prev.camelot).forEach(k => keys.add(k));
  if (next) camelotNeighbors(next.camelot).forEach(k => keys.add(k));
  return [...keys];
}

export function findCrateGaps(set: SetTrack[], prefs: DJPreferences): CrateGap[] {
  if (set.length < 2) return [];

  const genre = (prefs.genres ?? [])[0] ?? '';
  const rawGaps: Array<{ slot: number; energyDelta: number; gap: CrateGap }> = [];

  for (let i = 0; i < set.length; i++) {
    const track = set[i];
    const energyDelta = Math.abs(track.energy - track.targetEnergy);
    const flagged = track.harmonicWarning || energyDelta > ENERGY_GAP_THRESHOLD;
    if (!flagged) continue;

    const prev = i > 0 ? set[i - 1] : null;
    const next = i < set.length - 1 ? set[i + 1] : null;

    const prevBpm = prev?.bpm ?? track.bpm;
    const nextBpm = next?.bpm ?? track.bpm;
    const bpmRange = {
      min: Math.round(Math.min(prevBpm, nextBpm) * (1 - BPM_TOLERANCE)),
      max: Math.round(Math.max(prevBpm, nextBpm) * (1 + BPM_TOLERANCE)),
    };

    const camelotNeeded = adjacentKeys(prev, next);
    const keyStr = camelotNeeded.slice(0, 3).join('/');
    const energyStr = track.targetEnergy.toFixed(1);
    const suggestedSearch = [
      genre,
      `${bpmRange.min}–${bpmRange.max} BPM`,
      keyStr ? `key ${keyStr}` : '',
      `energy ${energyStr}+`,
    ].filter(Boolean).join(' ');

    rawGaps.push({
      slot: i,
      energyDelta,
      gap: {
        setPosition: set.length === 1 ? 0.5 : i / (set.length - 1),
        targetEnergy: track.targetEnergy,
        camelotNeeded,
        bpmRange,
        suggestedSearch,
      },
    });
  }

  // Deduplicate: within DEDUP_SLOT_RADIUS slots, keep the one with the largest energy delta
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
