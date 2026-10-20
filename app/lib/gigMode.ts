// Gig mode and "What can I play next?" for the phone app. Pure.
import { camelotHarmonyScore, getCamelotCompatibility, getTransitionLabel } from './camelot';
import type { SyncSet } from './sync/records';

/** The track fields gig mode and next-track suggestions use. */
export interface GigTrack { id: string; artist: string; title: string; bpm: number; camelot: string; energy: number }

/** Where the plan continues: the first planned track after the last played one that was in the plan. */
export function nextPlanIndex(plan: string[], played: string[]): number {
  for (let i = played.length - 1; i >= 0; i--) {
    const at = plan.lastIndexOf(played[i]);
    if (at >= 0) {
      // Skip planned tracks that were already played out of order
      let next = at + 1;
      while (next < plan.length && played.includes(plan[next])) next++;
      return next;
    }
  }
  let first = 0;
  while (first < plan.length && played.includes(plan[first])) first++;
  return first;
}

/** Signed tempo change in percent (from → to); 0 when either BPM is unknown. */
export function bpmShift(from: number, to: number): number {
  if (!(from > 0) || !(to > 0)) return 0;
  return Math.round(((to - from) / from) * 1000) / 10;
}

/** A short mixing tip for a transition, e.g. "Forward +1 (8A→9A) · +1.6% tempo · energy up". */
export function transitionTip(from: GigTrack, to: GigTrack): string {
  const parts: string[] = [];
  if (from.camelot && to.camelot) parts.push(getTransitionLabel(from.camelot, to.camelot));
  const shift = bpmShift(from.bpm, to.bpm);
  if (from.bpm > 0 && to.bpm > 0) parts.push(shift === 0 ? 'same tempo' : `${shift > 0 ? '+' : ''}${shift}% tempo`);
  const de = to.energy - from.energy;
  if (Math.abs(de) >= 0.1) parts.push(de > 0 ? 'energy up' : 'energy down');
  return parts.join(' · ');
}

/** The live set log as a synced set: the played tracks in order. */
export function liveLog(name: string, startedAt: number, played: GigTrack[]): SyncSet {
  return {
    name, timestamp: startedAt,
    tracks: played.map(t => ({ file: t.id, artist: t.artist, title: t.title, bpm: t.bpm, camelot: t.camelot, energy: t.energy })),
  };
}

export interface NextSuggestion<T extends GigTrack> { track: T; score: number; tip: string }

export interface NextOptions {
  /** Ids to leave out (already played, the current track). */
  exclude?: ReadonlySet<string>;
  /** Energy to aim for (default: the current track's). */
  targetEnergy?: number;
  limit?: number;
}

/**
 * Best tracks to play after `current`: harmonic fit first, then tempo (within ±8 %), then energy.
 * Tracks in an incompatible key, or more than 8 % off in tempo, are left out.
 * Same scale as the set generator: harmony 1.0 for same/±1/relative, less for boosts.
 */
export function suggestNext<T extends GigTrack>(current: GigTrack, library: T[], opts: NextOptions = {}): NextSuggestion<T>[] {
  const target = opts.targetEnergy ?? current.energy;
  const out: NextSuggestion<T>[] = [];
  for (const t of library) {
    if (t.id === current.id || opts.exclude?.has(t.id)) continue;
    let harmonic = 0.5;   // unknown key on either side: neutral, never top-ranked by key
    if (current.camelot && t.camelot) {
      if (getCamelotCompatibility(current.camelot, t.camelot) === 'incompatible') continue;
      harmonic = camelotHarmonyScore(current.camelot, t.camelot);
    }
    let tempo = 0.5;
    if (current.bpm > 0 && t.bpm > 0) {
      const pct = Math.abs(bpmShift(current.bpm, t.bpm));
      if (pct > 8) continue;
      tempo = 1 - pct / 8;
    }
    const energy = 1 - Math.min(1, Math.abs(t.energy - target) / 0.4);
    const score = Math.round((harmonic * 0.5 + tempo * 0.3 + energy * 0.2) * 1000) / 1000;
    out.push({ track: t, score, tip: transitionTip(current, t) });
  }
  out.sort((a, b) => b.score - a.score || a.track.artist.localeCompare(b.track.artist) || a.track.title.localeCompare(b.track.title));
  return out.slice(0, opts.limit ?? 30);
}
