import type { DiscogsRelease } from '../types';
import { apiFetch } from './apiFetch';

export async function fetchDiscogsCollection(
  onProgress?: (loaded: number, total: number) => void,
): Promise<DiscogsRelease[]> {
  const res = await apiFetch('/api/discogs/sync', { method: 'POST' });
  if (!res.ok && res.status !== 200) {
    throw new Error(`Sync request failed: ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buf = '';
  const releases: DiscogsRelease[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { type: string; loaded?: number; total?: number; releases?: DiscogsRelease[]; message?: string };
      if (event.type === 'progress') {
        onProgress?.(event.loaded ?? 0, event.total ?? 0);
      } else if (event.type === 'done') {
        releases.push(...(event.releases ?? []));
      } else if (event.type === 'error') {
        throw new Error(event.message ?? 'Discogs sync failed');
      }
    }
  }

  return releases;
}
