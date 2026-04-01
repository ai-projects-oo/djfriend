/**
 * Extracts acoustic features from labeled tracks in SONGS_FOLDER.
 * Filename format: [track_num] KEY - ENERGY - Title.ext
 * Outputs a CSV: file,energy,onsetRate,rms,dynamicComplexity,spectralCentroid,hfc
 *
 * Usage: npx tsx scripts/extract-features.ts > features.csv
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const SONGS_FOLDER = process.env.SONGS_FOLDER ?? '/Users/ozben/Music/Music/Media.localized/Music';
const SAMPLE_RATE = 44100;
const ANALYZE_DURATION = 30; // seconds to analyze per track (at 40% position)

interface AudioBuffer {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

function extractEnergyFromFilename(filename: string): number | null {
  const match = filename.match(/\b(?:1[0-2]|[1-9])[AB]\s*-\s*(\d+)\s*-/i);
  return match ? parseInt(match[1], 10) : null;
}

function resample(audio: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate;
  const newLength = Math.floor(audio.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    result[i] = idx + 1 < audio.length
      ? audio[idx] * (1 - frac) + audio[idx + 1] * frac
      : audio[idx];
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- essentia.js has no TypeScript types
let essentiaInstance: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- essentia.js has no TypeScript types
function getEssentia(): any {
  if (!essentiaInstance) {
    const { Essentia, EssentiaWASM } = require('essentia.js') as { Essentia: new (wasm: unknown) => unknown; EssentiaWASM: unknown };
    essentiaInstance = new Essentia(EssentiaWASM);
  }
  return essentiaInstance;
}

async function extractFeatures(filePath: string): Promise<{
  onsetRate: number; rms: number; dynamicComplexity: number;
  spectralCentroid: number; hfc: number;
} | null> {
  try {
    const decodeAudio = (require('audio-decode') as { default: (buf: Buffer) => Promise<AudioBuffer> }).default;
    const fileBuffer = fs.readFileSync(filePath);
    const audioBuffer = await decodeAudio(fileBuffer);

    let channelData = audioBuffer.getChannelData(0);
    if (audioBuffer.sampleRate !== SAMPLE_RATE) {
      channelData = resample(channelData, audioBuffer.sampleRate, SAMPLE_RATE);
    }

    // Analyze 30s starting at 40% of the track
    const start = Math.floor(channelData.length * 0.40);
    const slice = channelData.slice(start, start + ANALYZE_DURATION * SAMPLE_RATE);

    const e = getEssentia();
    const vec = e.arrayToVector(slice);

    // OnsetRate
    let onsetRate = 0;
    try { onsetRate = e.OnsetRate(vec).onsetRate ?? 0; } catch { /* feature unavailable */ }

    // DynamicComplexity
    let dynamicComplexity = 0;
    try { dynamicComplexity = e.DynamicComplexity(vec, SAMPLE_RATE).dynamicComplexity ?? 0; } catch { /* feature unavailable */ }

    // Spectral features — need spectrum first
    let spectralCentroid = 0;
    let hfc = 0;
    try {
      const windowed = e.Windowing(vec, true, 0, 'hann', 1024, 0.5);
      const spectrum = e.Spectrum(windowed.frame);
      spectralCentroid = e.SpectralCentroidTime(vec).centroid ?? 0;
      hfc = e.HFC(spectrum.spectrum).hfc ?? 0;
    } catch { /* feature unavailable */ }

    vec.delete();

    // RMS
    let sumSq = 0;
    for (let i = 0; i < slice.length; i++) sumSq += slice[i] * slice[i];
    const rms = Math.sqrt(sumSq / slice.length);

    return { onsetRate, rms, dynamicComplexity, spectralCentroid, hfc };
  } catch {
    return null;
  }
}

async function main() {
  const allFiles: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(mp3|aiff|flac|m4a)$/i.test(entry.name)) allFiles.push(full);
    }
  }
  walk(SONGS_FOLDER);

  // Only files with MixedInKey energy labels
  const labeled = allFiles.filter(f => extractEnergyFromFilename(path.basename(f)) !== null);

  process.stderr.write(`Found ${labeled.length} labeled tracks\n`);

  // Stratified sample: up to 60 tracks per energy level (1–10)
  const buckets = new Map<number, string[]>();
  for (const f of labeled) {
    const e = extractEnergyFromFilename(path.basename(f))!;
    if (!buckets.has(e)) buckets.set(e, []);
    buckets.get(e)!.push(f);
  }
  const sample: string[] = [];
  for (const [, files] of [...buckets.entries()].sort(([a], [b]) => a - b)) {
    // Shuffle deterministically and take up to 60
    const shuffled = files.slice().sort(() => 0); // stable order
    sample.push(...shuffled.slice(0, 60));
  }

  process.stderr.write(`Sampling ${sample.length} tracks\n`);

  // CSV header
  process.stdout.write('file,energy,onsetRate,rms,dynamicComplexity,spectralCentroid,hfc\n');

  let done = 0;
  for (const filePath of sample) {
    const energy = extractEnergyFromFilename(path.basename(filePath))!;
    const features = await extractFeatures(filePath);
    if (features) {
      const { onsetRate, rms, dynamicComplexity, spectralCentroid, hfc } = features;
      const row = [
        JSON.stringify(path.basename(filePath)),
        energy,
        onsetRate.toFixed(4),
        rms.toFixed(6),
        dynamicComplexity.toFixed(4),
        spectralCentroid.toFixed(4),
        hfc.toFixed(4),
      ].join(',');
      process.stdout.write(row + '\n');
    }
    done++;
    if (done % 10 === 0) process.stderr.write(`  ${done}/${sample.length}\n`);
  }

  process.stderr.write('Done.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
