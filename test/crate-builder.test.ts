import { describe, it, expect } from 'vitest';
import { findCrateGaps } from '../app/lib/crateBuilder';
import type { SetTrack, DJPreferences } from '../app/types';

const BASE_PREFS: DJPreferences = {
  setDuration: 60,
  venueType: 'Club',
  setPhase: 'Peak time',
  genres: ['house'],
  tagFilters: { vibeTags: [], moodTags: [], vocalTypes: [], venueTags: [], timeOfNightTags: [] },
  dateFilter: { field: 'dateAdded', preset: 'all' },
};

function makeTrack(overrides: Partial<SetTrack> = {}): SetTrack {
  return {
    file: 'track.mp3',
    artist: 'Artist',
    title: 'Title',
    bpm: 128,
    key: 'C Major',
    camelot: '8B',
    energy: 0.7,
    genres: ['house'],
    slot: 0,
    targetEnergy: 0.7,
    harmonicWarning: false,
    ...overrides,
  };
}

describe('findCrateGaps', () => {
  it('returns [] for empty set', () => {
    expect(findCrateGaps([], BASE_PREFS)).toEqual([]);
  });

  it('returns [] for single-track set', () => {
    expect(findCrateGaps([makeTrack()], BASE_PREFS)).toEqual([]);
  });

  it('returns [] for a clean set with no warnings and energy on curve', () => {
    const tracks = [
      makeTrack({ slot: 0, bpm: 128, energy: 0.7, targetEnergy: 0.7, harmonicWarning: false }),
      makeTrack({ slot: 1, bpm: 130, energy: 0.75, targetEnergy: 0.75, harmonicWarning: false }),
      makeTrack({ slot: 2, bpm: 132, energy: 0.8, targetEnergy: 0.8, harmonicWarning: false }),
    ];
    expect(findCrateGaps(tracks, BASE_PREFS)).toEqual([]);
  });

  it('flags a track with harmonicWarning', () => {
    const tracks = [
      makeTrack({ slot: 0, camelot: '8B', harmonicWarning: false }),
      makeTrack({ slot: 1, camelot: '3A', harmonicWarning: true }),
      makeTrack({ slot: 2, camelot: '8B', harmonicWarning: false }),
    ];
    const gaps = findCrateGaps(tracks, BASE_PREFS);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0].camelotNeeded.length).toBeGreaterThan(0);
  });

  it('flags a track with energy error > 0.15', () => {
    const tracks = [
      makeTrack({ slot: 0, energy: 0.7, targetEnergy: 0.7 }),
      makeTrack({ slot: 1, energy: 0.2, targetEnergy: 0.8 }), // delta = 0.6
      makeTrack({ slot: 2, energy: 0.8, targetEnergy: 0.8 }),
    ];
    const gaps = findCrateGaps(tracks, BASE_PREFS);
    expect(gaps.length).toBe(1);
    expect(gaps[0].targetEnergy).toBeCloseTo(0.8, 2);
  });

  it('does not flag a track with energy error exactly at threshold (0.15)', () => {
    const tracks = [
      makeTrack({ slot: 0, energy: 0.7, targetEnergy: 0.7 }),
      makeTrack({ slot: 1, energy: 0.55, targetEnergy: 0.7 }), // delta = 0.15, not > threshold
      makeTrack({ slot: 2, energy: 0.7, targetEnergy: 0.7 }),
    ];
    expect(findCrateGaps(tracks, BASE_PREFS)).toEqual([]);
  });

  it('BPM range applies 3% tolerance', () => {
    const tracks = [
      makeTrack({ slot: 0, bpm: 128 }),
      makeTrack({ slot: 1, bpm: 130, harmonicWarning: true }),
      makeTrack({ slot: 2, bpm: 132 }),
    ];
    const gaps = findCrateGaps(tracks, BASE_PREFS);
    expect(gaps.length).toBeGreaterThan(0);
    const { min, max } = gaps[0].bpmRange;
    expect(min).toBe(Math.round(128 * 0.97));
    expect(max).toBe(Math.round(132 * 1.03));
  });

  it('deduplicates adjacent flags keeping the worst energy delta', () => {
    // Slots 1 and 2 are within the dedup radius (2 slots) — keep the one with larger energyDelta
    const tracks = [
      makeTrack({ slot: 0, energy: 0.7, targetEnergy: 0.7 }),
      makeTrack({ slot: 1, energy: 0.3, targetEnergy: 0.8 }), // delta = 0.5
      makeTrack({ slot: 2, energy: 0.4, targetEnergy: 0.8 }), // delta = 0.4
      makeTrack({ slot: 3, energy: 0.8, targetEnergy: 0.8 }),
    ];
    const gaps = findCrateGaps(tracks, BASE_PREFS);
    expect(gaps.length).toBe(1);
    expect(gaps[0].targetEnergy).toBeCloseTo(0.8, 2);
  });

  it('setPosition is normalized 0–1', () => {
    const tracks = [
      makeTrack({ slot: 0, harmonicWarning: false, energy: 0.7, targetEnergy: 0.7 }),
      makeTrack({ slot: 1, harmonicWarning: true }),
      makeTrack({ slot: 2, harmonicWarning: false, energy: 0.7, targetEnergy: 0.7 }),
      makeTrack({ slot: 3, harmonicWarning: false, energy: 0.7, targetEnergy: 0.7 }),
    ];
    const gaps = findCrateGaps(tracks, BASE_PREFS);
    expect(gaps.length).toBeGreaterThan(0);
    gaps.forEach(g => {
      expect(g.setPosition).toBeGreaterThanOrEqual(0);
      expect(g.setPosition).toBeLessThanOrEqual(1);
    });
  });

  it('suggestedSearch includes genre, BPM range, and energy', () => {
    const tracks = [
      makeTrack({ slot: 0, bpm: 126 }),
      makeTrack({ slot: 1, bpm: 128, harmonicWarning: true, targetEnergy: 0.8 }),
      makeTrack({ slot: 2, bpm: 130 }),
    ];
    const gaps = findCrateGaps(tracks, BASE_PREFS);
    expect(gaps.length).toBeGreaterThan(0);
    const s = gaps[0].suggestedSearch;
    expect(s).toContain('house');
    expect(s).toContain('BPM');
    expect(s).toContain('energy');
  });

  it('camelotNeeded contains neighbors of surrounding tracks', () => {
    const tracks = [
      makeTrack({ slot: 0, camelot: '8B' }),
      makeTrack({ slot: 1, camelot: '1A', harmonicWarning: true }),
      makeTrack({ slot: 2, camelot: '9B' }),
    ];
    const gaps = findCrateGaps(tracks, BASE_PREFS);
    expect(gaps[0].camelotNeeded.length).toBeGreaterThan(0);
    // Neighbors of 8B include 7B, 9B, 8A
    expect(gaps[0].camelotNeeded).toContain('9B');
  });
});
