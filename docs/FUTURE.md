# DJFriend — AI Features Roadmap

## Overview

DJFriend's core set generator is deterministic: harmonic compatibility, BPM proximity, and energy-curve
targeting produce reproducible, explainable results. The roadmap below layers AI capabilities **on top of**
that deterministic engine — hard audio facts (BPM, key, Camelot) remain deterministic; AI provides
semantic enrichment, planning assistance, and learned personalisation.

Each phase is independently deployable. Later phases depend on the data introduced by earlier ones, but
no phase requires all prior phases to be complete.

---

## Pre-Requisites

Before any phase begins:

1. **Update CLAUDE.md** — add `docs/` section pointing to this file and `AGENTS.md`.
2. **Migrate history to Electron IPC** — set history is currently stored in `localStorage` directly from
   renderer code. Move read/write behind `ipcMain` handlers so the main process can inspect history
   without renderer involvement (needed for Phase 5).
3. **results.json migration strategy** — `src/analyzer.ts` writes `results.json` to `SONGS_FOLDER`.
   New optional fields introduced in each phase must be additive (never rename existing keys) so old
   `results.json` files remain valid. A `schemaVersion` top-level field should be added before Phase 1
   merges so the app can detect stale files and offer a re-scan.
4. **Groq AI setup** — AI features use [Groq](https://console.groq.com) (free, no credit card required).
   Add `GROQ_API_KEY` to `.env.example`. Store the key in `~/Library/Application Support/djfriend/settings.json`
   alongside Spotify credentials. Install the `openai` npm package — Groq exposes an OpenAI-compatible API,
   so no separate SDK is needed. Create `src/ai.ts` as the shared AI module (see Phase 0).

---

## Phase 0 — AI Infrastructure

**Goal**: establish the shared Groq client, settings plumbing, and rate limiter that all AI phases depend on.
No visible AI features ship in this phase — it is the foundation.

### Models

| Model | Use case | Free tier |
|---|---|---|
| `llama-3.1-8b-instant` | Bulk track enrichment (Phase 1) — fast, cheap, reliable JSON | 6,000 req/day |
| `llama-3.3-70b-versatile` | Conversational set planner (Phase 3) — better reasoning | 6,000 req/day |

Both models are accessed via `https://api.groq.com/openai/v1` using the standard `openai` npm package
with a custom `baseURL`. No Groq-specific SDK is required.

### `src/ai.ts` — module API

```ts
// Lazy singleton — re-created only when the API key changes
export function getGroqClient(apiKey: string): OpenAI

// Rate limiter (token-bucket, 1 s minimum gap between enrichment batches)
class RateLimiter { async wait(): Promise<void> }

// Phase 1 exports
export async function enrichTrackBatch(
  tracks: Array<{ file: string; artist: string; title: string;
                  bpm: number | null; key: string | null;
                  energy: number | null; genres: string[] }>,
  apiKey: string
): Promise<Map<string, SemanticTags>>

export async function enrichTracks(
  resultsMap: Record<string, AppSong>,
  apiKey: string,
  onProgress?: (completed: number, total: number) => void
): Promise<void>  // mutates resultsMap; skips already-tagged tracks

export const ENRICHMENT_BATCH_SIZE = 20

// Phase 3 export
export async function planSet(
  prompt: string,
  context: { availableGenres: string[]; librarySize: number },
  apiKey: string
): Promise<SetPlan>
```

### Settings

`src/settings.ts` — add `groqApiKey?: string` to `Settings` interface.
`src/api.ts` GET `/api/settings` — expose `hasGroqKey: boolean` (never the key itself).
`app/components/SettingsModal.tsx` — add an "AI" section with a password input for the Groq key,
mirroring the existing Spotify credentials section.

### Sprint 0 stories

| # | Story | Files | Done when |
|---|-------|-------|-----------|
| 0.1 | Add `openai` npm package | `package.json` | `import OpenAI from 'openai'` compiles; `--external:openai` in esbuild script |
| 0.2 | Add `GROQ_API_KEY` to env and settings | `.env.example`, `src/settings.ts` | `readSettings()` returns `groqApiKey` |
| 0.3 | Create `src/ai.ts` with Groq client factory + rate limiter | `src/ai.ts` (new) | `getGroqClient(key)` returns OpenAI instance at Groq baseURL |
| 0.4 | Add Groq key input to SettingsModal + settings API | `app/components/SettingsModal.tsx`, `src/api.ts` | Key persists to settings.json; `hasGroqKey` returned by GET `/api/settings` |

### Files touched

| File | Change |
|---|---|
| `package.json` | Add `"openai": "^4.x"`; add `--external:openai` to `build:electron` esbuild script |
| `.env.example` | Add `GROQ_API_KEY=` |
| `src/settings.ts` | Add `groqApiKey?: string` to `Settings` |
| `src/ai.ts` | New file — client factory, rate limiter, stub exports for Phase 1 + 3 |
| `src/api.ts` | Update `/api/settings` GET/POST to handle `groqApiKey` |
| `app/components/SettingsModal.tsx` | Add "AI" section with Groq key password input |

---

## Phase 1 — AI Semantic Tagging

**Goal**: enrich every `Song` with human-readable semantic tags derived from existing audio features,
so the set generator and UI can reason about vibe, venue fit, and time-of-night without touching
audio analysis a second time.

### New `Song` fields (`app/types/index.ts`)

```ts
interface SemanticTags {
  vibeTags:        string[]   // e.g. ["euphoric", "melancholic", "driving"]
  venueTags:       string[]   // e.g. ["festival", "club", "bar", "lounge"]
  moodTags:        string[]   // e.g. ["dark", "uplifting", "funky"]
  timeOfNightTags: string[]   // e.g. ["opening", "peak-time", "closing"]
  vocalType:       'vocal' | 'instrumental' | 'mostly-vocal'
}

// Song gains:
semanticTags?: SemanticTags
```

### Derivation strategy

**Rule layer** (no API call, always available):
- `energy > 0.85` → `vibeTags` += "euphoric"
- `energy < 0.35` → `vibeTags` += "melancholic"
- `bpm > 140` → `vibeTags` += "driving"
- `camelot` ends in `B` (major) → mood bias "uplifting"; ends in `A` (minor) → "dark"
- `bpm < 100` → `timeOfNightTags` += "opening" | "closing"
- `bpm > 128 && energy > 0.75` → `timeOfNightTags` += "peak-time"

**AI layer** (Groq, batched, cached in `results.json`):
- Model: `llama-3.1-8b-instant` — fast, handles structured JSON reliably.
- Batch 20 tracks per request using `response_format: { type: "json_schema", strict: true }`.
- Input per track: `{ file, artist, title, bpm, key, energy, genres }`.
- Output per track: full `SemanticTags` object keyed by `file`.
- Results written back to `results.json` — **never re-fetched if `semanticTags` already present**.
- Rate limited: 1-second minimum gap between batches (well within Groq's 30 req/min free tier).
- A 200-track library enriches in ~10 seconds (10 batches × 1 s).

### Sprint 1 stories

| # | Story | Files | Done when |
|---|-------|-------|-----------|
| 1.1 | Add `SemanticTags` interface; extend `Song` and `AppSong` | `app/types/index.ts`, `src/api.ts` | TypeScript compiles with optional `semanticTags` |
| 1.2 | Implement `enrichTrackBatch` in `src/ai.ts` | `src/ai.ts` | Single Groq call returns `Map<file, SemanticTags>` via `json_schema` |
| 1.3 | Implement `enrichTracks` driver | `src/ai.ts` | Skips tagged tracks; batches; mutates resultsMap; calls `onProgress` |
| 1.4 | Call `enrichTracks` at end of analysis pipeline | `src/api.ts` | After scan completes, results.json has `semanticTags` on each track |
| 1.5 | Add `POST /api/ai/enrich` streaming endpoint | `src/api.ts` | NDJSON stream: `start` → `progress` → `done` |
| 1.6 | Use `semanticTags` in scoring (optional bonus) | `app/lib/setGenerator.ts` | `semanticAffinityBonus` (max +0.10) applied when tags present; falls back to 0 |

### Files touched

| File | Change |
|---|---|
| `app/types/index.ts` | Add `SemanticTags` interface; add `semanticTags?: SemanticTags` to `Song` |
| `src/ai.ts` | Implement `enrichTrackBatch`, `enrichTracks`, `ENRICHMENT_BATCH_SIZE` |
| `src/api.ts` | Add `semanticTags` to `AppSong`; integrate enrichment into `analyzeLibrary`; add `POST /api/ai/enrich` |
| `app/lib/setGenerator.ts` | `semanticAffinityBonus` using `song.semanticTags` when present |

---

## Phase 2 — Track Energy Micro-Profiles

**Goal**: capture intra-track energy shape (intro, body, peak, outro) so transition scoring can match
the *end* of one track to the *start* of the next, not just overall energy levels.

### New interface

```ts
interface EnergyProfile {
  intro:        number  // 0–1, avg RMS of first 16 bars
  body:         number  // 0–1, avg RMS of middle section
  peak:         number  // 0–1, max RMS in track
  outro:        number  // 0–1, avg RMS of last 16 bars
  variance:     number  // std-dev of per-bar RMS
  dropStrength: number  // 0–1, magnitude of the largest energy drop
}
```

`Song` gains `energyProfile?: EnergyProfile`.

### Scoring upgrade (`app/lib/setGenerator.ts`)

Current transition score uses `Math.abs(prev.energy - next.energy)`. Upgrade to:

```
transitionScore = 1 - Math.abs(prev.energyProfile.outro - next.energyProfile.intro)
```

Fall back to overall `energy` delta when `energyProfile` is absent (backwards compatibility).

### Implementation constraint

`src/analyzer.ts` already decodes audio to `channelData` for overall RMS. The micro-profile
computation **must reuse that same decoded buffer** — no second `decodeAudioData` call. Split the
existing `computeRMS` helper into `computeRMS` (overall) + `computeEnergyProfile` (segmented),
both receiving the already-decoded `channelData`.

### Files touched

| File | Change |
|---|---|
| `app/types/index.ts` | Add `EnergyProfile` interface; add `energyProfile?` to `Song` |
| `src/analyzer.ts` | Add `computeEnergyProfile(channelData)` — reuses existing buffer |
| `app/lib/setGenerator.ts` | Upgrade transition score; preserve fallback |
| `test/set-generator.test.ts` | Add transition-score tests with mock `energyProfile` |

---

## Phase 3 — AI Venue Planner → Set Plan

**Goal**: let the user describe the gig in natural language and get back a pre-filled energy curve,
BPM corridor, and scoring weight overrides — reducing manual curve editing to zero for typical bookings.

### New interfaces (`app/types/index.ts`)

```ts
interface ScoringWeights {
  harmonicWeight:  number  // default 0.6
  bpmWeight:       number  // default 0.3
  affinityWeight:  number  // default 0.1
}

interface SetPlan {
  curve:          CurvePoint[]   // 3–7 points describing the energy arc
  bpmMin:         number         // e.g. 128
  bpmMax:         number         // e.g. 145
  bpmTarget:      number         // e.g. 138
  scoringWeights: ScoringWeights
  venueType?:     VenueType
  audiencePurpose?: AudiencePurpose
  occasionType?:  OccasionType
  genre?:         string
  setDuration?:   number
  reasoning:      string         // one-sentence human-readable explanation shown in UI
}

interface ChatMessage {
  role:    'user' | 'assistant'
  content: string
  plan?:   SetPlan  // present on assistant messages that returned a plan
}
```

### Implementation

- **V1** (deterministic, no API): lookup table keyed on `venueType × occasionType` in `app/lib/venuePlanner.ts`.
- **V2** (AI, live): chat panel sends freeform DJ prompt to `POST /api/ai/plan-set`.
  Model: `llama-3.3-70b-versatile` — better reasoning for open-ended gig descriptions.
  Uses `response_format: { type: "json_schema", strict: true }` to guarantee a valid `SetPlan`.
  Single-shot (not streaming) — typical latency ~500 ms.

### UI — `AIPlannerPanel.tsx`

A slide-in chat panel (right edge, `z-40`) in the dark palette (`bg-[#0d0d14]`):
- Text input + send button.
- Each assistant reply shows `reasoning` text and, if a plan was returned, an **"Apply to generator"**
  button that calls `onApplyPlan(plan)`.
- `onApplyPlan` in `App.tsx` maps `SetPlan` → updates `prefs`, `curve`, and `scoringWeights` state.
- Toggle button in the main toolbar (beside the Settings gear icon).

### Sprint 3 stories

| # | Story | Files | Done when |
|---|-------|-------|-----------|
| 3.1 | Add `ScoringWeights`, `SetPlan`, `ChatMessage` interfaces | `app/types/index.ts` | TypeScript compiles |
| 3.2 | Implement `planSet` in `src/ai.ts` | `src/ai.ts` | Returns valid `SetPlan` from freeform prompt via `json_schema` |
| 3.3 | Add `POST /api/ai/plan-set` endpoint | `src/api.ts` | Returns `{ ok: true, plan }` or `{ ok: false, error }` |
| 3.4 | Accept optional `weights?: ScoringWeights` in `generateSet` | `app/lib/setGenerator.ts` | Hardcoded `0.6`/`0.3` replaced by `weights?.harmonicWeight ?? 0.6` etc. |
| 3.5 | Create `AIPlannerPanel.tsx` | `app/components/AIPlannerPanel.tsx` (new) | Chat UI posts to plan-set endpoint; "Apply" triggers `onApplyPlan` |
| 3.6 | Wire planner into `App.tsx` | `app/App.tsx` | `chatOpen` toggle; `handleApplyPlan` updates `prefs` + `curve` + `scoringWeights` |

### Files touched

| File | Change |
|---|---|
| `app/types/index.ts` | Add `ScoringWeights`, `SetPlan`, `ChatMessage` |
| `src/ai.ts` | Add `planSet`, `PLANNER_SYSTEM_PROMPT` |
| `src/api.ts` | Add `POST /api/ai/plan-set` |
| `app/lib/setGenerator.ts` | Accept optional `weights?: ScoringWeights`; replace hardcoded coefficients |
| `app/components/AIPlannerPanel.tsx` | New file — chat panel component |
| `app/App.tsx` | `chatOpen` + `scoringWeights` state; `handleApplyPlan`; render `AIPlannerPanel` |

---

## Phase 4 — Upgraded Scoring Formula

**Goal**: replace the current fixed-weight formula with a general weighted sum driven by `ScoringWeights`
from Phase 3, enabling per-gig tuning of what matters most.

### Current formula (`app/lib/setGenerator.ts` lines 121–133)

```
score = harmonicScore × 0.6 + bpmScore × 0.3 + affinityBonus (max 0.15)
```

### Target formula

```
score = Σ(weights[i] × scores[i])
```

where `scores` includes: `harmonic`, `bpm`, `affinity`, `vibe` (Phase 1), `familiarity` (Phase 5),
`vocal` (Phase 1), `risk`.

`weights` defaults to the current hard-coded values when no `ScoringWeights` is provided.

### Migration

The energy-neighbourhood pre-filter (`top K = max(5, ceil(15% of pool))`) is **preserved unchanged** —
it is a performance guard, not part of the score.

### Files touched

| File | Change |
|---|---|
| `app/lib/setGenerator.ts` | Refactor scoring block (lines 121–133) to weighted sum |
| `app/types/index.ts` | `ScoringWeights` already added in Phase 3 |
| `test/set-generator.test.ts` | Update scoring tests; add weight-override tests |

---

## Phase 5 — Personal Learning from History

**Goal**: give a small familiarity boost to tracks the DJ plays regularly and a slight penalty to
over-played tracks, without any cloud sync or external storage.

### Derived data

```ts
interface PlayStats {
  playCount:      number
  lastPlayed:     string    // ISO date
  avgSetPosition: number    // 0–1, average slot / setLength
  setTypes:       string[]  // venueTypes from sets where this track appeared
}
```

`PlayStats` is computed at runtime from `HistoryEntry[]` (localStorage) — never written to `results.json`.

### Familiarity score

```
familiarityScore(playCount):
  0 plays  → 0.5   (neutral)
  3–6 plays → 1.0  (peak)
  10+ plays → 0.3  (slight penalty — avoid overplay)
  interpolated via sigmoid between breakpoints
```

### Files touched

| File | Change |
|---|---|
| `app/lib/historyStats.ts` | New file — `computePlayStats(history, songId): PlayStats` |
| `app/lib/setGenerator.ts` | Feed `familiarityScore` into Phase 4 weighted sum |
| `app/types/index.ts` | Add `PlayStats` interface |
| `test/set-generator.test.ts` | Add familiarity-score unit tests |

---

## Phase 6 — Explainability

**Goal**: show the DJ *why* each track was chosen, so they can build intuition and override with
confidence.

### Data model change

`SetTrack` gains:
```ts
selectionReason?: string[]
// e.g. ["harmonic match 11B→4B", "energy 0.72 matches target 0.70", "vibe: euphoric × energetic"]
```

### Scoring function change

Internal scoring returns `{ score: number, breakdown: ScoreBreakdown }`. The `breakdown` fields are
converted to human-readable strings and stored on `SetTrack.selectionReason`.

### UI change

`TrackRow.tsx` — info icon or expandable row that shows `selectionReason` as a bulleted list.
Tooltip on hover for compact view; expandable for detail.

### Files touched

| File | Change |
|---|---|
| `app/types/index.ts` | Add `selectionReason?` to `SetTrack` |
| `app/lib/setGenerator.ts` | Return `breakdown`; populate `selectionReason` |
| `app/components/TrackRow.tsx` | Expandable reason display |
| `test/set-generator.test.ts` | Assert `selectionReason` populated correctly |

---

## Phase 7 — Smart Crate Builder

**Goal**: after set generation, identify gaps where the library is weak and suggest targeted search
queries so the DJ knows exactly what records to buy or licence.

### Gap analysis

```ts
interface CrateGap {
  setPosition:     number    // 0–1, where in the set the gap appears
  targetEnergy:    number
  camelotNeeded:   string[]  // compatible keys from camelot wheel
  bpmRange:        { min: number; max: number }
  suggestedSearch: string    // e.g. "techno 128–132 BPM 6A 6B energy 0.8+"
}
```

### Trigger conditions

Gap analysis runs automatically when:
- Harmonic warning rate > 20% of set slots (`SetTrack.harmonicWarning` count / set length)
- Average `|slot.energy - slot.targetEnergy|` > 0.15

Results surface in a "Crate Suggestions" panel below the set list.

### Files touched

| File | Change |
|---|---|
| `app/lib/crateBuilder.ts` | New file — `findCrateGaps(set: SetTrack[], prefs: DJPreferences): CrateGap[]` |
| `app/types/index.ts` | Add `CrateGap` interface |
| `app/App.tsx` | Render "Crate Suggestions" panel |
| `test/set-generator.test.ts` | Add gap-detection unit tests |

---

## Out of Scope

The following are explicitly excluded from this roadmap:

- **Cloud sync** — history and preferences remain local-only (Electron + localStorage + IPC)
- **In-app playback** — audio preview is a separate product surface; not planned here
- **Mobile** — Electron desktop only; no React Native port planned
- **Real-time BPM detection** — BPM comes from Spotify audio features or local analysis at import time; no live tempo tracking
- **Paid AI APIs** — all AI features use Groq's free tier; no OpenAI, Anthropic, or other paid providers planned
