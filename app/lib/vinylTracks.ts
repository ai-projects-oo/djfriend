import type { VinylTrackEntry } from '../types';

/** Auto-suggest the next position given existing tracks */
export function nextPosition(tracks: VinylTrackEntry[]): string {
  if (tracks.length === 0) return 'A1';
  const last = tracks[tracks.length - 1].position;
  const m = last.match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return 'A1';
  const side = m[1].toUpperCase();
  const num  = parseInt(m[2], 10);
  return `${side}${num + 1}`;
}
