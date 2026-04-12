/**
 * Standard Camelot wheel color map.
 * 12 positions × 2 modes (A = minor, B = major).
 * Returns a hex color string for a given Camelot notation (e.g. "8B", "4A").
 */
const CAMELOT_COLOR_MAP: Record<string, string> = {
  '1A':  '#4a9e6b',
  '1B':  '#5cb87a',
  '2A':  '#3d8f8f',
  '2B':  '#4aa8a8',
  '3A':  '#3a7abf',
  '3B':  '#4a90d9',
  '4A':  '#5a5abf',
  '4B':  '#7070d4',
  '5A':  '#8a4abf',
  '5B':  '#a060d4',
  '6A':  '#bf4a8a',
  '6B':  '#d460a0',
  '7A':  '#bf4a4a',
  '7B':  '#d46060',
  '8A':  '#bf7a3a',
  '8B':  '#d49050',
  '9A':  '#bfa03a',
  '9B':  '#d4b850',
  '10A': '#8abf3a',
  '10B': '#a0d450',
  '11A': '#5abf5a',
  '11B': '#70d470',
  '12A': '#3abf8a',
  '12B': '#50d4a0',
};

const FALLBACK_COLOR = '#64748b';

/**
 * Returns the standard Camelot wheel hex color for a given Camelot notation.
 * Accepts values like "8B", "4A", "11B". Case-insensitive.
 * Returns a neutral gray (#64748b) for unknown or empty values.
 */
export function camelotColor(camelot: string): string {
  if (!camelot) return FALLBACK_COLOR;
  const key = camelot.trim().toUpperCase();
  return CAMELOT_COLOR_MAP[key] ?? FALLBACK_COLOR;
}
