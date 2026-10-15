import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import { fft } from './dsp.js';
import { detectKey, KEY_DETECTION_VERSION } from './keyDetection.js';

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

export interface FrequencyWaveform {
  bass: number[]; // ~2000 values 0–1, energy in 20–250 Hz per time window
  mid:  number[]; // ~2000 values 0–1, energy in 250–4000 Hz per time window
  high: number[]; // ~2000 values 0–1, energy in 4000+ Hz per time window
}

export interface LocalAudioFeatures {
  bpm: number;
  tagBpm: number | null; // Raw ID3/metadata BPM tag — null if absent
  pitchClass: number; // 0–11 (matches Spotify pitch class, compatible with camelot.ts)
  mode: number;       // 1=major, 0=minor
  keyConfidence?: number; // 0–1 margin between best and second-best key template
  keyVersion?: number;    // KEY_DETECTION_VERSION that produced pitchClass/mode
  energy: number;     // 0–1 normalized via dBFS
  energyProfile?: EnergyProfile;
  waveform?: number[]; // ~1200 normalized RMS values (0–1) for waveform display
  frequencyWaveform?: FrequencyWaveform; // per-window band energies for frequency-colored waveform
  vocalTimeline?: number[]; // per-patch vocal probability (~1 value per 3 s)
  year?: number;      // ID3 year tag
  comment?: string;   // ID3 first comment frame
  // Spectral features for local semantic tag derivation (no API key needed)
  spectral?: {
    zcRate: number;
    bassDb: number;
    midDb: number;
    highMidDb: number;
    highDb: number;
    spectralCentroid: number;
    spectralFlatness: number;
    spectralFlux: number;
    vocalLikelihood: number;  // 0–1 voice probability
  };
}


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

/**
 * Linear interpolation resampler. BPM, key and energy analysis all assume
 * 44100 Hz input, so we must resample if the file differs.
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
  spectralCentroid: number;  // Hz — weighted average frequency
  spectralFlatness: number;  // 0–1, low=tonal/voiced, high=noisy/unvoiced
  spectralFlux: number;      // average frame-to-frame spectral change (normalized)
  vocalLikelihood: number;   // 0–1 voice probability (logistic regression on spectral features)
}

function sigmoid(x: number): number { return 1 / (1 + Math.exp(-x)); }

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
  let centroidNum = 0, centroidDen = 0;   // for spectral centroid
  let geoLogSum = 0, arithSum = 0;        // for spectral flatness
  let specFlux = 0;                       // frame-to-frame flux
  let frameCount = 0;

  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const prevMag = new Float64Array(halfFFT);  // previous frame magnitude spectrum

  for (let f = 0; f < nFrames; f++) {
    const start = Math.min(f * hop, N - FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = channelData[start + i] * hann[i]; im[i] = 0; }
    fft(re, im);

    let framePower = 0;
    let frameCentNum = 0;
    let frameGeoLog = 0, frameArith = 0;
    let frameFlux = 0;
    const frameBandPower: Record<string, number> = { bass: 0, mid: 0, highMid: 0, high: 0 };

    for (let k = 1; k < halfFFT; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      const mag = Math.sqrt(power);
      const hz = k * freqPerBin;
      framePower += power;
      frameCentNum += hz * power;
      frameArith += power;
      frameGeoLog += Math.log(Math.max(power, 1e-30));
      // half-wave rectified flux — only count increases (onset-like)
      const diff = mag - prevMag[k];
      if (diff > 0) frameFlux += diff * diff;
      prevMag[k] = mag;
      for (const b of ENERGY_BANDS) {
        if (hz >= b.lo && hz < b.hi) { frameBandPower[b.name] += power; break; }
      }
    }

    if (framePower > 1e-12) {
      for (const b of ENERGY_BANDS) bandPower[b.name] += frameBandPower[b.name];
      centroidNum += frameCentNum;
      centroidDen += framePower;
      geoLogSum += frameGeoLog / (halfFFT - 1);
      arithSum  += frameArith  / (halfFFT - 1);
      if (f > 0) specFlux += frameFlux / (halfFFT - 1);
      frameCount++;
    }
  }

  // Band dBFS (absolute energy per band)
  const bassDb    = 10 * Math.log10(Math.max(frameCount > 0 ? bandPower.bass    / frameCount : 1e-18, 1e-18));
  const midDb     = 10 * Math.log10(Math.max(frameCount > 0 ? bandPower.mid     / frameCount : 1e-18, 1e-18));
  const highMidDb = 10 * Math.log10(Math.max(frameCount > 0 ? bandPower.highMid / frameCount : 1e-18, 1e-18));
  const highDb    = 10 * Math.log10(Math.max(frameCount > 0 ? bandPower.high    / frameCount : 1e-18, 1e-18));

  // Spectral centroid (Hz)
  const spectralCentroid = centroidDen > 0 ? centroidNum / centroidDen : 1000;

  // Spectral flatness (Wiener entropy): geometric mean / arithmetic mean of power spectrum.
  // Values near 0 = tonal/voiced; near 1 = white noise.
  const avgGeoLog = frameCount > 0 ? geoLogSum / frameCount : -69;
  const avgArith  = frameCount > 0 ? arithSum  / frameCount : 1e-18;
  const spectralFlatness = Math.max(0, Math.min(1, Math.exp(avgGeoLog) / Math.max(avgArith, 1e-30)));

  // Spectral flux (normalized, drop first frame which has no prev)
  const spectralFlux = frameCount > 1 ? Math.sqrt(specFlux / (frameCount - 1)) / Math.max(avgArith, 1e-18) : 0;

  // Zero-crossing rate (full resolution for accuracy)
  let zc = 0;
  for (let i = 1; i < N; i++) {
    if ((channelData[i] >= 0) !== (channelData[i - 1] >= 0)) zc++;
  }
  const zcRate = zc / N;

  // Voice probability — logistic regression on spectral features.
  // Coefficients calibrated on knowledge of vocal vs. instrumental spectral characteristics:
  //   • centroid 1500–3500 Hz = vocal sweet spot (formants F1–F3 + harmonics)
  //   • low flatness = tonal/harmonic (vowels) vs. high flatness = broadband noise
  //   • moderate flux = rhythmic syllable modulation
  //   • midDb > bassDb = vocal presence lifts mid band
  //   • moderate ZCR distinguishes voiced (0.05–0.18) from high-noise signals
  const centNorm    = (spectralCentroid - 2200) / 1000   // peak vocal at ~2200 Hz → 0
  const flatScore   = -spectralFlatness * 4               // tonal wins
  const fluxScore   = Math.max(0, Math.min(spectralFlux, 5)) * 0.4  // syllabic flux
  const midBassRat  = (midDb - bassDb - 8) / 8            // >8 dB lift = vocal
  const zcScore     = -(Math.abs(zcRate - 0.10) - 0.02) * 8  // sweet spot 0.08–0.12
  const logit = -0.4 * centNorm * centNorm + flatScore + fluxScore + midBassRat + zcScore - 0.5
  const vocalLikelihood = Math.round(sigmoid(logit) * 1000) / 1000

  return { bassDb, midDb, highMidDb, highDb, zcRate, spectralCentroid, spectralFlatness, spectralFlux, vocalLikelihood };
}

/**
 * Energy v5 — transparent, hand-weighted combination of loudness-related bands and onset activity.
 * Not fitted to any third-party tool's ratings. Weights favour the bands a DJ hears as "drive":
 * kick/sub (bass) and hats/air (high), with mids and spectral flux (rhythmic activity) as support.
 * Library-wide percentile normalisation (normalizeLibraryEnergy in api.ts) is applied afterwards,
 * so only the relative ordering of tracks matters here.
 */
export function energyScore(f: Pick<MultiBandFeatures, 'bassDb' | 'midDb' | 'highMidDb' | 'highDb' | 'spectralFlux'>): number {
  const bandDb = 0.30 * f.bassDb + 0.20 * f.midDb + 0.20 * f.highMidDb + 0.30 * f.highDb;
  const activity = Math.max(0, Math.min(5, f.spectralFlux));
  const raw = (bandDb - 30) / 6 + (activity - 1) * 0.5;
  return Math.round(sigmoid(raw) * 1000) / 1000;
}

/** Spectral vocal likelihood per ~3 s window across the whole track (drives the waveform's vocal lane). */
export function computeVocalTimeline(channelData: Float32Array, sampleRate: number, windowSeconds = 3): number[] {
  const win = Math.round(windowSeconds * sampleRate);
  const out: number[] = [];
  for (let start = 0; start + FFT_SIZE * 2 <= channelData.length; start += win) {
    out.push(extractMultiBandFeatures(channelData.subarray(start, Math.min(channelData.length, start + win)), sampleRate).vocalLikelihood);
  }
  return out;
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

// mpg123-decoder prints "mpg123-decoder: …" via console.error for every damaged MP3 frame it skips.
// Those are non-fatal (the frame is dropped, decoding continues), so count them instead of flooding
// the log, and report one line per file.
let skippedMp3Frames = 0;
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('mpg123-decoder:')) { skippedMp3Frames++; return; }
  consoleError(...args);
};
async function decodeQuietly(decode: (buf: Buffer) => Promise<AudioBuffer>, buf: Buffer, label: string): Promise<AudioBuffer> {
  const before = skippedMp3Frames;
  try { return await decode(buf); }
  finally {
    const n = skippedMp3Frames - before;
    if (n > 0) console.warn(`  (${label}: skipped ${n} damaged MP3 frame${n === 1 ? '' : 's'})`);
  }
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

export function computeWaveform(channelData: Float32Array, points = 2000): number[] {
  const blockSize = Math.floor(channelData.length / points);
  const raw: number[] = [];
  for (let i = 0; i < points; i++) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, channelData.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += channelData[j] * channelData[j];
    raw.push(Math.sqrt(sum / (end - start)));
  }
  const max = Math.max(...raw, 1e-6);
  return raw.map(v => Math.round((v / max) * 100) / 100);
}

/**
 * Per-window frequency band energy for waveform display.
 * Reuses the existing fft() — no second decodeAudioData call.
 * Returns three normalized arrays (bass / mid / high), each with `points` values.
 */
export function computeFrequencyWaveform(channelData: Float32Array, sampleRate: number, points = 2000): FrequencyWaveform {
  const N    = channelData.length;
  const WIN  = 2048;
  const half = WIN >> 1;
  const freqPerBin = sampleRate / WIN;

  const bassHiBin = Math.min(half - 1, Math.floor(250  / freqPerBin)); // 20–250 Hz
  const midHiBin  = Math.min(half - 1, Math.floor(4000 / freqPerBin)); // 250–4000 Hz
  // high: midHiBin+1 … half-1                                           4000+ Hz

  const nBass = Math.max(1, bassHiBin);
  const nMid  = Math.max(1, midHiBin - bassHiBin);
  const nHigh = Math.max(1, half - 1 - midHiBin);

  const hann = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (WIN - 1)));

  const re = new Float64Array(WIN);
  const im = new Float64Array(WIN);
  const blockSize = Math.floor(N / points);

  const rawBass = new Float32Array(points);
  const rawMid  = new Float32Array(points);
  const rawHigh = new Float32Array(points);

  for (let p = 0; p < points; p++) {
    const center = Math.floor((p + 0.5) * blockSize);
    const s0 = Math.max(0, Math.min(N - WIN, center - half));
    for (let i = 0; i < WIN; i++) { re[i] = channelData[s0 + i] * hann[i]; im[i] = 0; }
    fft(re, im);

    let bassE = 0, midE = 0, highE = 0;
    for (let k = 1; k < half; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      if      (k <= bassHiBin) bassE += power;
      else if (k <= midHiBin)  midE  += power;
      else                     highE += power;
    }
    rawBass[p] = Math.sqrt(bassE / nBass);
    rawMid[p]  = Math.sqrt(midE  / nMid);
    rawHigh[p] = Math.sqrt(highE / nHigh);
  }

  const norm = (arr: Float32Array): number[] => {
    let mx = 1e-10;
    for (let i = 0; i < arr.length; i++) if (arr[i] > mx) mx = arr[i];
    return Array.from(arr, v => Math.round(v / mx * 100) / 100);
  };

  return { bass: norm(rawBass), mid: norm(rawMid), high: norm(rawHigh) };
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
      if (rawComment && rawComment.length > 0) {
        const first = rawComment[0];
        const text = typeof first === 'string' ? first : first.text;
        if (text && text.trim()) tagComment = text.trim();
      }
    } catch { /* tag read failure is non-fatal */ }

    const fileBuffer = fs.readFileSync(filePath);
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await decodeQuietly(decodeAudio, fileBuffer, path.basename(filePath));
    } catch (decodeErr) {
      const msg = decodeErr instanceof Error ? decodeErr.message : String(decodeErr);
      if ((msg.includes('Missing decoder for') || msg.includes('Cannot detect audio format')) && process.platform === 'darwin') {
        audioBuffer = await afconvertDecode(filePath, decodeAudio);
      } else {
        throw decodeErr;
      }
    }

    // Analysis expects mono 44100 Hz PCM
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

    // Key — CQT chromagram × key templates (src/keyDetection.ts)
    const keyResult = detectKey(channelData);
    const pitchClass = keyResult?.pitchClass ?? -1;
    const mode = keyResult?.mode ?? 0;
    const keyConfidence = keyResult?.confidence;
    const analysisEnd = Math.floor(channelData.length * 0.75);
    const energyData = channelData.slice(0, analysisEnd);
    const mbFeats = extractMultiBandFeatures(energyData, 44100);
    const energy = energyScore(mbFeats);

    const energyProfile      = computeEnergyProfile(channelData, 44100);
    const waveform           = computeWaveform(channelData);
    const frequencyWaveform  = computeFrequencyWaveform(channelData, 44100);

    // Vocal presence — spectral estimate (overall + per ~3 s window for the waveform's vocal lane)
    const vocalLikelihood = mbFeats.vocalLikelihood;
    const vocalTimeline   = computeVocalTimeline(channelData, 44100);

    return { bpm, tagBpm, pitchClass, mode, keyConfidence, keyVersion: KEY_DETECTION_VERSION, energy, energyProfile, waveform, frequencyWaveform, vocalTimeline: vocalTimeline.length > 0 ? vocalTimeline : undefined, year: tagYear, comment: tagComment, spectral: { zcRate: mbFeats.zcRate, bassDb: mbFeats.bassDb, midDb: mbFeats.midDb, highMidDb: mbFeats.highMidDb, highDb: mbFeats.highDb, spectralCentroid: mbFeats.spectralCentroid, spectralFlatness: mbFeats.spectralFlatness, spectralFlux: mbFeats.spectralFlux, vocalLikelihood } };
  } catch (err: unknown) {
    console.warn(`  (local analysis failed: ${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}

/** Analyze audio from a raw Buffer (e.g. fetched from a URL) instead of a local file path. */
export async function analyzeAudioBuffer(buf: Buffer, bpmHint?: { min: number; max: number }): Promise<LocalAudioFeatures | null> {
  try {
    const decodeAudio = (require('audio-decode') as { default: (buf: Buffer) => Promise<AudioBuffer> }).default;
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await decodeQuietly(decodeAudio, buf, 'buffer');
    } catch (err) {
      console.warn(`  (audio-decode failed for buffer: ${err instanceof Error ? err.message : String(err)})`);
      return null;
    }

    let channelData = audioBuffer.getChannelData(0);
    if (audioBuffer.sampleRate !== 44100) {
      channelData = resample(channelData, audioBuffer.sampleRate, 44100);
    }

    const SKIP_SAMPLES = 30 * 44100;
    const WINDOW_SAMPLES = 60 * 44100;
    const grooveData = channelData.length > SKIP_SAMPLES
      ? channelData.slice(SKIP_SAMPLES, SKIP_SAMPLES + WINDOW_SAMPLES)
      : channelData.slice(0, WINDOW_SAMPLES);


    let bpm = correctBpmWithTag(detectBpm(grooveData.slice(0, 30 * 44100), 44100), null);
    if (bpmHint) {
      if (bpm < bpmHint.min || bpm > bpmHint.max) {
        const halved  = Math.round((bpm / 2)  * 10) / 10;
        const doubled = Math.round((bpm * 2)  * 10) / 10;
        if (halved  >= bpmHint.min && halved  <= bpmHint.max) bpm = halved;
        else if (doubled >= bpmHint.min && doubled <= bpmHint.max) bpm = doubled;
      }
    }

    const keyResult = detectKey(channelData);
    const pitchClass = keyResult?.pitchClass ?? 0;
    const mode = keyResult?.mode ?? 0;
    const keyConfidence = keyResult?.confidence;
    const analysisEnd = Math.floor(channelData.length * 0.75);

    const energyData = channelData.slice(0, analysisEnd);
    const mbFeats = extractMultiBandFeatures(energyData, 44100);
    const energy = energyScore(mbFeats);

    return { bpm, tagBpm: null, pitchClass, mode, keyConfidence, keyVersion: KEY_DETECTION_VERSION, energy };
  } catch (err: unknown) {
    console.warn(`  (buffer analysis failed: ${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}

/**
 * Key + BPM from raw mono PCM captured live (e.g. a vinyl record played into the audio input).
 * The audio is analysed in memory and never written to disk.
 */
export function analyzePcm(samples: Float32Array, sampleRate: number): { pitchClass: number; mode: number; keyConfidence?: number; keyVersion: number; bpm: number } | null {
  if (samples.length < sampleRate * 5) return null;
  const pcm = sampleRate !== 44100 ? resample(samples, sampleRate, 44100) : samples;
  const key = detectKey(pcm, { trimEnds: false });
  if (!key) return null;
  const bpm = detectBpm(pcm.subarray(0, Math.min(pcm.length, 30 * 44100)), 44100);
  return { pitchClass: key.pitchClass, mode: key.mode, keyConfidence: key.confidence, keyVersion: KEY_DETECTION_VERSION, bpm };
}
