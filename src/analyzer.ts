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

    const fileBuffer = fs.readFileSync(filePath);
    const audioBuffer = await decodeAudio(fileBuffer);

    // Essentia algorithms require mono 44100 Hz PCM
    let channelData = audioBuffer.getChannelData(0);
    if (audioBuffer.sampleRate !== 44100) {
      channelData = resample(channelData, audioBuffer.sampleRate, 44100);
    }

    const e = getEssentia();
    const audioVector = e.arrayToVector(channelData);

    // BPM — RhythmExtractor2013 is the most accurate algorithm in essentia.js
    const rhythmResult = e.RhythmExtractor2013(audioVector, 208, 'multifeature', 40);
    const bpm = Math.round(rhythmResult.bpm * 10) / 10;

    // Key — returns { key: 'A', scale: 'major'|'minor', strength: 0–1 }
    const keyResult = e.KeyExtractor(audioVector);
    const pitchClass = KEY_TO_PITCH[keyResult.key] ?? -1;
    const mode = keyResult.scale === 'major' ? 1 : 0;

    // Energy — RMS normalized to 0–1 via a dBFS scale (-60 dBFS → 0, 0 dBFS → 1)
    let sumSq = 0;
    for (let i = 0; i < channelData.length; i++) sumSq += channelData[i] * channelData[i];
    const rms = Math.sqrt(sumSq / channelData.length);
    const rmsDb = 20 * Math.log10(Math.max(rms, 1e-9));
    const energy = Math.round(Math.max(0, Math.min(1, 1 + rmsDb / 60)) * 1000) / 1000;

    audioVector.delete();

    return { bpm, pitchClass, mode, energy };
  } catch (err: any) {
    console.warn(`  (local analysis failed: ${err.message})`);
    return null;
  }
}
