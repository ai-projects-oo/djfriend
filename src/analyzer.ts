// Public API for audio analysis.
// In compiled Electron builds, heavy CPU work runs in a persistent Worker Thread
// so the main process event loop stays free during analysis.
// In tsx/dev contexts (no compiled worker file present), falls back to running inline.
import { Worker } from 'worker_threads';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { analyzeAudio as analyzeAudioDirect } from './analyzer-core.js';
export type { LocalAudioFeatures } from './analyzer-core.js';

let _worker: Worker | null = null;
// Single-slot pending resolver — safe because analysis is always sequential.
let _resolve: ((result: Awaited<ReturnType<typeof analyzeAudioDirect>>) => void) | null = null;

function getWorker(): Worker | null {
  if (_worker) return _worker;
  try {
    const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'analyzer-worker.js');
    if (!fs.existsSync(workerPath)) return null;
    _worker = new Worker(workerPath);
    _worker.on('message', (result) => {
      const resolve = _resolve;
      _resolve = null;
      resolve?.(result as Awaited<ReturnType<typeof analyzeAudioDirect>>);
    });
    _worker.on('error', (err) => {
      console.error('Analyzer worker error:', err);
      const resolve = _resolve;
      _resolve = null;
      _worker = null;
      resolve?.(null);
    });
    _worker.on('exit', (code) => {
      if (code !== 0) console.warn(`Analyzer worker exited with code ${code}`);
      const resolve = _resolve;
      _resolve = null;
      _worker = null;
      resolve?.(null);
    });
    return _worker;
  } catch {
    return null;
  }
}

export async function analyzeAudio(filePath: string): Promise<Awaited<ReturnType<typeof analyzeAudioDirect>>> {
  const w = getWorker();
  if (!w) return analyzeAudioDirect(filePath); // fallback for tsx / non-compiled contexts
  return new Promise(resolve => {
    _resolve = resolve;
    w.postMessage({ filePath });
  });
}
