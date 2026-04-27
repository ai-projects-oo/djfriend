// Local semantic tagging — no API key, no cloud AI.
// All tags derived from audio features computed by Essentia.js during analysis.

export interface SemanticTags {
  vibeTags: string[]
  moodTags: string[]
  vocalType: 'vocal' | 'instrumental' | 'mostly-vocal'
  venueTags: string[]
  timeOfNightTags: string[]
}

export interface AudioProfile {
  bpm: number
  camelot: string     // e.g. "8A", "5B"
  energy: number      // 0–1
  genres: string[]
  // Optional spectral features from analyzer-core — enables richer vocal heuristic
  zcRate?: number
  bassDb?: number
  midDb?: number
  highMidDb?: number
  highDb?: number
}

export function deriveSemanticTags(p: AudioProfile): SemanticTags {
  const vibeTags: string[] = []
  const moodTags: string[] = []
  const venueTags: string[] = []
  const timeOfNightTags: string[] = []

  const isMinor = p.camelot?.endsWith('A') ?? false
  const camelotNum = parseInt(p.camelot ?? '0', 10)

  // ── Vibe ──────────────────────────────────────────────────────────────────
  if (p.bpm > 140) vibeTags.push('driving')
  if (p.energy > 0.80 && p.bpm >= 125) vibeTags.push('intense')
  if (p.energy > 0.75 && p.bpm >= 118 && p.bpm <= 135 && !isMinor) vibeTags.push('groovy')
  if (p.energy < 0.45 && p.bpm < 115) vibeTags.push('dreamy')
  if (p.energy < 0.40 && isMinor) vibeTags.push('ethereal')
  if (p.energy > 0.70 && p.bpm >= 130 && p.bpm < 138 && isMinor) vibeTags.push('hypnotic')
  if (p.energy > 0.85 && isMinor) vibeTags.push('aggressive')
  if (p.energy > 0.55 && p.bpm >= 90 && p.bpm <= 115) vibeTags.push('bouncy')
  if (p.energy > 0.60 && p.bpm >= 138) vibeTags.push('raw')

  // ── Mood ──────────────────────────────────────────────────────────────────
  if (isMinor) moodTags.push('dark')
  else moodTags.push('uplifting')
  if (p.energy < 0.40 && isMinor) moodTags.push('melancholic')
  if (p.energy > 0.80 && !isMinor) moodTags.push('euphoric')
  if (p.energy > 0.75 && isMinor) moodTags.push('tense')
  if (p.energy < 0.35 && !isMinor) moodTags.push('peaceful')
  // Camelot 1A–3A (Db/Ab/Eb minor) tends towards mysterious
  if (isMinor && camelotNum >= 1 && camelotNum <= 3 && p.energy < 0.65) moodTags.push('mysterious')
  // Funky: mid-energy, major, moderate BPM
  if (!isMinor && p.energy >= 0.50 && p.energy <= 0.75 && p.bpm >= 100 && p.bpm <= 125) moodTags.push('funky')
  if (p.energy < 0.55 && isMinor && p.bpm >= 120) moodTags.push('emotional')

  // ── Time of Night ─────────────────────────────────────────────────────────
  if (p.bpm >= 128 && p.energy > 0.75) timeOfNightTags.push('peak-time')
  if (p.energy < 0.45 || p.bpm < 105) {
    timeOfNightTags.push('opening')
  } else if (p.energy < 0.65 || (p.bpm >= 105 && p.bpm < 125)) {
    timeOfNightTags.push('warm-up')
  }
  if (p.energy > 0.50 && p.bpm >= 124 && p.energy < 0.72) timeOfNightTags.push('after-hours')
  if (p.energy < 0.50 && p.bpm >= 115) timeOfNightTags.push('closing')

  // ── Venue ─────────────────────────────────────────────────────────────────
  if (p.bpm >= 125 && p.energy > 0.65) venueTags.push('club')
  if (p.bpm > 135 && p.energy > 0.80) venueTags.push('festival')
  if (p.energy < 0.55 && p.bpm < 125) venueTags.push('bar')
  if (p.energy < 0.40) venueTags.push('lounge')
  if (p.bpm > 135 && isMinor && p.energy > 0.75) venueTags.push('warehouse')

  // ── Vocal type ────────────────────────────────────────────────────────────
  // Genre hints are the most reliable signal we have without ML
  const genreStr = (p.genres ?? []).join(' ').toLowerCase()
  const hasVocalGenre = /\b(vocal|r&b|soul|pop|indie|rock|reggae|funk|disco|jazz|gospel|country|blues|hip.?hop|rap|singer)\b/.test(genreStr)
  const hasInstGenre = /\b(techno|minimal|ambient|drone|instrumental|deep house|progressive house)\b/.test(genreStr)

  let vocalType: 'vocal' | 'instrumental' | 'mostly-vocal' = 'instrumental'
  if (hasVocalGenre) {
    vocalType = 'vocal'
  } else if (!hasInstGenre && p.midDb !== undefined && p.bassDb !== undefined && p.zcRate !== undefined) {
    // Spectral heuristic: vocals elevate mid-band energy relative to bass and produce
    // moderate zero-crossing rates (higher than a sine wave, lower than pure noise).
    const midOverBass = p.midDb - p.bassDb
    if (midOverBass > 12 && p.zcRate > 0.08 && p.zcRate < 0.20) vocalType = 'vocal'
    else if (midOverBass > 7 && p.zcRate > 0.06 && p.zcRate < 0.22) vocalType = 'mostly-vocal'
  } else if (!hasInstGenre) {
    // No spectral data, no genre hint: house/pop BPMs + moderate energy often have vocals
    if (p.bpm >= 115 && p.bpm <= 130 && p.energy >= 0.45 && p.energy <= 0.80 && !isMinor) {
      vocalType = 'mostly-vocal'
    }
  }

  const unique = (arr: string[]) => [...new Set(arr)]
  return {
    vibeTags:        unique(vibeTags).slice(0, 3),
    moodTags:        unique(moodTags).slice(0, 3),
    vocalType,
    venueTags:       unique(venueTags).slice(0, 2),
    timeOfNightTags: unique(timeOfNightTags).slice(0, 2),
  }
}
