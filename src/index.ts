import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getTracksFromPlaylist } from './apple-music';
import { authenticate, searchTrack, getArtistGenres } from './spotify';
import { analyzeAudio } from './analyzer';
import { toCamelot } from './camelot';
import type { AnalyzedTrack } from './types';

const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SONGS_FOLDER } = process.env;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  console.error('Missing required env vars: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET');
  process.exit(1);
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('Authenticating with Spotify...');
  const token = await authenticate(SPOTIFY_CLIENT_ID!, SPOTIFY_CLIENT_SECRET!);

  const { tracks, playlistName } = await getTracksFromPlaylist();
  console.log(`\nAnalyzing playlist: ${playlistName}`);
  console.log(`Found ${tracks.length} track(s)\n`);

  const results: AnalyzedTrack[] = [];

  for (const [i, track] of tracks.entries()) {
    const label = track.artist ? `${track.artist} - ${track.title}` : track.title;
    process.stdout.write(`[${i + 1}/${tracks.length}] ${label} ... `);
    const result: AnalyzedTrack = {
      file: track.file,
      artist: track.artist,
      title: track.title,
      spotifyId: null,
      spotifyArtist: null,
      spotifyTitle: null,
      bpm: null,
      key: null,
      camelot: null,
      energy: null,
      genres: [],
    };

    try {
      const match = await searchTrack(track.artist, track.title, token);

      if (!match) {
        console.log('not found on Spotify');
        results.push(result);
        continue;
      }

      result.spotifyId = match.spotifyId;
      result.spotifyArtist = match.spotifyArtist;
      result.spotifyTitle = match.spotifyTitle;

      const [features, genres] = await Promise.all([
        analyzeAudio(track.filePath),
        match.artistId ? getArtistGenres(match.artistId, token) : Promise.resolve([]),
      ]);
      if (features) {
        result.bpm = features.bpm;
        result.energy = features.energy;
        const keyInfo = toCamelot(features.pitchClass, features.mode);
        if (keyInfo) {
          result.key = keyInfo.keyName;
          result.camelot = keyInfo.camelot;
        }
      }

      result.genres = genres;
      console.log(`ok — ${result.camelot ?? '?'} | ${result.bpm ?? '?'} BPM | energy ${result.energy ?? '?'}`);
    } catch (err: any) {
      console.log(`error: ${err.message}`);
    }

    results.push(result);

    // Respect Spotify rate limits (~100 req/min for basic tier)
    await delay(200);
  }

  const outputDir = SONGS_FOLDER ?? process.cwd();
  const outputPath = path.join(outputDir, 'results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  // Print summary table
  const found = results.filter(r => r.spotifyId !== null);
  console.log(`\nSummary: ${found.length}/${results.length} tracks matched on Spotify\n`);
  console.table(
    results.map(r => ({
      File: r.file,
      Artist: r.spotifyArtist ?? r.artist ?? '?',
      Title: r.spotifyTitle ?? r.title,
      BPM: r.bpm ?? '—',
      Key: r.key ?? '—',
      Camelot: r.camelot ?? '—',
      Energy: r.energy ?? '—',
      Genres: r.genres.slice(0, 2).join(', ') || '—',
    }))
  );
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
