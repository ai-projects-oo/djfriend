/**
 * Musical key detection — DSP pipeline built from published, public-domain methods:
 *
 *   PCM → Constant-Q Transform → 12-bin chromagram → 24 key templates
 *       → Pearson (or cosine) similarity → argmax → key
 *
 * - CQT: Brown & Puckette (1992) spectral-kernel method, 36 bins/octave, A1 (55 Hz) – A7 (3520 Hz).
 * - Chroma: energy of the A2–A6 octaves (110–1760 Hz, where harmony lives — below is kick/sub,
 *   above is mostly overtones) folded into 12 pitch classes, with tuning correction (the 3 sub-bins
 *   per semitone tell us whether the track sits sharp/flat of A440) and spectral whitening
 *   (each semitone minus its ±1-octave neighbourhood mean, so broadband drums don't smear the chroma).
 * - Templates: the default "triad" template anchors the tonic triad with the other scale degrees as
 *   secondary weights; Krumhansl & Kessler (1982) probe-tone profiles are available as `krumhansl`.
 *   Template choice was benchmarked against key tags already in the user's own files — measurement
 *   only; no weights were fitted to those tags.
 *
 * Pure and dependency-free; operates on the already-decoded 44.1 kHz mono buffer.
 */
import { fft } from './dsp.js';

/** Bump when the algorithm changes, so stored keys can be told apart from older analyses. */
export const KEY_DETECTION_VERSION = 2;

// Krumhansl & Kessler (1982) probe-tone ratings, index 0 = tonic
export const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88] as const;
export const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17] as const;

// Tonic triad = dominant anchors (1, 3, 5); remaining scale degrees = secondary weights; non-scale = 0
export const TRIAD_MAJOR = [2, 0, 1, 0, 1.5, 1, 0, 1.75, 0, 1, 0, 1] as const;
export const TRIAD_MINOR = [2, 0, 1, 1.5, 0, 1, 0, 1.75, 1, 0, 1, 0] as const;

export type KeyProfile = 'triad' | 'krumhansl';
const PROFILES: Record<KeyProfile, readonly [readonly number[], readonly number[]]> = {
  triad: [TRIAD_MAJOR, TRIAD_MINOR],
  krumhansl: [KS_MAJOR, KS_MINOR],
};

export type SimilarityMetric = 'pearson' | 'cosine';

export interface KeyScore { pitchClass: number; mode: number; score: number }

export interface KeyResult {
  pitchClass: number;   // 0–11, C = 0
  mode: number;         // 1 = major, 0 = minor
  score: number;        // similarity of the winning template
  confidence: number;   // 0–1: margin between the best and second-best key
  chroma: number[];     // 12 bins, C = 0, max-normalised
}

const SAMPLE_RATE = 44100;
const DECIMATION = 4;
const FS = SAMPLE_RATE / DECIMATION;          // 11 025 Hz — covers the 3.5 kHz top of the CQT
const BINS_PER_SEMITONE = 3;
const BINS_PER_OCTAVE = 12 * BINS_PER_SEMITONE;
const OCTAVES = 6;
const SEMITONES = 12 * OCTAVES;
const NUM_BINS = BINS_PER_OCTAVE * OCTAVES;
const F_MIN = 55;                             // A1; bin 1 sits exactly on it (bins 0/2 are ∓33 cents)
const FRAME = 16384;                          // ≥ longest kernel (≈10.3 k samples at 55 Hz)
const HOP = 8192;
const KERNEL_THRESHOLD = 0.0054;              // drop near-zero spectral-kernel entries (sparse CQT)
const A_PITCH_CLASS = 9;

// ── Pure math ────────────────────────────────────────────────────────────────

export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += a[i] * b[i]; da += a[i] * a[i]; db += b[i] * b[i]; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/** The template for a key: the C-based profile rotated so index `tonic` holds the tonic weight. */
export function keyTemplate(tonic: number, mode: number, profile: KeyProfile = 'triad'): number[] {
  const base = PROFILES[profile][mode === 1 ? 0 : 1];
  return Array.from({ length: 12 }, (_, pc) => base[(pc - tonic + 12) % 12]);
}

/** Similarity of a 12-bin chroma vector (C = 0) to all 24 key templates, best first. */
export function scoreKeys(chroma: ArrayLike<number>, metric: SimilarityMetric = 'pearson', profile: KeyProfile = 'triad'): KeyScore[] {
  const sim = metric === 'cosine' ? cosine : pearson;
  const out: KeyScore[] = [];
  for (const mode of [1, 0]) {
    for (let tonic = 0; tonic < 12; tonic++) out.push({ pitchClass: tonic, mode, score: sim(chroma, keyTemplate(tonic, mode, profile)) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Argmax over the 24 templates. Null when the chroma carries no pitch information (silence, noise floor). */
export function keyFromChroma(chroma: ArrayLike<number>, metric: SimilarityMetric = 'pearson', profile: KeyProfile = 'triad'): KeyResult | null {
  let max = 0, min = Infinity;
  for (let i = 0; i < 12; i++) { max = Math.max(max, chroma[i]); min = Math.min(min, chroma[i]); }
  if (!(max > 0) || max - min < max * 1e-6) return null;
  const [best, second] = scoreKeys(chroma, metric, profile);
  const confidence = Math.max(0, Math.min(1, (best.score - second.score) / Math.max(1e-9, Math.abs(best.score))));
  return {
    pitchClass: best.pitchClass,
    mode: best.mode,
    score: best.score,
    confidence: Math.round(confidence * 1000) / 1000,
    chroma: Array.from({ length: 12 }, (_, i) => chroma[i] / max),
  };
}

// ── Decimation (44.1 kHz → 11.025 kHz) ──────────────────────────────────────

const FIR_TAPS = 31;
let firCache: Float64Array | null = null;
function lowpassFir(): Float64Array {
  if (firCache) return firCache;
  // Hamming-windowed sinc, cutoff 0.45 × output Nyquist-relative band → ~4.96 kHz
  const fc = 0.45 / DECIMATION;
  const h = new Float64Array(FIR_TAPS);
  const mid = (FIR_TAPS - 1) / 2;
  let sum = 0;
  for (let i = 0; i < FIR_TAPS; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    h[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FIR_TAPS - 1)));
    sum += h[i];
  }
  for (let i = 0; i < FIR_TAPS; i++) h[i] /= sum;
  return (firCache = h);
}

export function decimate(input: ArrayLike<number>): Float64Array {
  const h = lowpassFir();
  const half = (FIR_TAPS - 1) / 2;
  const out = new Float64Array(Math.floor(input.length / DECIMATION));
  for (let o = 0; o < out.length; o++) {
    const c = o * DECIMATION;
    let acc = 0;
    for (let t = 0; t < FIR_TAPS; t++) {
      const idx = c + t - half;
      if (idx >= 0 && idx < input.length) acc += h[t] * input[idx];
    }
    out[o] = acc;
  }
  return out;
}

// ── Constant-Q transform (sparse spectral kernels) ───────────────────────────

interface SparseKernel { idx: Int32Array; re: Float64Array; im: Float64Array }
let kernelCache: SparseKernel[] | null = null;

/** Centre frequency of CQT bin k (bin 1 = A1 = 55 Hz, three bins per semitone). */
export function cqtBinFrequency(k: number): number {
  return F_MIN * Math.pow(2, (k - 1) / BINS_PER_OCTAVE);
}

function cqtKernels(): SparseKernel[] {
  if (kernelCache) return kernelCache;
  const Q = 1 / (Math.pow(2, 1 / BINS_PER_OCTAVE) - 1);
  const kernels: SparseKernel[] = [];
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
  for (let k = 0; k < NUM_BINS; k++) {
    const len = Math.min(FRAME, Math.ceil((Q * FS) / cqtBinFrequency(k)));
    re.fill(0); im.fill(0);
    const offset = Math.floor((FRAME - len) / 2);
    for (let n = 0; n < len; n++) {
      const w = (0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (len - 1))) / len;
      const phase = (2 * Math.PI * Q * n) / len;
      re[offset + n] = w * Math.cos(phase);
      im[offset + n] = w * Math.sin(phase);
    }
    fft(re, im);
    const idx: number[] = [], kr: number[] = [], ki: number[] = [];
    for (let j = 0; j < FRAME; j++) {
      if (Math.hypot(re[j], im[j]) > KERNEL_THRESHOLD) { idx.push(j); kr.push(re[j]); ki.push(-im[j]); }   // conjugate
    }
    kernels.push({ idx: Int32Array.from(idx), re: Float64Array.from(kr), im: Float64Array.from(ki) });
  }
  return (kernelCache = kernels);
}

/** CQT magnitudes for each frame of an 11.025 kHz signal. */
export function constantQ(signal: Float64Array): Float64Array[] {
  const kernels = cqtKernels();
  const frames: Float64Array[] = [];
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
  for (let start = 0; start + FRAME <= signal.length; start += HOP) {
    re.set(signal.subarray(start, start + FRAME)); im.fill(0);
    fft(re, im);
    const mags = new Float64Array(NUM_BINS);
    for (let k = 0; k < NUM_BINS; k++) {
      const { idx, re: kr, im: ki } = kernels[k];
      let sr = 0, si = 0;
      for (let j = 0; j < idx.length; j++) {
        const x = idx[j];
        sr += re[x] * kr[j] - im[x] * ki[j];
        si += re[x] * ki[j] + im[x] * kr[j];
      }
      mags[k] = Math.hypot(sr, si) / FRAME;
    }
    frames.push(mags);
  }
  return frames;
}

// ── Chromagram ───────────────────────────────────────────────────────────────

const CHROMA_MIN_SEMITONE = 12;   // A2, 110 Hz
const CHROMA_MAX_SEMITONE = 60;   // A6, 1760 Hz (exclusive)
const WHITEN_SEMITONES = 12;

/**
 * Folds CQT frames into one time-averaged 12-bin chroma vector (C = 0).
 * Tuning: whichever of the 3 sub-bin positions holds the most energy is taken as the semitone centre.
 */
export function chromagram(cqtFrames: Float64Array[]): number[] {
  const chroma = new Array<number>(12).fill(0);
  if (cqtFrames.length === 0) return chroma;

  const subEnergy = [0, 0, 0];
  for (const f of cqtFrames) for (let k = 0; k < NUM_BINS; k++) subEnergy[k % BINS_PER_SEMITONE] += f[k];
  const centre = subEnergy.indexOf(Math.max(...subEnergy));

  const semi = new Float64Array(SEMITONES);
  for (const f of cqtFrames) {
    for (let s = 0; s < SEMITONES; s++) {
      const c = s * BINS_PER_SEMITONE + centre;
      let e = f[c];
      if (c - 1 >= 0) e += 0.5 * f[c - 1];
      if (c + 1 < NUM_BINS) e += 0.5 * f[c + 1];
      semi[s] = e;
    }
    for (let s = CHROMA_MIN_SEMITONE; s < CHROMA_MAX_SEMITONE; s++) {
      // Whitening: keep only what stands out from the surrounding ±1 octave (tonal peaks, not drum noise)
      let sum = 0, n = 0;
      for (let d = -WHITEN_SEMITONES; d <= WHITEN_SEMITONES; d++) {
        const j = s + d;
        if (j >= 0 && j < SEMITONES) { sum += semi[j]; n++; }
      }
      const peak = Math.max(0, semi[s] - sum / n);
      chroma[(A_PITCH_CLASS + s) % 12] += Math.sqrt(peak);   // compression tames loud bass notes
    }
  }
  return chroma.map(v => v / cqtFrames.length);
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Detects the key of a decoded 44.1 kHz mono track. Analyses the whole track (skipping the first
 * and last 5 %, usually beat-only intro/outro) as one averaged chromagram.
 */
export function detectKey(
  channelData: Float32Array,
  opts: { metric?: SimilarityMetric; profile?: KeyProfile; trimEnds?: boolean } = {},
): KeyResult | null {
  const trim = opts.trimEnds !== false && channelData.length > SAMPLE_RATE * 20;
  const start = trim ? Math.floor(channelData.length * 0.05) : 0;
  const end = trim ? Math.floor(channelData.length * 0.95) : channelData.length;
  if (end - start < FRAME * DECIMATION) return null;
  const frames = constantQ(decimate(channelData.subarray(start, end)));
  if (frames.length === 0) return null;
  return keyFromChroma(chromagram(frames), opts.metric, opts.profile);
}
