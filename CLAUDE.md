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

Single-purpose CLI tool: scan a folder of audio files → analyze each track locally → output enriched JSON.

**Entry point**: `src/index.ts` — orchestrates the full pipeline: scan → analyze each track → write `results.json` to the songs folder.

**Pipeline stages:**
1. `src/scanner.ts` — reads audio files from `SONGS_FOLDER`, extracts artist/title from ID3 tags via `music-metadata`, falls back to filename parsing (`Artist - Title.ext`)
2. `src/analyzer.ts` — local analysis using `essentia.js` and `audio-decode` to estimate BPM, musical key/Camelot, and energy
3. `src/camelot.ts` — converts pitch class (0–11) + mode (0/1) to Camelot wheel notation (e.g. `11B`) and human-readable key name (e.g. `A Major`)
4. `src/types.ts` — shared interfaces: `ScannedTrack`, `AnalyzedTrack`

## Environment

Copy `.env.example` to `.env` and fill in:
```
SONGS_FOLDER=/path/to/songs
```

## Output

`results.json` is written to `SONGS_FOLDER`. If local extraction fails for a file, `bpm`, `key`, `camelot`, or `energy` may be `null`.

## Notes

- No API credentials are required; analysis runs fully local
- `music-metadata` v7 uses CommonJS — keep `"module": "commonjs"` in tsconfig
