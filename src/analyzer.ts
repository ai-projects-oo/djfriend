// Public API for audio analysis.
// In compiled Electron builds, heavy CPU work runs in persistent Worker Threads
// so the main process event loop stays free during analysis.
// In tsx/dev contexts (no compiled worker file present), falls back to running inline.
import { Worker } from 'worker_threads';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { analyzeAudio as analyzeAudioDirect } from './analyzer-core.js';
import { readSettings } from './settings.js';
export type { LocalAudioFeatures } from './analyzer-core.js';

type Result = Awaited<ReturnType<typeof analyzeAudioDirect>>;

let _workers: Worker[] | null = null;
let _nextId = 0;
let _nextWorker = 0;
const _pending = new Map<number, (result: Result) => void>();
const _pendingOwner = new Map<number, Worker>();

function failWorkerPending(dead: Worker): void {
  for (const [id, w] of _pendingOwner.entries()) {
    if (w === dead) {
      const resolve = _pending.get(id);
      _pending.delete(id);
      _pendingOwner.delete(id);
      resolve?.(null);
    }
  }
}

function spawnWorker(workerPath: string): Worker {
  const w = new Worker(workerPath);
  w.on('message', (msg: { id: number; result: Result }) => {
    const resolve = _pending.get(msg.id);
    if (resolve) {
      _pending.delete(msg.id);
      _pendingOwner.delete(msg.id);
      resolve(msg.result);
    }
  });
  w.on('error', (err) => {
    console.error('Analyzer worker error:', err);
    failWorkerPending(w);
    if (_workers) _workers = _workers.filter(x => x !== w);
  });
  w.on('exit', (code) => {
    if (code !== 0) console.warn(`Analyzer worker exited with code ${code}`);
    failWorkerPending(w);
    if (_workers) _workers = _workers.filter(x => x !== w);
  });
  return w;
}

function getWorkers(): Worker[] | null {
  if (_workers && _workers.length > 0) return _workers;
  try {
    const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'analyzer-worker.js');
    if (!fs.existsSync(workerPath)) return null;
    const mode = readSettings().analysisMode ?? 'normal';
    const cpus = Math.max(1, os.cpus().length);
    const poolSize = mode === 'performance' ? cpus : mode === 'normal' ? Math.max(1, Math.ceil(cpus / 2)) : 1;
    _workers = Array.from({ length: poolSize }, () => spawnWorker(workerPath));
    if (poolSize > 1) console.log(`[analyzer] spawned ${poolSize} audio workers (${mode} mode)`);
    return _workers;
  } catch {
    return null;
  }
}

export async function analyzeAudio(filePath: string, bpmHint?: { min: number; max: number }): Promise<Result> {
  const workers = getWorkers();
  if (!workers || workers.length === 0) return analyzeAudioDirect(filePath, bpmHint); // fallback
  const id = _nextId++;
  const worker = workers[_nextWorker % workers.length];
  _nextWorker++;
  return new Promise<Result>(resolve => {
    _pending.set(id, resolve);
    _pendingOwner.set(id, worker);
    worker.postMessage({ id, filePath, bpmHint });
  });
}
