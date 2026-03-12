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

    // Truncate to 90 s — BPM/key are stable throughout a track and Essentia
    // algorithms scale linearly with sample count. Full tracks were taking 10–30s.
    const MAX_SAMPLES = 90 * 44100;
    if (channelData.length > MAX_SAMPLES) {
      channelData = channelData.slice(0, MAX_SAMPLES);
    }

    const e = getEssentia();
    const audioVector = e.arrayToVector(channelData);
    console.error(`  [timing] arrayToVector (${channelData.length} samples): ${Date.now() - t}ms`);

    // BPM — RhythmExtractor2013 is the most accurate algorithm in essentia.js
    t = Date.now();
    const rhythmResult = e.RhythmExtractor2013(audioVector, 208, 'multifeature', 40);
    const bpm = Math.round(rhythmResult.bpm * 10) / 10;
    console.error(`  [timing] RhythmExtractor2013: ${Date.now() - t}ms`);

    // Key — returns { key: 'A', scale: 'major'|'minor', strength: 0–1 }
    t = Date.now();
    const keyResult = e.KeyExtractor(audioVector);
    const pitchClass = KEY_TO_PITCH[keyResult.key] ?? -1;
    const mode = keyResult.scale === 'major' ? 1 : 0;
    console.error(`  [timing] KeyExtractor: ${Date.now() - t}ms`);

    // RMS loudness — baseline component of energy
    let sumSq = 0;
    for (let i = 0; i < channelData.length; i++) sumSq += channelData[i] * channelData[i];
    const rms = Math.sqrt(sumSq / channelData.length);
    const rmsDb = 20 * Math.log10(Math.max(rms, 1e-9));
    const rmsScore = Math.max(0, Math.min(1, 1 + rmsDb / 60));

    // Energy — onset rate (musical events per second) is a much better perceptual
    // proxy than RMS loudness alone. Modern mastering makes even ballads loud, so
    // pure RMS fails to distinguish a quiet ballad from an energetic dance track.
    // Onset rate: ballads ~2–4/sec, pop ~4–8/sec, dance/EDM ~8–15/sec.
    let energy: number;
    try {
      t = Date.now();
      const onsetResult = e.OnsetRate(audioVector);
      const onsetRate: number = onsetResult.onsetRate ?? 0;
      const onsetScore = Math.min(1, onsetRate / 8); // 8 onsets/sec ≈ peak energy
      energy = Math.round((onsetScore * 0.7 + rmsScore * 0.3) * 1000) / 1000;
      console.error(`  [timing] OnsetRate: ${Date.now() - t}ms`);
    } catch {
      // OnsetRate unavailable — fall back to RMS only
      energy = Math.round(rmsScore * 1000) / 1000;
    }

    audioVector.delete();

    // Return raw BPM — callers apply genre-aware double-time correction once
    // genre data is available (see normalizeBpm in vite.config.ts / index.ts).
    return { bpm, pitchClass, mode, energy };
  } catch (err: any) {
    console.warn(`  (local analysis failed: ${err.message})`);
    return null;
  }
}
