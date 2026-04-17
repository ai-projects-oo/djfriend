/**
 * Energy Formula Calibration Script
 *
 * Uses MIK-tagged files as ground truth to find optimal audio feature weights.
 * Extracts features from raw PCM: RMS, crest factor, zero-crossing rate,
 * spectral centroid, high-band ratio, onset density.
 *
 * Run: node scripts/calibrate-energy.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const decodeAudio = require('audio-decode').default;

const MIK_RE = /^(?:\d+[-\s]+)?[0-9]{1,2}[AB]\s*-\s*(10|[1-9])\s*-\s*/i;
const RESULTS_PATH = path.join(process.env.HOME, 'Music', 'djfriend-results-v3.json');

// ── Feature extraction ────────────────────────────────────────────────────────

function computeFeatures(channelData, sampleRate) {
  const N = channelData.length;

  // 1. Overall RMS and dBFS
  let sumSq = 0;
  let peakAbs = 0;
  for (let i = 0; i < N; i++) {
    const v = channelData[i];
    sumSq += v * v;
    if (Math.abs(v) > peakAbs) peakAbs = Math.abs(v);
  }
  const rms = Math.sqrt(sumSq / N);
  const rmsDb = 20 * Math.log10(Math.max(rms, 1e-9));

  // 2. Crest factor (peak/RMS) — lower = more compressed = perceived louder/harder
  const crestFactor = peakAbs / Math.max(rms, 1e-9);
  // Normalize: typical range 3–20 (9.5–26 dB). Invert so "more compressed" → higher score.
  // crest 3 (5dB) = very compressed → score ~1.0; crest 20 (26dB) = dynamic → score ~0.0
  const crestScore = Math.max(0, Math.min(1, (20 - crestFactor) / 17));

  // 3. Zero-crossing rate — correlates with high-frequency content / brightness
  let zc = 0;
  for (let i = 1; i < N; i++) {
    if ((channelData[i] >= 0) !== (channelData[i - 1] >= 0)) zc++;
  }
  const zcRate = zc / N; // crossings per sample
  // Normalize: ~0.03 (bass heavy) to ~0.15 (bright/noisy). Map to 0-1.
  const zcScore = Math.max(0, Math.min(1, (zcRate - 0.03) / 0.12));

  // 4. Spectral centroid and high-band ratio via FFT over 4096 windows
  const FFT_SIZE = 4096;
  const HOP = Math.floor(sampleRate * 0.1); // 100ms hops
  const nFrames = Math.floor((N - FFT_SIZE) / HOP);

  let totalCentroid = 0;
  let totalHighBand = 0; // energy above 4kHz
  let totalSpectral = 0;
  let frameCount = 0;

  // Simple DFT centroid on downsampled signal (every 8th sample, max 512 bins)
  // for speed. We only need relative differences, not absolute accuracy.
  const STRIDE = 8; // decimate to ~5512 Hz
  const WLEN = Math.floor(FFT_SIZE / STRIDE);
  const decSr = sampleRate / STRIDE;

  for (let f = 0; f < nFrames && f < 50; f++) {
    const start = f * HOP;
    // Hanning window + DFT (manual, just N/2 bins)
    let realParts = new Float32Array(WLEN);
    let imagParts = new Float32Array(WLEN);

    // Apply Hanning window
    const windowed = new Float32Array(WLEN);
    for (let i = 0; i < WLEN; i++) {
      const sample = channelData[start + i * STRIDE] ?? 0;
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (WLEN - 1)));
      windowed[i] = sample * w;
    }

    // Cooley-Tukey FFT (power of 2 only — use WLEN or nearest power of 2)
    const fftSize = Math.pow(2, Math.floor(Math.log2(WLEN)));
    const magnitude = new Float32Array(fftSize / 2);

    // Simple O(n log n) FFT
    function fft(re, im) {
      const n = re.length;
      if (n <= 1) return;
      const even_re = new Float32Array(n / 2);
      const even_im = new Float32Array(n / 2);
      const odd_re = new Float32Array(n / 2);
      const odd_im = new Float32Array(n / 2);
      for (let i = 0; i < n / 2; i++) {
        even_re[i] = re[i * 2];
        even_im[i] = im[i * 2];
        odd_re[i] = re[i * 2 + 1];
        odd_im[i] = im[i * 2 + 1];
      }
      fft(even_re, even_im);
      fft(odd_re, odd_im);
      for (let k = 0; k < n / 2; k++) {
        const angle = -2 * Math.PI * k / n;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const tr = cos * odd_re[k] - sin * odd_im[k];
        const ti = sin * odd_re[k] + cos * odd_im[k];
        re[k] = even_re[k] + tr;
        im[k] = even_im[k] + ti;
        re[k + n / 2] = even_re[k] - tr;
        im[k + n / 2] = even_im[k] - ti;
      }
    }

    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    for (let i = 0; i < fftSize && i < windowed.length; i++) re[i] = windowed[i];

    fft(re, im);

    // Compute magnitude spectrum and spectral centroid
    let weightedFreq = 0;
    let totalPower = 0;
    let highBandPower = 0;
    const highBandHz = 4000;
    const highBinStart = Math.floor(highBandHz / (decSr / fftSize));

    for (let k = 1; k < fftSize / 2; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const power = mag * mag;
      const hz = k * decSr / fftSize;
      weightedFreq += hz * power;
      totalPower += power;
      if (k >= highBinStart) highBandPower += power;
    }

    if (totalPower > 1e-12) {
      totalCentroid += weightedFreq / totalPower;
      totalHighBand += highBandPower / totalPower;
      totalSpectral += totalPower;
      frameCount++;
    }
  }

  // Avg spectral centroid (Hz) — typical DJ music: 1500Hz (bass-heavy) to 4000Hz (bright)
  const centroidHz = frameCount > 0 ? totalCentroid / frameCount : 2000;
  const centroidScore = Math.max(0, Math.min(1, (centroidHz - 1000) / 3000));

  // High-band ratio (fraction of energy above 4kHz) — 0.05 (bass) to 0.35 (bright)
  const highBandRatio = frameCount > 0 ? totalHighBand / frameCount : 0;
  const highBandScore = Math.max(0, Math.min(1, (highBandRatio - 0.05) / 0.30));

  // 5. RMS score (updated range for DJ music)
  const rmsScore = Math.max(0, Math.min(1, (rmsDb + 18) / 14));

  return { rmsDb, rmsScore, crestFactor, crestScore, zcRate, zcScore, centroidHz, centroidScore, highBandRatio, highBandScore };
}

// ── Pearson correlation ───────────────────────────────────────────────────────

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

// ── Ordinary Least Squares (no intercept, constrained coefficients sum to 1) ─

function fitWeights(features, targets) {
  // Grid search over 4D weight space (rms, crest, zc, centroid + highband combined)
  // Constrained: all weights >= 0, sum = 1
  const steps = 6;
  let best = { w: [0.25, 0.25, 0.25, 0.25], mse: Infinity };

  for (let a = 0; a <= steps; a++) {
    for (let b = 0; b <= steps - a; b++) {
      for (let c = 0; c <= steps - a - b; c++) {
        const d = steps - a - b - c;
        const w = [a / steps, b / steps, c / steps, d / steps];

        let mse = 0;
        for (let i = 0; i < features.length; i++) {
          const pred = w[0] * features[i].rmsScore
                     + w[1] * features[i].crestScore
                     + w[2] * features[i].zcScore
                     + w[3] * features[i].centroidScore;
          mse += (pred - targets[i]) ** 2;
        }
        mse /= features.length;
        if (mse < best.mse) best = { w, mse };
      }
    }
  }
  return best;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
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

  console.log(`Found ${candidates.length} MIK-tagged tracks with valid file paths\n`);

  // Sample up to 8 tracks per energy level (balanced)
  const PER_LEVEL = 8;
  const byLevel = {};
  for (const c of candidates) {
    if (!byLevel[c.mik]) byLevel[c.mik] = [];
    if (byLevel[c.mik].length < PER_LEVEL) byLevel[c.mik].push(c);
  }

  const sample = Object.values(byLevel).flat();
  console.log(`Analyzing ${sample.length} tracks (up to ${PER_LEVEL} per MIK level)...\n`);

  const records = [];
  for (let i = 0; i < sample.length; i++) {
    const { filePath, mik } = sample[i];
    process.stdout.write(`  [${i + 1}/${sample.length}] MIK=${mik} ${path.basename(filePath).slice(0, 50)}...\r`);

    try {
      const buf = fs.readFileSync(filePath);
      const audio = await decodeAudio(buf);
      let ch = audio.getChannelData(0);

      // Resample to 44100 if needed (linear interpolation)
      if (audio.sampleRate !== 44100) {
        const ratio = audio.sampleRate / 44100;
        const newLen = Math.floor(ch.length / ratio);
        const resampled = new Float32Array(newLen);
        for (let k = 0; k < newLen; k++) {
          const pos = k * ratio;
          const idx = Math.floor(pos);
          const frac = pos - idx;
          resampled[k] = idx + 1 < ch.length ? ch[idx] * (1 - frac) + ch[idx + 1] * frac : ch[idx];
        }
        ch = resampled;
      }

      // Use middle 60s for analysis (skip 30s intro, grab main section)
      const SKIP = 30 * 44100;
      const LEN  = 60 * 44100;
      const slice = ch.length > SKIP + LEN ? ch.slice(SKIP, SKIP + LEN) : ch.slice(SKIP);

      const feats = computeFeatures(slice, 44100);
      records.push({ mik, mikNorm: mik / 10, feats, file: path.basename(filePath) });
    } catch (err) {
      // skip failed files silently
    }
  }

  console.log(`\n\nExtracted features for ${records.length} tracks\n`);

  // Correlations
  const mikNorm = records.map(r => r.mikNorm);
  const featureNames = ['rmsScore', 'crestScore', 'zcScore', 'centroidScore', 'highBandScore'];

  console.log('Pearson correlations with MIK energy (normalized 0-1):');
  for (const fn of featureNames) {
    const vals = records.map(r => r.feats[fn]);
    const r = pearson(vals, mikNorm);
    const bar = '█'.repeat(Math.round(Math.abs(r) * 20));
    const sign = r >= 0 ? '+' : '-';
    console.log(`  ${fn.padEnd(16)} r = ${sign}${Math.abs(r).toFixed(3)}  ${bar}`);
  }

  console.log('\nRaw feature ranges by MIK level:');
  const levels = [...new Set(records.map(r => r.mik))].sort();
  for (const fn of ['rmsDb', 'crestFactor', 'zcRate', 'centroidHz', 'highBandRatio']) {
    console.log(`\n  ${fn}:`);
    for (const lv of levels) {
      const vals = records.filter(r => r.mik === lv).map(r => r.feats[fn]);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      console.log(`    MIK ${lv}: ${mean.toFixed(3)} ± ${std.toFixed(3)}  (n=${vals.length})`);
    }
  }

  // Find optimal weights
  console.log('\nFitting optimal weights via grid search...');
  const { w, mse } = fitWeights(records.map(r => r.feats), mikNorm);
  console.log(`  Best weights: rms=${w[0].toFixed(2)} crest=${w[1].toFixed(2)} zc=${w[2].toFixed(2)} centroid=${w[3].toFixed(2)}`);
  console.log(`  MSE: ${mse.toFixed(4)}`);

  // Evaluate
  console.log('\nPredicted vs actual MIK (sample):');
  for (const r of records.slice(0, 10)) {
    const pred = w[0] * r.feats.rmsScore + w[1] * r.feats.crestScore + w[2] * r.feats.zcScore + w[3] * r.feats.centroidScore;
    console.log(`  MIK=${r.mik} predicted=${(pred * 10).toFixed(1)} err=${((pred - r.mikNorm) * 10).toFixed(1)}  ${r.file.slice(0, 45)}`);
  }

  // Suggest formula
  console.log('\n── Suggested formula for analyzer-core.ts ──────────────────────────────────');
  console.log(`  const rmsScore     = Math.max(0, Math.min(1, (rmsDb + 18) / 14));`);
  console.log(`  const crestScore   = Math.max(0, Math.min(1, (20 - crestFactor) / 17));`);
  console.log(`  const zcScore      = Math.max(0, Math.min(1, (zcRate - 0.03) / 0.12));`);
  console.log(`  const centroidScore = Math.max(0, Math.min(1, (centroidHz - 1000) / 3000));`);
  console.log(`  const energy = Math.round((`);
  console.log(`    rmsScore     * ${w[0].toFixed(2)} +`);
  console.log(`    crestScore   * ${w[1].toFixed(2)} +`);
  console.log(`    zcScore      * ${w[2].toFixed(2)} +`);
  console.log(`    centroidScore* ${w[3].toFixed(2)}`);
  console.log(`  ) * 1000) / 1000;`);
}

main().catch(console.error);
