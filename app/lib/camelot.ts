/**
 * Camelot Wheel compatibility logic.
 * A Camelot key looks like "5B" or "11A" — a number 1–12 and a letter A or B.
 *
 * Compatible moves (MixedInKey system):
 *   perfect      — same key (8A → 8A)
 *   compatible   — ±1 same letter (7A/9A) or same number other letter (8B)
 *   energyBoost  — ±1 with letter switch / diagonal (7B, 9B from 8A)
 *                  Creates a perfect-fifth energy shift; use for intentional lifts
 *   incompatible — everything else
 */

export type CamelotCompatibility = 'perfect' | 'compatible' | 'energyBoost' | 'incompatible';

export function parseCamelot(camelot: string): { num: number; letter: 'A' | 'B' } | null {
  const match = camelot.trim().match(/^(\d{1,2})([AaBb])$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const letter = match[2].toUpperCase() as 'A' | 'B';
  if (num < 1 || num > 12) return null;
  return { num, letter };
}

export function getCamelotCompatibility(
  from: string,
  to: string,
): CamelotCompatibility {
  const a = parseCamelot(from);
  const b = parseCamelot(to);

  if (!a || !b) return 'incompatible';

  const sameNum = a.num === b.num;
  const sameLetter = a.letter === b.letter;
  const diff = Math.abs(a.num - b.num);
  const wrappedDiff = Math.min(diff, 12 - diff);

  // Perfect: identical key
  if (sameNum && sameLetter) return 'perfect';

  // Compatible: ±1 same letter (smooth energy flow)
  if (sameLetter && wrappedDiff === 1) return 'compatible';

  // Compatible: same number, other letter (relative major/minor swap)
  if (sameNum && !sameLetter) return 'compatible';

  // Energy boost: ±1 with letter switch (diagonal — perfect fifth relationship)
  // Clockwise (+1) lifts energy; counterclockwise (-1) softens it.
  if (!sameLetter && wrappedDiff === 1) return 'energyBoost';

  return 'incompatible';
}

/**
 * Returns a numeric harmony score for the transition.
 *   perfect / compatible → 1.0
 *   energyBoost         → 0.75  (valid but adds tension)
 *   incompatible        → 0.0
 */
export function camelotHarmonyScore(from: string, to: string): number {
  switch (getCamelotCompatibility(from, to)) {
    case 'perfect':      return 1.0;
    case 'compatible':   return 1.0;
    case 'energyBoost':  return 0.75;
    case 'incompatible': return 0.0;
  }
}

/** Only flag as a warning when there is zero harmonic relationship. */
export function isHarmonicWarning(from: string, to: string): boolean {
  return getCamelotCompatibility(from, to) === 'incompatible';
}
