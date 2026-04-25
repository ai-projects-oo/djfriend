import { describe, it, expect } from 'vitest';
import { computeSetScore, SCORE_THRESHOLDS } from '../app/lib/setScore';
import type { SetTrack } from '../app/types';

function makeTrack(overrides: Partial<SetTrack> = {}): SetTrack {
  return {
    file: 'track.mp3',
    artist: 'Artist',
    title: 'Title',
    bpm: 128,
    key: 'C Major',
    camelot: '8B',
    energy: 0.7,
    genres: [],
    slot: 0,
    targetEnergy: 0.7,
    harmonicWarning: false,
    ...overrides,
  };
}

describe('computeSetScore', () => {
  it('returns null for empty array', () => {
    expect(computeSetScore([])).toBeNull();
  });

  it('returns null for single track', () => {
    expect(computeSetScore([makeTrack()])).toBeNull();
  });

  it('scores near 100 for a clean 3-track set', () => {
    const tracks = [
      makeTrack({ slot: 0, bpm: 128, energy: 0.70, targetEnergy: 0.70, harmonicWarning: false }),
      makeTrack({ slot: 1, bpm: 130, energy: 0.75, targetEnergy: 0.75, harmonicWarning: false }),
      makeTrack({ slot: 2, bpm: 132, energy: 0.80, targetEnergy: 0.80, harmonicWarning: false }),
    ];
    const s = computeSetScore(tracks)!;
    expect(s.total).toBeGreaterThanOrEqual(90);
    expect(s.harmonicRate).toBe(0);
    expect(s.avgEnergyError).toBe(0);
  });

  it('uses transitions (n-1) as harmonic denominator', () => {
    // 4 tracks → 3 transitions. Track 0 never has harmonicWarning by convention.
    // Mark tracks 1,2,3 as warning → 3 warnings / 3 transitions = 1.0
    const tracks = [
      makeTrack({ harmonicWarning: false }),
      makeTrack({ harmonicWarning: true }),
      makeTrack({ harmonicWarning: true }),
      makeTrack({ harmonicWarning: true }),
    ];
    const s = computeSetScore(tracks)!;
    expect(s.harmonicRate).toBeCloseTo(1.0, 2);
  });

  it('penalises all-warning set heavily on harmonic component', () => {
    const tracks = [
      makeTrack({ harmonicWarning: true }),
      makeTrack({ harmonicWarning: true }),
      makeTrack({ harmonicWarning: true }),
    ];
    const s = computeSetScore(tracks)!;
    // harmonicRate = 3 warnings / 2 transitions — clamp to 1
    expect(s.harmonicRate).toBeGreaterThanOrEqual(1);
    // harmonic component = 0 → max total = 35 + 25 = 60
    expect(s.total).toBeLessThanOrEqual(60);
  });

  it('SCORE_THRESHOLDS exports correct thresholds', () => {
    expect(SCORE_THRESHOLDS.good).toBe(80);
    expect(SCORE_THRESHOLDS.fair).toBe(60);
  });

  it('penalises energy always off by 0.5', () => {
    const tracks = [
      makeTrack({ energy: 0.2, targetEnergy: 0.7 }),
      makeTrack({ energy: 0.2, targetEnergy: 0.7 }),
      makeTrack({ energy: 0.2, targetEnergy: 0.7 }),
    ];
    const s = computeSetScore(tracks)!;
    expect(s.avgEnergyError).toBeCloseTo(0.5, 2);
    // (1-0)*40 + (1-0.5)*35 + 1*25 = 82.5 → 83
    expect(s.total).toBeGreaterThan(75);
    expect(s.total).toBeLessThan(90);
  });

  it('penalises chaotic BPM jumps', () => {
    const tracks = [
      makeTrack({ bpm: 80 }),
      makeTrack({ bpm: 160 }),
      makeTrack({ bpm: 80 }),
      makeTrack({ bpm: 160 }),
    ];
    const s = computeSetScore(tracks)!;
    // mean delta = 80 → 80/20 = 4 → clamp(1-4, 0, 1) = 0
    expect(s.bpmSmoothness).toBe(0);
  });

  it('ignores tracks with bpm <= 0 in smoothness', () => {
    const tracks = [
      makeTrack({ bpm: 0 }),
      makeTrack({ bpm: 128 }),
      makeTrack({ bpm: 0 }),
      makeTrack({ bpm: 130 }),
    ];
    const s = computeSetScore(tracks)!;
    // Only [128, 130] contribute → delta [2] → meanDelta/20 = 0.1 → smoothness = 0.9
    expect(s.bpmSmoothness).toBeCloseTo(0.9, 2);
  });

  it('returns smoothness 1 when fewer than 2 valid BPM tracks', () => {
    const tracks = [
      makeTrack({ bpm: 0 }),
      makeTrack({ bpm: 0 }),
    ];
    const s = computeSetScore(tracks)!;
    expect(s.bpmSmoothness).toBe(1);
  });

  it('total stays within 0–100 range for worst-case inputs', () => {
    const tracks = Array.from({ length: 5 }, () =>
      makeTrack({ harmonicWarning: true, energy: 0, targetEnergy: 1, bpm: 200 }),
    );
    const s = computeSetScore(tracks)!;
    expect(s.total).toBeGreaterThanOrEqual(0);
    expect(s.total).toBeLessThanOrEqual(100);
  });

  it('partial harmonic warnings are proportional (denominator = n-1)', () => {
    // 2 tracks → 1 transition; 1 warning → rate = 1/1 = 1.0
    const tracks = [
      makeTrack({ harmonicWarning: false }),
      makeTrack({ harmonicWarning: true }),
    ];
    const s = computeSetScore(tracks)!;
    expect(s.harmonicRate).toBeCloseTo(1.0, 2);
  });

  it('clamps avgEnergyError that would exceed 1', () => {
    // energy and targetEnergy are both 0–1, so |diff| ≤ 1 always.
    // This test verifies clamping is applied at the stored value.
    const tracks = [
      makeTrack({ energy: 0, targetEnergy: 1 }),
      makeTrack({ energy: 0, targetEnergy: 1 }),
    ];
    const s = computeSetScore(tracks)!;
    expect(s.avgEnergyError).toBeLessThanOrEqual(1);
    expect(s.avgEnergyError).toBeGreaterThanOrEqual(0);
  });
});
