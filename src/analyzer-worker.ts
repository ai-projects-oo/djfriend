// Persistent worker — Essentia WASM is initialized once per worker and
// reused across all tracks sent to this worker via message passing.
import { parentPort } from 'worker_threads';
import { analyzeAudio } from './analyzer-core.js';

// Serialize message processing — the audio decoder keeps shared singleton state
// (decoder.reset() then decoder.decode()) that races when handlers interleave.
// Each link catches its own errors so one failed track can't poison the chain.
let _chain: Promise<void> = Promise.resolve();

parentPort!.on('message', ({ id, filePath, bpmHint }: { id: number; filePath: string; bpmHint?: { min: number; max: number } }) => {
  _chain = _chain.then(async () => {
    try {
      const result = await analyzeAudio(filePath, bpmHint);
      parentPort!.postMessage({ id, result });
    } catch (err) {
      console.error(`[analyzer-worker] analyzeAudio threw for "${filePath}":`, err instanceof Error ? err.message : err);
      parentPort!.postMessage({ id, result: null });
    }
  });
});
