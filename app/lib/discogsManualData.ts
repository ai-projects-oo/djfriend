export interface ManualData {
  bpm?:         number;
  camelot?:     string;
  comment?:     string;
  matchedFile?: string;
}

export const MANUAL_STORAGE_KEY   = 'djfriend-crates-manual';
export const REJECTED_STORAGE_KEY = 'djfriend-crates-rejected';

export function loadManualData(): Map<number, ManualData> {
  try {
    const raw = localStorage.getItem(MANUAL_STORAGE_KEY);
    if (!raw) return new Map();
    return new Map(JSON.parse(raw) as [number, ManualData][]);
  } catch { return new Map(); }
}

export function saveManualData(map: Map<number, ManualData>): void {
  localStorage.setItem(MANUAL_STORAGE_KEY, JSON.stringify([...map]));
}

export function loadRejected(): Set<number> {
  try {
    const raw = localStorage.getItem(REJECTED_STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch { return new Set(); }
}

export function saveRejected(s: Set<number>): void {
  localStorage.setItem(REJECTED_STORAGE_KEY, JSON.stringify([...s]));
}
