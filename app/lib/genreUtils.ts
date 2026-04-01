import type { Song, DJPreferences, TagFilters } from "../types";

// ─── Beatport umbrella genres ──────────────────────────────────────────────────

export interface BeatportUmbrella {
  label: string;    // Display name (e.g. "Melodic House & Techno")
  phrases: string[]; // Lowercase match phrases (any match → belongs to umbrella)
}

export const BEATPORT_UMBRELLAS: BeatportUmbrella[] = [
  { label: 'Afro House',              phrases: ['afro house'] },
  { label: 'Amapiano',                phrases: ['amapiano'] },
  { label: 'Ambient / Experimental',  phrases: ['ambient', 'experimental'] },
  { label: 'Bass House',              phrases: ['bass house'] },
  { label: 'Breaks / Breakbeat',      phrases: ['breaks', 'breakbeat'] },
  { label: 'Deep House',              phrases: ['deep house'] },
  { label: 'Downtempo',               phrases: ['downtempo', 'chill out', 'chillout'] },
  { label: 'Drum & Bass',             phrases: ['drum & bass', 'drum and bass', 'dnb', 'd&b'] },
  { label: 'Dubstep',                 phrases: ['dubstep'] },
  { label: 'Electro',                 phrases: ['electro'] },
  { label: 'Electronica',             phrases: ['electronica'] },
  { label: 'Funky House',             phrases: ['funky house'] },
  { label: 'Hard Dance / Hardcore',   phrases: ['hard dance', 'hardcore'] },
  { label: 'Hard Techno',             phrases: ['hard techno'] },
  { label: 'House',                   phrases: ['house'] },
  { label: 'Indie Dance',             phrases: ['indie dance'] },
  { label: 'Jackin House',            phrases: ['jackin house'] },
  { label: 'Melodic House & Techno',  phrases: ['melodic house', 'melodic techno'] },
  { label: 'Minimal / Deep Tech',     phrases: ['minimal', 'deep tech'] },
  { label: 'Nu Disco / Disco',        phrases: ['nu disco', 'disco'] },
  { label: 'Organic House',           phrases: ['organic house'] },
  { label: 'Progressive House',       phrases: ['progressive house'] },
  { label: 'Psy-Trance',              phrases: ['psy trance', 'psytrance', 'psychedelic trance'] },
  { label: 'Tech House',              phrases: ['tech house'] },
  { label: 'Techno',                  phrases: ['techno'] },
  { label: 'Trance',                  phrases: ['trance'] },
  { label: 'Trap / Future Bass',      phrases: ['trap', 'future bass'] },
  { label: 'UK Garage / Bassline',    phrases: ['uk garage', 'bassline'] },
  { label: 'Grime',                   phrases: ['grime'] },
  { label: 'Hip-Hop',                 phrases: ['hip hop', 'hip-hop', 'rap'] },
  { label: 'Pop',                     phrases: ['pop'] },
  { label: 'R&B',                     phrases: ['r&b', 'rnb', 'soul', 'neo soul', 'neo-soul'] },
  { label: 'Rock',                    phrases: ['rock'] },
  { label: 'Latin',                   phrases: ['latin', 'reggaeton', 'salsa', 'cumbia'] },
  { label: 'Country',                 phrases: ['country'] },
  { label: 'Afrobeats',               phrases: ['afrobeats', 'afropop', 'afro pop'] },
];

// All match phrases across all Beatport umbrellas (used for "most specific wins" logic)
const ALL_BEATPORT_PHRASES = BEATPORT_UMBRELLAS.flatMap(u => u.phrases);

// Check if a user genre string matches a selected umbrella genre value (e.g. "~Tech House").
// A genre only counts as matching if it does NOT also match any other Beatport umbrella —
// e.g. "disco house" matches both "House" and "Nu Disco / Disco", so it belongs to neither.
export function genreMatchesUmbrella(genreStr: string, selectedGenre: string): boolean {
  if (!selectedGenre.startsWith('~')) return false;
  const label = selectedGenre.slice(1);
  const umbrella = BEATPORT_UMBRELLAS.find(u => u.label === label);
  if (umbrella) {
    const matchesSelected = umbrella.phrases.some(
      phrase => matchesUmbrella(genreStr, `~${phrase}`, ALL_BEATPORT_PHRASES)
    );
    if (!matchesSelected) return false;
    // Exclude genres that also match a different umbrella (ambiguous genres belong to none)
    const matchesOther = BEATPORT_UMBRELLAS.some(u =>
      u.label !== label &&
      u.phrases.some(phrase => matchesUmbrella(genreStr, `~${phrase}`, ALL_BEATPORT_PHRASES))
    );
    return !matchesOther;
  }
  // Fallback: single-phrase legacy umbrella
  return matchesUmbrella(genreStr, selectedGenre, ALL_BEATPORT_PHRASES);
}

export const TAG_GROUPS: { key: keyof TagFilters; label: string; color: { inactiveBorder: string; inactiveText: string; activeBg: string; activeBorder: string } }[] = [
  { key: 'vibeTags',        label: 'Vibe',   color: { inactiveBorder: '#7c2d12', inactiveText: '#fb923c', activeBg: '#c2410c', activeBorder: '#f97316' } },
  { key: 'moodTags',        label: 'Mood',   color: { inactiveBorder: '#1e3a8a', inactiveText: '#60a5fa', activeBg: '#1d4ed8', activeBorder: '#3b82f6' } },
  { key: 'venueTags',       label: 'Venue',  color: { inactiveBorder: '#064e3b', inactiveText: '#34d399', activeBg: '#065f46', activeBorder: '#10b981' } },
  { key: 'timeOfNightTags', label: 'Time',   color: { inactiveBorder: '#78350f', inactiveText: '#fbbf24', activeBg: '#92400e', activeBorder: '#f59e0b' } },
  { key: 'vocalTypes',      label: 'Vocal',  color: { inactiveBorder: '#881337', inactiveText: '#fb7185', activeBg: '#9f1239', activeBorder: '#f43f5e' } },
];

export const DEFAULT_PREFS: DJPreferences = {
  setDuration: 60,
  venueType: "Club",
  setPhase: "Peak time",
  genre: "Any",
  tagFilters: { vibeTags: [], moodTags: [], vocalTypes: [], venueTags: [], timeOfNightTags: [] },
};

export function isValidSong(obj: unknown): obj is Song {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o["file"] === "string" &&
    typeof o["artist"] === "string" &&
    typeof o["title"] === "string" &&
    typeof o["bpm"] === "number" &&
    typeof o["key"] === "string" &&
    typeof o["camelot"] === "string" &&
    typeof o["energy"] === "number" &&
    Array.isArray(o["genres"])
  );
}

export function parseSongs(raw: unknown): Song[] | null {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null
      ? Object.values(raw as Record<string, unknown>)
      : null;
  if (!source) return null;
  const valid = source.filter(isValidSong);
  return valid.length > 0 ? valid : null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function tokenizeGenre(g: string): string[] {
  return g.toLowerCase().split(/[\s/,-]+/).filter(Boolean);
}

// Umbrella group tags are stored as "~<phrase>", e.g. "~house", "~indie dance"
// allUmbrellas: list of all known umbrella phrases (without "~"). When provided,
// a genre is excluded from a broader umbrella if it already belongs to a more
// specific (longer) umbrella — e.g. "tech house" won't match "~house" when
// "tech house" is itself an umbrella.
export function matchesUmbrella(genreStr: string, umbrella: string, allUmbrellas?: string[]): boolean {
  const phrase = umbrella.slice(1).split(' ');
  const words = tokenizeGenre(genreStr);
  let found = false;
  for (let i = 0; i <= words.length - phrase.length; i++) {
    if (phrase.every((w, j) => words[i + j] === w)) { found = true; break; }
  }
  if (!found) return false;

  // If a longer (more specific) umbrella also matches this genre, defer to it.
  if (allUmbrellas) {
    const phraseStr = umbrella.slice(1);
    for (const other of allUmbrellas) {
      if (other === phraseStr || other.split(' ').length <= phraseStr.split(' ').length) continue;
      const otherWords = other.split(' ');
      for (let i = 0; i <= words.length - otherWords.length; i++) {
        if (otherWords.every((w, j) => words[i + j] === w)) return false;
      }
    }
  }
  return true;
}

export function matchesGenrePref(song: Song, genre: string): boolean {
  if (genre === "Any") return true;
  if (genre.startsWith("~")) {
    const label = genre.slice(1);
    const umbrella = BEATPORT_UMBRELLAS.find(u => u.label === label);
    if (umbrella) {
      return umbrella.phrases.some(phrase =>
        song.genres.some(g => matchesUmbrella(g, `~${phrase}`, ALL_BEATPORT_PHRASES))
      );
    }
    // Fallback: single-phrase legacy umbrella
    return song.genres.some(g => matchesUmbrella(g, genre, ALL_BEATPORT_PHRASES));
  }
  const needle = genre.toLowerCase();
  return song.genres.some((g) => {
    const gl = g.toLowerCase();
    return gl.includes(needle) || needle.includes(gl);
  });
}
