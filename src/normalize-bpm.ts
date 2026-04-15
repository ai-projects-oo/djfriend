/**
 * Correct a detected BPM against the file's metadata tag BPM.
 *
 * Beat detectors commonly lock onto half-time or double-time pulses.
 * If the tag says 124 but the detector returned 62, the detector locked
 * onto the half-time kick and we should double it — and vice-versa.
 *
 * Tag takes precedence when it is plausible (50–220 BPM) and the
 * detected value is within 15 % of the expected octave relationship.
 * If there is no tag, we fall back to genre/energy heuristics as a
 * last resort.
 */
export function normalizeBpm(bpm: number, _energy: number, genres: string[], tagBpm?: number | null): number {
  // ── 1. Tag-based octave correction (preferred) ──────────────────────────
  if (tagBpm && tagBpm >= 50 && tagBpm <= 220) {
    // Tag says X, detector returned ~X/2 → double
    if (Math.abs(bpm / tagBpm - 0.5) < 0.15) return Math.round(bpm * 2 * 10) / 10
    // Tag says X, detector returned ~X*2 → halve
    if (Math.abs(bpm / tagBpm - 2) < 0.15) return Math.round((bpm / 2) * 10) / 10
    // Tag says X, detector returned ~X/3 → triple
    if (Math.abs(bpm / tagBpm - 1 / 3) < 0.12) return Math.round(bpm * 3 * 10) / 10
    // Tag says X, detector returned ~X*3 → third
    if (Math.abs(bpm / tagBpm - 3) < 0.12) return Math.round((bpm / 3) * 10) / 10
    // Tag and detection agree — trust the tag for precision
    if (Math.abs(bpm - tagBpm) / tagBpm < 0.08) return Math.round(tagBpm * 10) / 10
  }

  // ── 2. Genre heuristics (fallback — only when genre is clearly known) ───
  // Without a tag we can only correct when the genre is unambiguous.
  // Unknown genres are left as-is — a wrong heuristic is worse than no correction.
  const gl = genres.map(g => g.toLowerCase())
  const hasAny = (terms: string[]) => gl.some(g => terms.some(t => g.includes(t)))
  const isFastGenre = hasAny(['house', 'techno', 'trance', 'drum and bass', 'dnb', 'jungle',
    'hardstyle', 'hardcore', 'gabber', 'neurofunk', 'speed garage', 'edm',
    'electronic dance', 'eurodance'])
  const isSlowGenre = hasAny(['soul', 'r&b', 'rnb', 'neo soul', 'jazz', 'blues', 'gospel',
    'ambient', 'downtempo', 'chill', 'lo-fi', 'lofi', 'classical', 'opera',
    'orchestral', 'folk', 'acoustic', 'singer-songwriter', 'country', 'bluegrass',
    'bossa nova', 'bolero', 'fado', 'adult contemporary', 'soft rock',
    'easy listening', 'reggae', 'dub', 'ska', 'christmas', 'holiday',
    'seasonal', 'christian', 'hymn', 'carol'])

  // Confirmed fast genre + half-time detection → double
  if (isFastGenre && bpm < 90) {
    const doubled = Math.round(bpm * 2 * 10) / 10
    if (doubled >= 100 && doubled <= 200) return doubled
  }
  if (isFastGenre) return bpm

  // Confirmed slow genre + double-time detection → halve or third
  if (isSlowGenre) {
    if (bpm > 150) {
      const third = Math.round((bpm / 3) * 10) / 10
      if (third >= 45 && third <= 100) return third
    }
    const half = Math.round((bpm / 2) * 10) / 10
    if (bpm > 100 && half >= 45 && half <= 100) return half
  }

  // Unknown genre — trust the detector as-is
  return bpm
}
