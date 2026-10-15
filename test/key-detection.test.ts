import { describe, it, expect } from 'vitest';
import {
  detectKey, keyFromChroma, scoreKeys, keyTemplate, pearson, cosine, chromagram, constantQ, decimate,
  cqtBinFrequency, KS_MAJOR, KS_MINOR, KEY_DETECTION_VERSION,
} from '../src/keyDetection';
import { toCamelot } from '../src/camelot';

const SR = 44100;
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Sum of harmonic-rich tones at the given MIDI notes, `seconds` long. */
function chord(midis: number[], seconds: number, detuneCents = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  const f = midis.map(m => midiHz(m) * Math.pow(2, detuneCents / 1200));
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (const hz of f) for (let h = 1; h <= 3; h++) v += Math.sin((2 * Math.PI * hz * h * i) / SR) / h;
    out[i] = v / (midis.length * 2);
  }
  return out;
}

/** A I–IV–V–I style progression so both tonic and scale degrees are present. */
function progression(chords: number[][], secondsEach: number): Float32Array {
  const parts = chords.map(c => chord(c, secondsEach));
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const camelotOf = (r: { pitchClass: number; mode: number } | null) => (r ? toCamelot(r.pitchClass, r.mode)?.camelot : undefined);

describe('similarity metrics', () => {
  it('pearson is 1 for identical, -1 for inverted, 0 for constant input', () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0);
  });
  it('cosine is 1 for parallel vectors and 0 for zero vectors', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([0, 0], [1, 2])).toBe(0);
  });
});

describe('Krumhansl-Schmuckler templates', () => {
  it('C major / C minor templates are the unrotated profiles', () => {
    expect(keyTemplate(0, 1)).toEqual([...KS_MAJOR]);
    expect(keyTemplate(0, 0)).toEqual([...KS_MINOR]);
  });
  it('rotation puts the tonic weight on the tonic pitch class', () => {
    for (let t = 0; t < 12; t++) {
      expect(keyTemplate(t, 1)[t]).toBe(KS_MAJOR[0]);
      expect(keyTemplate(t, 0)[t]).toBe(KS_MINOR[0]);
    }
  });
  it('every one of the 24 templates scores itself as the best key', () => {
    for (const mode of [0, 1]) for (let t = 0; t < 12; t++) {
      const [best] = scoreKeys(keyTemplate(t, mode));
      expect(best).toMatchObject({ pitchClass: t, mode });
      expect(best.score).toBeCloseTo(1);
    }
  });
  it('cosine metric also recovers each template', () => {
    for (let t = 0; t < 12; t++) expect(scoreKeys(keyTemplate(t, 0), 'cosine')[0]).toMatchObject({ pitchClass: t, mode: 0 });
  });
  it('scoreKeys returns all 24 keys sorted best-first', () => {
    const s = scoreKeys(keyTemplate(4, 1));
    expect(s).toHaveLength(24);
    for (let i = 1; i < s.length; i++) expect(s[i - 1].score).toBeGreaterThanOrEqual(s[i].score);
  });
});

describe('keyFromChroma', () => {
  it('returns null for silent or flat chroma', () => {
    expect(keyFromChroma(new Array(12).fill(0))).toBeNull();
    expect(keyFromChroma(new Array(12).fill(3))).toBeNull();
  });
  it('reports confidence in 0–1 and a max-normalised chroma', () => {
    const r = keyFromChroma(keyTemplate(7, 1))!;
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(Math.max(...r.chroma)).toBeCloseTo(1);
  });
});

describe('constant-Q transform', () => {
  it('bin 1 is A1 = 55 Hz and 36 bins make an octave', () => {
    expect(cqtBinFrequency(1)).toBeCloseTo(55);
    expect(cqtBinFrequency(37)).toBeCloseTo(110);
  });
  it('a pure 440 Hz tone peaks at the A4 bin', () => {
    const tone = new Float32Array(SR * 3);
    for (let i = 0; i < tone.length; i++) tone[i] = Math.sin((2 * Math.PI * 440 * i) / SR);
    const frames = constantQ(decimate(tone));
    expect(frames.length).toBeGreaterThan(0);
    const f = frames[0];
    const peak = f.indexOf(Math.max(...f));
    expect(cqtBinFrequency(peak)).toBeCloseTo(440, 0);
  });
  it('chromagram of an A tone is strongest on pitch class A (9)', () => {
    const tone = new Float32Array(SR * 3);
    for (let i = 0; i < tone.length; i++) tone[i] = Math.sin((2 * Math.PI * 220 * i) / SR);
    const c = chromagram(constantQ(decimate(tone)));
    expect(c.indexOf(Math.max(...c))).toBe(9);
  });
  it('chromagram of no frames is all zeros', () => {
    expect(chromagram([])).toEqual(new Array(12).fill(0));
  });
});

describe('detectKey (end to end)', () => {
  it('C major progression → 8B', () => {
    // C–F–G–C (C4 E4 G4 / F3 A3 C4 / G3 B3 D4)
    const audio = progression([[48, 60, 64, 67], [41, 53, 57, 60], [43, 55, 59, 62], [48, 60, 64, 67]], 2);
    expect(camelotOf(detectKey(audio, { segments: 1, segmentSeconds: 8 }))).toBe('8B');
  });
  it('A minor progression → 8A', () => {
    // Am–Dm–E–Am
    const audio = progression([[45, 57, 60, 64], [38, 50, 53, 57], [40, 52, 56, 59], [45, 57, 60, 64]], 2);
    expect(camelotOf(detectKey(audio, { segments: 1, segmentSeconds: 8 }))).toBe('8A');
  });
  it('G major progression → 9B', () => {
    const audio = progression([[43, 55, 59, 62], [36, 48, 52, 55], [38, 50, 54, 57], [43, 55, 59, 62]], 2);
    expect(camelotOf(detectKey(audio, { segments: 1, segmentSeconds: 8 }))).toBe('9B');
  });
  it('tuning correction: a progression 30 cents sharp is still C major', () => {
    const parts = [[48, 60, 64, 67], [41, 53, 57, 60], [43, 55, 59, 62], [48, 60, 64, 67]].map(c => chord(c, 2, 30));
    const audio = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0; for (const p of parts) { audio.set(p, o); o += p.length; }
    expect(camelotOf(detectKey(audio, { segments: 1, segmentSeconds: 8 }))).toBe('8B');
  });
  it('silence → null', () => {
    expect(detectKey(new Float32Array(SR * 10))).toBeNull();
  });
  it('too short to analyse → null', () => {
    expect(detectKey(new Float32Array(SR / 2))).toBeNull();
  });
  it('exposes a version marker for stored keys', () => {
    expect(KEY_DETECTION_VERSION).toBeGreaterThanOrEqual(2);
  });
});
