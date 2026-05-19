/**
 * ML-based vocal detection using the Essentia voice_instrumental-msd-musicnn-1 model.
 *
 * Pipeline:
 *   44.1kHz audio → downsample to 16kHz → EssentiaTFInputExtractor (MusiCNN mel)
 *   → batch into 187-frame patches → TF.js graph model → average voice softmax → 0–1
 *
 * Model: voice_instrumental-msd-musicnn-1 (~2 MB, downloaded once to app data dir)
 * Backend: @tensorflow/tfjs CPU (pure JS, no native binaries)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { isMainThread } from 'worker_threads';

const require = createRequire(import.meta.url);

const MODEL_ZIP_URL =
  'https://essentia.upf.edu/models/classifiers/voice_instrumental/voice_instrumental-musicnn-msd-2-tfjs.zip';

const PATCH_SIZE = 187;  // MusiCNN temporal context (frames)
const MEL_BANDS  = 96;   // MusiCNN mel-band count
const TARGET_SR  = 16000; // MusiCNN expected sample rate

// Lazy singletons
let tf: typeof import('@tensorflow/tfjs') | null = null;
let graphModel: { execute(inputs: unknown): unknown } | null = null;
let essentiaExtractor: { computeFrameWise(audio: Float32Array): { melSpectrum: Float32Array[]; frameSize: number } } | null = null;
let initState: 'idle' | 'pending' | 'ready' | 'failed' = 'idle';

function modelDir(): string {
  const home = os.homedir();
  const base =
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'djfriend', 'models')
      : path.join(home, '.djfriend', 'models');
  const dir = path.join(base, 'voice_instrumental_musicnn');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function ensureModel(dir: string): Promise<{ modelJson: Record<string, unknown>; shardPaths: string[] }> {
  const jsonPath = path.join(dir, 'model.json');

  if (!fs.existsSync(jsonPath)) {
    console.log('[vocal-ml] Downloading voice_instrumental model (~3 MB, one-time)…');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- axios dynamic import
    const { default: axios } = await import('axios') as any;
    const res = await axios.get(MODEL_ZIP_URL, { responseType: 'arraybuffer', timeout: 60_000 });
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(res.data as ArrayBuffer);

    for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
      const basename = path.basename(zipPath);
      if (!basename || (zipEntry as import('jszip').JSZipObject).dir) continue;
      if (basename === 'model.json' || basename.endsWith('.bin')) {
        const buf = await (zipEntry as import('jszip').JSZipObject).async('nodebuffer');
        fs.writeFileSync(path.join(dir, basename), buf);
        console.log(`[vocal-ml]   Extracted ${basename}`);
      }
    }
  }

  const modelJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<string, unknown>;
  const manifest = modelJson.weightsManifest as Array<{ paths: string[] }> | undefined ?? [];
  const shardPaths: string[] = manifest.flatMap(g => g.paths);

  return { modelJson, shardPaths };
}

function fsIoHandler(dir: string, modelJson: Record<string, unknown>, shardPaths: string[]) {
  return {
    load: async () => {
      const manifest = modelJson.weightsManifest as Array<{ paths: string[]; weights: unknown[] }> ?? [];
      const weightSpecs = manifest.flatMap(g => g.weights);

      const buffers: ArrayBuffer[] = shardPaths.map(p => {
        const raw = fs.readFileSync(path.join(dir, p));
        return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
      });

      // Concatenate all shards into a single ArrayBuffer
      const totalBytes = buffers.reduce((s, b) => s + b.byteLength, 0);
      const merged = new Uint8Array(totalBytes);
      let offset = 0;
      for (const b of buffers) { merged.set(new Uint8Array(b), offset); offset += b.byteLength; }

      return {
        modelTopology: modelJson.modelTopology,
        weightSpecs,
        weightData:    merged.buffer,
        format:        modelJson.format,
        generatedBy:   modelJson.generatedBy,
        convertedBy:   modelJson.convertedBy,
        signature:     modelJson.signature,
      };
    },
  };
}

async function initialize(): Promise<void> {
  if (initState === 'ready' || initState === 'failed') return;
  if (initState === 'pending') {
    // Wait for the pending init to resolve
    await new Promise<void>(resolve => {
      const poll = setInterval(() => {
        if (initState === 'ready' || initState === 'failed') { clearInterval(poll); resolve(); }
      }, 100);
    });
    return;
  }

  // Skip in test environments and worker threads — use spectral fallback
  if (process.env.VITEST || process.env.NODE_ENV === 'test' || !isMainThread) {
    initState = 'failed';
    return;
  }

  initState = 'pending';
  try {
    tf = await import('@tensorflow/tfjs');

    const dir = modelDir();
    const { modelJson, shardPaths } = await ensureModel(dir);

    // Load frozen graph model from disk — no URL fetch at inference time
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tf types
    graphModel = await (tf as any).loadGraphModel(fsIoHandler(dir, modelJson, shardPaths)) as typeof graphModel;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- essentia has no TS types
    const { EssentiaWASM } = require('essentia.js') as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- UMD build required; CJS build exports empty object
    const { EssentiaTFInputExtractor } = require('essentia.js/dist/essentia.js-model.umd.js') as any;
    essentiaExtractor = new EssentiaTFInputExtractor(EssentiaWASM, 'musicnn', false);

    initState = 'ready';
    console.log('[vocal-ml] Model ready');
  } catch (err) {
    initState = 'failed';
    console.warn('[vocal-ml] Initialization failed:', err instanceof Error ? err.message : String(err));
  }
}

/** Run model on an audio slice. Returns per-patch vocal probabilities (col 0 = voice). */
async function runPatches(audio: Float32Array): Promise<number[] | null> {
  if (!graphModel || !essentiaExtractor || !tf) return null;
  const features = essentiaExtractor.computeFrameWise(audio);
  const frames: Float32Array[] = features.melSpectrum;
  const totalFrames: number = features.frameSize;
  if (!frames || totalFrames < PATCH_SIZE) return null;

  const numPatches = Math.floor(totalFrames / PATCH_SIZE);
  const flat = new Float32Array(numPatches * PATCH_SIZE * MEL_BANDS);
  for (let b = 0; b < numPatches; b++) {
    for (let f = 0; f < PATCH_SIZE; f++) {
      flat.set(frames[b * PATCH_SIZE + f], (b * PATCH_SIZE + f) * MEL_BANDS);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputTensor  = (tf as any).tensor3d(flat, [numPatches, PATCH_SIZE, MEL_BANDS]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outputTensor = (graphModel as any).execute(inputTensor) as any;
  inputTensor.dispose();
  const predictions: number[][] = await outputTensor.array();
  outputTensor.dispose();
  return predictions.map(row => Math.round(row[0] * 100) / 100);
}

function downsample(channelData: Float32Array, sampleRate: number): Float32Array {
  const ratio = sampleRate / TARGET_SR;
  const dsLen = Math.floor(channelData.length / ratio);
  const out = new Float32Array(dsLen);
  for (let i = 0; i < dsLen; i++) out[i] = channelData[Math.round(i * ratio)];
  return out;
}

/**
 * Compute voice probability for a decoded audio track.
 * Returns a value 0–1 (1 = definitely vocal), or -1 if model unavailable (use spectral fallback).
 * Audio must be mono 44100 Hz Float32Array.
 */
export async function detectVocalProbability(
  channelData: Float32Array,
  sampleRate: number,
): Promise<number> {
  await initialize();
  if (initState !== 'ready') return -1;
  try {
    const ds = downsample(channelData, sampleRate);
    const windowSamples = Math.min(30 * TARGET_SR, ds.length);
    const start = Math.max(0, Math.floor((ds.length - windowSamples) / 2));
    const patches = await runPatches(ds.slice(start, start + windowSamples));
    if (!patches || patches.length === 0) return -1;
    return Math.round(patches.reduce((s, v) => s + v, 0) / patches.length * 1000) / 1000;
  } catch (err) {
    console.warn('[vocal-ml] Inference error:', err instanceof Error ? err.message : String(err));
    return -1;
  }
}

/**
 * Compute per-patch vocal probability timeline across the full track.
 * Returns one value per ~3 s of audio, or [] if model unavailable.
 * Audio must be mono 44100 Hz Float32Array.
 */
export async function detectVocalTimeline(
  channelData: Float32Array,
  sampleRate: number,
): Promise<number[]> {
  await initialize();
  if (initState !== 'ready') return [];
  try {
    const ds = downsample(channelData, sampleRate);
    const patches = await runPatches(ds);
    return patches ?? [];
  } catch (err) {
    console.warn('[vocal-ml] Timeline error:', err instanceof Error ? err.message : String(err));
    return [];
  }
}
