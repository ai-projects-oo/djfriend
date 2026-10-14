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

export interface AiTrackResult {
  position: string;
  title: string;
  bpm?: number;
  camelot?: string;
  genre?: string;
}

const sameTitle = (a?: string, b?: string) =>
  !!a?.trim() && !!b?.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Merges per-track AI results into the stored tracks. A stored track is matched by title first;
 * a position match is used only when that position is unique on both sides (old auto-imports
 * gave many tracks the same position, which would copy one track's values onto all of them).
 * Only empty fields are filled, and each filled field is recorded in `aiFields`.
 * With `addMissing`, AI results that match no stored track are appended as new tracks.
 */
export function mergeAiTracks(
  stored: VinylTrackEntry[],
  ai: AiTrackResult[],
  opts: { releaseId: number; addMissing: boolean },
): VinylTrackEntry[] {
  const count = <T,>(items: T[], pos: (t: T) => string | undefined) => {
    const m = new Map<string, number>();
    for (const t of items) { const p = pos(t); if (p) m.set(p, (m.get(p) ?? 0) + 1); }
    return m;
  };
  const storedPos = count(stored, t => t.position);
  const aiPos = count(ai, t => t.position);
  const used = new Set<AiTrackResult>();

  const find = (t: VinylTrackEntry): AiTrackResult | undefined =>
    ai.find(a => !used.has(a) && sameTitle(a.title, t.title)) ??
    (t.position && storedPos.get(t.position) === 1 && aiPos.get(t.position) === 1
      ? ai.find(a => !used.has(a) && a.position === t.position)
      : undefined);

  const merged = stored.map(t => {
    const hit = find(t);
    if (!hit) return t;
    used.add(hit);
    const filled: Array<'bpm' | 'camelot' | 'genre'> = [];
    const next: VinylTrackEntry = { ...t };
    if (t.bpm == null && hit.bpm) { next.bpm = hit.bpm; filled.push('bpm'); }
    if (!t.camelot && hit.camelot) { next.camelot = hit.camelot; filled.push('camelot'); }
    if (!t.genre && hit.genre) { next.genre = hit.genre; filled.push('genre'); }
    if (filled.length > 0) next.aiFields = [...new Set([...(t.aiFields ?? []), ...filled])];
    return next;
  });

  if (!opts.addMissing) return merged;
  const added = ai
    .filter(a => !used.has(a) && a.title?.trim())
    .map((a, i): VinylTrackEntry => {
      const aiFields = (['bpm', 'camelot', 'genre'] as const).filter(f => a[f]);
      return {
        id: `${opts.releaseId}-${a.position || 'x'}-${merged.length + i}-ai`,
        position: a.position || `A${merged.length + i + 1}`,
        title: a.title,
        ...(a.bpm ? { bpm: a.bpm } : {}),
        ...(a.camelot ? { camelot: a.camelot } : {}),
        ...(a.genre ? { genre: a.genre } : {}),
        ...(aiFields.length > 0 ? { aiFields } : {}),
      };
    });
  return [...merged, ...added];
}

/**
 * Removes AI-filled values from a track, keeping anything entered by hand.
 * Tracks from before `aiFields` existed lose only their BPM (the previous behaviour).
 */
export function clearAiFields(t: VinylTrackEntry): VinylTrackEntry {
  const fields = t.aiFields ?? ['bpm'];
  const next: VinylTrackEntry = { ...t };
  for (const f of fields) delete next[f];
  delete next.aiFields;
  return next;
}
