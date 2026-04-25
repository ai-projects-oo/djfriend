import type { SetTrack, SetScore } from '../types';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function computeSetScore(tracks: SetTrack[]): SetScore {
  if (tracks.length <= 1) {
    return { total: 100, harmonicRate: 0, avgEnergyError: 0, bpmSmoothness: 1 };
  }

  const harmonicRate = tracks.filter(t => t.harmonicWarning).length / tracks.length;

  const avgEnergyError =
    tracks.reduce((sum, t) => sum + Math.abs(t.energy - t.targetEnergy), 0) / tracks.length;

  const validBpms = tracks.map(t => t.bpm).filter(b => b > 0);
  let bpmSmoothness = 1;
  if (validBpms.length >= 2) {
    const deltas: number[] = [];
    for (let i = 1; i < validBpms.length; i++) {
      deltas.push(Math.abs(validBpms[i] - validBpms[i - 1]));
    }
    const meanDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    bpmSmoothness = clamp(1 - meanDelta / 20, 0, 1);
  }

  const total = Math.round(
    (1 - harmonicRate) * 40 +
    (1 - clamp(avgEnergyError, 0, 1)) * 35 +
    bpmSmoothness * 25,
  );

  return { total, harmonicRate, avgEnergyError, bpmSmoothness };
}
