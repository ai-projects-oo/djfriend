import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Worker } from 'worker_threads';
import { getTracksFromPlaylist } from './apple-music';
import { authenticate, searchTrack, getArtistGenres } from './spotify';
import { toCamelot } from './camelot';
import type { AnalyzedTrack, ScannedTrack } from './types';
import type { LocalAudioFeatures } from './analyzer';

const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SONGS_FOLDER } = process.env;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  console.error('Missing required env vars: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET');
  process.exit(1);
}

// One worker per CPU core (capped at 6). Each worker loads Essentia WASM once
// and stays alive to process all tracks assigned to it.
const POOL_SIZE = Math.min(os.cpus().length, 6);

// ---------------------------------------------------------------------------
// Persistent worker pool
// ---------------------------------------------------------------------------
type PoolTask = {
  filePath: string;
  resolve: (r: LocalAudioFeatures | null) => void;
  reject: (e: Error) => void;
};

function createWorkerPool(size: number) {
  const idle: Worker[] = [];
  const queue: PoolTask[] = [];

  function dispatch(task: PoolTask) {
    if (idle.length === 0) {
      queue.push(task);
      return;
    }
    const worker = idle.pop()!;
    const onMessage = (result: LocalAudioFeatures | null) => {
      cleanup();
      idle.push(worker);
      task.resolve(result);
      if (queue.length > 0) dispatch(queue.shift()!);
    };
    const onError = (err: Error) => {
      cleanup();
      idle.push(worker);
      task.reject(err);
      if (queue.length > 0) dispatch(queue.shift()!);
    };
    function cleanup() {
      worker.off('message', onMessage);
      worker.off('error', onError);
    }
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.postMessage({ filePath: task.filePath });
  }

  // Initialise workers up front so WASM boots in parallel before tracks start
  for (let i = 0; i < size; i++) {
    const w = new Worker(new URL('./analyzer-worker.ts', import.meta.url), {
      execArgv: ['--import', 'tsx'],
    });
    idle.push(w);
  }

  return {
    run(filePath: string): Promise<LocalAudioFeatures | null> {
      return new Promise((resolve, reject) => dispatch({ filePath, resolve, reject }));
    },
    terminate() {
      for (const w of idle) w.terminate();
    },
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
function loadCache(outputPath: string): Map<string, AnalyzedTrack> {
  const cache = new Map<string, AnalyzedTrack>();
  if (!fs.existsSync(outputPath)) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8')) as AnalyzedTrack[];
    for (const track of data) cache.set(track.file, track);
    console.log(`Loaded ${cache.size} cached result(s)`);
  } catch { /* ignore corrupt cache */ }
  return cache;
}

// ---------------------------------------------------------------------------
// Per-track processing
// ---------------------------------------------------------------------------
async function processTrack(
  track: ScannedTrack,
  token: string,
  idx: number,
  total: number,
  pool: ReturnType<typeof createWorkerPool>,
): Promise<AnalyzedTrack> {
  const label = track.artist ? `${track.artist} - ${track.title}` : track.title;

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
    // Spotify search and local audio analysis run in parallel
    const t0 = Date.now();
    const [match, features] = await Promise.all([
      searchTrack(track.artist, track.title, token).then(r => {
        console.error(`  [timing] spotify search: ${Date.now() - t0}ms`);
        return r;
      }),
      pool.run(track.filePath),
    ]);

    if (match) {
      result.spotifyId = match.spotifyId;
      result.spotifyArtist = match.spotifyArtist;
      result.spotifyTitle = match.spotifyTitle;
      const tg = Date.now();
      result.genres = match.artistId ? await getArtistGenres(match.artistId, token) : [];
      console.error(`  [timing] spotify genres: ${Date.now() - tg}ms`);
    }

    if (features) {
      result.bpm = features.bpm;
      result.energy = features.energy;
      const keyInfo = toCamelot(features.pitchClass, features.mode);
      if (keyInfo) {
        result.key = keyInfo.keyName;
        result.camelot = keyInfo.camelot;
      }
    }

    const status = match
      ? `ok — ${result.camelot ?? '?'} | ${result.bpm ?? '?'} BPM | energy ${result.energy ?? '?'}`
      : 'not found on Spotify';
    console.log(`[${idx + 1}/${total}] ${label} — ${status}`);
  } catch (err: any) {
    console.log(`[${idx + 1}/${total}] ${label} — error: ${err.message}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Authenticating with Spotify...');
  const token = await authenticate(SPOTIFY_CLIENT_ID!, SPOTIFY_CLIENT_SECRET!);

  const { tracks, playlistName } = await getTracksFromPlaylist();
  console.log(`\nAnalyzing playlist: ${playlistName}`);
  console.log(`Found ${tracks.length} track(s)\n`);

  const outputDir = SONGS_FOLDER ?? process.cwd();
  const outputPath = path.join(outputDir, 'results.json');

  const cache = loadCache(outputPath);
  const toProcess = tracks.filter(t => !cache.has(t.file));
  const skipped = tracks.length - toProcess.length;

  if (toProcess.length === 0) {
    console.log('All tracks already cached!\n');
  } else {
    console.log(
      `Processing ${toProcess.length} track(s) — ${POOL_SIZE} parallel workers` +
      (skipped ? ` (${skipped} cached)` : '') +
      '\n'
    );
  }

  const resultsMap = new Map<string, AnalyzedTrack>(cache);

  function saveResults() {
    const ordered = tracks
      .map(t => resultsMap.get(t.file))
      .filter((r): r is AnalyzedTrack => r !== undefined);
    fs.writeFileSync(outputPath, JSON.stringify(ordered, null, 2));
  }

  if (toProcess.length > 0) {
    // Boot the worker pool while the user is choosing the playlist (already done
    // above) — workers load Essentia WASM in the background from here.
    const pool = createWorkerPool(POOL_SIZE);

    let nextIdx = 0;
    async function runSlot() {
      while (true) {
        const i = nextIdx++;
        if (i >= toProcess.length) break;
        const result = await processTrack(toProcess[i], token, skipped + i, tracks.length, pool);
        resultsMap.set(toProcess[i].file, result);
        saveResults();
      }
    }

    await Promise.all(Array.from({ length: Math.min(POOL_SIZE, toProcess.length) }, runSlot));
    pool.terminate();
    console.log(`\nResults saved to: ${outputPath}`);
  }

  const results = tracks
    .map(t => resultsMap.get(t.file))
    .filter((r): r is AnalyzedTrack => r !== undefined);
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
