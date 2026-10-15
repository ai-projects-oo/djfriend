import type { SetTrack, Song } from '../types';
import { apiFetch } from './apiFetch';
import { downloadM3U } from './downloads';

export interface ReanalyzeResult { bpm: number; key: string; camelot: string; energy: number; keyConfidence?: number; keyVersion?: number }

/** Re-runs local audio analysis for one track. Null when analysis failed. */
export async function reanalyzeTrack(song: Song): Promise<ReanalyzeResult | null> {
  try {
    const res = await apiFetch('/api/reanalyze-track', { method: 'POST', body: JSON.stringify({ filePath: song.filePath ?? song.file }) });
    const data = await res.json() as { ok: boolean } & ReanalyzeResult;
    return data.ok ? data : null;
  } catch { return null; }
}

/**
 * Removes tracks from the library on disk. Resolves true on success.
 * Sends each track's full path too, so tracks stored under their path (Apple Music) are found
 * even when two files share a name.
 */
export async function removeTracksFromLibrary(files: string[], songsByFile?: Map<string, Song>): Promise<boolean> {
  const paths = files.map(f => songsByFile?.get(f)?.filePath).filter((p): p is string => !!p);
  try {
    const res = await apiFetch('/api/remove-tracks', { method: 'POST', body: JSON.stringify({ files: [...files, ...paths] }) });
    return res.ok;
  } catch { return false; }
}

export function exportTrackM3U(song: Song): void {
  const track: SetTrack = { ...song, slot: 0, targetEnergy: song.energy, harmonicWarning: false };
  downloadM3U([track], `${song.artist} - ${song.title}`);
}
