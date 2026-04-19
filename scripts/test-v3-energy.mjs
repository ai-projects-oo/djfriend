/**
 * Test v3 energy formula against MIK-tagged tracks.
 * Uses the same FFT + multi-band logic as analyzer-core.ts.
 *
 * Run: node scripts/test-v3-energy.mjs [--full]
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const decodeAudio = require('audio-decode').default;

const FULL_RUN = process.argv.includes('--full');
const SAMPLE_SIZE = FULL_RUN ? 9999 : 50;
const MIK_RE = /^(?:\d+[-\s]+)?[0-9]{1,2}[AB]\s*-\s*(10|[1-9])\s*-\s*/i;
const RESULTS_PATH = path.join(process.env.HOME, 'Music', 'djfriend-results-v3.json');
const OUTPUT_PATH = path.join(process.cwd(), 'test', 'energy-v3-test-results.txt');

// ── FFT (same as analyzer-core.ts) ───────────────────────────────────────────
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

// ── Multi-band feature extraction (same as analyzer-core.ts) ─────────────────
const FFT_SIZE = 2048;
const NUM_FRAMES = 60;
const ENERGY_BANDS = [
  { name: 'mid',     lo: 1000, hi: 4000 },
  { name: 'highMid', lo: 4000, hi: 8000 },
  { name: 'high',    lo: 8000, hi: 20000 },
];

function extractMultiBandFeatures(channelData, sampleRate) {
  const N = channelData.length;
  const halfFFT = FFT_SIZE / 2;
  const freqPerBin = sampleRate / FFT_SIZE;

  const hann = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));

  const hop = Math.max(FFT_SIZE, Math.floor((N - FFT_SIZE) / (NUM_FRAMES - 1)));
  const nFrames = Math.min(NUM_FRAMES, Math.floor((N - FFT_SIZE) / hop) + 1);

  const bandPower = { mid: 0, highMid: 0, high: 0 };
  let frameCount = 0;
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);

  for (let f = 0; f < nFrames; f++) {
    const start = Math.min(f * hop, N - FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = channelData[start + i] * hann[i]; im[i] = 0; }
    fft(re, im);

    let framePower = 0;
    const frameBandPower = { mid: 0, highMid: 0, high: 0 };
    for (let k = 1; k < halfFFT; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      const hz = k * freqPerBin;
      framePower += power;
      for (const b of ENERGY_BANDS) {
        if (hz >= b.lo && hz < b.hi) { frameBandPower[b.name] += power; break; }
      }
    }
    if (framePower > 1e-12) {
      for (const b of ENERGY_BANDS) bandPower[b.name] += frameBandPower[b.name];
      frameCount++;
    }
  }

  const midDb = 10 * Math.log10(Math.max(frameCount > 0 ? bandPower.mid / frameCount : 1e-18, 1e-18));
  const highMidDb = 10 * Math.log10(Math.max(frameCount > 0 ? bandPower.highMid / frameCount : 1e-18, 1e-18));
  const highDb = 10 * Math.log10(Math.max(frameCount > 0 ? bandPower.high / frameCount : 1e-18, 1e-18));

  let zc = 0;
  for (let i = 1; i < N; i++) {
    if ((channelData[i] >= 0) !== (channelData[i - 1] >= 0)) zc++;
  }
  const zcRate = zc / N;

  return { midDb, highMidDb, highDb, zcRate };
}

// ── V3 energy formula (same as analyzer-core.ts) ─────────────────────────────
function computeEnergyV3(feats) {
  return Math.round(Math.max(0, Math.min(1,
    0.5838
    + (feats.highMidDb - 28.454) / 5.648 * 0.0107
    + (feats.highDb - 26.545) / 6.372 * 0.0209
    + (feats.midDb - 32.203) / 4.492 * 0.0141
    + (feats.zcRate - 0.064) / 0.029 * 0.0016
  )) * 1000) / 1000;
}

// ── Stats ────────────────────────────────────────────────────────────────────
function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { cov += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return cov / (Math.sqrt(sa * sb) + 1e-9);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8'));

  const candidates = [];
  for (const s of Object.values(results)) {
    const fp = s.filePath;
    if (!fp || !fs.existsSync(fp)) continue;
    const fname = path.basename(fp);
    const m = MIK_RE.exec(fname);
    if (!m) continue;
    candidates.push({ filePath: fp, mik: parseInt(m[1]), fname });
  }

  // Shuffle and sample
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const sample = candidates.slice(0, SAMPLE_SIZE);

  console.log(`\n  Testing v3 energy formula against ${sample.length}/${candidates.length} MIK-tagged tracks\n`);

  const records = [];
  const t0 = Date.now();

  for (let i = 0; i < sample.length; i++) {
    const { filePath, mik, fname } = sample[i];
    process.stdout.write(`  [${i + 1}/${sample.length}] ${fname.slice(0, 55).padEnd(55)}\r`);
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
      // Same windowing as analyzer-core.ts: skip 30s, take 60s
      const SKIP = 30 * 44100, LEN = 60 * 44100;
      const analysisEnd = Math.floor(ch.length * 0.75);
      const energySlice = ch.slice(0, analysisEnd);

      const feats = extractMultiBandFeatures(energySlice, 44100);
      const energy = computeEnergyV3(feats);
      const mikNorm = mik / 10;
      const err = energy - mikNorm;
      records.push({ mik, mikNorm, energy, err: Math.abs(err), errSigned: err, fname, ...feats });
    } catch (e) {
      /* skip */
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n\n  Analyzed ${records.length} tracks in ${elapsed}s\n`);

  // Sort by MIK for display
  records.sort((a, b) => a.mik - b.mik || a.fname.localeCompare(b.fname));

  const mikVals = records.map(r => r.mikNorm);
  const predVals = records.map(r => r.energy);
  const r = pearson(mikVals, predVals);
  const maeVal = records.reduce((s, r) => s + r.err, 0) / records.length;

  // Accuracy buckets
  const exact = records.filter(r => r.err <= 0.05).length;     // ±0.5 MIK unit
  const close = records.filter(r => r.err <= 0.15).length;     // ±1.5 MIK units
  const far = records.filter(r => r.err > 0.15).length;

  const lines = [];
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  DJFriend v3 Energy Test — analyzer-core.ts implementation   ');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`  Tracks tested: ${records.length}/${candidates.length}`);
  lines.push(`  Time: ${elapsed}s`);
  lines.push(`  Pearson r: ${r.toFixed(3)}`);
  lines.push(`  MAE: ${(maeVal * 10).toFixed(2)} MIK units`);
  lines.push(`  Exact (±0.5 MIK): ${exact}/${records.length} (${(exact/records.length*100).toFixed(0)}%)`);
  lines.push(`  Close (±1.5 MIK): ${close}/${records.length} (${(close/records.length*100).toFixed(0)}%)`);
  lines.push(`  Far   (>1.5 MIK): ${far}/${records.length} (${(far/records.length*100).toFixed(0)}%)`);
  lines.push('');
  lines.push('─── Predictions (sorted by MIK level) ───────────────────────');
  lines.push('');
  lines.push('  MIK  Pred   Err   File');
  lines.push('  ───  ────   ───   ────');

  for (const r of records) {
    const mikDisp = String(r.mik).padStart(3);
    const predMik = (r.energy * 10).toFixed(1).padStart(5);
    const errDisp = (r.errSigned >= 0 ? '+' : '') + (r.errSigned * 10).toFixed(1);
    const icon = r.err <= 0.05 ? '✓' : r.err <= 0.15 ? '▿' : '✗';
    lines.push(`  ${icon} ${mikDisp}   ${predMik}  ${errDisp.padStart(5)}  ${r.fname}`);
  }

  const output = lines.join('\n') + '\n';
  console.log(output);
  fs.writeFileSync(OUTPUT_PATH, output);
  console.log(`  Results saved to ${OUTPUT_PATH}\n`);
}

main().catch(console.error);
