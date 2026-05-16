import type { SetTrack, DJPreferences, CrateGap } from '../types';
import { parseCamelot } from './camelot';

function getCompatibleKeys(camelot: string): string[] {
  const parsed = parseCamelot(camelot);
  if (!parsed) return [];
  const { num, letter } = parsed;
  const other = letter === 'A' ? 'B' : 'A';
  const prev = num === 1 ? 12 : num - 1;
  const next = num === 12 ? 1 : num + 1;
  return [
    `${num}${letter}`,   // perfect
    `${num}${other}`,    // relative major/minor
    `${prev}${letter}`,  // compatible −1
    `${next}${letter}`,  // compatible +1
    `${prev}${other}`,   // energy boost
    `${next}${other}`,   // energy boost
  ];
}

export function findCrateGaps(set: SetTrack[], prefs: DJPreferences): CrateGap[] {
  if (set.length === 0) return [];
  const gaps: CrateGap[] = [];
  const genre = prefs.genres[0] ?? '';

  for (let i = 0; i < set.length; i++) {
    const track = set[i];
    if (!track.harmonicWarning && Math.abs(track.energy - track.targetEnergy) <= 0.15) continue;

    const prevTrack = i > 0 ? set[i - 1] : null;
    const camelotNeeded = prevTrack ? getCompatibleKeys(prevTrack.camelot) : [];

    const bpmCenter = track.bpm;
    const bpmMin = Math.round(Math.max(prefs.bpmMin ?? 0, bpmCenter - 5));
    const bpmMax = Math.round(Math.min(prefs.bpmMax ?? 999, bpmCenter + 5));

    const energyLabel = track.targetEnergy >= 0.7
      ? `energy ${track.targetEnergy.toFixed(1)}+`
      : `energy ~${track.targetEnergy.toFixed(1)}`;

    const keyStr = camelotNeeded.slice(0, 4).join(' ');
    const genrePart = genre ? `${genre} ` : '';
    const suggestedSearch = `${genrePart}${bpmMin}–${bpmMax} BPM${keyStr ? ` ${keyStr}` : ''} ${energyLabel}`.trim();

    gaps.push({
      setPosition: set.length > 1 ? i / (set.length - 1) : 0,
      targetEnergy: track.targetEnergy,
      camelotNeeded,
      bpmRange: { min: bpmMin, max: bpmMax },
      suggestedSearch,
    });
  }

  return gaps;
}
