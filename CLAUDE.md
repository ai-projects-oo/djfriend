# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run analyze      # run the analyzer (reads .env)
npm run build        # compile TypeScript to dist/
npm start            # run compiled output
```

## Architecture

Single-purpose CLI tool: scan a folder of audio files → look up each on Spotify → output enriched JSON.

**Entry point**: `src/index.ts` — orchestrates the full pipeline: auth → scan → analyze each track → write `results.json` to the songs folder.

**Pipeline stages:**
1. `src/scanner.ts` — reads audio files from `SONGS_FOLDER`, extracts artist/title from ID3 tags via `music-metadata`, falls back to filename parsing (`Artist - Title.ext`)
2. `src/spotify.ts` — Spotify Web API client using Client Credentials auth. Functions: `authenticate`, `searchTrack`, `getAudioFeatures`, `getArtistGenres`
3. `src/camelot.ts` — converts Spotify's pitch class (0–11) + mode (0/1) to Camelot wheel notation (e.g. `11B`) and human-readable key name (e.g. `A Major`)
4. `src/types.ts` — shared interfaces: `ScannedTrack`, `SpotifyMatch`, `AnalyzedTrack`

## Environment

Copy `.env.example` to `.env` and fill in:
```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SONGS_FOLDER=/path/to/songs
```

Get credentials at [developer.spotify.com](https://developer.spotify.com) — create an app, copy Client ID and Client Secret.

## Output

`results.json` is written to `SONGS_FOLDER`. Tracks not found on Spotify have `spotifyId: null` and null audio fields. Audio features (`bpm`, `key`, `camelot`, `energy`) will be `null` if the Spotify app doesn't have extended quota access to the audio features endpoint.

## Notes

- Requests are rate-limited with a 200ms delay between tracks to stay within Spotify's ~100 req/min limit
- `music-metadata` v7 uses CommonJS — keep `"module": "commonjs"` in tsconfig
