# DJFriend

**Build smarter DJ sets — harmonic mixing, energy curves, and AI-powered track selection.**

DJFriend is a desktop app for DJs. Load your music library, draw an energy curve, and let DJFriend generate a tracklist that flows harmonically, matches your target energy arc, and fits your set duration. Think of it as a smart set planner that does the crate-digging math for you.

---

## How it works

- **Harmonic mixing** — tracks in compatible keys sound smooth together. DJFriend scores every possible transition and picks the best one automatically.
- **Energy arc** — you draw a curve showing how you want energy to build and drop across your set. DJFriend matches tracks to each point on that curve.
- **You stay in control** — every track can be swapped, reordered, or removed. The generator is a starting point, not a final answer.

---

## Features

- Energy curve editor with presets (Build-up, Peak, Valley, Steady, W-shape)
- Automatic harmonic compatibility scoring
- BPM continuity scoring
- Genre and semantic tag filters — Vibe, Mood, Venue, Time of night, Vocal/Instrumental
- Set duration control (30 – 180 min)
- Load your library from a local folder, Apple Music, M3U/TXT file, or Rekordbox XML
- Drag-to-reorder tracklist
- Harmonic warning badges with one-click swap suggestions
- Export as M3U playlist or directly to Spotify
- Full set history — save, rename, reload, and re-export any past set
- Spotify playlist checker — see which tracks from any playlist you already own

---

## Installation

1. Go to the [Releases page](../../releases)
2. Download `DJFriend Setup.exe` (Windows) or `DJFriend.dmg` (Mac)
3. Run the installer — the app launches automatically

No account required.

---

## Step 1 — Load your music

Click **Analyze** in the top-right corner. You have four options:

### Scan a folder
1. Click the gear icon (⚙) to open Settings
2. Set your **Music Folder** to the folder where your tracks live
3. Click **Analyze → Folder**

DJFriend reads BPM, key, and energy from every track in the folder. Results are cached — future loads are instant.

### Apple Music playlist (Mac only)
1. Click **Analyze → Apple Music**
2. Pick a playlist from the list

### M3U or text file
1. Click **Analyze → Import M3U / TXT**
2. Pick any `.m3u`, `.m3u8`, or `.txt` file containing file paths

Works with playlists exported from Rekordbox, Serato, or any plain text file with one track path per line.

### Rekordbox XML collection
1. In Rekordbox: **File → Export Collection in xml format**
2. In DJFriend: **Analyze → Import Rekordbox XML** → pick the `.xml` file

Your BPM and key data from Rekordbox are used directly — no re-analysis needed.

---

## Step 2 — Shape your energy arc

The **Energy Curve** editor in the left panel shows 5 draggable handles across your set timeline (left = start, right = end).

- Drag handles **up** for high energy moments, **down** for low
- Use a preset as a starting point: **Build-up**, **Peak**, **Steady**, **Valley**, or **W-shape**

The curve guides track selection — DJFriend finds the best-matching track for each position.

---

## Step 3 — Set your preferences

- **Duration** — choose how many minutes your set should run (shown below the curve)
- **Filters** (optional) — open the Filters section to narrow by genre, vibe, mood, venue type, time of night, or vocal style. Only tags found in your actual library appear here.

---

## Step 4 — Generate your set

Click **Generate**. DJFriend builds a tracklist optimized for harmonic flow, BPM continuity, and your energy curve.

From here you can:

- **Reorder** — drag any row up or down
- **Fix warnings** — tracks marked with ⚠ have a rough key transition. Click the badge to see scored alternatives and swap in a better fit.
- **Swap a track** — click the swap icon on any row to browse top alternatives
- **Regenerate** — shuffle the pool for a different arrangement
- **Generate New** — add more tracks from your library that haven't been used yet (appears when your library has more tracks than the current set needs)

---

## Step 5 — Export

**As an M3U playlist**
Click **Export → Save M3U**. The file is saved to your Playlists Folder (set in Settings). Load it in Rekordbox, Serato, or any DJ software.

**As a Spotify playlist**
Click **Export → Create Spotify Playlist**. Authorize with your Spotify account and DJFriend creates a new playlist there automatically.

---

## History

Every set you generate is saved automatically in the **History** tab. From there you can:

- Load a past set back into the generator
- Rename it
- Export it again as M3U or Spotify

---

## Import tab

Paste any Spotify playlist URL into the **Import** tab to check which tracks from that playlist you already have in your library — and which ones you're missing.

---

## Settings

| Setting | What it does |
|---|---|
| Music Folder | The folder DJFriend scans for audio files |
| Playlists Folder | Where exported M3U files are saved |
| Groq API Key | Optional — enables AI-generated tags (vibe, mood, venue type). Free at [console.groq.com](https://console.groq.com) |
