export interface ScannedTrack {
  file: string;
  filePath: string;
  artist: string | null;
  title: string;
  duration: number | null; // seconds
  localGenres: string[];   // genres from ID3 tags (empty if not tagged)
}

export interface SpotifyMatch {
  spotifyId: string;
  artistId: string;
  spotifyArtist: string;
  spotifyTitle: string;
}

export interface AnalyzedTrack {
  file: string;
  artist: string | null;
  title: string;
  spotifyId: string | null;
  spotifyArtist: string | null;
  spotifyTitle: string | null;
  bpm: number | null;
  key: string | null;
  camelot: string | null;
  energy: number | null;
  genres: string[];
}
