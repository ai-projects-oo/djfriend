/**
 * Semantic Tag Regeneration
 *
 * Re-derives vibeTags, moodTags, venueTags, timeOfNightTags for every track
 * in djfriend-results-v3.json using the current deriveSemanticTags rules and
 * the (now accurate) MixedInKey energy values.
 *
 * Run: node scripts/regen-semantic-tags.mjs
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const RESULTS_PATH = path.join(os.homedir(), 'Music', 'djfriend-results-v3.json');

// ── Inline deriveSemanticTags (mirrors src/ai.ts exactly) ────────────────────

function deriveSemanticTags({ bpm, camelot, energy, genres = [], vocalLikelihood, zcRate, bassDb, midDb }) {
  const vibeTags = [], moodTags = [], venueTags = [], timeOfNightTags = [];
  const isMinor = camelot?.endsWith('A') ?? false;
  const camelotNum = parseInt(camelot ?? '0', 10);

  // Vibe
  if (bpm > 140) vibeTags.push('driving');
  if (energy > 0.80 && bpm >= 125) vibeTags.push('intense');
  if (energy > 0.75 && bpm >= 118 && bpm <= 135 && !isMinor) vibeTags.push('groovy');
  if (energy < 0.45 && bpm < 115) vibeTags.push('dreamy');
  if (energy < 0.40 && isMinor) vibeTags.push('ethereal');
  if (energy > 0.70 && bpm >= 130 && bpm < 138 && isMinor) vibeTags.push('hypnotic');
  if (energy > 0.85 && isMinor) vibeTags.push('aggressive');
  if (energy > 0.55 && bpm >= 90 && bpm <= 115) vibeTags.push('bouncy');
  if (energy > 0.60 && bpm >= 138) vibeTags.push('raw');

  // Mood
  if (isMinor) moodTags.push('dark'); else moodTags.push('uplifting');
  if (energy < 0.40 && isMinor) moodTags.push('melancholic');
  if (energy > 0.80 && !isMinor) moodTags.push('euphoric');
  if (energy > 0.75 && isMinor) moodTags.push('tense');
  if (energy < 0.35 && !isMinor) moodTags.push('peaceful');
  if (isMinor && camelotNum >= 1 && camelotNum <= 3 && energy < 0.65) moodTags.push('mysterious');
  if (!isMinor && energy >= 0.50 && energy <= 0.75 && bpm >= 100 && bpm <= 125) moodTags.push('funky');
  if (energy < 0.55 && isMinor && bpm >= 120) moodTags.push('emotional');

  // Time of night
  if (bpm >= 128 && energy > 0.75) timeOfNightTags.push('peak-time');
  if (energy < 0.45 || bpm < 105) {
    timeOfNightTags.push('opening');
  } else if (energy < 0.65 || (bpm >= 105 && bpm < 125)) {
    timeOfNightTags.push('warm-up');
  }
  if (energy > 0.50 && bpm >= 124 && energy < 0.72) timeOfNightTags.push('after-hours');
  if (energy < 0.50 && bpm >= 115) timeOfNightTags.push('closing');

  // Venue
  if (bpm >= 125 && energy > 0.65) venueTags.push('club');
  if (bpm > 135 && energy > 0.80) venueTags.push('festival');
  if (energy < 0.55 && bpm < 125) venueTags.push('bar');
  if (energy < 0.40) venueTags.push('lounge');
  if (bpm > 135 && isMinor && energy > 0.75) venueTags.push('warehouse');

  // Vocal type
  const genreStr = genres.join(' ').toLowerCase();
  const hasVocalGenre = /\b(vocal|r&b|soul|pop|indie|rock|reggae|funk|disco|jazz|gospel|country|blues|hip.?hop|rap|singer)\b/.test(genreStr);
  const hasInstGenre = /\b(techno|minimal|ambient|drone|instrumental|deep house|progressive house)\b/.test(genreStr);

  let vocalType = 'instrumental';
  if (hasVocalGenre) {
    vocalType = 'vocal';
  } else if (hasInstGenre) {
    vocalType = 'instrumental';
  } else if (vocalLikelihood !== undefined) {
    if (vocalLikelihood >= 0.62) vocalType = 'vocal';
    else if (vocalLikelihood >= 0.42) vocalType = 'mostly-vocal';
  } else if (midDb !== undefined && bassDb !== undefined && zcRate !== undefined) {
    const midOverBass = midDb - bassDb;
    if (midOverBass > 12 && zcRate > 0.08 && zcRate < 0.20) vocalType = 'vocal';
    else if (midOverBass > 7 && zcRate > 0.06 && zcRate < 0.22) vocalType = 'mostly-vocal';
  } else if (!isMinor && bpm >= 115 && bpm <= 130 && energy >= 0.45 && energy <= 0.80) {
    vocalType = 'mostly-vocal';
  }

  const unique = arr => [...new Set(arr)];
  return {
    vibeTags:        unique(vibeTags).slice(0, 3),
    moodTags:        unique(moodTags).slice(0, 3),
    vocalType,
    venueTags:       unique(venueTags).slice(0, 2),
    timeOfNightTags: unique(timeOfNightTags).slice(0, 2),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('Reading results…');
const data = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
const songs = Object.values(data);
console.log(`  ${songs.length} tracks\n`);

let updated = 0, skippedNoBpm = 0;

for (const song of songs) {
  if (!song.bpm || !song.camelot) { skippedNoBpm++; continue; }

  song.semanticTags = deriveSemanticTags({
    bpm:             song.bpm,
    camelot:         song.camelot,
    energy:          song.energy,
    genres:          song.genres ?? [],
    vocalLikelihood: song.vocalLikelihood,
    zcRate:          song.zcRate,
    bassDb:          song.bassDb,
    midDb:           song.midDb,
  });
  updated++;
}

console.log(`Writing results…`);
fs.writeFileSync(RESULTS_PATH, JSON.stringify(data, null, 2), 'utf8');

console.log(`Done!`);
console.log(`  ${updated} tracks re-tagged`);
console.log(`  ${skippedNoBpm} skipped (no BPM or Camelot)`);

// Tag distribution summary
const allTags = Object.values(data)
  .flatMap(s => [...(s.semanticTags?.vibeTags ?? []), ...(s.semanticTags?.moodTags ?? []), ...(s.semanticTags?.venueTags ?? []), ...(s.semanticTags?.timeOfNightTags ?? [])]);
const freq = {};
for (const t of allTags) freq[t] = (freq[t] ?? 0) + 1;
const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
console.log('\nTop tags across library:');
for (const [tag, count] of sorted.slice(0, 15)) {
  const bar = '█'.repeat(Math.round(count / sorted[0][1] * 30));
  console.log(`  ${tag.padEnd(14)} ${bar} ${count}`);
}
