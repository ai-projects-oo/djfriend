import type { SetTrack, SetScore } from '../types';

// BPM delta (absolute) at which smoothness reaches 0. Keylock transitions
// typically stay within 10 BPM; 20 is a generous ceiling before the score penalises.
const SMOOTHNESS_BPM_RANGE = 20;

export const SCORE_THRESHOLDS = { good: 80, fair: 60 } as const;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Returns null for sets with fewer than 2 tracks — no meaningful transitions to score.
export function computeSetScore(tracks: SetTrack[]): SetScore | null {
  if (tracks.length < 2) return null;

  // harmonicWarning is a property of a transition, so denominator is n-1.
  const transitions = tracks.length - 1;
  const harmonicRate = tracks.filter(t => t.harmonicWarning).length / transitions;

  const avgEnergyError = clamp(
    tracks.reduce((sum, t) => sum + Math.abs(t.energy - t.targetEnergy), 0) / tracks.length,
    0,
    1,
  );

  const validBpms = tracks.map(t => t.bpm).filter(b => b > 0);
  let bpmSmoothness = 1;
  if (validBpms.length >= 2) {
    const deltas: number[] = [];
    for (let i = 1; i < validBpms.length; i++) {
      deltas.push(Math.abs(validBpms[i] - validBpms[i - 1]));
    }
    const meanDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    bpmSmoothness = clamp(1 - meanDelta / SMOOTHNESS_BPM_RANGE, 0, 1);
  }

  const total = Math.round(
    (1 - clamp(harmonicRate, 0, 1)) * 40 +
    (1 - avgEnergyError) * 35 +
    bpmSmoothness * 25,
  );

  return { total, harmonicRate, avgEnergyError, bpmSmoothness };
}
