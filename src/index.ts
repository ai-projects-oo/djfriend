import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { scanFolder } from './scanner';
import { analyzeAudioFile } from './analyzer';
import { AnalyzedTrack } from './types';

const { SONGS_FOLDER } = process.env;

if (!SONGS_FOLDER) {
  console.error('Missing required env var: SONGS_FOLDER');
  process.exit(1);
}
const songsFolder = SONGS_FOLDER;

async function main() {
  console.log(`Scanning folder: ${songsFolder}\n`);
  const tracks = await scanFolder(songsFolder);
  console.log(`Found ${tracks.length} audio file(s)\n`);

  const results: AnalyzedTrack[] = [];

  for (const [i, track] of tracks.entries()) {
    const label = track.artist ? `${track.artist} - ${track.title}` : track.title;
    process.stdout.write(`[${i + 1}/${tracks.length}] ${label} ... `);
    const result: AnalyzedTrack = {
      file: track.file,
      artist: track.artist,
      title: track.title,
      bpm: null,
      key: null,
      camelot: null,
      energy: null,
      genres: track.genres,
    };

    try {
      const analysis = await analyzeAudioFile(track.filePath);
      result.bpm = analysis.bpm;
      result.key = analysis.key;
      result.camelot = analysis.camelot;
      result.energy = analysis.energy;
      console.log(`ok — ${result.camelot ?? '?'} | ${result.bpm ?? '?'} BPM | energy ${result.energy ?? '?'}`);
    } catch (err: any) {
      console.log(`error: ${err.message}`);
    }

    results.push(result);
  }

  const outputPath = path.join(songsFolder, 'results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  console.log(`\nSummary: analyzed ${results.length}/${tracks.length} tracks\n`);
  console.table(
    results.map(r => ({
      File: r.file,
      Artist: r.artist ?? '?',
      Title: r.title,
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
