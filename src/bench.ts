/**
 * Benchmark / smoke-test for the analysis pipeline.
 *
 * Generates a synthetic WAV click-track at a known BPM, runs the full local
 * analysis pipeline, and prints per-stage timing so we can see where time goes.
 *
 * Usage:  npm run bench
 *
 * Spotify timing is also tested when SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET
 * are present in .env.
 */
import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { analyzeAudio } from './analyzer';

// ---------------------------------------------------------------------------
// Synthetic WAV generator
// ---------------------------------------------------------------------------
/**
 * Build a mono 44100 Hz 16-bit PCM WAV buffer containing a click-track at
 * `bpm` beats per minute for `durationSec` seconds.  The click is a short
 * decaying sine burst at 440 Hz so RhythmExtractor can pick up the pulse.
 */
function generateClickTrack(bpm: number, durationSec: number, sampleRate = 44100): Buffer {
  const totalSamples = Math.round(durationSec * sampleRate);
  const samplesPerBeat = Math.round((60 / bpm) * sampleRate);
  const clickLen = Math.round(sampleRate * 0.02); // 20 ms click

  const pcm = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const beatPhase = i % samplesPerBeat;
    if (beatPhase < clickLen) {
      const envelope = 1 - beatPhase / clickLen;
      pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 28000 * envelope);
    }
  }

  // WAV RIFF header
  const dataBytes = totalSamples * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);          // PCM chunk size
  header.writeUInt16LE(1, 20);           // format: PCM
  header.writeUInt16LE(1, 22);           // channels: mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);           // block align
  header.writeUInt16LE(16, 34);          // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);

  return Buffer.concat([header, Buffer.from(pcm.buffer)]);
}

// ---------------------------------------------------------------------------
// Spotify timing (optional)
// ---------------------------------------------------------------------------
async function benchSpotify() {
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    console.log('  (skipped — no Spotify credentials in .env)\n');
    return;
  }
  const { authenticate, searchTrack, getArtistGenres } = await import('./spotify');

  let t = Date.now();
  const token = await authenticate(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET);
  console.log(`  auth:         ${Date.now() - t}ms`);

  t = Date.now();
  const match = await searchTrack('Daft Punk', 'Get Lucky', token);
  console.log(`  search:       ${Date.now() - t}ms  →  ${match?.spotifyId ?? 'not found'}`);

  if (match?.artistId) {
    t = Date.now();
    const genres = await getArtistGenres(match.artistId, token);
    console.log(`  genres:       ${Date.now() - t}ms  →  ${genres.slice(0, 3).join(', ')}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Analyse a real file and print per-stage timing
// ---------------------------------------------------------------------------
async function benchFile(filePath: string) {
  const label = path.basename(filePath);
  const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
  console.log(`\n[ ${label} — ${sizeMB} MB ]\n`);

  const wallStart = Date.now();
  const result = await analyzeAudio(filePath);
  const wallMs = Date.now() - wallStart;

  console.log('\n  --- result ---');
  if (!result) {
    console.log('  analyzeAudio returned null');
  } else {
    console.log(`  BPM:    ${result.bpm}`);
    console.log(`  pitch:  ${result.pitchClass}  mode: ${result.mode === 1 ? 'major' : 'minor'}`);
    console.log(`  energy: ${result.energy}`);
  }
  console.log(`  TOTAL: ${wallMs}ms\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const REAL_FILES = [
  '/Users/oded/Downloads/Jaydee – Plastic Dreams.mp3',
  '/Users/oded/Downloads/Lello B – L.O.V.E (Lello B Remix).mp3',
  '/Users/oded/Downloads/Mariah Carey – Hero.mp3',
];

async function main() {
  const TARGET_BPM = 128;
  const DURATION_SEC = 60;

  console.log('=== djfriend pipeline benchmark ===\n');

  // --- Spotify ---
  console.log('[ Spotify ]');
  await benchSpotify();

  // --- Synthetic click-track ---
  console.log(`[ Synthetic click-track — ${DURATION_SEC}s @ ${TARGET_BPM} BPM ]\n`);
  const wav = generateClickTrack(TARGET_BPM, DURATION_SEC);
  const tmpPath = path.join(os.tmpdir(), 'djfriend-bench.wav');
  fs.writeFileSync(tmpPath, wav);
  console.log(`  generated: ${tmpPath}  (${(wav.length / 1024).toFixed(0)} KB)\n`);

  const wallStart = Date.now();
  const result = await analyzeAudio(tmpPath);
  const wallMs = Date.now() - wallStart;
  fs.unlinkSync(tmpPath);

  console.log('\n  --- result ---');
  if (!result) {
    console.log('  analyzeAudio returned null');
  } else {
    const bpmOk = Math.abs(result.bpm - TARGET_BPM) < 5 || Math.abs(result.bpm * 2 - TARGET_BPM) < 5;
    console.log(`  BPM:    ${result.bpm}  (expected ~${TARGET_BPM}) ${bpmOk ? '✓' : '⚠ unexpected'}`);
    console.log(`  pitch:  ${result.pitchClass}  mode: ${result.mode === 1 ? 'major' : 'minor'}`);
    console.log(`  energy: ${result.energy}`);
  }
  console.log(`  TOTAL: ${wallMs}ms\n`);

  // --- Real MP3s ---
  for (const f of REAL_FILES) {
    if (!fs.existsSync(f)) {
      console.log(`\n[ SKIP — not found: ${path.basename(f)} ]`);
      continue;
    }
    await benchFile(f);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
