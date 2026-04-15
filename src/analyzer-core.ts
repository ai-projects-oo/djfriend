import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Minimal AudioBuffer interface (matches Web Audio API, returned by audio-decode)
interface AudioBuffer {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

export interface EnergyProfile {
  intro:        number;
  body:         number;
  peak:         number;
  outro:        number;
  variance:     number;
  dropStrength: number;
}

export interface LocalAudioFeatures {
  bpm: number;
  tagBpm: number | null; // Raw ID3/metadata BPM tag — null if absent
  pitchClass: number; // 0–11 (matches Spotify pitch class, compatible with camelot.ts)
  mode: number;       // 1=major, 0=minor
  energy: number;     // 0–1 normalized via dBFS
  energyProfile?: EnergyProfile;
  year?: number;      // ID3 year tag
  comment?: string;   // ID3 first comment frame
}

// Essentia's KeyExtractor returns key names using sharps/flats
const KEY_TO_PITCH: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
  E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8,
  Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

/**
 * Fast BPM detector using onset-strength autocorrelation.
 * ~20x faster than RhythmExtractor2013.
 *
 * Works by:
 * 1. Decimating to ~2205 Hz (kick drum energy lives well below that)
 * 2. Computing a short-time RMS energy envelope
 * 3. Half-wave rectifying the first difference → onset strength signal
 * 4. Autocorrelating over the 60–200 BPM lag range
 * 5. Correcting for half-time / double-time octave errors
 */
function detectBpm(audio: Float32Array, sampleRate: number): number {
  // Decimate to ~2205 Hz — cheap approximation, fine for sub-200 Hz kick energy
  const DECIMATE = Math.max(1, Math.floor(sampleRate / 2205));
  const decimated = new Float32Array(Math.floor(audio.length / DECIMATE));
  for (let i = 0; i < decimated.length; i++) decimated[i] = audio[i * DECIMATE];
  const sr = sampleRate / DECIMATE;

  // Short-time RMS in overlapping 20 ms windows (10 ms hops)
  const HOP = Math.max(1, Math.round(sr * 0.010));
  const WIN = HOP * 2;
  const nFrames = Math.floor((decimated.length - WIN) / HOP);
  const energy = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    let s = 0;
    const base = i * HOP;
    for (let j = base; j < base + WIN; j++) s += decimated[j] * decimated[j];
    energy[i] = Math.sqrt(s / WIN);
  }

  // Onset strength: half-wave rectified first difference
  const onset = new Float32Array(nFrames);
  for (let i = 1; i < nFrames; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1]);

  // Autocorrelation over the 60–200 BPM lag range
  const fps = sr / HOP; // frames per second (~100)
  const lagMin = Math.floor(fps * 60 / 200); // shortest period = fastest BPM
  const lagMax = Math.ceil(fps * 60 / 60);   // longest period = slowest BPM

  let bestLag = lagMin;
  let bestCorr = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let c = 0;
    for (let i = lag; i < nFrames; i++) c += onset[i] * onset[i - lag];
    if (c > bestCorr) { bestCorr = c; bestLag = lag; }
  }

  let bpm = (fps * 60) / bestLag;

  // Octave correction: fold into the typical 60–175 BPM range
  while (bpm < 60) bpm *= 2;
  while (bpm > 175) bpm /= 2;

  return Math.round(bpm * 10) / 10;
}

// Lazy singleton — WASM init is heavy, reuse across tracks
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let essentiaInstance: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- essentia.js has no TypeScript types
function getEssentia(): any {
  if (!essentiaInstance) {
    const { Essentia, EssentiaWASM } = require('essentia.js') as { Essentia: new (wasm: unknown) => unknown; EssentiaWASM: unknown };
    essentiaInstance = new Essentia(EssentiaWASM);
  }
  return essentiaInstance;
}

/**
 * Linear interpolation resampler. RhythmExtractor2013 and KeyExtractor
 * both assume 44100 Hz input, so we must resample if the file differs.
 */
function resample(audio: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate;
  const newLength = Math.floor(audio.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    result[i] =
      idx + 1 < audio.length
        ? audio[idx] * (1 - frac) + audio[idx + 1] * frac
        : audio[idx];
  }
  return result;
}

function correctBpmWithTag(detected: number, tagBpm: number | null): number {
  if (!tagBpm || tagBpm < 50 || tagBpm > 250) return detected;
  if (Math.abs(detected / tagBpm - 2) < 0.15) return Math.round((detected / 2) * 10) / 10;
  if (Math.abs(detected / tagBpm - 0.5) < 0.15) return Math.round((detected * 2) * 10) / 10;
  return detected;
}

/** Normalized RMS of a slice (same dBFS scale as overall energy). */
function windowRms(data: Float32Array, start: number, end: number): number {
  const len = end - start;
  if (len <= 0) return 0;
  let sum = 0;
  for (let i = start; i < end; i += 4) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / Math.ceil(len / 4));
  const db = 20 * Math.log10(Math.max(rms, 1e-9));
  return Math.max(0, Math.min(1, 1 + db / 55));
}

/**
 * Compute a 6-field energy micro-profile from already-decoded, already-resampled channelData.
 * Uses 10-second windows so the values are resolution-independent of track length.
 * Called once per file — reuses the same decoded buffer as BPM/key/energy analysis.
 */
export function computeEnergyProfile(channelData: Float32Array, sampleRate: number): EnergyProfile {
  const WINDOW = Math.round(10 * sampleRate); // 10s windows
  const totalSamples = channelData.length;

  if (totalSamples < WINDOW) {
    const v = windowRms(channelData, 0, totalSamples);
    return { intro: v, body: v, peak: v, outro: v, variance: 0, dropStrength: 0 };
  }

  const windows: number[] = [];
  for (let i = 0; i + WINDOW <= totalSamples; i += WINDOW) {
    windows.push(windowRms(channelData, i, i + WINDOW));
  }

  const N = windows.length;
  const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

  // intro ≈ first 15%, outro ≈ last 15%, body ≈ middle 60%
  const introEnd    = Math.max(1, Math.round(N * 0.15));
  const outroStart  = Math.min(N - 1, Math.round(N * 0.85));
  const bodyStart   = Math.round(N * 0.20);
  const bodyEnd     = Math.max(bodyStart + 1, Math.round(N * 0.80));

  const intro  = avg(windows.slice(0, introEnd));
  const outro  = avg(windows.slice(outroStart));
  const body   = avg(windows.slice(bodyStart, bodyEnd));
  const peak   = Math.max(...windows);

  const mean     = avg(windows);
  const variance = Math.sqrt(windows.reduce((s, v) => s + (v - mean) ** 2, 0) / N);

  let dropStrength = 0;
  for (let i = 1; i < N; i++) {
    const drop = windows[i - 1] - windows[i];
    if (drop > dropStrength) dropStrength = drop;
  }

  return { intro, body, peak, outro, variance, dropStrength };
}

export async function analyzeAudio(filePath: string): Promise<LocalAudioFeatures | null> {
  try {
    const decodeAudio = (require('audio-decode') as { default: (buf: Buffer) => Promise<AudioBuffer> }).default;
    // Read BPM tag before audio analysis — used to disambiguate ×2/÷2 detection errors
    let tagBpm: number | null = null;
    let tagYear: number | undefined;
    let tagComment: string | undefined;
    try {
      const mm = require('music-metadata') as typeof import('music-metadata');
      const meta = await mm.parseFile(filePath, { skipCovers: true, duration: false });
      if (meta.common.bpm && meta.common.bpm > 0) tagBpm = meta.common.bpm;
      if (meta.common.year && meta.common.year > 0) tagYear = meta.common.year;
      const rawComment = meta.common.comment;
      if (rawComment && rawComment.length > 0) tagComment = rawComment[0].text ?? undefined;
    } catch { /* tag read failure is non-fatal */ }

    const fileBuffer = fs.readFileSync(filePath);
    const audioBuffer = await decodeAudio(fileBuffer);

    // Essentia algorithms require mono 44100 Hz PCM
    let channelData = audioBuffer.getChannelData(0);
    if (audioBuffer.sampleRate !== 44100) {
      channelData = resample(channelData, audioBuffer.sampleRate, 44100);
    }

    // For BPM/energy: skip 30 s intro, analyse 60 s of main groove.
    // For short tracks (< 45 s) fall back to full track.
    const SKIP_SAMPLES = 30 * 44100;
    const WINDOW_SAMPLES = 60 * 44100;
    const grooveData = channelData.length > SKIP_SAMPLES
      ? channelData.slice(SKIP_SAMPLES, SKIP_SAMPLES + WINDOW_SAMPLES)
      : channelData.slice(0, WINDOW_SAMPLES);

    const e = getEssentia();

    // BPM — trust ID3 tag if present and in a valid DJ range (60–200).
    // Only fall back to audio detection when no tag exists, then use the tag
    // as a hint to correct ×2/÷2 octave errors in the detection result.
    const bpm = (tagBpm && tagBpm >= 60 && tagBpm <= 200)
      ? Math.round(tagBpm * 10) / 10
      : correctBpmWithTag(detectBpm(grooveData.slice(0, 30 * 44100), 44100), tagBpm);

    // Key consensus — 5 segments spread across the first 75 % of the track × 4 profiles.
    // Proportional spacing means we hit the main drop, verse and chorus regardless of
    // track length, rather than being confined to the first 100 s.  Four diverse
    // profiles (edma, temperley, edmm, bgate) reduce both pitch-class and mode errors.
    const SEG_SAMPLES = 20 * 44100;
    const NUM_SEGS = 5;
    const KEY_PROFILES = ['edma', 'temperley', 'edmm', 'bgate', 'krumhansl', 'noland'] as const;
    // Analyse the first 75 % of the track; clamp to the actual track length
    const analysisEnd = Math.floor(channelData.length * 0.75);
    const keyVotes: Array<{ pitchClass: number; mode: number; strength: number }> = [];
    for (let seg = 0; seg < NUM_SEGS; seg++) {
      const start = Math.floor((analysisEnd / NUM_SEGS) * seg);
      const slice = channelData.slice(start, start + SEG_SAMPLES);
      if (slice.length < SEG_SAMPLES / 2) break; // segment too short, skip
      const vec = e.arrayToVector(slice);
      for (const profile of KEY_PROFILES) {
        const r = e.KeyExtractor(vec, true, 4096, 4096, 12, 3500, 60, 25, 0.2, profile);
        keyVotes.push({
          pitchClass: KEY_TO_PITCH[r.key] ?? -1,
          mode: r.scale === 'major' ? 1 : 0,
          strength: (r.strength as number) ?? 0,
        });
      }
      vec.delete();
    }


    // Tally votes — identify key by pitchClass+mode; tie-break by cumulative strength
    const tally = new Map<string, { pitchClass: number; mode: number; count: number; strength: number }>();
    for (const v of keyVotes) {
      if (v.pitchClass === -1) continue;
      const k = `${v.pitchClass}-${v.mode}`;
      const entry = tally.get(k);
      if (entry) { entry.count++; entry.strength += v.strength; }
      else tally.set(k, { pitchClass: v.pitchClass, mode: v.mode, count: 1, strength: v.strength });
    }
    let best = { pitchClass: -1, mode: 0, count: 0, strength: 0 };
    for (const entry of tally.values()) {
      if (entry.count > best.count || (entry.count === best.count && entry.strength > best.strength)) {
        best = entry;
      }
    }
    const pitchClass = best.pitchClass;
    const mode = best.mode;
    // Energy — MixedInKey-style: combines onset density (rhythmic content) with
    // overall loudness.  Onset rate is sampled at 40 % of the track to hit the
    // main section rather than a quiet intro.  RMS is measured over the first 75 %.
    //
    // Calibration (onset normalised to 9 events/sec ≈ peak dance energy; RMS
    // mapped via 1 + rmsDb/55):
    //   energy 4 ≈ sparse minimal track  (~3 onsets/s, −25 dBFS) → 0.40
    //   energy 7 ≈ energetic dance track (~8 onsets/s, −33 dBFS) → 0.69
    //   energy 8 ≈ busy pop/club track   (≥9 onsets/s, −28 dBFS) → 0.80
    const mainStart = Math.floor(channelData.length * 0.40);
    const onsetSlice = channelData.slice(mainStart, mainStart + 30 * 44100);
    const onsetVec = e.arrayToVector(onsetSlice);
    let onsetScore = 0;
    try {
      const onsetResult = e.OnsetRate(onsetVec);
      const onsetRate: number = onsetResult.onsetRate ?? 0;
      onsetScore = Math.min(1, onsetRate / 9);
    } catch { /* fall back to 0 */ }
    onsetVec.delete();

    const energyData = channelData.slice(0, analysisEnd);
    let sumSq = 0;
    for (let i = 0; i < energyData.length; i += 4) sumSq += energyData[i] * energyData[i];
    const rms = Math.sqrt(sumSq / Math.ceil(energyData.length / 4));
    const rmsDb = 20 * Math.log10(Math.max(rms, 1e-9));
    const rmsScore = Math.max(0, Math.min(1, 1 + rmsDb / 55));
    const energy = Math.round((onsetScore * 0.6 + rmsScore * 0.4) * 1000) / 1000;

    const energyProfile = computeEnergyProfile(channelData, 44100);

    return { bpm, tagBpm, pitchClass, mode, energy, energyProfile, year: tagYear, comment: tagComment };
  } catch (err: unknown) {
    console.warn(`  (local analysis failed: ${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}
