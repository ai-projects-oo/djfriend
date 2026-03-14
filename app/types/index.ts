export interface Song {
  file: string;
  filePath?: string;
  artist: string;
  title: string;
  spotifyId?: string;
  spotifyArtist?: string;
  spotifyTitle?: string;
  duration?: number; // in seconds (may be absent if not scanned)
  bpm: number;
  key: string; // e.g. "E♭ Major"
  camelot: string; // e.g. "5B"
  energy: number; // 0.0 – 1.0
  genres: string[];
  genresFromSpotify?: boolean; // true = genres from Spotify API (not final), absent/false = from ID3 tags
}

export interface SetTrack extends Song {
  slot: number;
  targetEnergy: number;
  harmonicWarning: boolean; // true if camelot transition is incompatible
}

export interface CurvePoint {
  x: number; // 0.0 – 1.0 (position in set timeline)
  y: number; // 0.0 – 1.0 (energy level)
}

export type VenueType =
  | 'Club'
  | 'Bar'
  | 'Festival'
  | 'Private event'
  | 'Corporate'
  | 'Wedding';

export type AudienceAgeRange = '18–25' | '25–35' | '35–50' | 'Mixed';

export type AudiencePurpose = 'Dancing' | 'Background' | 'Celebration' | 'Mixed';

export type OccasionType =
  | 'Birthday'
  | 'Weekend night'
  | 'Midweek'
  | 'After-party'
  | 'Warm-up'
  | 'Peak time'
  | 'Cool-down';

export type ArcPreset = 'Build-up' | 'Peak' | 'Valley' | 'Steady' | 'W-shape';

export interface DJPreferences {
  setDuration: number; // minutes
  venueType: VenueType;
  audienceAgeRange: AudienceAgeRange;
  audiencePurpose: AudiencePurpose;
  occasionType: OccasionType;
  genre: string;
}

export interface HistoryEntry {
  id: string;
  name: string;
  timestamp: number;
  tracks: SetTrack[];
  prefs: DJPreferences;
  curve: CurvePoint[];
}

export interface ImportTrack {
  spotifyId: string;
  title: string;
  artist: string;
  inLibrary: boolean;
  unavailable?: boolean;
}

export interface ImportEntry {
  id: string;
  name: string;
  timestamp: number;
  playlistId: string;
  tracks: ImportTrack[];
}
