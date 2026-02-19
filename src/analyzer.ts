import fs from 'fs';
import audioDecode from 'audio-decode';
import { toCamelot } from './camelot';

const { Essentia, EssentiaWASM } = require('essentia.js');
const essentia = new Essentia(EssentiaWASM);

interface LocalAnalysis {
  bpm: number | null;
  key: string | null;
  camelot: string | null;
  energy: number | null;
}

interface DecodedAudio {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

const PITCH_BY_KEY: Record<string, number> = {
  C: 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  F: 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
};

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeKey(rawKey: unknown): number | null {
  if (typeof rawKey !== 'string') return null;
  const normalized = rawKey.toUpperCase().replace('♯', '#').replace('♭', 'B');
  return PITCH_BY_KEY[normalized] ?? null;
}

function normalizeMode(rawScale: unknown): number | null {
  if (typeof rawScale !== 'string') return null;
  const scale = rawScale.toLowerCase();
  if (scale === 'major') return 1;
  if (scale === 'minor') return 0;
  return null;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function toMono(audio: DecodedAudio): Float32Array {
  if (audio.numberOfChannels <= 1) {
    return audio.getChannelData(0);
  }

  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c += 1) {
    const channel = audio.getChannelData(c);
    for (let i = 0; i < audio.length; i += 1) {
      mono[i] += channel[i];
    }
  }
  for (let i = 0; i < audio.length; i += 1) {
    mono[i] /= audio.numberOfChannels;
  }
  return mono;
}

function displayKey(pitchClass: number, mode: number): string {
  const info = toCamelot(pitchClass, mode);
  return info?.keyName ?? '';
}

export async function analyzeAudioFile(filePath: string): Promise<LocalAnalysis> {
  const fileBuffer = fs.readFileSync(filePath);
  const decoded = (await audioDecode(toArrayBuffer(fileBuffer))) as DecodedAudio;
  const monoSignal = toMono(decoded);
  const signalVector = essentia.arrayToVector(monoSignal);

  let bpm: number | null = null;
  let key: string | null = null;
  let camelot: string | null = null;
  let energy: number | null = null;

  try {
    const rhythm = essentia.RhythmExtractor(signalVector, 1024, 1024, 256, 0.1, 208, 40, 1024, decoded.sampleRate);
    if (Number.isFinite(rhythm?.bpm)) {
      bpm = roundTo(Number(rhythm.bpm), 1);
    }
  } catch {
    // Keep bpm null if extraction fails on this file.
  }

  try {
    let tonal = essentia.KeyExtractor(
      signalVector,
      true,
      4096,
      2048,
      12,
      3500,
      60,
      25,
      0.2,
      'bgate',
      decoded.sampleRate,
      0.0001,
      440,
      'cosine',
      'hann',
    );
    if (!tonal?.key || !tonal?.scale) {
      tonal = essentia.KeyExtractor(signalVector);
    }
    const pitchClass = normalizeKey(tonal?.key);
    const mode = normalizeMode(tonal?.scale);
    if (pitchClass !== null && mode !== null) {
      key = displayKey(pitchClass, mode);
      camelot = toCamelot(pitchClass, mode)?.camelot ?? null;
    }
  } catch {
    // Keep key/camelot null if extraction fails on this file.
  }

  try {
    const rms = essentia.RMS(signalVector);
    if (Number.isFinite(rms?.rms)) {
      energy = roundTo(Math.max(0, Math.min(1, Number(rms.rms))), 3);
    }
  } catch {
    // Keep energy null if extraction fails on this file.
  }

  return { bpm, key, camelot, energy };
}
