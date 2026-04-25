export interface EnergyProfile {
  intro:        number  // 0–1, avg normalized RMS of first ~15% of track
  body:         number  // 0–1, avg normalized RMS of middle section
  peak:         number  // 0–1, max normalized RMS window
  outro:        number  // 0–1, avg normalized RMS of last ~15% of track
  variance:     number  // std-dev of per-window RMS across full track
  dropStrength: number  // 0–1, magnitude of the largest energy drop between windows
}

export interface SemanticTags {
  vibeTags: string[];        // e.g. ["euphoric", "driving"]
  moodTags: string[];        // e.g. ["dark", "uplifting"]
  vocalType: 'vocal' | 'instrumental' | 'mostly-vocal';
  venueTags: string[];       // e.g. ["club", "festival"]
  timeOfNightTags: string[]; // e.g. ["peak-time", "closing"]
}

export interface Song {
  file: string;
  filePath?: string;
  artist: string;
  title: string;
  spotifyId?: string;
  spotifyArtist?: string;
  spotifyTitle?: string;
  duration?: number; // in seconds (may be absent if not scanned)
  dateAdded?: number; // Unix timestamp (seconds) — set for Apple Music tracks
  bpm: number;
  key: string; // e.g. "E♭ Major"
  camelot: string; // e.g. "5B"
  energy: number; // 0.0 – 1.0
  genres: string[];
  genresFromSpotify?: boolean; // true = genres from Spotify API (not final), absent/false = from ID3 tags
  year?: number;               // ID3 year tag
  comment?: string;            // ID3 comment tag (first COMM frame)
  semanticTags?: SemanticTags;
  energyProfile?: EnergyProfile;
}

export interface SetTrack extends Song {
  slot: number;
  targetEnergy: number;
  harmonicWarning: boolean;    // true if camelot transition is incompatible
  locked?: boolean;            // true = preserved on regenerate
  selectionReason?: string[];  // human-readable breakdown of why this track was chosen
}

export interface SetScore {
  total: number;          // 0–100 overall quality score
  harmonicRate: number;   // 0–1, fraction of transitions with harmonic warnings
  avgEnergyError: number; // 0–1, average |energy - targetEnergy| across all tracks
  bpmSmoothness: number;  // 0–1, 1 = perfectly smooth BPM flow
}

export interface CrateGap {
  slot: number;                           // 0-indexed position in the set (use directly, don't recompute)
  setPosition: number;                    // 0–1, normalized slot position
  targetEnergy: number;
  camelotNeeded: string[];                // compatible Camelot keys adjacent to surrounding tracks
  bpmRange: { min: number; max: number } | null; // null when BPM data is unavailable
  suggestedSearch: string;                // e.g. "house 120–128 BPM 7A/7B energy 0.7+"
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

export type SetPhase = 'Warm-up' | 'Peak time' | 'Cool-down' | 'After-party';

export type ArcPreset = 'Build-up' | 'Peak' | 'Valley' | 'Steady' | 'W-shape';

export interface TagFilters {
  vibeTags: string[];
  moodTags: string[];
  vocalTypes: string[];
  venueTags: string[];
  timeOfNightTags: string[];
}

export type DateField = 'dateAdded' | 'releaseYear';
export type DateFilterPreset = 'all' | 'thisYear' | 'lastYear' | 'older' | 'range';

export interface DateFilter {
  field: DateField;
  preset: DateFilterPreset;
  rangeFrom?: string; // ISO date YYYY-MM-DD; undefined = beginning of time ("Ever")
  rangeTo?: string;   // ISO date YYYY-MM-DD; undefined = today ("Now")
}

export interface DJPreferences {
  setDuration: number | null; // minutes; null = unlimited (all matching tracks)
  venueType: VenueType;
  setPhase: SetPhase;
  genres: string[]; // empty = "Any" (no genre filter)
  bpmMin?: number;  // optional hard floor for candidate pool
  bpmMax?: number;  // optional hard ceiling for candidate pool
  tagFilters: TagFilters;
  dateFilter: DateFilter;
}

export interface PlayStats {
  playCount:      number;   // how many times this track appeared in any saved set
  lastPlayed:     string;   // ISO date of most recent set containing this track
  avgSetPosition: number;   // 0–1, average slot / (setLength - 1)
  setTypes:       string[]; // venueTypes from sets where this track appeared
}

export interface ScoringWeights {
  harmonicWeight:   number; // default 0.55
  bpmWeight:        number; // default 0.25
  transitionWeight: number; // default 0.10
}

export interface SetPlan {
  curve:          CurvePoint[];
  bpmMin:         number;
  bpmMax:         number;
  bpmTarget:      number;
  scoringWeights: ScoringWeights;
  venueType?:     VenueType;
  genre?:         string;
  setDuration?:   number;
  reasoning:      string;
}

export interface ChatMessage {
  role:    'user' | 'assistant';
  content: string;
  plan?:   SetPlan;
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
  matchConfidence?: 'exact' | 'fuzzy' | 'partial'; // exact/fuzzy = green; partial = yellow (parenthetical strip needed)
  unavailable?: boolean;
  manualMatchFile?: string; // file path of manually-matched library song (skips auto-rematch)
}

export interface ImportEntry {
  id: string;
  name: string;
  timestamp: number;
  playlistId: string;
  tracks: ImportTrack[];
}
