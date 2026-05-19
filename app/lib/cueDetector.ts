import type { Song } from '../types';

export interface CuePoint {
  name: string;
  time: number; // seconds (beat-snapped)
  num: number;  // Rekordbox hot cue slot 0–7 (A–H)
}

// Slide a small average window over the waveform to smooth noise
function smooth(arr: number[], win: number): number[] {
  return arr.map((_, i) => {
    const lo = Math.max(0, i - win), hi = Math.min(arr.length - 1, i + win);
    let s = 0; for (let j = lo; j <= hi; j++) s += arr[j];
    return s / (hi - lo + 1);
  });
}

// Round a time to the nearest bar boundary (4 beats)
function snapToBar(time: number, bpm: number): number {
  if (bpm <= 0) return time;
  const barDur = (4 * 60) / bpm;
  return Math.round(time / barDur) * barDur;
}

function idx2time(idx: number, total: number, duration: number): number {
  return (idx / total) * duration;
}

/**
 * Auto-detect up to 5 musical cue points from amplitude waveform + energy profile.
 * All returned times are beat-snapped to the nearest bar boundary.
 */
export function detectCuePoints(song: Song): CuePoint[] {
  const { bpm, duration, waveform, energyProfile } = song;
  if (!duration || duration < 15) return [];

  // ── Fallback when no waveform ──────────────────────────────────────────────
  if (!waveform || waveform.length < 20) {
    const cues: CuePoint[] = [
      { name: 'Intro',  time: snapToBar(duration * 0.00, bpm), num: 0 },
      { name: 'Drop',   time: snapToBar(duration * 0.20, bpm), num: 1 },
      { name: 'Outro',  time: snapToBar(duration * 0.83, bpm), num: 2 },
    ];
    if (energyProfile && energyProfile.dropStrength > 0.15) {
      cues.splice(1, 0, { name: 'Break', time: snapToBar(duration * 0.50, bpm), num: 2 });
      cues[2].num = 3; cues[3] = { name: 'Outro', time: snapToBar(duration * 0.83, bpm), num: 3 };
    }
    return cues.slice(0, 5);
  }

  // ── Waveform-based detection ───────────────────────────────────────────────
  const n   = waveform.length;
  const sm  = smooth(waveform, 6); // ~3% window
  const t   = (i: number) => idx2time(i, n, duration);
  const bar = (i: number) => snapToBar(t(i), bpm);

  const cues: CuePoint[] = [];

  // 1. Intro end — first bar where sustained energy crosses 0.28 (in first 35%)
  let introIdx = Math.floor(n * 0.05);
  for (let i = Math.floor(n * 0.02); i < Math.floor(n * 0.35); i++) {
    if (sm[i] > 0.28) { introIdx = i; break; }
  }
  cues.push({ name: 'Intro', time: bar(introIdx), num: 0 });

  // 2. Breakdown — largest sustained energy drop in 35–75% zone
  let breakIdx = -1, maxDrop = 0.10; // require at least 0.10 drop to count
  for (let i = Math.floor(n * 0.35); i < Math.floor(n * 0.72); i++) {
    const before = sm[Math.max(0, i - 6)];
    const after  = sm[Math.min(n - 1, i + 6)];
    const drop   = before - after;
    if (drop > maxDrop && before > 0.35) { maxDrop = drop; breakIdx = i; }
  }

  if (breakIdx >= 0) {
    cues.push({ name: 'Break', time: bar(breakIdx), num: 1 });

    // 3. Drop — first sustained rise ≥ 0.45 after the breakdown
    let dropIdx = breakIdx + Math.floor(n * 0.02);
    for (let i = breakIdx + 4; i < Math.min(breakIdx + Math.floor(n * 0.30), n); i++) {
      if (sm[i] >= 0.45) { dropIdx = i; break; }
    }
    cues.push({ name: 'Drop', time: bar(dropIdx), num: 2 });
  } else {
    // No breakdown found — add a mid-track marker instead
    cues.push({ name: 'Mid', time: bar(Math.floor(n * 0.50)), num: 1 });
  }

  // 4. Second breakdown (if dropStrength is high and track is long enough)
  if (energyProfile && energyProfile.dropStrength > 0.20 && duration > 240) {
    let break2Idx = -1, maxDrop2 = 0.10;
    const searchFrom = breakIdx >= 0 ? Math.floor(n * 0.65) : Math.floor(n * 0.55);
    for (let i = searchFrom; i < Math.floor(n * 0.78); i++) {
      const before = sm[Math.max(0, i - 6)];
      const after  = sm[Math.min(n - 1, i + 6)];
      const drop   = before - after;
      if (drop > maxDrop2 && before > 0.35 && i !== breakIdx) { maxDrop2 = drop; break2Idx = i; }
    }
    if (break2Idx >= 0) cues.push({ name: 'Break 2', time: bar(break2Idx), num: cues.length });
  }

  // 5. Outro — first bar in last 18% where energy drops below 0.35 for a sustained stretch
  let outroIdx = Math.floor(n * 0.82);
  for (let i = Math.floor(n * 0.78); i < Math.floor(n * 0.92); i++) {
    if (sm[i] < 0.35) { outroIdx = i; break; }
  }
  cues.push({ name: 'Outro', time: bar(outroIdx), num: cues.length });

  // Re-number sequentially and dedupe (remove cues < 2 s apart)
  const deduped: CuePoint[] = [];
  for (const c of cues) {
    if (c.time < 0) continue;
    if (deduped.length && Math.abs(c.time - deduped[deduped.length - 1].time) < 2) continue;
    deduped.push({ ...c, num: deduped.length });
  }

  return deduped.slice(0, 8); // Rekordbox supports 8 hot cues max
}
