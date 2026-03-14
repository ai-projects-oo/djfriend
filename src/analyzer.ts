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

export interface LocalAudioFeatures {
  bpm: number;
  pitchClass: number; // 0–11 (matches Spotify pitch class, compatible with camelot.ts)
  mode: number;       // 1=major, 0=minor
  energy: number;     // 0–1 normalized via dBFS
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getEssentia(): any {
  if (!essentiaInstance) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Essentia, EssentiaWASM } = require('essentia.js');
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

export async function analyzeAudio(filePath: string): Promise<LocalAudioFeatures | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const decodeAudio: (buf: Buffer) => Promise<AudioBuffer> = require('audio-decode').default;

    let t = Date.now();
    const fileBuffer = fs.readFileSync(filePath);
    console.error(`  [timing] read file: ${Date.now() - t}ms`);

    t = Date.now();
    const audioBuffer = await decodeAudio(fileBuffer);
    console.error(`  [timing] decode audio (${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels}ch, ${(audioBuffer.length / audioBuffer.sampleRate).toFixed(1)}s): ${Date.now() - t}ms`);

    t = Date.now();
    // Essentia algorithms require mono 44100 Hz PCM
    let channelData = audioBuffer.getChannelData(0);
    if (audioBuffer.sampleRate !== 44100) {
      channelData = resample(channelData, audioBuffer.sampleRate, 44100);
      console.error(`  [timing] resample: ${Date.now() - t}ms`);
      t = Date.now();
    }

    // Skip the first 30 s (intro is usually minimal/silent) and analyse a 60 s
    // window of the main groove. BPM and key are stable within 30–60 s, and
    // skipping the intro gives more representative energy readings.
    // For short tracks (< 45 s) fall back to analysing whatever is available.
    const SKIP_SAMPLES = 30 * 44100;
    const WINDOW_SAMPLES = 60 * 44100;
    if (channelData.length > SKIP_SAMPLES) {
      channelData = channelData.slice(SKIP_SAMPLES, SKIP_SAMPLES + WINDOW_SAMPLES);
    } else {
      // Track shorter than 30 s — analyse in full (no skip)
      channelData = channelData.slice(0, WINDOW_SAMPLES);
    }

    const e = getEssentia();

    // BPM — pure-JS onset autocorrelation; ~20x faster than RhythmExtractor2013
    t = Date.now();
    const bpm = detectBpm(channelData.slice(0, 30 * 44100), 44100);
    console.error(`  [timing] detectBpm: ${Date.now() - t}ms`);

    // Key consensus — run KeyExtractor on 3 × 20 s segments, take majority vote.
    // Three independent readings break ties caused by ambiguous intros/outros and
    // reduce the mode-confusion (A↔B) error rate vs a single 60 s pass.
    t = Date.now();
    const SEG_SAMPLES = 20 * 44100;
    const keyVotes: Array<{ pitchClass: number; mode: number; strength: number }> = [];
    for (let seg = 0; seg < 3; seg++) {
      const slice = channelData.slice(seg * SEG_SAMPLES, (seg + 1) * SEG_SAMPLES);
      if (slice.length < SEG_SAMPLES / 2) break; // skip if too short
      const vec = e.arrayToVector(slice);
      const r = e.KeyExtractor(vec, true, 4096, 4096, 12, 3500, 60, 25, 0.2, 'edma');
      vec.delete();
      keyVotes.push({
        pitchClass: KEY_TO_PITCH[r.key] ?? -1,
        mode: r.scale === 'major' ? 1 : 0,
        strength: (r.strength as number) ?? 0,
      });
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
    console.error(`  [timing] KeyExtractor consensus (${keyVotes.length} segs, winner ${best.count}/${keyVotes.length}): ${Date.now() - t}ms`);

    // RMS — stride-4 sampling is statistically equivalent (~0.01% error) but 4× faster.
    let sumSq = 0;
    for (let i = 0; i < channelData.length; i += 4) sumSq += channelData[i] * channelData[i];
    const rms = Math.sqrt(sumSq / Math.ceil(channelData.length / 4));
    const rmsDb = 20 * Math.log10(Math.max(rms, 1e-9));
    const rmsScore = Math.max(0, Math.min(1, 1 + rmsDb / 60));

    // OnsetRate — 30 s is enough for onset rate to converge; use first half of window.
    const onsetVector = e.arrayToVector(channelData.slice(0, 30 * 44100));
    let energy: number;
    try {
      t = Date.now();
      const onsetResult = e.OnsetRate(onsetVector);
      const onsetRate: number = onsetResult.onsetRate ?? 0;
      const onsetScore = Math.min(1, onsetRate / 12); // 12 onsets/sec ≈ peak energy for electronic music
      energy = Math.round((onsetScore * 0.7 + rmsScore * 0.3) * 1000) / 1000;
      console.error(`  [timing] OnsetRate: ${Date.now() - t}ms`);
    } catch {
      // OnsetRate unavailable — fall back to RMS only
      energy = Math.round(rmsScore * 1000) / 1000;
    }

    onsetVector.delete();

    // Return raw BPM — callers apply genre-aware double-time correction once
    // genre data is available (see normalizeBpm in vite.config.ts / index.ts).
    return { bpm, pitchClass, mode, energy };
  } catch (err: any) {
    console.warn(`  (local analysis failed: ${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}
