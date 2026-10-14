import type { VinylStore } from '../types';

const KEY = 'djfriend-vinyl-tracks';

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
