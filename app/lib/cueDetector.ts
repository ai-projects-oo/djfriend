import type { Song } from '../types';

export interface CuePoint {
  name: string;
  time: number; // seconds (bar-snapped)
  num: number;  // Rekordbox hot cue slot 0–7 (A–H)
}

function smooth(arr: number[], win: number): number[] {
  return arr.map((_, i) => {
    const lo = Math.max(0, i - win), hi = Math.min(arr.length - 1, i + win);
    let s = 0; for (let j = lo; j <= hi; j++) s += arr[j];
    return s / (hi - lo + 1);
  });
}

function snapToBar(time: number, bpm: number): number {
  if (bpm <= 0) return Math.round(time * 10) / 10;
  const barDur = (4 * 60) / bpm;
  return Math.round(time / barDur) * barDur;
}

function idx2time(idx: number, total: number, duration: number): number {
  return (idx / total) * duration;
}

function bar(idx: number, n: number, duration: number, bpm: number): number {
  return snapToBar(idx2time(idx, n, duration), bpm);
}

/**
 * Detect up to 8 hot cue points (A–H) from waveform + energy profile.
 * Covers the full structural anatomy of an electronic track:
 *   A Mix-in  · B Intro end  · C Buildup  · D Break
 *   E Drop    · F Body       · G 2nd break · H Outro
 */
export function detectCuePoints(song: Song): CuePoint[] {
  const { bpm, duration, waveform, energyProfile } = song;
  if (!duration || duration < 15) return [];

  const barDur = bpm > 0 ? (4 * 60) / bpm : 8;

  // ── Fallback: no waveform ──────────────────────────────────────────────────
  if (!waveform || waveform.length < 20) {
    const s = (ratio: number) => snapToBar(duration * ratio, bpm);
    const hasBreak = energyProfile && energyProfile.dropStrength > 0.12;
    return [
      { name: 'Mix-in',   time: 0,          num: 0 },
      { name: 'Intro',    time: s(0.12),     num: 1 },
      { name: 'Buildup',  time: s(hasBreak ? 0.35 : 0.25), num: 2 },
      { name: 'Break',    time: s(hasBreak ? 0.45 : 0.40), num: 3 },
      { name: 'Drop',     time: s(hasBreak ? 0.55 : 0.50), num: 4 },
      { name: 'Body',     time: s(0.62),     num: 5 },
      { name: '2nd Break',time: s(0.75),     num: 6 },
      { name: 'Outro',    time: s(0.83),     num: 7 },
    ];
  }

  // ── Waveform analysis ──────────────────────────────────────────────────────
  const n  = waveform.length;
  const sm = smooth(waveform, 6);
  const b  = (i: number) => bar(i, n, duration, bpm);

  // ── A: Mix-in — always bar 0 ──────────────────────────────────────────────
  const mixIn = 0;

  // ── B: Intro end — first bar where energy locks in above 0.28 ────────────
  let introIdx = Math.floor(n * 0.08);
  for (let i = Math.floor(n * 0.02); i < Math.floor(n * 0.35); i++) {
    if (sm[i] > 0.28) { introIdx = i; break; }
  }

  // ── D: Breakdown — largest sustained drop in 35–75% zone ─────────────────
  let breakIdx = -1, maxDrop = 0.08;
  for (let i = Math.floor(n * 0.35); i < Math.floor(n * 0.75); i++) {
    const before = sm[Math.max(0, i - 8)];
    const after  = sm[Math.min(n - 1, i + 8)];
    const drop   = before - after;
    if (drop > maxDrop && before > 0.30) { maxDrop = drop; breakIdx = i; }
  }
  // If no breakdown found, use 48% mark
  if (breakIdx < 0) breakIdx = Math.floor(n * 0.48);

  // ── C: Buildup — sustained rise ≥ 1.5 bars before the breakdown ──────────
  // Walk back from breakdown to find where energy starts its climb
  const buildupFrames = Math.max(4, Math.round((barDur * 1.5) / duration * n));
  let buildupIdx = Math.max(introIdx + 4, breakIdx - buildupFrames);
  for (let i = breakIdx - 4; i > introIdx; i--) {
    if (sm[i] < sm[breakIdx - 2] * 0.75) { buildupIdx = i; break; }
  }

  // ── E: Drop — first sustained rise ≥ 0.42 after breakdown ────────────────
  let dropIdx = breakIdx + Math.floor(n * 0.02);
  for (let i = breakIdx + 3; i < Math.min(breakIdx + Math.floor(n * 0.35), n); i++) {
    if (sm[i] >= 0.42) { dropIdx = i; break; }
  }

  // ── F: Body — 2 bars after drop (groove locked in) ───────────────────────
  const twoBarsFrames = Math.round((barDur * 2) / duration * n);
  const bodyIdx = Math.min(n - 1, dropIdx + twoBarsFrames);

  // ── G: Second break — largest drop in 68–82% zone (excluding first break) ─
  let break2Idx = -1, maxDrop2 = 0.08;
  const searchFrom2 = Math.max(dropIdx + Math.floor(n * 0.05), Math.floor(n * 0.60));
  for (let i = searchFrom2; i < Math.floor(n * 0.82); i++) {
    if (Math.abs(i - breakIdx) < Math.floor(n * 0.08)) continue; // too close to first break
    const before = sm[Math.max(0, i - 8)];
    const after  = sm[Math.min(n - 1, i + 8)];
    const drop   = before - after;
    if (drop > maxDrop2 && before > 0.28) { maxDrop2 = drop; break2Idx = i; }
  }
  // Fallback: use 75% mark if no second break found
  if (break2Idx < 0) break2Idx = Math.floor(n * 0.75);

  // ── H: Outro — first bar in 78–92% where energy drops below 0.35 ─────────
  let outroIdx = Math.floor(n * 0.83);
  for (let i = Math.floor(n * 0.78); i < Math.floor(n * 0.92); i++) {
    if (sm[i] < 0.35) { outroIdx = i; break; }
  }

  // ── Assemble, dedupe (< 1.5 bars apart → drop the later one) ─────────────
  const minGap = barDur * 1.5;
  const raw: CuePoint[] = [
    { name: 'Mix-in',    time: mixIn,         num: 0 },
    { name: 'Intro',     time: b(introIdx),   num: 1 },
    { name: 'Buildup',   time: b(buildupIdx), num: 2 },
    { name: 'Break',     time: b(breakIdx),   num: 3 },
    { name: 'Drop',      time: b(dropIdx),    num: 4 },
    { name: 'Body',      time: b(bodyIdx),    num: 5 },
    { name: '2nd Break', time: b(break2Idx),  num: 6 },
    { name: 'Outro',     time: b(outroIdx),   num: 7 },
  ];

  const out: CuePoint[] = [];
  for (const c of raw) {
    if (c.time < 0 || c.time > duration) continue;
    if (out.length && c.time - out[out.length - 1].time < minGap) continue;
    out.push({ ...c, num: out.length });
  }

  return out; // up to 8 slots, already numbered 0–7
}
