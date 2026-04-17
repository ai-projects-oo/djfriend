/**
 * Energy Formula Calibration Script — v2
 *
 * Extracts 7 audio features from MIK-tagged tracks, fits a weighted formula
 * via grid search, and outputs the optimal coefficients for analyzer-core.ts.
 *
 * Features:
 *   1. rmsDb         — overall loudness (dBFS)
 *   2. zcRate         — zero-crossing rate (spectral brightness proxy)
 *   3. crestFactor    — peak/RMS ratio (dynamic compression)
 *   4. spectralCentroid — center of mass of the frequency spectrum (Hz)
 *   5. spectralRolloff  — frequency below which 85% of energy lives (Hz)
 *   6. bassRatio      — fraction of spectral energy below 250 Hz
 *   7. highRatio      — fraction of spectral energy above 4 kHz
 *
 * Run: node scripts/calibrate-energy.mjs [--full]
 *   --full: analyze all MIK-tagged tracks (slow); default: sample 8 per level
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const decodeAudio = require('audio-decode').default;

const FULL_MODE = process.argv.includes('--full');
const MIK_RE = /^(?:\d+[-\s]+)?[0-9]{1,2}[AB]\s*-\s*(10|[1-9])\s*-\s*/i;
const RESULTS_PATH = path.join(process.env.HOME, 'Music', 'djfriend-results-v3.json');

// ── FFT (Cooley-Tukey radix-2) ────────────────────────────────────────────────

/**
 * In-place iterative radix-2 FFT.  n must be a power of 2.
 * Returns the real and imaginary arrays modified in-place.
 */
function fft(re, im) {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // Butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

// ── Spectral feature extraction ───────────────────────────────────────────────

const FFT_SIZE = 2048;  // 2048-point FFT → 1024 frequency bins up to Nyquist
const NUM_FRAMES = 60;  // Sample 60 frames across the analysis window

/**
 * Compute spectral features from a PCM signal using proper FFT.
 * Returns spectral centroid, rolloff, bass/mid/high energy ratios, and flux.
 */
function computeSpectralFeatures(channelData, sampleRate) {
  const N = channelData.length;
  const halfFFT = FFT_SIZE / 2;
  const freqPerBin = sampleRate / FFT_SIZE;

  // Band boundaries in bins
  const bassCutoff  = Math.round(250 / freqPerBin);   // ~250 Hz
  const midCutoff   = Math.round(4000 / freqPerBin);  // ~4000 Hz
  const rolloffTarget = 0.85; // 85th percentile

  // Hanning window
  const hann = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
  }

  const hop = Math.max(FFT_SIZE, Math.floor((N - FFT_SIZE) / (NUM_FRAMES - 1)));
  const nFrames = Math.min(NUM_FRAMES, Math.floor((N - FFT_SIZE) / hop) + 1);

  let sumCentroid = 0;
  let sumRolloff = 0;
  let sumBassRatio = 0;
  let sumHighRatio = 0;
  let sumFlux = 0;
  let prevMag = null;
  let frameCount = 0;

  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);

  for (let f = 0; f < nFrames; f++) {
    const start = Math.min(f * hop, N - FFT_SIZE);

    // Apply Hanning window
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = channelData[start + i] * hann[i];
      im[i] = 0;
    }

    fft(re, im);

    // Compute magnitude spectrum (first half only — symmetric)
    const mag = new Float64Array(halfFFT);
    let totalPower = 0;
    let weightedFreq = 0;
    let bassPower = 0;
    let highPower = 0;

    for (let k = 1; k < halfFFT; k++) {
      mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const power = mag[k] * mag[k];
      const hz = k * freqPerBin;
      totalPower += power;
      weightedFreq += hz * power;
      if (k <= bassCutoff) bassPower += power;
      if (k >= midCutoff) highPower += power;
    }

    if (totalPower > 1e-12) {
      // Spectral centroid
      sumCentroid += weightedFreq / totalPower;

      // Spectral rolloff (85th percentile frequency)
      let cumPower = 0;
      let rolloffBin = halfFFT - 1;
      for (let k = 1; k < halfFFT; k++) {
        cumPower += mag[k] * mag[k];
        if (cumPower >= rolloffTarget * totalPower) { rolloffBin = k; break; }
      }
      sumRolloff += rolloffBin * freqPerBin;

      // Band ratios
      sumBassRatio += bassPower / totalPower;
      sumHighRatio += highPower / totalPower;

      // Spectral flux (L2 norm of frame-to-frame magnitude difference)
      if (prevMag) {
        let flux = 0;
        for (let k = 1; k < halfFFT; k++) {
          const d = mag[k] - prevMag[k];
          flux += d * d;
        }
        sumFlux += Math.sqrt(flux);
      }

      prevMag = mag;
      frameCount++;
    }
  }

  if (frameCount === 0) {
    return { spectralCentroid: 1000, spectralRolloff: 2000, bassRatio: 0.33, highRatio: 0.33, spectralFlux: 0 };
  }

  return {
    spectralCentroid: sumCentroid / frameCount,
    spectralRolloff: sumRolloff / frameCount,
    bassRatio: sumBassRatio / frameCount,
    highRatio: sumHighRatio / frameCount,
    spectralFlux: sumFlux / Math.max(1, frameCount - 1),
  };
}

// ── Time-domain feature extraction ────────────────────────────────────────────

function computeTimeFeatures(channelData) {
  const N = channelData.length;
  let sumSq = 0;
  let peakAbs = 0;
  let zeroCrossings = 0;

  for (let i = 0; i < N; i++) {
    const v = channelData[i];
    sumSq += v * v;
    const absV = Math.abs(v);
    if (absV > peakAbs) peakAbs = absV;
    if (i > 0 && (v >= 0) !== (channelData[i - 1] >= 0)) zeroCrossings++;
  }

  const rms = Math.sqrt(sumSq / N);
  const rmsDb = 20 * Math.log10(Math.max(rms, 1e-9));
  const zcRate = zeroCrossings / N;
  const crestFactor = peakAbs / Math.max(rms, 1e-9);

  return { rmsDb, zcRate, crestFactor };
}

// ── All features ──────────────────────────────────────────────────────────────

function extractAllFeatures(channelData, sampleRate) {
  const time = computeTimeFeatures(channelData);
  const spectral = computeSpectralFeatures(channelData, sampleRate);

  return {
    // Raw values
    rmsDb: time.rmsDb,
    zcRate: time.zcRate,
    crestFactor: time.crestFactor,
    spectralCentroid: spectral.spectralCentroid,
    spectralRolloff: spectral.spectralRolloff,
    bassRatio: spectral.bassRatio,
    highRatio: spectral.highRatio,
    spectralFlux: spectral.spectralFlux,

    // Normalized scores (0–1) — ranges calibrated for DJ music
    rmsScore: Math.max(0, Math.min(1, (time.rmsDb + 18) / 14)),
    zcScore: Math.max(0, Math.min(1, (time.zcRate - 0.01) / 0.10)),
    crestScore: Math.max(0, Math.min(1, (20 - time.crestFactor) / 17)),
    // Spectral centroid: 500 Hz (bass-heavy) → 0.0, 5000 Hz (bright) → 1.0
    centroidScore: Math.max(0, Math.min(1, (spectral.spectralCentroid - 500) / 4500)),
    // Spectral rolloff: 1000 Hz (dark) → 0.0, 8000 Hz (bright) → 1.0
    rolloffScore: Math.max(0, Math.min(1, (spectral.spectralRolloff - 1000) / 7000)),
    // Bass ratio: inverted — more bass = less energy feeling
    bassScore: Math.max(0, Math.min(1, 1 - spectral.bassRatio * 3)),
    // High ratio: 0% → 0.0, 30%+ → 1.0
    highScore: Math.max(0, Math.min(1, spectral.highRatio / 0.30)),
    // Spectral flux: 0 → 0.0, 50+ → 1.0 (very track-dependent)
    fluxScore: Math.max(0, Math.min(1, spectral.spectralFlux / 50)),
  };
}

// ── Statistics ─────────────────────────────────────────────────────────────────

function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    sa += (a[i] - ma) ** 2;
    sb += (b[i] - mb) ** 2;
  }
  return cov / (Math.sqrt(sa * sb) + 1e-9);
}

function meanAbsError(predicted, actual) {
  let s = 0;
  for (let i = 0; i < predicted.length; i++) s += Math.abs(predicted[i] - actual[i]);
  return s / predicted.length;
}

// ── Weight fitting: exhaustive grid search over top features ──────────────────

function fitWeights(records, featureNames, targets) {
  const STEPS = 10;
  const nFeats = featureNames.length;
  if (nFeats > 5) throw new Error('Too many features for grid search — use top 4-5');

  // Generate all weight combinations that sum to 1.0 (at grid resolution)
  function* weightCombos(remaining, depth, current) {
    if (depth === nFeats - 1) {
      yield [...current, remaining / STEPS];
      return;
    }
    for (let w = 0; w <= remaining; w++) {
      yield* weightCombos(remaining - w, depth + 1, [...current, w / STEPS]);
    }
  }

  let bestW = null;
  let bestMSE = Infinity;

  for (const w of weightCombos(STEPS, 0, [])) {
    let mse = 0;
    for (let i = 0; i < records.length; i++) {
      let pred = 0;
      for (let f = 0; f < nFeats; f++) {
        pred += w[f] * records[i][featureNames[f]];
      }
      mse += (pred - targets[i]) ** 2;
    }
    mse /= records.length;
    if (mse < bestMSE) { bestMSE = mse; bestW = w; }
  }

  return { weights: bestW, mse: bestMSE, featureNames };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  DJFriend Energy Calibration v2 — Spectral Feature Analysis  ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const resultsRaw = fs.readFileSync(RESULTS_PATH, 'utf-8');
  const results = JSON.parse(resultsRaw);

  // Collect MIK-tagged tracks
  const candidates = [];
  for (const s of Object.values(results)) {
    const fp = s.filePath;
    if (!fp || !fs.existsSync(fp)) continue;
    const fname = path.basename(fp);
    const m = MIK_RE.exec(fname);
    if (!m) continue;
    candidates.push({ filePath: fp, mik: parseInt(m[1]), existingEnergy: s.energy });
  }

  console.log(`MIK-tagged tracks found: ${candidates.length}`);

  // Sample or take all
  let sample;
  if (FULL_MODE) {
    sample = candidates;
    console.log('Mode: FULL — analyzing all tracks\n');
  } else {
    const PER_LEVEL = 8;
    const byLevel = {};
    // Shuffle within each level for varied sampling
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    for (const c of shuffled) {
      if (!byLevel[c.mik]) byLevel[c.mik] = [];
      if (byLevel[c.mik].length < PER_LEVEL) byLevel[c.mik].push(c);
    }
    sample = Object.values(byLevel).flat();
    console.log(`Mode: SAMPLE — ${sample.length} tracks (up to ${PER_LEVEL} per MIK level)\n`);
  }

  // Analyze
  const records = [];
  const startTime = Date.now();

  for (let i = 0; i < sample.length; i++) {
    const { filePath, mik, existingEnergy } = sample[i];
    const fname = path.basename(filePath);
    process.stdout.write(`  [${i + 1}/${sample.length}] MIK=${mik} ${fname.slice(0, 55).padEnd(55)}\r`);

    try {
      const buf = fs.readFileSync(filePath);
      const audio = await decodeAudio(buf);
      let ch = audio.getChannelData(0);
      const sr = audio.sampleRate;

      // Resample to 44100 if needed
      if (sr !== 44100) {
        const ratio = sr / 44100;
        const newLen = Math.floor(ch.length / ratio);
        const res = new Float32Array(newLen);
        for (let k = 0; k < newLen; k++) {
          const pos = k * ratio;
          const idx = Math.floor(pos);
          res[k] = idx + 1 < ch.length ? ch[idx] * (1 - pos + idx) + ch[idx + 1] * (pos - idx) : ch[idx];
        }
        ch = res;
      }

      // Skip 30s intro, take 60s of main groove section
      const SKIP = 30 * 44100;
      const LEN  = 60 * 44100;
      const slice = ch.length > SKIP + LEN
        ? ch.slice(SKIP, SKIP + LEN)
        : ch.length > SKIP
          ? ch.slice(SKIP)
          : ch;

      const feats = extractAllFeatures(slice, 44100);
      records.push({ mik, mikNorm: mik / 10, oldEnergy: existingEnergy, file: fname, ...feats });
    } catch (err) {
      console.log(`\n  ✗ Failed: ${fname} — ${err.message}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n  Analyzed ${records.length} tracks in ${elapsed}s\n`);

  if (records.length < 10) {
    console.log('Not enough tracks for calibration. Need at least 10.');
    return;
  }

  // ── Correlation analysis ──────────────────────────────────────────────────

  const mikVals = records.map(r => r.mikNorm);

  const scoreNames = [
    'rmsScore', 'zcScore', 'crestScore',
    'centroidScore', 'rolloffScore', 'bassScore', 'highScore', 'fluxScore'
  ];

  const rawNames = [
    'rmsDb', 'zcRate', 'crestFactor',
    'spectralCentroid', 'spectralRolloff', 'bassRatio', 'highRatio', 'spectralFlux'
  ];

  console.log('─── Individual Feature Correlations with MIK Energy ───────────\n');
  console.log('  Feature              │   r   │ Strength');
  console.log('  ─────────────────────┼───────┼─────────────────');

  const correlations = {};
  for (const name of scoreNames) {
    const vals = records.map(r => r[name]);
    const r = pearson(vals, mikVals);
    correlations[name] = r;
    const bar = '█'.repeat(Math.round(Math.abs(r) * 20));
    const sign = r >= 0 ? '+' : '−';
    const strength = Math.abs(r) > 0.5 ? '★ STRONG' : Math.abs(r) > 0.3 ? '● MEDIUM' : '○ weak';
    console.log(`  ${name.padEnd(20)} │ ${sign}${Math.abs(r).toFixed(3)} │ ${bar} ${strength}`);
  }

  // ── Raw feature distributions by MIK level ───────────────────────────────

  console.log('\n─── Raw Feature Distributions by MIK Level ──────────────────\n');

  const levels = [...new Set(records.map(r => r.mik))].sort();
  for (const fn of rawNames) {
    console.log(`  ${fn}:`);
    for (const lv of levels) {
      const vals = records.filter(r => r.mik === lv).map(r => r[fn]);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      console.log(`    MIK ${lv}: ${mean.toFixed(3)} ± ${std.toFixed(3)}  [${min.toFixed(3)}..${max.toFixed(3)}]  n=${vals.length}`);
    }
    console.log();
  }

  // ── Weight fitting: try different feature combinations ────────────────────

  console.log('─── Weight Fitting (Grid Search) ──────────────────────────────\n');

  // Sort features by absolute correlation, take top 5
  const ranked = scoreNames
    .map(name => ({ name, r: Math.abs(correlations[name]) }))
    .sort((a, b) => b.r - a.r);

  console.log('  Feature ranking by |r|:');
  ranked.forEach(({ name, r }, i) => console.log(`    ${i + 1}. ${name} (|r|=${r.toFixed(3)})`));
  console.log();

  // Fit: top 3 features
  const top3 = ranked.slice(0, 3).map(r => r.name);
  const fit3 = fitWeights(records, top3, mikVals);
  const pred3 = records.map(r => top3.reduce((s, f, i) => s + fit3.weights[i] * r[f], 0));
  const r3 = pearson(pred3, mikVals);
  const mae3 = meanAbsError(pred3.map(v => v * 10), mikVals.map(v => v * 10));

  console.log(`  Top 3: ${top3.join(', ')}`);
  console.log(`    Weights: ${top3.map((f, i) => `${f}=${fit3.weights[i].toFixed(2)}`).join(', ')}`);
  console.log(`    MSE=${fit3.mse.toFixed(4)}, r=${r3.toFixed(3)}, MAE=${mae3.toFixed(2)} MIK units\n`);

  // Fit: top 4 features
  const top4 = ranked.slice(0, 4).map(r => r.name);
  const fit4 = fitWeights(records, top4, mikVals);
  const pred4 = records.map(r => top4.reduce((s, f, i) => s + fit4.weights[i] * r[f], 0));
  const r4 = pearson(pred4, mikVals);
  const mae4 = meanAbsError(pred4.map(v => v * 10), mikVals.map(v => v * 10));

  console.log(`  Top 4: ${top4.join(', ')}`);
  console.log(`    Weights: ${top4.map((f, i) => `${f}=${fit4.weights[i].toFixed(2)}`).join(', ')}`);
  console.log(`    MSE=${fit4.mse.toFixed(4)}, r=${r4.toFixed(3)}, MAE=${mae4.toFixed(2)} MIK units\n`);

  // Fit: top 5 features
  if (ranked.length >= 5) {
    const top5 = ranked.slice(0, 5).map(r => r.name);
    const fit5 = fitWeights(records, top5, mikVals);
    const pred5 = records.map(r => top5.reduce((s, f, i) => s + fit5.weights[i] * r[f], 0));
    const r5 = pearson(pred5, mikVals);
    const mae5 = meanAbsError(pred5.map(v => v * 10), mikVals.map(v => v * 10));

    console.log(`  Top 5: ${top5.join(', ')}`);
    console.log(`    Weights: ${top5.map((f, i) => `${f}=${fit5.weights[i].toFixed(2)}`).join(', ')}`);
    console.log(`    MSE=${fit5.mse.toFixed(4)}, r=${r5.toFixed(3)}, MAE=${mae5.toFixed(2)} MIK units\n`);
  }

  // ── Pick best model ──────────────────────────────────────────────────────

  const bestFit = [
    { fit: fit3, r: r3, mae: mae3, name: 'top3' },
    { fit: fit4, r: r4, mae: mae4, name: 'top4' },
  ].sort((a, b) => a.fit.mse - b.fit.mse)[0];

  console.log(`─── Best Model: ${bestFit.name} ──────────────────────────────────────────\n`);
  console.log(`  r = ${bestFit.r.toFixed(3)}, MAE = ${bestFit.mae.toFixed(2)} MIK units\n`);
  console.log('  Formula:');
  console.log('    energy =');
  for (let i = 0; i < bestFit.fit.featureNames.length; i++) {
    const op = i === 0 ? '      ' : '    + ';
    console.log(`${op}${bestFit.fit.featureNames[i].padEnd(16)} × ${bestFit.fit.weights[i].toFixed(2)}`);
  }

  // ── Per-track predictions ─────────────────────────────────────────────────

  console.log('\n─── Sample Predictions ────────────────────────────────────────\n');
  console.log('  MIK  New    Old    Err   File');
  console.log('  ───  ───    ───    ───   ────');

  const finalPred = records.map(r =>
    bestFit.fit.featureNames.reduce((s, f, i) => s + bestFit.fit.weights[i] * r[f], 0)
  );

  // Sort by MIK level for readability
  const indexed = records.map((r, i) => ({ ...r, pred: finalPred[i] }));
  indexed.sort((a, b) => a.mik - b.mik || a.file.localeCompare(b.file));

  for (const r of indexed) {
    const err = (r.pred - r.mikNorm) * 10;
    const mark = Math.abs(err) < 0.5 ? '✓' : Math.abs(err) < 1.0 ? '~' : Math.abs(err) < 1.5 ? '▿' : '✗';
    console.log(`  ${mark} ${r.mik}    ${(r.pred * 10).toFixed(1).padStart(4)}   ${(r.oldEnergy * 10).toFixed(1).padStart(4)}   ${err >= 0 ? '+' : ''}${err.toFixed(1).padStart(4)}  ${r.file.slice(0, 45)}`);
  }

  // ── Suggested code ────────────────────────────────────────────────────────

  console.log('\n─── Suggested analyzer-core.ts Formula ────────────────────────\n');
  const { featureNames: fNames, weights: fWeights } = bestFit.fit;

  // Map score names to raw computation
  const scoreToCode = {
    rmsScore: 'Math.max(0, Math.min(1, (rmsDb + 18) / 14))',
    zcScore: 'Math.max(0, Math.min(1, (zcRate - 0.01) / 0.10))',
    crestScore: 'Math.max(0, Math.min(1, (20 - crestFactor) / 17))',
    centroidScore: 'Math.max(0, Math.min(1, (spectralCentroid - 500) / 4500))',
    rolloffScore: 'Math.max(0, Math.min(1, (spectralRolloff - 1000) / 7000))',
    bassScore: 'Math.max(0, Math.min(1, 1 - bassRatio * 3))',
    highScore: 'Math.max(0, Math.min(1, highRatio / 0.30))',
    fluxScore: 'Math.max(0, Math.min(1, spectralFlux / 50))',
  };

  for (let i = 0; i < fNames.length; i++) {
    if (fWeights[i] > 0) {
      console.log(`  const ${fNames[i]} = ${scoreToCode[fNames[i]]};`);
    }
  }
  console.log(`  const energy = Math.round((`);
  const terms = fNames.filter((_, i) => fWeights[i] > 0);
  const tWeights = fNames.map((_, i) => fWeights[i]).filter(w => w > 0);
  for (let i = 0; i < terms.length; i++) {
    const sep = i === 0 ? '    ' : '  + ';
    console.log(`${sep}${terms[i].padEnd(16)} * ${tWeights[i].toFixed(2)}`);
  }
  console.log(`  ) * 1000) / 1000;`);

  console.log('\n══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
