# We Built an AI-Powered DJ Set Generator — Here's What We Learned

Every DJ knows the feeling. You've got a gig in two days, 800 tracks in your library, and you need a two-hour set that flows. The right harmonic transitions. The right energy arc. The right moment to peak. You spend three hours dragging tracks around in Rekordbox, second-guessing yourself.

We got tired of that. So we built DJFriend.

---

## The Problem

Building a great set isn't random — there are real rules:

- **Harmonic compatibility** — tracks that neighbor each other on the Camelot Wheel mix cleanly without key clashes
- **BPM proximity** — transitions within ±6 BPM feel natural
- **Energy arc** — a set has a shape: warm-up, build, peak, landing. Slamming peak-energy tracks at the opening kills the room

Professional DJs know this intuitively. But the actual execution is almost entirely mechanical, rule-following work. The kind of work a computer should do.

---

## What It Does

You tell DJFriend how long the set should be, your BPM range, and draw an energy curve. It gives you back a sequenced tracklist — harmonic scores, BPM transitions, energy targets for each slot.

It reads from local music folders, Apple Music, Rekordbox XML, or M3U playlists. BPM, key, and energy come from Spotify's audio features API. For tracks Spotify doesn't know, Groq AI estimates the values from artist and title context.

---

## The Algorithm

The core generator is fully deterministic — no AI in the hot path. Each next track is picked by scoring candidates against the current slot:

```
score = harmonicScore × 0.6 + bpmScore × 0.3 + affinityBonus (max 0.15)
```

**Harmonic score** uses the Camelot Wheel — perfect key match scores 1.0, neighboring keys score 0.85. **BPM score** rewards proximity. **Affinity bonus** rewards genre continuity.

Before scoring, the algorithm pre-filters to tracks within ±15% of the target energy for that slot. This keeps scoring O(n) instead of O(n²) — under 200ms on a 5,000-track library.

---

## Where AI Fits In

The deterministic engine handles technical transitions well. But it has no concept of *vibe*. A perfectly harmonic, on-BPM transition from a euphoric rave anthem to dark industrial techno is technically correct — but it feels wrong.

So we added semantic tagging via Groq (`llama-3.1-8b-instant`). Every track gets enriched with:

- **Vibe tags** — `euphoric`, `melancholic`, `driving`, `hypnotic`
- **Mood tags** — `dark`, `uplifting`, `funky`
- **Venue tags** — `festival`, `club`, `lounge`
- **Time-of-night** — `opening`, `peak-time`, `closing`

Input per track: `{ artist, title, bpm, key, energy, genres }`. Output: structured JSON via Groq's `json_schema` format — reliable, not free-text. 20 tracks per batch, 1-second rate limiter, results cached locally. A 200-track library enriches in ~10 seconds and is never re-fetched.

---

## The Hardest Parts

**Apple code signing** took the most iteration. Getting macOS builds to open without "unidentified developer" warnings requires a Developer ID certificate, notarization via Apple's `notarytool`, and stapling the ticket back to the app — all running in GitHub Actions. The environment variable name matters: `electron-builder` expects `APPLE_APP_SPECIFIC_PASSWORD` specifically. Getting that wrong silently breaks notarization.

**Icon design** was surprisingly tricky. macOS squircle icons have a corner radius of exactly 22.4% of the icon size. Not a circle, not a regular rounded rect — Apple's specific shape. We generated it with Python's Pillow:

```python
RADIUS = int(1024 * 0.224)
draw.rounded_rectangle([0, 0, 1023, 1023], radius=RADIUS, fill=255)
```

**Web/desktop parity** — the same React frontend runs both as an Electron app and a Render web service. Feature gating with `navigator.userAgent.toLowerCase().includes("electron")` keeps them in sync without a separate codebase.

---

## How We Built It — With Claude as a Co-Developer

This project was built almost entirely through conversations with **Claude Code** (Anthropic's CLI tool for Claude). Not just "write me a function" prompts — a full structured workflow where Claude acted as the development team.

### The agent team

The codebase is divided into ownership zones, and Claude runs specialized agents for each:

- `developer-core` → backend analysis pipeline (`src/`)
- `developer-ui` → React frontend (`app/components/`, `app/lib/`)
- `developer-infra` → Electron main process, build scripts, CI/CD
- `code-reviewer` → read-only gatekeeper that checks correctness before any merge

Each agent only touches its own zone. The UI agent can't modify backend logic; the backend agent can't modify components. This prevents the kind of unintended cross-contamination that makes AI-assisted development messy.

### Parallel execution with git worktrees

Independent tasks run in parallel — Claude launches multiple agents simultaneously, each in an isolated git worktree. While one agent is implementing the AI enrichment endpoint, another is building the UI component for it, and a third is writing the tests. No waiting, no bottlenecks.

### The sprint checklist (non-negotiable)

Every feature goes through this before merging:

1. `npm run build` — zero TypeScript errors
2. `npm run lint` — zero new lint errors
3. Write tests for all new logic
4. `npm test` — all green
5. Launch the `code-reviewer` agent — checks edge cases, null safety, non-negotiables
6. Fix everything the reviewer finds
7. Re-run tests
8. Human approval before merging

The reviewer has a hard checklist: no O(n²) loops in hot paths, no second `decodeAudioData` call per file, all `results.json` keys additive-only, all Spotify calls going through the rate limiter. These are flagged as blockers, not suggestions.

### What this workflow actually feels like

The human role shifts from *writing code* to *making decisions*. You review diffs, approve merges, catch things that feel wrong even when the tests pass. Claude handles the mechanical execution — the boilerplate, the consistency, the "did we update every file that needs updating" checklist.

The biggest win: Claude doesn't forget. Every constraint defined in `CLAUDE.md` is enforced on every PR, on every agent, every session. You write the rule once; it's checked forever.

The biggest limitation: Claude can't feel the music. All the vibe decisions — what makes a set *feel* right — are still human calls. The AI handles the mechanics. The taste is yours.

---

## What's Next

**Energy micro-profiles:** Instead of scoring on average track energy, compute intro/body/outro energy separately. Match the *end* of one track to the *start* of the next.

**AI venue planner:** Describe your gig in natural language — "2-hour festival closing set, peak-time techno" — and get back a pre-filled energy curve and BPM corridor automatically.

**Personal learning:** Track which songs you actually play and in what context. Boost proven tracks, gently penalize the ones you've worn out.

---

## Try It

DJFriend is free — macOS and Windows desktop builds on GitHub, plus a web demo for M3U uploads.

**GitHub:** https://github.com/ai-projects-oo/djfriend

---

*Stack: Electron · React 19 · TypeScript · Vite · Tailwind CSS 4 · Spotify API · Groq (free tier)*
*Written with Claude Code*
