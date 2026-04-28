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

const require = createRequire(import.meta.url);

const MODEL_BASE =
  'https://essentia.upf.edu/models/classifiers/voice_instrumental/voice_instrumental-msd-musicnn-1/';

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

async function downloadFile(url: string, dest: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- axios dynamic import
  const { default: axios } = await import('axios') as any;
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30_000 });
  fs.writeFileSync(dest, Buffer.from(res.data as ArrayBuffer));
}

async function ensureModel(dir: string): Promise<{ modelJson: Record<string, unknown>; shardPaths: string[] }> {
  const jsonPath = path.join(dir, 'model.json');
  if (!fs.existsSync(jsonPath)) {
    console.log('[vocal-ml] Downloading voice_instrumental model (~2 MB, one-time)…');
    await downloadFile(MODEL_BASE + 'model.json', jsonPath);
  }

  const modelJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<string, unknown>;
  const manifest = modelJson.weightsManifest as Array<{ paths: string[] }> | undefined ?? [];
  const shardPaths: string[] = [];

  for (const group of manifest) {
    for (const p of group.paths) {
      shardPaths.push(p);
      const dest = path.join(dir, p);
      if (!fs.existsSync(dest)) {
        console.log(`[vocal-ml]   Downloading ${p}…`);
        await downloadFile(MODEL_BASE + p, dest);
      }
    }
  }

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

  initState = 'pending';
  try {
    tf = await import('@tensorflow/tfjs');

    const dir = modelDir();
    const { modelJson, shardPaths } = await ensureModel(dir);

    // Load frozen graph model from disk — no URL fetch at inference time
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tf types
    graphModel = await (tf as any).loadGraphModel(fsIoHandler(dir, modelJson, shardPaths)) as typeof graphModel;

    // EssentiaTFInputExtractor requires EssentiaWASM (already loaded by analyzer-core)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- essentia has no TS types
    const { EssentiaWASM } = require('essentia.js') as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- essentia has no TS types
    const { EssentiaTFInputExtractor } = require('essentia.js/dist/essentia.js-model.js') as any;
    essentiaExtractor = new EssentiaTFInputExtractor(EssentiaWASM, 'musicnn', false);

    initState = 'ready';
    console.log('[vocal-ml] Model ready');
  } catch (err) {
    initState = 'failed';
    console.warn('[vocal-ml] Initialization failed:', err instanceof Error ? err.message : String(err));
  }
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
  if (initState !== 'ready' || !graphModel || !essentiaExtractor || !tf) return -1;

  try {
    // Downsample to 16 kHz (nearest-neighbour — fast, sufficient for mel features)
    const ratio = sampleRate / TARGET_SR;
    const dsLen = Math.floor(channelData.length / ratio);
    const downsampled = new Float32Array(dsLen);
    for (let i = 0; i < dsLen; i++) downsampled[i] = channelData[Math.round(i * ratio)];

    // Analyse 30 s from the body of the track (skip intro/outro)
    const windowSamples = Math.min(30 * TARGET_SR, downsampled.length);
    const startSample = Math.max(0, Math.floor((downsampled.length - windowSamples) / 2));
    const audio = downsampled.slice(startSample, startSample + windowSamples);

    // Compute MusiCNN mel features (187 frames × 96 bands per frame)
    const features = essentiaExtractor.computeFrameWise(audio);
    const frames: Float32Array[] = features.melSpectrum;
    const totalFrames = features.frameSize;

    if (!frames || totalFrames < PATCH_SIZE) return -1;

    // Build [numPatches, PATCH_SIZE, MEL_BANDS] tensor
    const numPatches = Math.floor(totalFrames / PATCH_SIZE);
    const flat = new Float32Array(numPatches * PATCH_SIZE * MEL_BANDS);
    for (let b = 0; b < numPatches; b++) {
      for (let f = 0; f < PATCH_SIZE; f++) {
        const src = frames[b * PATCH_SIZE + f];
        flat.set(src, (b * PATCH_SIZE + f) * MEL_BANDS);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tf types
    const inputTensor = (tf as any).tensor3d(flat, [numPatches, PATCH_SIZE, MEL_BANDS]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tf types
    const outputTensor = (graphModel as any).execute(inputTensor) as any;
    inputTensor.dispose();

    // output shape: [numPatches, 2]  — col 0 = voice, col 1 = instrumental
    const predictions: number[][] = await outputTensor.array();
    outputTensor.dispose();

    if (!predictions || predictions.length === 0) return -1;

    const avgVoice = predictions.reduce((s, row) => s + row[0], 0) / predictions.length;
    return Math.round(avgVoice * 1000) / 1000;

  } catch (err) {
    console.warn('[vocal-ml] Inference error:', err instanceof Error ? err.message : String(err));
    return -1;
  }
}
