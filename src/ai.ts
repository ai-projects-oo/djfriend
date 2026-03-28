import OpenAI from 'openai'

export interface SemanticTags {
  vibeTags: string[]
  moodTags: string[]
  vocalType: 'vocal' | 'instrumental' | 'mostly-vocal'
  venueTags: string[]
  timeOfNightTags: string[]
}

// Minimal interface — avoids circular import with src/api.ts
interface EnrichableTrack {
  artist: string
  title: string
  bpm: number
  key: string
  energy: number
  genres: string[]
  semanticTags?: SemanticTags
}

export const ENRICHMENT_BATCH_SIZE = 20

export const ENRICHMENT_SYSTEM_PROMPT = `You are a music taxonomy expert. Given a list of tracks with audio features, return semantic tags for each track.

Each category has a STRICTLY separate vocabulary — never use a word from one category in another.

For each track, analyze artist, title, BPM, musical key, energy (0-1 scale), and genres to determine:
- vibeTags: 1-3 sonic/energy character tags — ONLY from: driving, hypnotic, dreamy, groovy, aggressive, trippy, ethereal, intense, raw, bouncy
- moodTags: 1-3 emotional quality tags — ONLY from: dark, uplifting, melancholic, euphoric, romantic, tense, peaceful, rebellious, mysterious, funky, emotional
- vocalType: exactly one of "vocal", "instrumental", "mostly-vocal"
- venueTags: 1-2 venue tags — ONLY from: club, festival, bar, lounge, warehouse, outdoor, intimate, rooftop
- timeOfNightTags: 1-2 time-of-night tags — ONLY from: opening, warm-up, peak-time, after-hours, closing

Rules:
- Use ONLY the exact words listed above for each category — no synonyms, no additions
- A word from one category must NEVER appear in another category
- venueTags must NOT include time-of-night concepts like "peak-time"

Return a JSON object with a "tracks" array. Each item must include the original "file" key unchanged.`

class RateLimiter {
  private lastCallTime = 0
  constructor(private minGapMs: number) {}
  async wait(): Promise<void> {
    const elapsed = Date.now() - this.lastCallTime
    if (elapsed < this.minGapMs) {
      await new Promise<void>(r => setTimeout(r, this.minGapMs - elapsed))
    }
    this.lastCallTime = Date.now()
  }
}

let _client: OpenAI | null = null
let _currentKey = ''

export function getGroqClient(apiKey: string): OpenAI {
  if (apiKey !== _currentKey || !_client) {
    _client = new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    })
    _currentKey = apiKey
  }
  return _client
}

export async function enrichTrackBatch(
  tracks: Array<{ file: string; artist: string; title: string; bpm: number; key: string; energy: number; genres: string[] }>,
  apiKey: string
): Promise<Map<string, SemanticTags>> {
  const client = getGroqClient(apiKey)
  const completion = await client.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: ENRICHMENT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify(tracks.map(t => ({
          file: t.file,
          artist: t.artist,
          title: t.title,
          bpm: t.bpm,
          key: t.key,
          energy: t.energy,
          genres: t.genres,
        }))),
      },
    ],
  })

  const raw = completion.choices[0]?.message?.content ?? '{}'
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return new Map() }

  const result = new Map<string, SemanticTags>()
  const items = (parsed as Record<string, unknown>)?.tracks
  if (!Array.isArray(items)) return result

  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const it = item as Record<string, unknown>
    const file = typeof it.file === 'string' ? it.file : null
    if (!file) continue
    result.set(file, {
      vibeTags: Array.isArray(it.vibeTags) ? it.vibeTags.filter((x): x is string => typeof x === 'string') : [],
      moodTags: Array.isArray(it.moodTags) ? it.moodTags.filter((x): x is string => typeof x === 'string') : [],
      vocalType: it.vocalType === 'vocal' || it.vocalType === 'mostly-vocal' ? it.vocalType : 'instrumental',
      venueTags: Array.isArray(it.venueTags) ? it.venueTags.filter((x): x is string => typeof x === 'string') : [],
      timeOfNightTags: Array.isArray(it.timeOfNightTags) ? it.timeOfNightTags.filter((x): x is string => typeof x === 'string') : [],
    })
  }
  return result
}

export async function enrichTracks(
  resultsMap: Record<string, EnrichableTrack>,
  apiKey: string,
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  const toEnrich = Object.entries(resultsMap).filter(([, song]) => !song.semanticTags)
  if (toEnrich.length === 0) return

  const limiter = new RateLimiter(1000)
  let completed = 0

  for (let i = 0; i < toEnrich.length; i += ENRICHMENT_BATCH_SIZE) {
    const batch = toEnrich.slice(i, i + ENRICHMENT_BATCH_SIZE)
    await limiter.wait()
    try {
      const tags = await enrichTrackBatch(
        batch.map(([file, song]) => ({
          file,
          artist: song.artist,
          title: song.title,
          bpm: song.bpm,
          key: song.key,
          energy: song.energy,
          genres: song.genres,
        })),
        apiKey
      )
      for (const [file] of batch) {
        const t = tags.get(file)
        if (t) resultsMap[file].semanticTags = t
        completed++
        onProgress?.(completed, toEnrich.length)
      }
    } catch {
      // skip failed batch — progress does not advance so the user can see something stalled
    }
  }
}
