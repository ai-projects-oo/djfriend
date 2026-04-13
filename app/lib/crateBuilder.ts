import type { SetTrack, DJPreferences, CrateGap } from '../types';
import { parseCamelot } from './camelot';

/** BPM tolerance window used when building search suggestions. */
const BPM_WINDOW = 4;
/** Energy string threshold — only label it in the search when target is notably high or low. */
const ENERGY_LABEL_THRESHOLD = 0.65;

/**
 * Returns compatible Camelot keys for a given key (same number other letter, ±1 same letter).
 * Used to tell the DJ what keys would fit at this gap position.
 */
function compatibleKeys(camelot: string): string[] {
  const p = parseCamelot(camelot);
  if (!p) return [];
  const { num, letter } = p;
  const other = letter === 'A' ? 'B' : 'A';
  const prev = num === 1 ? 12 : num - 1;
  const next = num === 12 ? 1 : num + 1;
  return [
    `${prev}${letter}`,
    `${next}${letter}`,
    `${num}${other}`,
  ];
}

/**
 * Analyse a generated set and return gap suggestions for slots where:
 *  - the track has a harmonic warning (bad key transition), OR
 *  - the track's actual energy deviates from the target by more than 0.15
 *
 * The caller is responsible for checking whether the set is worth analysing
 * (harmonic warning rate > 20% OR avg energy error > 0.15) before rendering
 * the panel, but findCrateGaps itself only analyses individual problem slots.
 */
export function findCrateGaps(set: SetTrack[], prefs: DJPreferences): CrateGap[] {
  if (set.length === 0) return [];

  const gaps: CrateGap[] = [];

  for (let i = 0; i < set.length; i++) {
    const track = set[i];
    const energyErr = Math.abs(track.energy - track.targetEnergy);
    const isGap = track.harmonicWarning || energyErr > 0.15;
    if (!isGap) continue;

    const setPosition = set.length === 1 ? 0.5 : i / (set.length - 1);
    const targetEnergy = track.targetEnergy;

    // Compatible keys: from the previous track (what the next track should match)
    const prevCamelot = i > 0 ? set[i - 1].camelot : track.camelot;
    const camelotNeeded = compatibleKeys(prevCamelot);

    // BPM range centred on the previous track's BPM (or this track's BPM for slot 0)
    const pivotBpm = i > 0 ? set[i - 1].bpm : track.bpm;
    const bpmRange = { min: Math.round(pivotBpm - BPM_WINDOW), max: Math.round(pivotBpm + BPM_WINDOW) };

    // Build a human-friendly search string
    const parts: string[] = [];
    if (prefs.genre && prefs.genre !== 'Any') parts.push(prefs.genre);
    parts.push(`${bpmRange.min}–${bpmRange.max} BPM`);
    if (camelotNeeded.length > 0) parts.push(camelotNeeded.join(' '));
    if (targetEnergy >= ENERGY_LABEL_THRESHOLD) {
      parts.push(`energy ${targetEnergy.toFixed(1)}+`);
    } else if (targetEnergy < 0.4) {
      parts.push('low energy');
    }

    gaps.push({ setPosition, targetEnergy, camelotNeeded, bpmRange, suggestedSearch: parts.join(' ') });
  }

  return gaps;
}

/**
 * Returns true when the set has enough problems to warrant showing crate suggestions.
 * Conditions (either triggers the panel):
 *  - harmonic warning rate > 20 %
 *  - average |energy − targetEnergy| > 0.15
 */
export function setNeedsCrateSuggestions(set: SetTrack[]): boolean {
  if (set.length === 0) return false;
  const warningRate = set.filter(t => t.harmonicWarning).length / set.length;
  if (warningRate > 0.2) return true;
  const avgEnergyErr = set.reduce((s, t) => s + Math.abs(t.energy - t.targetEnergy), 0) / set.length;
  return avgEnergyErr > 0.15;
}
