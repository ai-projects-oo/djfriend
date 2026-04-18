/**
 * Energy Calibration v3 — Multi-band analysis + OLS regression
 *
 * Instead of single-band features, decomposes the spectrum into 6 bands
 * and computes RMS in each. Uses OLS regression to find optimal weights
 * across ALL features simultaneously (no grid search limitation).
 *
 * Run: node scripts/calibrate-energy-v3.mjs
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const decodeAudio = require('audio-decode').default;

const MIK_RE = /^(?:\d+[-\s]+)?[0-9]{1,2}[AB]\s*-\s*(10|[1-9])\s*-\s*/i;
const RESULTS_PATH = path.join(process.env.HOME, 'Music', 'djfriend-results-v3.json');

// ── FFT (iterative Cooley-Tukey) ──────────────────────────────────────────────

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle), wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe; im[b] = im[a] - tIm;
        re[a] += tRe; im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

// ── Feature extraction ────────────────────────────────────────────────────────

const FFT_SIZE = 2048;
const NUM_FRAMES = 60;

// 6 frequency bands
const BANDS = [
  { name: 'subBass',  lo: 20,   hi: 80 },
  { name: 'bass',     lo: 80,   hi: 250 },
  { name: 'lowMid',   lo: 250,  hi: 1000 },
  { name: 'mid',      lo: 1000, hi: 4000 },
  { name: 'highMid',  lo: 4000, hi: 8000 },
  { name: 'high',     lo: 8000, hi: 20000 },
];

function extractFeatures(channelData, sampleRate) {
  const N = channelData.length;
  const halfFFT = FFT_SIZE / 2;
  const freqPerBin = sampleRate / FFT_SIZE;

  const hann = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));

  const hop = Math.max(FFT_SIZE, Math.floor((N - FFT_SIZE) / (NUM_FRAMES - 1)));
  const nFrames = Math.min(NUM_FRAMES, Math.floor((N - FFT_SIZE) / hop) + 1);

  // Accumulators for band energies (in power, will convert to dB)
  const bandPower = {};
  for (const b of BANDS) bandPower[b.name] = 0;
  let totalPower = 0;
  let sumCentroid = 0;
  let frameCount = 0;

  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);

  for (let f = 0; f < nFrames; f++) {
    const start = Math.min(f * hop, N - FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = channelData[start + i] * hann[i]; im[i] = 0; }
    fft(re, im);

    let framePower = 0;
    let weightedFreq = 0;
    const frameBandPower = {};
    for (const b of BANDS) frameBandPower[b.name] = 0;

    for (let k = 1; k < halfFFT; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      const hz = k * freqPerBin;
      framePower += power;
      weightedFreq += hz * power;
      for (const b of BANDS) {
        if (hz >= b.lo && hz < b.hi) { frameBandPower[b.name] += power; break; }
      }
    }

    if (framePower > 1e-12) {
      for (const b of BANDS) bandPower[b.name] += frameBandPower[b.name];
      totalPower += framePower;
      sumCentroid += weightedFreq / framePower;
      frameCount++;
    }
  }

  // Time-domain features
  let sumSq = 0, peakAbs = 0, zc = 0;
  for (let i = 0; i < N; i++) {
    const v = channelData[i];
    sumSq += v * v;
    if (Math.abs(v) > peakAbs) peakAbs = Math.abs(v);
    if (i > 0 && (v >= 0) !== (channelData[i - 1] >= 0)) zc++;
  }
  const rms = Math.sqrt(sumSq / N);
  const rmsDb = 20 * Math.log10(Math.max(rms, 1e-9));
  const zcRate = zc / N;
  const crestFactor = peakAbs / Math.max(rms, 1e-9);
  const centroidHz = frameCount > 0 ? sumCentroid / frameCount : 1000;

  // Band dBFS (absolute energy per band, not ratio)
  const bandDb = {};
  for (const b of BANDS) {
    const avgPower = frameCount > 0 ? bandPower[b.name] / frameCount : 1e-18;
    bandDb[b.name + 'Db'] = 10 * Math.log10(Math.max(avgPower, 1e-18));
  }

  // Band ratios (relative)
  const bandRatio = {};
  for (const b of BANDS) {
    bandRatio[b.name + 'Ratio'] = totalPower > 1e-12 ? bandPower[b.name] / totalPower : 0;
  }

  return { rmsDb, zcRate, crestFactor, centroidHz, ...bandDb, ...bandRatio };
}

// ── OLS regression (normal equation: w = (X'X)^-1 X'y) ─────────────────────

function olsRegression(X, y) {
  const n = X.length;
  const p = X[0].length;

  // X'X
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++)
    for (let j = 0; j < p; j++)
      for (let k = 0; k < n; k++)
        XtX[i][j] += X[k][i] * X[k][j];

  // X'y
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < p; i++)
    for (let k = 0; k < n; k++)
      Xty[i] += X[k][i] * y[k];

  // Solve via Gauss-Jordan elimination
  const aug = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < p; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < p; row++)
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue;
    for (let j = col; j <= p; j++) aug[col][j] /= pivot;
    for (let row = 0; row < p; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = col; j <= p; j++) aug[row][j] -= factor * aug[col][j];
    }
  }

  return aug.map(row => row[p]);
}

function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { cov += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return cov / (Math.sqrt(sa * sb) + 1e-9);
}

function mae(pred, actual) {
  return pred.reduce((s, v, i) => s + Math.abs(v - actual[i]), 0) / pred.length;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  DJFriend Energy Calibration v3 — Multi-Band + OLS          ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8'));

  const candidates = [];
  for (const s of Object.values(results)) {
    const fp = s.filePath;
    if (!fp || !fs.existsSync(fp)) continue;
    const fname = path.basename(fp);
    const m = MIK_RE.exec(fname);
    if (!m) continue;
    candidates.push({ filePath: fp, mik: parseInt(m[1]) });
  }
  console.log(`MIK-tagged tracks: ${candidates.length}\n`);

  const records = [];
  const t0 = Date.now();

  for (let i = 0; i < candidates.length; i++) {
    const { filePath, mik } = candidates[i];
    process.stdout.write(`  [${i + 1}/${candidates.length}] ${path.basename(filePath).slice(0, 55).padEnd(55)}\r`);
    try {
      const buf = fs.readFileSync(filePath);
      const audio = await decodeAudio(buf);
      let ch = audio.getChannelData(0);
      if (audio.sampleRate !== 44100) {
        const ratio = audio.sampleRate / 44100;
        const newLen = Math.floor(ch.length / ratio);
        const res = new Float32Array(newLen);
        for (let k = 0; k < newLen; k++) {
          const pos = k * ratio; const idx = Math.floor(pos);
          res[k] = idx + 1 < ch.length ? ch[idx] * (1 - pos + idx) + ch[idx + 1] * (pos - idx) : ch[idx];
        }
        ch = res;
      }
      const SKIP = 30 * 44100, LEN = 60 * 44100;
      const slice = ch.length > SKIP + LEN ? ch.slice(SKIP, SKIP + LEN) : ch.length > SKIP ? ch.slice(SKIP) : ch;
      const feats = extractFeatures(slice, 44100);
      records.push({ mik, mikNorm: mik / 10, ...feats, file: path.basename(filePath) });
    } catch { /* skip */ }
  }
  console.log(`\n\n  Analyzed ${records.length} tracks in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

  const mikVals = records.map(r => r.mikNorm);

  // ── Individual correlations ────────────────────────────────────────────────

  const allFeatureNames = [
    'rmsDb', 'zcRate', 'crestFactor', 'centroidHz',
    ...BANDS.map(b => b.name + 'Db'),
    ...BANDS.map(b => b.name + 'Ratio'),
  ];

  console.log('─── Individual Feature Correlations ──────────────────────────\n');
  const correlations = [];
  for (const fn of allFeatureNames) {
    const vals = records.map(r => r[fn]);
    const r = pearson(vals, mikVals);
    correlations.push({ name: fn, r });
  }
  correlations.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  for (const { name, r } of correlations) {
    const bar = '█'.repeat(Math.round(Math.abs(r) * 30));
    const sign = r >= 0 ? '+' : '−';
    console.log(`  ${name.padEnd(18)} r=${sign}${Math.abs(r).toFixed(3)}  ${bar}`);
  }

  // ── OLS regression with z-scored features ──────────────────────────────────

  console.log('\n─── OLS Regression (all features) ───────────────────────────\n');

  // Z-score normalization (mean=0, std=1)
  const featureStats = {};
  for (const fn of allFeatureNames) {
    const vals = records.map(r => r[fn]);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    featureStats[fn] = { mean, std: std || 1 };
  }

  // Build design matrix [n × (p+1)] with intercept column
  const X = records.map(r => {
    const row = [1]; // intercept
    for (const fn of allFeatureNames) {
      row.push((r[fn] - featureStats[fn].mean) / featureStats[fn].std);
    }
    return row;
  });

  const weights = olsRegression(X, mikVals);
  const intercept = weights[0];
  const featureWeights = weights.slice(1);

  // Predict
  const predictions = records.map(r => {
    let pred = intercept;
    for (let i = 0; i < allFeatureNames.length; i++) {
      pred += featureWeights[i] * (r[allFeatureNames[i]] - featureStats[allFeatureNames[i]].mean) / featureStats[allFeatureNames[i]].std;
    }
    return Math.max(0, Math.min(1, pred));
  });

  const r_all = pearson(predictions, mikVals);
  const mae_all = mae(predictions.map(v => v * 10), mikVals.map(v => v * 10));
  console.log(`  All features: r=${r_all.toFixed(3)}, MAE=${mae_all.toFixed(2)} MIK units`);
  console.log(`  Intercept: ${intercept.toFixed(4)}`);
  console.log('  Feature weights (by |w|):');
  const sortedWeights = allFeatureNames.map((fn, i) => ({ name: fn, w: featureWeights[i] }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  for (const { name, w } of sortedWeights) {
    if (Math.abs(w) > 0.001) {
      console.log(`    ${name.padEnd(18)} w=${w >= 0 ? '+' : ''}${w.toFixed(4)}`);
    }
  }

  // ── Stepwise: try top N features ──────────────────────────────────────────

  console.log('\n─── Stepwise Feature Selection ───────────────────────────────\n');

  const topByCorr = correlations.filter(c => Math.abs(c.r) > 0.05).map(c => c.name);

  for (const nFeats of [2, 3, 4, 5, 6]) {
    const selected = topByCorr.slice(0, nFeats);
    const Xs = records.map(r => {
      const row = [1];
      for (const fn of selected) row.push((r[fn] - featureStats[fn].mean) / featureStats[fn].std);
      return row;
    });
    const ws = olsRegression(Xs, mikVals);
    const preds = records.map(r => {
      let p = ws[0];
      for (let i = 0; i < selected.length; i++) p += ws[i + 1] * (r[selected[i]] - featureStats[selected[i]].mean) / featureStats[selected[i]].std;
      return Math.max(0, Math.min(1, p));
    });
    const rVal = pearson(preds, mikVals);
    const maeVal = mae(preds.map(v => v * 10), mikVals.map(v => v * 10));
    console.log(`  Top ${nFeats}: r=${rVal.toFixed(3)}, MAE=${maeVal.toFixed(2)}  [${selected.join(', ')}]`);
  }

  // ── Best practical model: top 3 OLS ────────────────────────────────────────

  console.log('\n─── Best Practical Model ─────────────────────────────────────\n');

  const bestFeats = topByCorr.slice(0, 4);
  const Xb = records.map(r => {
    const row = [1];
    for (const fn of bestFeats) row.push((r[fn] - featureStats[fn].mean) / featureStats[fn].std);
    return row;
  });
  const wb = olsRegression(Xb, mikVals);
  const bestPred = records.map(r => {
    let p = wb[0];
    for (let i = 0; i < bestFeats.length; i++) p += wb[i + 1] * (r[bestFeats[i]] - featureStats[bestFeats[i]].mean) / featureStats[bestFeats[i]].std;
    return Math.max(0, Math.min(1, p));
  });
  const r_best = pearson(bestPred, mikVals);
  const mae_best = mae(bestPred.map(v => v * 10), mikVals.map(v => v * 10));

  console.log(`  Features: ${bestFeats.join(', ')}`);
  console.log(`  r=${r_best.toFixed(3)}, MAE=${mae_best.toFixed(2)} MIK units`);
  console.log(`  Intercept: ${wb[0].toFixed(4)}`);
  for (let i = 0; i < bestFeats.length; i++) {
    console.log(`  ${bestFeats[i].padEnd(18)} w=${wb[i + 1] >= 0 ? '+' : ''}${wb[i + 1].toFixed(4)}  (mean=${featureStats[bestFeats[i]].mean.toFixed(3)}, std=${featureStats[bestFeats[i]].std.toFixed(3)})`);
  }

  // ── Per-track predictions sorted by MIK ────────────────────────────────────

  console.log('\n─── Predictions (sorted by MIK level) ───────────────────────\n');
  console.log('  MIK  Pred   Err   File');
  console.log('  ───  ────   ───   ────');

  const indexed = records.map((r, i) => ({ ...r, pred: bestPred[i] })).sort((a, b) => a.mik - b.mik || a.file.localeCompare(b.file));
  let correct = 0, close = 0;
  for (const r of indexed) {
    const err = (r.pred - r.mikNorm) * 10;
    const mark = Math.abs(err) < 0.5 ? '✓' : Math.abs(err) < 1.0 ? '~' : Math.abs(err) < 1.5 ? '▿' : '✗';
    if (Math.abs(err) < 0.5) correct++;
    if (Math.abs(err) < 1.5) close++;
    console.log(`  ${mark} ${r.mik}    ${(r.pred * 10).toFixed(1).padStart(4)}  ${err >= 0 ? '+' : ''}${err.toFixed(1).padStart(5)}  ${r.file.slice(0, 50)}`);
  }

  console.log(`\n  Accuracy: ${correct}/${records.length} exact (±0.5), ${close}/${records.length} close (±1.5)`);

  // ── Output formula for analyzer-core.ts ────────────────────────────────────

  console.log('\n─── Formula for analyzer-core.ts ─────────────────────────────\n');
  console.log('  // OLS-fitted formula (trained on MIK-tagged library)');
  console.log(`  // r=${r_best.toFixed(3)}, MAE=${mae_best.toFixed(2)} MIK units, n=${records.length} tracks`);
  console.log(`  const energy = Math.max(0, Math.min(1,`);
  console.log(`    ${wb[0].toFixed(4)}`);
  for (let i = 0; i < bestFeats.length; i++) {
    const fn = bestFeats[i];
    const sign = wb[i + 1] >= 0 ? '+' : '-';
    console.log(`    ${sign} (${fn} - ${featureStats[fn].mean.toFixed(4)}) / ${featureStats[fn].std.toFixed(4)} * ${Math.abs(wb[i + 1]).toFixed(4)}`);
  }
  console.log(`  ));`);

  console.log('\n═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
