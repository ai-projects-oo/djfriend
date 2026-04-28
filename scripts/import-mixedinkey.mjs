/**
 * MixedInKey Library Import
 *
 * Reads Camelot key + energy from MixedInKey-renamed filenames across the
 * entire Apple Music library and populates djfriend-results-v3.json.
 *
 * For existing entries: updates energy + camelot from MXK (more accurate than RMS).
 * For new entries: reads BPM/artist/title from ID3 tags + folder structure.
 *
 * Run: node scripts/import-mixedinkey.mjs
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';

const require = createRequire(import.meta.url);
const id3 = require('node-id3');

const MUSIC_FOLDER = path.join(os.homedir(), 'Music', 'Music', 'Media.localized', 'Music');
const RESULTS_PATH = path.join(os.homedir(), 'Music', 'djfriend-results-v3.json');
const AUDIO_EXTS = new Set(['.mp3', '.aiff', '.aif', '.flac', '.m4a', '.wav']);

// MixedInKey filename pattern: "[optional track#] KEY - ENERGY - Title"
const MIK_RE = /(\d{1,2}[AB])\s*-\s*(10|[1-9])\s*-\s*/i;

const CAMELOT_TO_KEY = {
  '1A': 'A♭ Minor',  '1B': 'B Major',
  '2A': 'E♭ Minor',  '2B': 'F♯ Major',
  '3A': 'B♭ Minor',  '3B': 'D♭ Major',
  '4A': 'F Minor',   '4B': 'A♭ Major',
  '5A': 'C Minor',   '5B': 'E♭ Major',
  '6A': 'G Minor',   '6B': 'B♭ Major',
  '7A': 'D Minor',   '7B': 'F Major',
  '8A': 'A Minor',   '8B': 'C Major',
  '9A': 'E Minor',   '9B': 'G Major',
  '10A': 'B Minor',  '10B': 'D Major',
  '11A': 'F♯ Minor', '11B': 'A Major',
  '12A': 'C♯ Minor', '12B': 'E Major',
};

function walkDir(dir, results = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(full, results);
    else if (AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) results.push(full);
  }
  return results;
}

function processFile(filePath, existing) {
  const basename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const nameNoExt = path.basename(filePath, ext);

  const mxMatch = nameNoExt.match(MIK_RE);
  if (!mxMatch) return null;

  const camelot = mxMatch[1].toUpperCase();
  const mxEnergy = parseInt(mxMatch[2], 10);
  const energy = parseFloat(((mxEnergy - 1) / 9).toFixed(3));
  const key = CAMELOT_TO_KEY[camelot] ?? null;

  // Track already fully analyzed — just refresh energy + key from MXK
  if (existing[filePath]) {
    return { kind: 'update', filePath, patch: { camelot, key, energy, mxEnergy } };
  }

  // New track — read ID3 tags synchronously (fast, no stream overhead)
  let bpm = null, artist = null, title = null, genres = [], year = null;
  if (ext === '.mp3') {
    try {
      const tags = id3.read(filePath);
      bpm = tags.bpm ? parseInt(tags.bpm, 10) || null : null;
      artist = tags.artist ?? null;
      title = tags.title ?? null;
      genres = tags.genre ? [tags.genre] : [];
      year = tags.year ? parseInt(tags.year, 10) || null : null;
    } catch { /* ignore corrupt tags */ }
  }

  // Derive artist from folder: .../Music/<Artist>/<Album>/file
  const parts = filePath.split(path.sep);
  const artistFromFolder = parts.length >= 3 ? parts[parts.length - 3] : null;
  // Clean MXK prefix from title ("01 7A - 6 - ")
  const cleanTitle = nameNoExt.replace(/^[\d-]+\s+/, '').replace(MIK_RE, '').trim();
  // Remove MXK prefix from ID3 title if music-metadata left it there
  const cleanId3Title = title ? title.replace(MIK_RE, '').trim() : null;

  return {
    kind: 'add',
    filePath,
    entry: {
      filePath,
      file: basename,
      artist: artist ?? artistFromFolder ?? '',
      title: cleanId3Title ?? cleanTitle,
      bpm,
      key,
      camelot,
      energy,
      mxEnergy,
      genres,
      year,
    },
  };
}

function main() {
  console.log('Reading existing results…');
  const existing = fs.existsSync(RESULTS_PATH)
    ? JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'))
    : {};
  console.log(`  ${Object.keys(existing).length} tracks already in results.json`);

  console.log(`\nWalking: ${MUSIC_FOLDER}`);
  const allFiles = walkDir(MUSIC_FOLDER);
  console.log(`  Found ${allFiles.length} audio files\n`);

  let added = 0, updated = 0, skipped = 0;

  for (let i = 0; i < allFiles.length; i++) {
    const r = processFile(allFiles[i], existing);
    if (!r) { skipped++; }
    else if (r.kind === 'update') { existing[r.filePath] = { ...existing[r.filePath], ...r.patch }; updated++; }
    else { existing[r.filePath] = r.entry; added++; }

    if ((i + 1) % 100 === 0 || i + 1 === allFiles.length) {
      process.stdout.write(`\r  ${i + 1}/${allFiles.length} — added: ${added}  updated: ${updated}  no MXK: ${skipped}   `);
    }
    // Save every 1000 tracks
    if ((i + 1) % 1000 === 0) {
      fs.writeFileSync(RESULTS_PATH, JSON.stringify(existing, null, 2), 'utf8');
    }
  }

  console.log('\n\nWriting results.json…');
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(existing, null, 2), 'utf8');

  const total = Object.keys(existing).length;
  console.log(`\nDone!`);
  console.log(`  ${added} new tracks added from MixedInKey tags`);
  console.log(`  ${updated} existing tracks updated with MXK energy/key`);
  console.log(`  ${skipped} files skipped (no MXK tag in filename)`);
  console.log(`  ${total} total tracks in results.json`);

  // Energy distribution
  const songs = Object.values(existing).filter(s => s.mxEnergy);
  const dist = Array.from({ length: 10 }, (_, i) => ({
    level: i + 1,
    count: songs.filter(s => s.mxEnergy === i + 1).length,
  }));
  console.log('\nMixedInKey energy distribution (1=low … 10=peak):');
  const maxCount = Math.max(...dist.map(d => d.count));
  for (const { level, count } of dist) {
    const bar = '█'.repeat(Math.round(count / maxCount * 40));
    console.log(`  ${String(level).padStart(2)}: ${bar.padEnd(40)} ${count}`);
  }
}

main();
