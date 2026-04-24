export interface BpmRange {
  min: number;
  max: number;
}

// Genre keyword → expected BPM range.
// Used both to suggest defaults in the UI and as a hint during audio analysis
// to resolve half-time / double-time detection errors on untagged tracks.
export const GENRE_BPM_RANGES: Array<{ keywords: string[]; range: BpmRange }> = [
  { keywords: ['drum and bass', 'drum & bass', 'dnb', 'd&b'],  range: { min: 160, max: 180 } },
  { keywords: ['dubstep'],                                       range: { min: 135, max: 145 } },
  { keywords: ['hard techno', 'hard dance', 'hardcore', 'psy trance', 'psytrance', 'trance'], range: { min: 130, max: 160 } },
  { keywords: ['techno'],                                        range: { min: 128, max: 150 } },
  { keywords: ['tech house'],                                    range: { min: 124, max: 134 } },
  { keywords: ['house', 'melodic house', 'progressive house', 'afro house', 'deep house', 'bass house', 'indie dance', 'organic house'], range: { min: 115, max: 135 } },
  { keywords: ['nu disco', 'disco', 'funky house'],              range: { min: 110, max: 128 } },
  { keywords: ['pop'],                                           range: { min: 100, max: 130 } },
  { keywords: ['rock'],                                          range: { min: 80,  max: 115 } },
  { keywords: ['hip hop', 'hip-hop', 'rap', 'trap'],            range: { min: 60,  max: 110 } },
  { keywords: ['r&b', 'rnb', 'soul', 'neo soul'],               range: { min: 60,  max: 100 } },
  { keywords: ['reggae', 'reggaeton', 'latin'],                  range: { min: 60,  max: 100 } },
  { keywords: ['afrobeats', 'afropop'],                          range: { min: 95,  max: 115 } },
];

/**
 * Given an array of genre strings from the library, return the most likely
 * BPM range. Returns null if no known genre keyword is found.
 */
export function suggestBpmRange(genres: string[]): BpmRange | null {
  if (genres.length === 0) return null;
  const normalized = genres.map(g => g.toLowerCase());
  for (const { keywords, range } of GENRE_BPM_RANGES) {
    if (keywords.some(kw => normalized.some(g => g.includes(kw)))) {
      return range;
    }
  }
  return null;
}

/**
 * Given a detected BPM and an expected range, attempt to correct half-time /
 * double-time errors. Returns the corrected BPM or the original if no fix applies.
 */
export function correctBpmWithRange(detected: number, range: BpmRange): number {
  if (detected >= range.min && detected <= range.max) return detected;
  const halved  = Math.round((detected / 2)  * 10) / 10;
  const doubled = Math.round((detected * 2)  * 10) / 10;
  if (halved  >= range.min && halved  <= range.max) return halved;
  if (doubled >= range.min && doubled <= range.max) return doubled;
  return detected;
}
