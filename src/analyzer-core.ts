import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';

const execFile = promisify(execFileCb);

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
  // Spectral features for local semantic tag derivation (no API key needed)
  spectral?: {
    zcRate: number;
    bassDb: number;
    midDb: number;
    highMidDb: number;
    highDb: number;
  };
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
 * 1. Decimating to ~4410 Hz
 * 2. Computing a short-time RMS energy envelope
 * 3. Half-wave rectifying the first difference → onset strength signal
 * 4. Autocorrelating over the 40–220 BPM lag range (wider than the final target)
 * 5. Harmonic-aware candidate scoring to resolve half-time / double-time errors
 */
function detectBpm(audio: Float32Array, sampleRate: number): number {
  // Decimate to ~4410 Hz — better time resolution for onset detection
  const DECIMATE = Math.max(1, Math.floor(sampleRate / 4410));
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

  // Autocorrelation over a wider 40–220 BPM range so we capture octave candidates
  const fps = sr / HOP;
  const lagMin = Math.floor(fps * 60 / 220);
  const lagMax = Math.ceil(fps * 60 / 40);

  const corr = new Float32Array(lagMax + 1);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let c = 0;
    for (let i = lag; i < nFrames; i++) c += onset[i] * onset[i - lag];
    corr[lag] = c;
  }

  // Harmonic-aware scoring: for each candidate lag in the 50–150 BPM range,
  // boost its score if its double-time (half lag) is also strong in the autocorrelation
  // and penalise it if its half-time (double lag) is even stronger.
  // This resolves the classic kick-on-2-and-4 → half-BPM error.
  const targetMin = Math.floor(fps * 60 / 150);
  const targetMax = Math.ceil(fps * 60 / 50);

  let bestLag = targetMin;
  let bestScore = -Infinity;

  for (let lag = targetMin; lag <= targetMax; lag++) {
    const c = corr[lag];
    if (c <= 0) continue;

    // Half-lag = double tempo candidate
    const halfLag = Math.round(lag / 2);
    const halfC = (halfLag >= lagMin && halfLag <= lagMax) ? corr[halfLag] : 0;

    // Double-lag = half tempo candidate
    const doubleLag = Math.round(lag * 2);
    const doubleC = (doubleLag <= lagMax) ? corr[doubleLag] : 0;

    // Boost if double-time is also present (confirms this is a real beat period),
    // penalise if half-time has a much stronger peak (we're likely seeing half-BPM).
    const harmonicBoost = halfC > 0 ? Math.min(1.5, halfC / c) : 0;
    const halfTimePenalty = doubleC > c * 1.1 ? doubleC / c : 0;

    const score = c * (1 + 0.4 * harmonicBoost) / (1 + 0.5 * halfTimePenalty);

    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }

  return Math.round((fps * 60 / bestLag) * 10) / 10;
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

// ── FFT (iterative Cooley-Tukey radix-2) ──────────────────────────────────────
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle), wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe; im[b] = im[a] - tIm;
        re[a] += tRe; im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

// Multi-band energy extraction for v3 energy formula
const FFT_SIZE = 2048;
const NUM_FRAMES = 60;
const ENERGY_BANDS = [
  { name: 'bass',    lo: 60,   hi: 500  },  // kick + sub — essential for R&B/hip-hop energy
  { name: 'mid',     lo: 1000, hi: 4000 },
  { name: 'highMid', lo: 4000, hi: 8000 },
  { name: 'high',    lo: 8000, hi: 20000 },
] as const;

interface MultiBandFeatures {
  bassDb: number;
  midDb: number;
  highMidDb: number;
  highDb: number;
  zcRate: number;
}

function extractMultiBandFeatures(channelData: Float32Array, sampleRate: number): MultiBandFeatures {
  const N = channelData.length;
  const halfFFT = FFT_SIZE / 2;
  const freqPerBin = sampleRate / FFT_SIZE;

  // Hann window
  const hann = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));

  const hop = Math.max(FFT_SIZE, Math.floor((N - FFT_SIZE) / (NUM_FRAMES - 1)));
  const nFrames = Math.min(NUM_FRAMES, Math.floor((N - FFT_SIZE) / hop) + 1);

  const bandPower: Record<string, number> = { bass: 0, mid: 0, highMid: 0, high: 0 };
  let frameCount = 0;

  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);

  for (let f = 0; f < nFrames; f++) {
    const start = Math.min(f * hop, N - FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = channelData[start + i] * hann[i]; im[i] = 0; }
    fft(re, im);

    let framePower = 0;
    const frameBandPower: Record<string, number> = { bass: 0, mid: 0, highMid: 0, high: 0 };

    for (let k = 1; k < halfFFT; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      const hz = k * freqPerBin;
      framePower += power;
      for (const b of ENERGY_BANDS) {
        if (hz >= b.lo && hz < b.hi) { frameBandPower[b.name] += power; break; }
      }
    }

    if (framePower > 1e-12) {
      for (const b of ENERGY_BANDS) bandPower[b.name] += frameBandPower[b.name];
      frameCount++;
    }
  }

  // Band dBFS (absolute energy per band)
  const bassDb    = 10 * Math.log10(Math.max(frameCount > 0 ? bandPower.bass    / frameCount : 1e-18, 1e-18));
  const midDb     = 10 * Math.log10(Math.max(frameCount > 0 ? bandPower.mid     / frameCount : 1e-18, 1e-18));
  const highMidDb = 10 * Math.log10(Math.max(frameCount > 0 ? bandPower.highMid / frameCount : 1e-18, 1e-18));
  const highDb    = 10 * Math.log10(Math.max(frameCount > 0 ? bandPower.high    / frameCount : 1e-18, 1e-18));

  // Zero-crossing rate (full resolution for accuracy)
  let zc = 0;
  for (let i = 1; i < N; i++) {
    if ((channelData[i] >= 0) !== (channelData[i - 1] >= 0)) zc++;
  }
  const zcRate = zc / N;

  return { bassDb, midDb, highMidDb, highDb, zcRate };
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

// Fallback decoder for formats not supported by audio-decode (e.g. M4A/AAC).
// Uses macOS's built-in afconvert to transcode to 16-bit mono 44100 Hz WAV,
// then feeds the WAV through the normal audio-decode pipeline.
async function afconvertDecode(
  filePath: string,
  decodeAudio: (buf: Buffer) => Promise<AudioBuffer>,
): Promise<AudioBuffer> {
  const tmp = path.join(os.tmpdir(), `djfriend-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  try {
    await execFile('afconvert', ['-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', filePath, tmp]);
    const wavBuf = fs.readFileSync(tmp);
    return await decodeAudio(wavBuf);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* cleanup failure is non-fatal */ }
  }
}

export async function analyzeAudio(filePath: string, bpmHint?: { min: number; max: number }): Promise<LocalAudioFeatures | null> {
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
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await decodeAudio(fileBuffer);
    } catch (decodeErr) {
      const msg = decodeErr instanceof Error ? decodeErr.message : String(decodeErr);
      if ((msg.includes('Missing decoder for') || msg.includes('Cannot detect audio format')) && process.platform === 'darwin') {
        audioBuffer = await afconvertDecode(filePath, decodeAudio);
      } else {
        throw decodeErr;
      }
    }

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
    // For untagged tracks, run the internal onset-autocorrelation detector,
    // then apply tag-based octave correction. If a BPM range hint is provided
    // (e.g. derived from the playlist genre), use it to resolve remaining
    // half-time / double-time ambiguity for tracks without a BPM tag.
    let bpm = (tagBpm && tagBpm >= 60 && tagBpm <= 200)
      ? Math.round(tagBpm * 10) / 10
      : correctBpmWithTag(detectBpm(grooveData.slice(0, 30 * 44100), 44100), tagBpm);
    if (bpmHint && !tagBpm) {
      if (bpm < bpmHint.min || bpm > bpmHint.max) {
        const halved  = Math.round((bpm / 2)  * 10) / 10;
        const doubled = Math.round((bpm * 2)  * 10) / 10;
        if (halved  >= bpmHint.min && halved  <= bpmHint.max) bpm = halved;
        else if (doubled >= bpmHint.min && doubled <= bpmHint.max) bpm = doubled;
      }
    }

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
    // Energy v4 — Multi-band spectral analysis including bass band
    //
    // v3 was calibrated on electronic music (MixedInKey corpus); the original
    // formula rewarded hi-hat/brightness (4–20 kHz) and penalised bass-heavy
    // genres like R&B and hip-hop that lack high-frequency content but are
    // clearly energetic.  v4 adds a bass band (60–500 Hz, kick + sub) with a
    // weight derived from the same OLS scaling as the other bands.  All means
    // and stds for the original bands are unchanged; the bass band uses
    // estimated values (mean=37.0, std=4.5) consistent with typical tracks.
    // Library-wide percentile normalisation (normalizeLibraryEnergy) is applied
    // after all tracks are scored, so only relative ordering matters here.
    //
    // Coefficients (v3 preserved, bass added):
    //   bassDb     w=+0.0130  mean=37.0   std=4.5   ← new: 60–500 Hz
    //   highMidDb  w=+0.0107  mean=28.454 std=5.648
    //   highDb     w=+0.0209  mean=26.545 std=6.372
    //   midDb      w=+0.0141  mean=32.203 std=4.492
    //   zcRate     w=+0.0016  mean=0.064  std=0.029
    const energyData = channelData.slice(0, analysisEnd);
    const mbFeats = extractMultiBandFeatures(energyData, 44100);
    const energy = Math.round(Math.max(0, Math.min(1,
      0.5838
      + (mbFeats.bassDb    - 37.0  ) / 4.5   * 0.0130
      + (mbFeats.highMidDb - 28.454) / 5.648 * 0.0107
      + (mbFeats.highDb    - 26.545) / 6.372 * 0.0209
      + (mbFeats.midDb     - 32.203) / 4.492 * 0.0141
      + (mbFeats.zcRate    - 0.064 ) / 0.029 * 0.0016
    )) * 1000) / 1000;

    const energyProfile = computeEnergyProfile(channelData, 44100);

    return { bpm, tagBpm, pitchClass, mode, energy, energyProfile, year: tagYear, comment: tagComment, spectral: { zcRate: mbFeats.zcRate, bassDb: mbFeats.bassDb, midDb: mbFeats.midDb, highMidDb: mbFeats.highMidDb, highDb: mbFeats.highDb } };
  } catch (err: unknown) {
    console.warn(`  (local analysis failed: ${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}
