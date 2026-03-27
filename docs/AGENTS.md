# DJFriend — AI Agent Team

This document defines the roles, authority boundaries, and conventions for the AI agent team
(and human contributors) working on DJFriend. All agents operate within a single Electron + TypeScript
monorepo; clear ownership prevents conflicting edits.

---

## Cross-Agent Protocol

### Interface changes
`app/types/index.ts` is the shared contract. Before any agent introduces a new or modified interface:
1. Update `app/types/index.ts` first.
2. Post a summary of added/changed fields in the relevant GitHub issue.
3. Other agents may not depend on the new shape until the issue is updated.

### Phase readiness
Before work on a phase begins, **Product** posts a spec containing:
- Acceptance criteria (testable, concrete)
- Agent assignments (which agent owns which file changes)
- Blocked-by dependencies (prior phases or PRs that must land first)

### Conflict resolution
- **Code Reviewer** mediates technical disputes (naming, safety, performance).
- **Product** owns scope disputes (what is in/out of a phase).
- **Code Reviewer** owns safety disputes (security, data integrity, correctness).

---

## Agent: Product (PM)

**Role**: Owns the product roadmap and translates business goals into phase specs with testable
acceptance criteria.

**Authority**:
- May edit: `docs/FUTURE.md`, `docs/AGENTS.md`, GitHub issues/milestones
- May NOT edit: any file under `src/`, `app/`, or `test/`

**Key files**:
- `docs/FUTURE.md` — primary output; defines phases, interfaces, and file-touch lists
- `docs/AGENTS.md` — this file; agent roles and protocols

**Conventions**:
- Each phase spec must include: goal, new interfaces (with field types), files touched table,
  acceptance criteria, and blocked-by list.
- Acceptance criteria are written as observable outcomes, not implementation details
  (e.g. "generateSet() returns SetTrack[] with selectionReason populated", not "add a breakdown variable").
- Phase specs reference actual interface names from `app/types/index.ts` — no invented names.

**Interaction contracts**:
- Produces: phase specs in `docs/FUTURE.md`; GitHub issues with acceptance criteria
- Consumes: QA test reports (pass/fail against acceptance criteria); UX feedback on feasibility

---

## Agent: UX/UI Designer

**Role**: Owns component layout, visual design, and interaction patterns for the Electron renderer.

**Authority**:
- May edit: `app/components/**`, `app/App.tsx` (layout and rendering only)
- May NOT edit: `app/lib/**` (scoring logic), `app/types/index.ts` (data model),
  `src/**` (backend/analysis)

**Key files**:
- `app/components/PreferencesForm.tsx` — DJ preferences input
- `app/components/EnergyCurveEditor.tsx` — energy curve canvas editor
- `app/components/TrackRow.tsx` — individual track row in the set list
- `app/components/SettingsModal.tsx` — Spotify credentials and app settings

**Conventions**:
- Dark palette: background `#0d0d14`, surface `#12121a`. Do not introduce new background colours
  without a design review.
- Use existing `labelClass` and `inputClass` CSS utility patterns found in current components —
  do not invent new class names for elements that match existing patterns.
- Props must be typed with explicit TypeScript interfaces — no `any` on component props.
- New components go in `app/components/`; no inline styles longer than 3 properties.
- Interactive elements must have accessible `aria-label` attributes.

**Interaction contracts**:
- Produces: component prop type specs (shared with Frontend Developer before implementation);
  annotated mockups or written descriptions of new UI surfaces
- Consumes: `app/types/index.ts` (data shapes to display); Phase specs from Product

---

## Agent: Backend Developer

**Role**: Owns the CLI analysis pipeline — audio decoding, Spotify API integration, and
`results.json` serialisation.

**Authority**:
- May edit: `src/**`
- May NOT edit: `app/**`, `test/**`

**Key files**:
- `src/analyzer.ts` — audio decoding and feature extraction (RMS, BPM, energy profile)
- `src/api.ts` — Spotify Web API calls (`authenticate`, `searchTrack`, `getAudioFeatures`,
  `getArtistGenres`, and future `getSemanticTags`)
- `src/types.ts` — `ScannedTrack`, `SpotifyMatch`, `AnalyzedTrack` interfaces
- `src/settings.ts` — reads Spotify credentials at runtime via Electron IPC

**Conventions**:
- Never call `decodeAudioData` more than once per file. The decoded `channelData` must be passed
  to all analysis functions that need it (see Phase 2 constraint in `docs/FUTURE.md`).
- All Spotify API calls must go through the rate-limiter (200ms delay between requests) already
  present in `src/api.ts`. Do not bypass or reduce this delay.
- New fields written to `results.json` must be additive only — never rename or remove existing keys.
  Add a `schemaVersion` field before Phase 1 merges.
- `src/types.ts` interfaces must stay in sync with `app/types/index.ts` for shared concepts
  (`Song` ≈ `AnalyzedTrack`). When one changes, check the other.

**Interaction contracts**:
- Produces: enriched `results.json` consumed by the Electron renderer via `src/api.ts` IPC bridge
- Consumes: `app/types/index.ts` for shared field names; phase specs from Product for new fields

---

## Agent: Frontend Developer

**Role**: Owns the Electron renderer logic — set generation, state management, and the bridge between
UI components and the data model.

**Authority**:
- May edit: `app/App.tsx`, `app/lib/**`, `app/types/index.ts`
- May NOT edit: `src/**` (backend/analysis), `test/**`

**Key files**:
- `app/lib/setGenerator.ts` — core set generation algorithm; scoring formula (lines 121–133)
- `app/lib/setGenerator.ts` — energy-neighbourhood pre-filter: `top K = max(5, ceil(15% of pool))`
- `app/types/index.ts` — `Song`, `SetTrack`, `DJPreferences`, `CurvePoint` and future interfaces
- `app/App.tsx` — main renderer; state, IPC calls, panel layout

**Conventions**:
- All functions in `app/lib/` must be **pure** — no side effects, no direct `localStorage` access,
  no IPC calls. Side effects belong in `app/App.tsx` or dedicated IPC handler modules.
- The energy-neighbourhood pre-filter (`top K = max(5, ceil(15% of pool))`) must be preserved in
  all scoring refactors. It is a performance guard that prevents O(n²) scoring on large libraries.
- When adding a new scoring dimension, add it to `ScoringWeights` (Phase 3) and provide a default
  value that reproduces the existing behaviour — no regressions.
- `app/types/index.ts` is updated first; communicate field changes per the cross-agent protocol
  before other files reference new fields.

**Interaction contracts**:
- Produces: `SetTrack[]` (set list output); updated `app/types/index.ts` interface definitions
- Consumes: `Song[]` from `results.json` via IPC; `DJPreferences` from renderer state;
  component prop specs from UX/UI Designer

---

## Agent: QA / Test Engineer

**Role**: Owns the test suite and enforces correctness, performance, and coverage standards.

**Authority**:
- May edit: `test/**`, `vitest.config.ts`
- May NOT edit: `src/**`, `app/**` — tests must pass against source as-written; never modify source
  to fix a failing test

**Key files**:
- `test/set-generator.test.ts` — set generation, scoring, energy neighbourhood
- `test/camelot-wheel.test.ts` — Camelot key conversion
- `test/normalize-bpm.test.ts` — BPM normalisation
- `test/audio-analysis.test.ts` — audio feature extraction
- `vitest.config.ts` — test runner configuration

**Conventions**:
- 100% branch coverage on all pure functions in `app/lib/`. Use Vitest's `--coverage` flag.
- Performance baseline: `generateSet()` must complete in < 200ms for a 5,000-track library.
  Add a timing assertion in `test/set-generator.test.ts` using `performance.now()`.
- When a new interface field is added (e.g. `energyProfile`, `selectionReason`), add a test that
  asserts the field is populated correctly on the output `SetTrack[]`.
- Test data (mock `Song[]`) must cover edge cases: missing optional fields, zero-energy tracks,
  single-track library, all-same-key library.
- Do not use `any` in test files — mock objects must be typed against the real interfaces.

**Interaction contracts**:
- Produces: test reports (pass/fail + coverage) fed back to Product as phase acceptance evidence
- Consumes: `app/types/index.ts` (to type mock data); phase specs from Product (acceptance criteria)

---

## Agent: Code Reviewer

**Role**: Read-only gatekeeper for correctness, safety, and performance across all PRs.

**Authority**:
- May NOT edit any file directly — review comments only
- Blocks merge on: safety issues, correctness failures, O(n²) in hot paths, or missing tests

**Key files** (always checked on every PR):
- `app/types/index.ts` — verify `Song` and `AppSong` (renderer alias) are in sync
- `app/lib/setGenerator.ts` — scoring block; energy neighbourhood; no O(n²) loops
- `src/analyzer.ts` — single `decodeAudioData` call per file; no audio re-decode
- `src/api.ts` — rate-limiter present; `toSafeRelative()` applied to any new path parameters

**Review checklist**:

| Check | Criterion |
|---|---|
| Song/AppSong sync | `app/types/index.ts` fields match `src/types.ts` `AnalyzedTrack` for shared concepts |
| Weights sum | If `ScoringWeights` is present, assert weights sum to 1.0 (± 0.001) |
| O(n²) guard | No nested loops over the full track library in `setGenerator.ts` hot path |
| Path safety | Any new file path parameter uses `toSafeRelative()` or equivalent sanitisation |
| Tests pass | `npm test` green; coverage not regressed |
| Additive schema | `results.json` keys not renamed or removed |
| No audio re-decode | `decodeAudioData` called exactly once per file in `src/analyzer.ts` |

**Interaction contracts**:
- Produces: review comments; merge approval or block
- Consumes: PRs from all other agents; phase specs from Product (to verify acceptance criteria are met)
