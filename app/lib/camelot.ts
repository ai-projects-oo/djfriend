/**
 * Camelot Wheel compatibility logic.
 * A Camelot key looks like "5B" or "11A" — a number 1–12 and a letter A or B.
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

  // Perfect match: identical key
  if (sameNum && sameLetter) return 'perfect';

  // Energy boost: same number, different letter (relative major/minor swap)
  if (sameNum && !sameLetter) return 'energyBoost';

  // Compatible: ±1 position on the wheel, same letter
  if (sameLetter) {
    const diff = Math.abs(a.num - b.num);
    // Wrap-around: 12 and 1 are adjacent
    const wrappedDiff = Math.min(diff, 12 - diff);
    if (wrappedDiff === 1) return 'compatible';
  }

  return 'incompatible';
}

/**
 * Returns a numeric harmony score for the transition.
 * perfect/compatible → 1.0
 * energyBoost → 0.5
 * incompatible → 0.0
 */
export function camelotHarmonyScore(from: string, to: string): number {
  const compat = getCamelotCompatibility(from, to);
  switch (compat) {
    case 'perfect':
      return 1.0;
    case 'compatible':
      return 1.0;
    case 'energyBoost':
      return 0.5;
    case 'incompatible':
      return 0.0;
  }
}

export function isHarmonicWarning(from: string, to: string): boolean {
  return getCamelotCompatibility(from, to) === 'incompatible';
}
