// Pitch class: 0=C, 1=C#/Db, 2=D, 3=D#/Eb, 4=E, 5=F,
//              6=F#/Gb, 7=G, 8=G#/Ab, 9=A, 10=A#/Bb, 11=B
const KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
const CAMELOT_MAJOR = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
const CAMELOT_MINOR = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

/**
 * Convert Spotify's pitch class + mode to Camelot wheel notation and key name.
 * @param pitchClass 0–11 (Spotify `key` field; -1 means unknown)
 * @param mode 1 = major, 0 = minor
 */
export function toCamelot(pitchClass: number, mode: number): { camelot: string; keyName: string } | null {
  if (pitchClass < 0 || pitchClass > 11) return null;
  const isMajor = mode === 1;
  const camelot = isMajor ? CAMELOT_MAJOR[pitchClass] : CAMELOT_MINOR[pitchClass];
  const keyName = `${KEY_NAMES[pitchClass]} ${isMajor ? 'Major' : 'Minor'}`;
  return { camelot, keyName };
}
