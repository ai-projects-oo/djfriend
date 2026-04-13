import type { HistoryEntry, PlayStats } from '../types';

/**
 * Compute play statistics for a single song from the full set history.
 * Pure function — no side effects, no localStorage access.
 */
export function computePlayStats(history: HistoryEntry[], songFile: string): PlayStats {
  const appearances: Array<{ timestamp: number; slotFraction: number; venueType: string }> = [];

  for (const entry of history) {
    const trackIndex = entry.tracks.findIndex(t => t.file === songFile);
    if (trackIndex === -1) continue;
    const slotFraction = entry.tracks.length > 1 ? trackIndex / (entry.tracks.length - 1) : 0.5;
    appearances.push({
      timestamp: entry.timestamp,
      slotFraction,
      venueType: entry.prefs.venueType,
    });
  }

  if (appearances.length === 0) {
    return { playCount: 0, lastPlayed: '', avgSetPosition: 0.5, setTypes: [] };
  }

  const latest = appearances.reduce((max, a) => a.timestamp > max ? a.timestamp : max, 0);
  const avgSetPosition = appearances.reduce((sum, a) => sum + a.slotFraction, 0) / appearances.length;
  const setTypes = [...new Set(appearances.map(a => a.venueType))];

  return {
    playCount:      appearances.length,
    lastPlayed:     new Date(latest * 1000).toISOString().slice(0, 10),
    avgSetPosition,
    setTypes,
  };
}

/**
 * Familiarity score: sigmoid-like curve mapping play count to a 0–1 multiplier.
 *
 *   0 plays  → 0.50  (neutral — don't penalise fresh tracks)
 *   1–2 plays → rising toward 1.0
 *   3–6 plays → ~1.00 (sweet spot — DJ knows the track well)
 *   7–9 plays → declining toward 0.50
 *   10+ plays → 0.30  (slight penalty — avoid over-playing)
 */
export function familiarityScore(playCount: number): number {
  if (playCount === 0) return 0.5;
  if (playCount >= 10) return 0.3;

  // Piecewise linear: rise 0→3 plays (0.5→1.0), hold 3→6 (1.0), fall 6→10 (1.0→0.3)
  if (playCount <= 3) return 0.5 + (playCount / 3) * 0.5;
  if (playCount <= 6) return 1.0;
  return 1.0 - ((playCount - 6) / 4) * 0.7;
}
