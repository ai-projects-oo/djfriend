import { describe, it, expect } from 'vitest';
import { computeSetScore } from '../app/lib/setScore';
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
  it('returns perfect score for empty array', () => {
    const s = computeSetScore([]);
    expect(s.total).toBe(100);
    expect(s.harmonicRate).toBe(0);
    expect(s.avgEnergyError).toBe(0);
    expect(s.bpmSmoothness).toBe(1);
  });

  it('returns perfect score for single track', () => {
    const s = computeSetScore([makeTrack()]);
    expect(s.total).toBe(100);
  });

  it('scores near 100 for a clean set', () => {
    const tracks = [
      makeTrack({ slot: 0, bpm: 128, energy: 0.70, targetEnergy: 0.70, harmonicWarning: false }),
      makeTrack({ slot: 1, bpm: 130, energy: 0.75, targetEnergy: 0.75, harmonicWarning: false }),
      makeTrack({ slot: 2, bpm: 132, energy: 0.80, targetEnergy: 0.80, harmonicWarning: false }),
    ];
    const s = computeSetScore(tracks);
    expect(s.total).toBeGreaterThanOrEqual(90);
    expect(s.harmonicRate).toBe(0);
    expect(s.avgEnergyError).toBe(0);
  });

  it('penalises all-warning set heavily on harmonic component', () => {
    const tracks = [
      makeTrack({ harmonicWarning: true }),
      makeTrack({ harmonicWarning: true }),
      makeTrack({ harmonicWarning: true }),
    ];
    const s = computeSetScore(tracks);
    expect(s.harmonicRate).toBe(1);
    // harmonic component contributes 0, so max total = 35 + 25 = 60
    expect(s.total).toBeLessThanOrEqual(60);
  });

  it('penalises energy always off by 0.5', () => {
    const tracks = [
      makeTrack({ energy: 0.2, targetEnergy: 0.7 }),
      makeTrack({ energy: 0.2, targetEnergy: 0.7 }),
      makeTrack({ energy: 0.2, targetEnergy: 0.7 }),
    ];
    const s = computeSetScore(tracks);
    expect(s.avgEnergyError).toBeCloseTo(0.5, 2);
    // (1-0)*40 + (1-0.5)*35 + 1*25 = 40+17.5+25 = 82.5 → 83
    expect(s.total).toBeLessThan(90);
    expect(s.total).toBeGreaterThan(75);
  });

  it('penalises chaotic BPM jumps', () => {
    const tracks = [
      makeTrack({ bpm: 80 }),
      makeTrack({ bpm: 160 }),
      makeTrack({ bpm: 80 }),
      makeTrack({ bpm: 160 }),
    ];
    const s = computeSetScore(tracks);
    // mean delta = 80, 80/20 = 4 → clamp(1-4, 0, 1) = 0
    expect(s.bpmSmoothness).toBe(0);
  });

  it('ignores tracks with bpm <= 0 in smoothness', () => {
    const tracks = [
      makeTrack({ bpm: 0 }),
      makeTrack({ bpm: 128 }),
      makeTrack({ bpm: 0 }),
      makeTrack({ bpm: 130 }),
    ];
    const s = computeSetScore(tracks);
    // Only [128, 130] contribute → delta [2] → meanDelta/20 = 0.1 → smoothness = 0.9
    expect(s.bpmSmoothness).toBeCloseTo(0.9, 2);
  });

  it('returns smoothness 1 when fewer than 2 valid BPM tracks', () => {
    const tracks = [
      makeTrack({ bpm: 0 }),
      makeTrack({ bpm: 0 }),
    ];
    const s = computeSetScore(tracks);
    expect(s.bpmSmoothness).toBe(1);
  });

  it('total is clamped to 0–100 range', () => {
    const tracks = Array.from({ length: 5 }, () =>
      makeTrack({ harmonicWarning: true, energy: 0, targetEnergy: 1, bpm: 80 }),
    );
    const s = computeSetScore(tracks);
    expect(s.total).toBeGreaterThanOrEqual(0);
    expect(s.total).toBeLessThanOrEqual(100);
  });

  it('partial harmonic warnings are proportional', () => {
    const tracks = [
      makeTrack({ harmonicWarning: true }),
      makeTrack({ harmonicWarning: false }),
    ];
    const s = computeSetScore(tracks);
    expect(s.harmonicRate).toBe(0.5);
  });
});
