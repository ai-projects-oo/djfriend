import type { VinylReleaseData, VinylTrackEntry } from '../types';

const KEY = 'djfriend-vinyl-tracks';

export type VinylStore = Record<number, VinylReleaseData>;

export function loadVinylStore(): VinylStore {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as VinylStore) : {};
  } catch {
    return {};
  }
}

export function saveVinylStore(store: VinylStore): void {
  localStorage.setItem(KEY, JSON.stringify(store));
}

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
