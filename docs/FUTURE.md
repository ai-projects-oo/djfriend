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

---

## Phase 1 — AI Semantic Tagging

**Goal**: enrich every `Song` with human-readable semantic tags derived from existing audio features,
so the set generator and UI can reason about vibe, venue fit, and time-of-night without touching
audio analysis a second time.

### New `Song` fields (`app/types/index.ts`)

```ts
vibeTags?:       string[]   // e.g. ["euphoric", "melancholic", "driving"]
venueTags?:      string[]   // e.g. ["festival", "club", "bar", "lounge"]
moodTags?:       string[]   // e.g. ["dark", "uplifting", "funky"]
timeOfNightTags?: string[]  // e.g. ["opening", "peak-time", "closing"]
vocalType?:      string     // "vocal" | "instrumental" | "mostly-vocal"
```

### Derivation strategy

**Rule layer** (no API call, always available):
- `energy > 0.85` → `vibeTags` += "euphoric"
- `energy < 0.35` → `vibeTags` += "melancholic"
- `bpm > 140` → `vibeTags` += "driving"
- `camelot` ends in `B` (major) → mood bias "uplifting"; ends in `A` (minor) → "dark"
- `bpm < 100` → `timeOfNightTags` += "opening" | "closing"
- `bpm > 128 && energy > 0.75` → `timeOfNightTags` += "peak-time"

**LLM layer** (optional, batched, cached in `results.json`):
- Send `{ artist, title, bpm, key, energy, genres }` to the LLM.
- Prompt asks for `vibeTags`, `moodTags`, `vocalType` as JSON.
- Result written back to `results.json` — never re-fetched if already present.

### Files touched

| File | Change |
|---|---|
| `app/types/index.ts` | Add optional tag fields to `Song` |
| `src/analyzer.ts` | Apply rule layer during analysis; optionally call LLM |
| `src/api.ts` | New `getSemanticTags(song)` helper if LLM path is enabled |
| `app/lib/setGenerator.ts` | `affinityBonus` can now include vibe/mood match |

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

**Goal**: let the user describe the gig (venue type, audience, duration) and get back a pre-filled
energy curve, BPM corridor, and scoring weight overrides — reducing manual curve editing to zero for
typical bookings.

### New interfaces (`app/types/index.ts`)

```ts
interface BpmCorridor {
  min:    number
  max:    number
  target: number
}

interface ScoringWeights {
  harmonic:   number  // must sum to 1.0
  bpm:        number
  affinity:   number
  vibe:       number  // Phase 1 required
  familiarity: number // Phase 5 required
  vocal:      number
  risk:       number
}

interface SetPlan {
  curve:       CurvePoint[]   // pre-filled energy curve
  bpmCorridor: BpmCorridor
  weights:     ScoringWeights
  description: string         // human-readable plan summary
}
```

### Pure function

```ts
// app/lib/venuePlanner.ts
function venueToSetPlan(prefs: DJPreferences): SetPlan
```

- **V1**: lookup table keyed on `venueType × occasionType` — deterministic, no API call.
- **V2**: send `DJPreferences` to LLM, parse structured JSON response into `SetPlan`.

### UI changes

New "AI Plan" panel in `PreferencesForm.tsx`:
- "Generate Plan" button → calls `venueToSetPlan(prefs)` → populates curve + BPM corridor.
- BPM corridor displayed as a range slider in the preferences form.
- Weight sliders (normalized to 1.0) — collapsed by default, expandable for power users.
- `EnergyCurveEditor.tsx` accepts an optional `initialCurve` prop to render the AI-suggested curve.

### Files touched

| File | Change |
|---|---|
| `app/types/index.ts` | Add `BpmCorridor`, `ScoringWeights`, `SetPlan` |
| `app/lib/venuePlanner.ts` | New file — `venueToSetPlan` pure function |
| `app/lib/setGenerator.ts` | Accept optional `ScoringWeights` override |
| `app/components/PreferencesForm.tsx` | "AI Plan" panel, weight sliders |
| `app/components/EnergyCurveEditor.tsx` | `initialCurve` prop |

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
