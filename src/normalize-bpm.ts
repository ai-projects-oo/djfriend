export function normalizeBpm(bpm: number, energy: number, genres: string[]): number {
  const gl = genres.map(g => g.toLowerCase())
  const hasAny = (terms: string[]) => gl.some(g => terms.some(t => g.includes(t)))
  const isFastGenre = hasAny(['house', 'techno', 'trance', 'drum and bass', 'dnb', 'jungle', 'hardstyle', 'hardcore', 'gabber', 'neurofunk', 'speed garage', 'edm', 'electronic dance', 'eurodance'])
  if (isFastGenre) return bpm
  const isSlowGenre = hasAny(['soul', 'r&b', 'rnb', 'neo soul', 'jazz', 'blues', 'gospel', 'ambient', 'downtempo', 'chill', 'lo-fi', 'lofi', 'classical', 'opera', 'orchestral', 'folk', 'acoustic', 'singer-songwriter', 'country', 'bluegrass', 'bossa nova', 'bolero', 'fado', 'adult contemporary', 'soft rock', 'easy listening', 'reggae', 'dub', 'ska', 'christmas', 'holiday', 'seasonal', 'christian', 'hymn', 'carol'])
  if ((!isSlowGenre && energy >= 0.50) || bpm <= 100) return bpm
  if (bpm > 150) { const third = Math.round((bpm / 3) * 10) / 10; if (third >= 50 && third <= 100) return third }
  const half = Math.round((bpm / 2) * 10) / 10
  if (half >= 45 && half <= 100) return half
  return bpm
}
