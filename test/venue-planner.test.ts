import { describe, it, expect } from 'vitest';
import { getSetPlan, VENUE_TYPES, SET_PHASES } from '../app/lib/venuePlanner';
import type { VenueType, SetPhase } from '../app/types';

describe('getSetPlan', () => {
  it('returns a plan for every venue × phase combination', () => {
    for (const venue of VENUE_TYPES) {
      for (const phase of SET_PHASES) {
        const plan = getSetPlan(venue as VenueType, phase as SetPhase);
        expect(plan).toBeDefined();
        expect(plan.curve.length).toBeGreaterThanOrEqual(2);
        expect(plan.bpmMin).toBeLessThan(plan.bpmMax);
        expect(plan.bpmTarget).toBeGreaterThanOrEqual(plan.bpmMin);
        expect(plan.bpmTarget).toBeLessThanOrEqual(plan.bpmMax);
        expect(plan.reasoning.length).toBeGreaterThan(0);
      }
    }
  });

  it('scoring weights sum to approximately 1.0 for all plans', () => {
    for (const venue of VENUE_TYPES) {
      for (const phase of SET_PHASES) {
        const { scoringWeights: w } = getSetPlan(venue as VenueType, phase as SetPhase);
        const sum = w.harmonicWeight + w.bpmWeight + w.transitionWeight + w.energyWeight;
        expect(sum).toBeCloseTo(1.0, 1);
      }
    }
  });

  it('curve x values start at 0 and end at 1', () => {
    const plan = getSetPlan('Club', 'Peak time');
    expect(plan.curve[0].x).toBe(0);
    expect(plan.curve[plan.curve.length - 1].x).toBe(1);
  });

  it('curve y values stay within [0, 1]', () => {
    for (const venue of VENUE_TYPES) {
      for (const phase of SET_PHASES) {
        const plan = getSetPlan(venue as VenueType, phase as SetPhase);
        for (const pt of plan.curve) {
          expect(pt.y).toBeGreaterThanOrEqual(0);
          expect(pt.y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('Club Peak time has higher BPM target than Bar Warm-up', () => {
    const club = getSetPlan('Club', 'Peak time');
    const bar  = getSetPlan('Bar', 'Warm-up');
    expect(club.bpmTarget).toBeGreaterThan(bar.bpmTarget);
  });

  it('Club Peak time curve peaks higher than Club Warm-up curve', () => {
    const peak   = getSetPlan('Club', 'Peak time');
    const warmup = getSetPlan('Club', 'Warm-up');
    const maxPeak   = Math.max(...peak.curve.map(p => p.y));
    const maxWarmup = Math.max(...warmup.curve.map(p => p.y));
    expect(maxPeak).toBeGreaterThan(maxWarmup);
  });

  it('sets venueType on the returned plan', () => {
    expect(getSetPlan('Wedding', 'Cool-down').venueType).toBe('Wedding');
    expect(getSetPlan('Festival', 'Peak time').venueType).toBe('Festival');
  });
});
