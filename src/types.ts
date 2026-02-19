export interface ScannedTrack {
  file: string;
  filePath: string;
  artist: string | null;
  title: string;
  genres: string[];
}

export interface AnalyzedTrack {
  file: string;
  artist: string | null;
  title: string;
  bpm: number | null;
  key: string | null;
  camelot: string | null;
  energy: number | null;
  genres: string[];
}
