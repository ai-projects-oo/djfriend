// Persistent worker — Essentia WASM is initialized once per worker and
// reused across all tracks sent to this worker via message passing.
import { parentPort } from 'worker_threads';
import { analyzeAudio } from './analyzer';

parentPort!.on('message', async ({ filePath }: { filePath: string }) => {
  const result = await analyzeAudio(filePath);
  parentPort!.postMessage(result);
});
