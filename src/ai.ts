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

import type { AIProvider } from './settings'

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  baseUrl?: string  // only for 'custom'
}

const PROVIDER_BASE_URLS: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
}

// Default models per provider
const ENRICHMENT_MODELS: Record<string, string> = {
  groq: 'llama-3.1-8b-instant',
  openai: 'gpt-4o-mini',
  openrouter: 'meta-llama/llama-3.1-8b-instruct:free',
  custom: 'gpt-4o-mini',
}

const PLANNER_MODELS: Record<string, string> = {
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o',
  openrouter: 'meta-llama/llama-3.3-70b-instruct',
  custom: 'gpt-4o',
}

export function getEnrichmentModel(provider: AIProvider): string {
  return ENRICHMENT_MODELS[provider] ?? ENRICHMENT_MODELS.groq
}

export function getPlannerModel(provider: AIProvider): string {
  return PLANNER_MODELS[provider] ?? PLANNER_MODELS.groq
}

let _client: OpenAI | null = null
let _clientFingerprint = ''

function getClient(config: AIConfig): OpenAI {
  const baseURL = config.provider === 'custom'
    ? (config.baseUrl || PROVIDER_BASE_URLS.openai)
    : PROVIDER_BASE_URLS[config.provider]
  const fingerprint = `${config.provider}:${config.apiKey}:${baseURL}`
  if (fingerprint !== _clientFingerprint || !_client) {
    _client = new OpenAI({ apiKey: config.apiKey, baseURL })
    _clientFingerprint = fingerprint
  }
  return _client
}

/** @deprecated Use getClient(config) instead */
export function getGroqClient(apiKey: string): OpenAI {
  return getClient({ provider: 'groq', apiKey })
}

export async function enrichTrackBatch(
  tracks: Array<{ file: string; artist: string; title: string; bpm: number; key: string; energy: number; genres: string[] }>,
  apiKeyOrConfig: string | AIConfig
): Promise<Map<string, SemanticTags>> {
  const config: AIConfig = typeof apiKeyOrConfig === 'string'
    ? { provider: 'groq', apiKey: apiKeyOrConfig }
    : apiKeyOrConfig
  const client = getClient(config)
  const completion = await client.chat.completions.create({
    model: getEnrichmentModel(config.provider),
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

const ANALYZE_BATCH_SIZE = 20

export async function analyzeTracksBatch(
  tracks: Array<{ file: string; artist: string; title: string }>,
  apiKeyOrConfig: string | AIConfig
): Promise<Map<string, { bpm: number; camelot: string; energy: number }>> {
  const config: AIConfig = typeof apiKeyOrConfig === 'string'
    ? { provider: 'groq', apiKey: apiKeyOrConfig }
    : apiKeyOrConfig
  const client = getClient(config)
  const completion = await client.chat.completions.create({
    model: getEnrichmentModel(config.provider),
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a DJ and music expert. Given a list of tracks, estimate each track's audio properties from your knowledge.
Return a JSON object with a "tracks" array. Each item must include:
- "file": the original file key unchanged
- "bpm": integer BPM (e.g. 128), or 0 if unknown
- "camelot": Camelot wheel key (e.g. "7A", "10B", "5B"), or "" if unknown
- "energy": float 0.0–1.0 (0=very mellow, 1=very intense)

Return ONLY the JSON object, no explanation.`,
      },
      {
        role: 'user',
        content: JSON.stringify(tracks.map(t => ({ file: t.file, artist: t.artist, title: t.title }))),
      },
    ],
  })

  const raw = completion.choices[0]?.message?.content ?? '{}'
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return new Map() }

  const result = new Map<string, { bpm: number; camelot: string; energy: number }>()
  const items = (parsed as Record<string, unknown>)?.tracks
  if (!Array.isArray(items)) return result

  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const it = item as Record<string, unknown>
    const file = typeof it.file === 'string' ? it.file : null
    if (!file) continue
    result.set(file, {
      bpm: typeof it.bpm === 'number' ? Math.round(it.bpm) : 0,
      camelot: typeof it.camelot === 'string' ? it.camelot : '',
      energy: typeof it.energy === 'number' ? Math.min(1, Math.max(0, it.energy)) : 0.5,
    })
  }
  return result
}

export async function analyzeTracksWithAI(
  tracks: Array<{ file: string; artist: string; title: string }>,
  apiKeyOrConfig: string | AIConfig,
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, { bpm: number; camelot: string; energy: number }>> {
  const result = new Map<string, { bpm: number; camelot: string; energy: number }>()
  const limiter = new RateLimiter(1000)
  let completed = 0
  for (let i = 0; i < tracks.length; i += ANALYZE_BATCH_SIZE) {
    const batch = tracks.slice(i, i + ANALYZE_BATCH_SIZE)
    await limiter.wait()
    try {
      const batchResult = await analyzeTracksBatch(batch, apiKeyOrConfig)
      for (const [file, data] of batchResult) result.set(file, data)
    } catch { /* skip failed batch */ }
    completed += batch.length
    onProgress?.(completed, tracks.length)
  }
  return result
}

// ─── Phase 3: AI Venue Planner ────────────────────────────────────────────────

export const PLANNER_SYSTEM_PROMPT = `You are an expert DJ set planner. Given a description of a gig, return a JSON object that describes how to configure the set generator.

Return ONLY a JSON object with these fields:
- "curve": array of 5 objects {x, y} where x goes 0, 0.25, 0.5, 0.75, 1.0 and y is 0–1 energy
- "bpmMin": integer minimum BPM for the set (e.g. 124)
- "bpmMax": integer maximum BPM for the set (e.g. 140)
- "bpmTarget": integer ideal BPM for the peak (e.g. 132)
- "scoringWeights": object with harmonicWeight (0–1), bpmWeight (0–1), transitionWeight (0–1) — three values that sum to ~1.0
- "venueType": one of "Club", "Bar", "Festival", "Private event", "Corporate", "Wedding" (or omit if unclear)
- "genre": primary genre string or "Any"
- "setDuration": set length in minutes (integer, or omit if not specified)
- "reasoning": one sentence explaining your choices

Scoring weight guidance:
- Club/festival: harmonicWeight 0.6, bpmWeight 0.3, transitionWeight 0.1
- Bar/lounge: harmonicWeight 0.5, bpmWeight 0.2, transitionWeight 0.3
- Wedding/corporate: harmonicWeight 0.4, bpmWeight 0.2, transitionWeight 0.4

Curve presets:
- Warm-up/opening: y values [0.2, 0.4, 0.6, 0.75, 0.85]
- Peak time: y values [0.6, 0.8, 0.95, 0.85, 0.7]
- Closing: y values [0.8, 0.7, 0.6, 0.4, 0.25]
- All-night: y values [0.3, 0.6, 0.9, 0.75, 0.5]`

export interface SetPlan {
  curve:          Array<{ x: number; y: number }>
  bpmMin:         number
  bpmMax:         number
  bpmTarget:      number
  scoringWeights: { harmonicWeight: number; bpmWeight: number; transitionWeight: number }
  venueType?:     string
  genre?:         string
  setDuration?:   number
  reasoning:      string
}

export async function planSet(
  prompt: string,
  context: { availableGenres: string[]; librarySize: number },
  apiKeyOrConfig: string | AIConfig
): Promise<SetPlan> {
  const config: AIConfig = typeof apiKeyOrConfig === 'string'
    ? { provider: 'groq', apiKey: apiKeyOrConfig }
    : apiKeyOrConfig
  const client = getClient(config)
  const completion = await client.chat.completions.create({
    model: getPlannerModel(config.provider),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: PLANNER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Gig description: ${prompt}\n\nAvailable genres in library: ${context.availableGenres.slice(0, 20).join(', ') || 'unknown'}. Library size: ${context.librarySize} tracks.`,
      },
    ],
  })

  const raw = completion.choices[0]?.message?.content ?? '{}'
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { parsed = {} }
  const p = parsed as Record<string, unknown>

  // Validate and normalise the response
  const curve = Array.isArray(p.curve) && p.curve.length >= 2
    ? (p.curve as Array<Record<string, unknown>>).map((pt, i, arr) => ({
        x: typeof pt.x === 'number' ? pt.x : i / (arr.length - 1),
        y: typeof pt.y === 'number' ? Math.max(0, Math.min(1, pt.y)) : 0.5,
      }))
    : [{ x: 0, y: 0.3 }, { x: 0.25, y: 0.6 }, { x: 0.5, y: 0.9 }, { x: 0.75, y: 0.7 }, { x: 1, y: 0.5 }]

  const weights = (p.scoringWeights && typeof p.scoringWeights === 'object')
    ? p.scoringWeights as Record<string, unknown>
    : {}

  return {
    curve,
    bpmMin:     typeof p.bpmMin === 'number'    ? Math.round(p.bpmMin)    : 120,
    bpmMax:     typeof p.bpmMax === 'number'    ? Math.round(p.bpmMax)    : 145,
    bpmTarget:  typeof p.bpmTarget === 'number' ? Math.round(p.bpmTarget) : 130,
    scoringWeights: {
      harmonicWeight:   typeof weights.harmonicWeight === 'number'   ? weights.harmonicWeight   : 0.55,
      bpmWeight:        typeof weights.bpmWeight === 'number'        ? weights.bpmWeight        : 0.25,
      transitionWeight: typeof weights.transitionWeight === 'number' ? weights.transitionWeight : 0.10,
    },
    venueType:   typeof p.venueType === 'string'   ? p.venueType   : undefined,
    genre:       typeof p.genre === 'string'       ? p.genre       : undefined,
    setDuration: typeof p.setDuration === 'number' ? Math.round(p.setDuration) : undefined,
    reasoning:   typeof p.reasoning === 'string'   ? p.reasoning   : '',
  }
}

export async function enrichTracks(
  resultsMap: Record<string, EnrichableTrack>,
  apiKeyOrConfig: string | AIConfig,
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  const toEnrich = Object.entries(resultsMap).filter(([, song]) => !song.semanticTags)
  if (toEnrich.length === 0) return

  // Emit the real total up-front so the UI can show 0/N instead of indeterminate
  onProgress?.(0, toEnrich.length)

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
        apiKeyOrConfig
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
