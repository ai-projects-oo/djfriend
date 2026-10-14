import type { AppleMusicExportJob, AppleMusicExportResult } from '../types';
import { apiFetch } from './apiFetch';

export type AppleMusicExportProgress =
  | { phase: 'index' }
  | { phase: 'library'; done: number; total: number }
  | { phase: 'playlist'; name: string; index: number; total: number }
  | { phase: 'tracks'; name: string; done: number; total: number }
  | { phase: 'tagging'; done: number; total: number };

/** Runs an export in Music.app via the server, reporting progress. Abort the signal to cancel. */
export async function exportToAppleMusic(
  job: AppleMusicExportJob,
  onProgress: (p: AppleMusicExportProgress) => void,
  signal?: AbortSignal,
): Promise<AppleMusicExportResult> {
  const res = await apiFetch('/api/apple-music/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Export failed (${res.status})`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { type: string; message?: string; result?: AppleMusicExportResult } & Partial<AppleMusicExportProgress>;
      if (event.type === 'progress') onProgress(event as unknown as AppleMusicExportProgress);
      else if (event.type === 'error') throw new Error(event.message ?? 'Apple Music export failed');
      else if (event.type === 'done' && event.result) return event.result;
    }
  }
  throw new Error('Export ended without a result');
}
