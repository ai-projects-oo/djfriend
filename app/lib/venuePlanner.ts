import type { VenueType, SetPhase, SetPlan, CurvePoint, ScoringWeights } from '../types';

const DEFAULT_WEIGHTS: ScoringWeights = {
  harmonicWeight:   0.45,
  bpmWeight:        0.22,
  transitionWeight: 0.08,
  energyWeight:     0.25,
};

function curve(...pts: [number, number][]): CurvePoint[] {
  return pts.map(([x, y]) => ({ x, y }));
}

// Each entry: [bpmMin, bpmMax, bpmTarget, curve, weights override (partial), reasoning]
type PlanEntry = {
  bpmMin: number;
  bpmMax: number;
  bpmTarget: number;
  curve: CurvePoint[];
  weights?: Partial<ScoringWeights>;
  reasoning: string;
};

const PLANS: Record<VenueType, Record<SetPhase, PlanEntry>> = {
  Club: {
    'Warm-up': {
      bpmMin: 118, bpmMax: 128, bpmTarget: 123,
      curve: curve([0, 0.30], [0.4, 0.50], [0.8, 0.65], [1, 0.72]),
      reasoning: 'Gentle climb — get bodies moving before the peak.',
    },
    'Peak time': {
      bpmMin: 128, bpmMax: 140, bpmTarget: 134,
      curve: curve([0, 0.70], [0.3, 0.88], [0.6, 1.0], [0.85, 0.95], [1, 0.90]),
      weights: { harmonicWeight: 0.40, energyWeight: 0.30 },
      reasoning: 'Maximum energy — tight harmonic locks, relentless drive.',
    },
    'Cool-down': {
      bpmMin: 118, bpmMax: 128, bpmTarget: 122,
      curve: curve([0, 0.80], [0.4, 0.60], [0.7, 0.45], [1, 0.30]),
      weights: { bpmWeight: 0.18, transitionWeight: 0.12 },
      reasoning: 'Smooth descent — preserve the vibe while easing pressure.',
    },
    'After-party': {
      bpmMin: 120, bpmMax: 132, bpmTarget: 126,
      curve: curve([0, 0.55], [0.5, 0.75], [1, 0.65]),
      reasoning: 'Laid-back groove — keep it hypnotic for the faithful crowd.',
    },
  },

  Bar: {
    'Warm-up': {
      bpmMin: 90, bpmMax: 115, bpmTarget: 102,
      curve: curve([0, 0.25], [0.5, 0.45], [1, 0.55]),
      weights: { bpmWeight: 0.20, energyWeight: 0.28 },
      reasoning: 'Relaxed opener — background music that builds quietly.',
    },
    'Peak time': {
      bpmMin: 105, bpmMax: 125, bpmTarget: 115,
      curve: curve([0, 0.55], [0.4, 0.75], [0.7, 0.80], [1, 0.70]),
      reasoning: 'Mid-energy peak — danceable but never overwhelming.',
    },
    'Cool-down': {
      bpmMin: 85, bpmMax: 105, bpmTarget: 95,
      curve: curve([0, 0.65], [0.5, 0.45], [1, 0.30]),
      reasoning: 'Winding down the night — keep it chilled and conversational.',
    },
    'After-party': {
      bpmMin: 90, bpmMax: 110, bpmTarget: 100,
      curve: curve([0, 0.40], [0.5, 0.55], [1, 0.50]),
      reasoning: 'Late-night bar vibe — groove without overwhelming.',
    },
  },

  Festival: {
    'Warm-up': {
      bpmMin: 120, bpmMax: 130, bpmTarget: 125,
      curve: curve([0, 0.35], [0.5, 0.60], [1, 0.75]),
      reasoning: 'Build the crowd slowly — festival audiences arrive in waves.',
    },
    'Peak time': {
      bpmMin: 130, bpmMax: 150, bpmTarget: 140,
      curve: curve([0, 0.75], [0.25, 0.92], [0.5, 1.0], [0.75, 0.95], [1, 0.88]),
      weights: { harmonicWeight: 0.38, bpmWeight: 0.28, energyWeight: 0.28, transitionWeight: 0.06 },
      reasoning: 'Full euphoria — BPM and energy carry the massive outdoor crowd.',
    },
    'Cool-down': {
      bpmMin: 120, bpmMax: 132, bpmTarget: 126,
      curve: curve([0, 0.82], [0.5, 0.60], [1, 0.40]),
      reasoning: 'Festival close — enough energy to keep stragglers dancing.',
    },
    'After-party': {
      bpmMin: 125, bpmMax: 138, bpmTarget: 132,
      curve: curve([0, 0.60], [0.5, 0.78], [1, 0.70]),
      reasoning: 'After-party backstage — high energy but more intimate.',
    },
  },

  'Private event': {
    'Warm-up': {
      bpmMin: 90, bpmMax: 110, bpmTarget: 100,
      curve: curve([0, 0.20], [0.5, 0.40], [1, 0.55]),
      reasoning: 'Guests arriving — subtle, elegant background music.',
    },
    'Peak time': {
      bpmMin: 110, bpmMax: 128, bpmTarget: 120,
      curve: curve([0, 0.55], [0.4, 0.75], [0.7, 0.82], [1, 0.70]),
      weights: { harmonicWeight: 0.50, energyWeight: 0.22 },
      reasoning: 'Private crowd — harmonic flow matters more than raw energy.',
    },
    'Cool-down': {
      bpmMin: 85, bpmMax: 105, bpmTarget: 95,
      curve: curve([0, 0.65], [0.5, 0.45], [1, 0.25]),
      reasoning: 'Winding down — elegant close to the evening.',
    },
    'After-party': {
      bpmMin: 100, bpmMax: 120, bpmTarget: 110,
      curve: curve([0, 0.50], [0.5, 0.65], [1, 0.55]),
      reasoning: 'Inner circle after-party — relaxed and personal.',
    },
  },

  Corporate: {
    'Warm-up': {
      bpmMin: 88, bpmMax: 108, bpmTarget: 98,
      curve: curve([0, 0.20], [0.5, 0.35], [1, 0.45]),
      weights: { harmonicWeight: 0.50, energyWeight: 0.20 },
      reasoning: 'Office/conference arrivals — unobtrusive, professional.',
    },
    'Peak time': {
      bpmMin: 100, bpmMax: 118, bpmTarget: 110,
      curve: curve([0, 0.45], [0.5, 0.62], [1, 0.55]),
      weights: { harmonicWeight: 0.50, energyWeight: 0.20 },
      reasoning: 'Corporate peak — accessible energy, crowd-pleasing but not intense.',
    },
    'Cool-down': {
      bpmMin: 80, bpmMax: 100, bpmTarget: 90,
      curve: curve([0, 0.50], [0.5, 0.35], [1, 0.20]),
      reasoning: 'Evening wrap-up — smooth and understated.',
    },
    'After-party': {
      bpmMin: 90, bpmMax: 112, bpmTarget: 100,
      curve: curve([0, 0.40], [0.5, 0.55], [1, 0.50]),
      reasoning: 'Post-event drinks — light and sociable.',
    },
  },

  Wedding: {
    'Warm-up': {
      bpmMin: 80, bpmMax: 105, bpmTarget: 92,
      curve: curve([0, 0.20], [0.5, 0.38], [1, 0.50]),
      weights: { harmonicWeight: 0.52, bpmWeight: 0.18, energyWeight: 0.22, transitionWeight: 0.08 },
      reasoning: 'Ceremony / cocktail hour — delicate, harmonically smooth.',
    },
    'Peak time': {
      bpmMin: 105, bpmMax: 128, bpmTarget: 118,
      curve: curve([0, 0.55], [0.35, 0.80], [0.6, 0.88], [0.85, 0.78], [1, 0.65]),
      reasoning: 'Reception dancefloor peak — crowd-pleasing anthems across all ages.',
    },
    'Cool-down': {
      bpmMin: 80, bpmMax: 100, bpmTarget: 88,
      curve: curve([0, 0.65], [0.5, 0.45], [1, 0.28]),
      reasoning: 'Last dances — emotional, beautiful close.',
    },
    'After-party': {
      bpmMin: 100, bpmMax: 120, bpmTarget: 110,
      curve: curve([0, 0.55], [0.5, 0.72], [1, 0.60]),
      reasoning: 'Wedding after-party — younger crowd, more energy.',
    },
  },
};

export function getSetPlan(venueType: VenueType, phase: SetPhase): SetPlan {
  const entry = PLANS[venueType][phase];
  const weights: ScoringWeights = { ...DEFAULT_WEIGHTS, ...entry.weights };
  return {
    curve:          entry.curve,
    bpmMin:         entry.bpmMin,
    bpmMax:         entry.bpmMax,
    bpmTarget:      entry.bpmTarget,
    scoringWeights: weights,
    venueType,
    setDuration:    undefined,
    reasoning:      entry.reasoning,
  };
}

export const VENUE_TYPES: VenueType[] = ['Club', 'Bar', 'Festival', 'Private event', 'Corporate', 'Wedding'];
export const SET_PHASES: SetPhase[]   = ['Warm-up', 'Peak time', 'Cool-down', 'After-party'];
