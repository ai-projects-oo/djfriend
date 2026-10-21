import type { Song } from '../types';

export function parsePlaylistId(input: string): string | null {
  const urlMatch = input.match(/playlist\/([A-Za-z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[A-Za-z0-9]{22}$/.test(input.trim())) return input.trim();
  return null;
}

export interface SpotifyUserPlaylist {
  id: string;
  name: string;
  trackCount: number;
  imageUrl: string | null;
}

export interface SpotifyImportTrack {
  spotifyId: string;
  title: string;
  artist: string;
  unavailable?: boolean;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Library tracks can carry a wrong Spotify match or a "4A - 5 - " key/energy filename prefix,
// so compare against every plausible (title, artist) pair rather than just spotifyTitle.
function songCandidates(s: Song): Array<{ title: string; artist: string }> {
  const stripPrefix = (t: string) => t.replace(/^\s*\d{1,2}[ab]\s*-\s*\d{1,2}\s*-\s*/i, '');
  const raw = [
    { title: s.spotifyTitle ?? s.title, artist: s.spotifyArtist ?? s.artist },
    { title: s.title, artist: s.artist },
    { title: stripPrefix(s.title), artist: s.artist },
  ];
  const seen = new Set<string>();
  const out: Array<{ title: string; artist: string }> = [];
  for (const c of raw) {
    const t = norm(c.title), a = norm(c.artist);
    const key = `${t}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: t, artist: a });
  }
  return out;
}

export function findSongsForImport(tracks: import('../types').ImportTrack[], library: Song[]): Song[] {
  const seen = new Set<string>();
  return tracks
    .filter(t => t.inLibrary && !t.unavailable)
    .reduce<Song[]>((acc, t) => {
      const nTitle = norm(t.title);
      const nArtist = norm(t.artist);
      const found = library.find(s => {
        if (s.spotifyId === t.spotifyId) return true;
        return songCandidates(s).some(c => {
          if (!artistOk(c.artist, nArtist)) return false;
          // Non-Latin titles norm to ""; only use strict equality in that case
          if (!nTitle || !c.title) return c.title === nTitle;
          return titlesMatch(c.title, nTitle) !== false;
        });
      });
      if (found && !seen.has(found.file)) {
        seen.add(found.file);
        acc.push(found);
      }
      return acc;
    }, []);
}

// Returns 'exact' (clean match), 'stripped' (needed parenthetical stripping), or false
function titlesMatch(a: string, b: string): 'exact' | 'stripped' | false {
  // Empty strings (non-Latin titles that norm to "") must not match anything
  if (!a || !b) return a === b ? 'exact' : false;
  if (a === b) return 'exact';
  // One is a leading substring of the other (handles " (Dub Mix)" suffix on one side)
  if (b.startsWith(a) || a.startsWith(b)) return 'stripped';
  // Strip trailing parenthetical and compare again
  const strip = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const as = strip(a), bs = strip(b);
  if (as.length > 2 && (as === bs || bs.startsWith(as) || as.startsWith(bs))) return 'stripped';
  return false;
}

const ARTIST_JOINERS = new Set(['vs', 'v', 'x', 'and', 'feat', 'ft', 'featuring', 'with', 'pres', 'presents']);

// Guard against empty normalized artist matching everything via includes("")
function artistOk(sArtist: string, nArtist: string): boolean {
  if (!sArtist || !nArtist) return sArtist === nArtist;
  if (sArtist === nArtist || sArtist.includes(nArtist) || nArtist.includes(sArtist)) return true;
  // "Tiga, Audion" vs "Tiga VS Audion": compare name tokens, ignoring joiners
  const toks = (a: string) => a.split(' ').filter(t => t && !ARTIST_JOINERS.has(t));
  const st = toks(sArtist), nt = toks(nArtist);
  if (st.length === 0 || nt.length === 0) return false;
  const [small, big] = st.length <= nt.length ? [st, nt] : [nt, st];
  return small.every(t => big.includes(t));
}

export function findPartialMatchSong(spotifyId: string, title: string, artist: string, library: Song[]): Song | null {
  if (library.some((s) => s.spotifyId === spotifyId)) return null; // exact — not a partial
  const nTitle = norm(title);
  const nArtist = norm(artist);
  if (!nTitle || !nArtist) return null; // non-Latin search term — skip fuzzy matching
  for (const s of library) {
    if (songCandidates(s).some(c => artistOk(c.artist, nArtist) && titlesMatch(c.title, nTitle) === 'stripped')) return s;
  }
  return null;
}

export function matchInLibrary(spotifyId: string, title: string, artist: string, library: Song[]): 'exact' | 'fuzzy' | 'partial' | false {
  if (library.some((s) => s.spotifyId === spotifyId)) return 'exact';
  const nTitle = norm(title);
  const nArtist = norm(artist);
  if (!nTitle || !nArtist) return false; // non-Latin search term — skip fuzzy matching
  let best: 'fuzzy' | 'partial' | false = false;
  for (const s of library) {
    for (const c of songCandidates(s)) {
      if (!artistOk(c.artist, nArtist)) continue;
      const tm = titlesMatch(c.title, nTitle);
      if (tm === 'exact') return 'fuzzy';     // clean title/artist match → green
      if (tm === 'stripped') best = 'partial'; // needed stripping → yellow
    }
  }
  return best;
}
