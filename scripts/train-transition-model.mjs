/**
 * DJFriend Transition Model — Training Script
 *
 * Trains a 3-layer MLP to score track-to-track transitions.
 * Labels are generated from the current deterministic scoring formula,
 * giving the model a head start; it then generalises beyond the rules.
 *
 * Architecture: 18 inputs → ReLU(32) → ReLU(32) → Sigmoid(1)
 *
 * Run: node scripts/train-transition-model.mjs
 * Output: ~/Music/djfriend-transition-model.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const RESULTS_PATH   = path.join(os.homedir(), 'Music', 'djfriend-results-v3.json');
const MODEL_OUT_PATH = path.join(os.homedir(), 'Music', 'djfriend-transition-model.json');

const H1 = 32, H2 = 32, INPUT = 18;
const SAMPLES   = 80_000;
const EPOCHS    = 30;
const BATCH     = 128;
const LR_INIT   = 0.01;
const LR_DECAY  = 0.92;   // multiply LR each epoch
const MOMENTUM  = 0.9;

// ── Camelot helpers (mirrors app/lib/camelot.ts) ─────────────────────────────

function parseCamelot(s) {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})([AB])$/i);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  if (num < 1 || num > 12) return null;
  return { num, letter: m[2].toUpperCase() };
}

function camelotCompatibility(from, to) {
  const a = parseCamelot(from), b = parseCamelot(to);
  if (!a || !b) return 'incompatible';
  if (a.num === b.num && a.letter === b.letter) return 'perfect';
  if (a.num === b.num) return 'compatible';
  const next = a.num === 12 ? 1 : a.num + 1;
  const prev = a.num === 1 ? 12 : a.num - 1;
  if (b.num === next || b.num === prev) return 'compatible';
  return 'incompatible';
}

function camelotHarmonyScore(from, to) {
  switch (camelotCompatibility(from, to)) {
    case 'perfect': case 'compatible': return 1.0;
    case 'energyBoost': return 0.75;
    default: return 0.0;
  }
}

function isCamelotClockwise(from, to) {
  const a = parseCamelot(from), b = parseCamelot(to);
  if (!a || !b) return false;
  const next = a.num === 12 ? 1 : a.num + 1;
  return b.num === next;
}

// ── Feature extraction (mirrors app/lib/mlFeatures.ts) ───────────────────────

function transitionFeatures(a, b, targetEnergy, setPosition) {
  const bpmA = a.bpm || 128, bpmB = b.bpm || 128;
  const harmony    = camelotHarmonyScore(a.camelot, b.camelot);
  const clockwise  = isCamelotClockwise(a.camelot, b.camelot) ? 1 : 0;
  const sameKey    = a.camelot === b.camelot ? 1 : 0;
  const isMinorA   = (a.camelot || '').endsWith('A') ? 1 : 0;
  const isMinorB   = (b.camelot || '').endsWith('A') ? 1 : 0;
  const bpmDelta   = Math.min(1, Math.abs(bpmB - bpmA) / 20);
  const bpmRatio   = Math.min(bpmA, bpmB) / Math.max(bpmA, bpmB);
  const eDelta     = (b.energy - a.energy + 1) / 2;
  const absEDelta  = Math.min(1, Math.abs(b.energy - a.energy) / 0.4);
  const tgtDelta   = Math.min(1, Math.abs(b.energy - targetEnergy) / 0.4);
  const pA = parseCamelot(a.camelot);
  const pB = parseCamelot(b.camelot);
  const tA = ((pA?.num ?? 1) - 1) / 12;
  const tB = ((pB?.num ?? 1) - 1) / 12;
  const setA = new Set((a.genres ?? []).map(g => g.toLowerCase()));
  const overlap = (b.genres ?? []).filter(g => setA.has(g.toLowerCase())).length;
  const genreOvlp = Math.min(1, overlap / Math.max(1, Math.max((a.genres ?? []).length, (b.genres ?? []).length)));

  return [
    bpmRatio, bpmDelta,
    a.energy, b.energy, eDelta, absEDelta, tgtDelta,
    harmony, clockwise, sameKey, isMinorA, isMinorB,
    genreOvlp, setPosition,
    Math.sin(tA * 2 * Math.PI), Math.cos(tA * 2 * Math.PI),
    Math.sin(tB * 2 * Math.PI), Math.cos(tB * 2 * Math.PI),
  ];
}

// ── Scoring formula (mirrors setGenerator.ts labels) ─────────────────────────

function scoreTransition(a, b, targetEnergy) {
  const harmonic = camelotHarmonyScore(a.camelot, b.camelot);
  const bpmA = a.bpm || 128, bpmB = b.bpm || 128;
  const bpmScore  = 1 - Math.min(1, Math.abs(bpmB - bpmA) / 20);
  const tranScore = 1 - Math.min(1, Math.abs(b.energy - a.energy) / 0.4);
  const energyScore = Math.max(0, 1 - Math.abs(b.energy - targetEnergy) / 0.4);
  return harmonic * 0.45 + bpmScore * 0.22 + tranScore * 0.08 + energyScore * 0.25;
}

// ── MLP ───────────────────────────────────────────────────────────────────────

const relu    = x => Math.max(0, x);
const reluD   = x => x > 0 ? 1 : 0;
const sigmoid = x => 1 / (1 + Math.exp(-x));

function randNormal() {
  // Box-Muller
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function initWeights() {
  const he = (fanIn) => () => randNormal() * Math.sqrt(2 / fanIn);
  const zeros = n => new Float64Array(n);
  const mat = (rows, cols, init) => Array.from({ length: rows }, () => Float64Array.from({ length: cols }, init));

  return {
    w1: mat(H1, INPUT, he(INPUT)), b1: zeros(H1),
    w2: mat(H2, H1,    he(H1)),    b2: zeros(H2),
    w3: Float64Array.from({ length: H2 }, he(H2)), b3: 0,
    // Momentum buffers
    mw1: mat(H1, INPUT, () => 0), mb1: zeros(H1),
    mw2: mat(H2, H1,    () => 0), mb2: zeros(H2),
    mw3: zeros(H2), mb3: 0,
  };
}

function forward(x, w) {
  const z1 = w.b1.map((b, j) => w.w1[j].reduce((s, wij, i) => s + wij * x[i], b));
  const h1 = z1.map(relu);
  const z2 = w.b2.map((b, j) => w.w2[j].reduce((s, wij, i) => s + wij * h1[i], b));
  const h2 = z2.map(relu);
  const z3 = w.w3.reduce((s, wi, i) => s + wi * h2[i], w.b3);
  const out = sigmoid(z3);
  return { h1, h2, z1, z2, z3, out };
}

function backward(x, y, cache, w, lr, m) {
  const { h1, h2, z1, z2, z3, out } = cache;
  const dOut = out - y;  // d(MSE)/d(out) * sigmoid'(z3) = (out-y) * out*(1-out) but via chain rule simplifies

  // Output layer
  const dZ3 = dOut * out * (1 - out);
  for (let i = 0; i < H2; i++) {
    const g = dZ3 * h2[i];
    w.mw3[i] = m * w.mw3[i] - lr * g;
    w.w3[i] += w.mw3[i];
  }
  w.mb3 = m * w.mb3 - lr * dZ3;
  w.b3 += w.mb3;

  // Layer 2
  const dH2 = new Float64Array(H2);
  for (let i = 0; i < H2; i++) dH2[i] = dZ3 * w.w3[i];
  const dZ2 = dH2.map((d, i) => d * reluD(z2[i]));
  for (let j = 0; j < H2; j++) {
    for (let i = 0; i < H1; i++) {
      const g = dZ2[j] * h1[i];
      w.mw2[j][i] = m * w.mw2[j][i] - lr * g;
      w.w2[j][i] += w.mw2[j][i];
    }
    w.mb2[j] = m * w.mb2[j] - lr * dZ2[j];
    w.b2[j] += w.mb2[j];
  }

  // Layer 1
  const dH1 = new Float64Array(H1);
  for (let i = 0; i < H1; i++)
    for (let j = 0; j < H2; j++) dH1[i] += dZ2[j] * w.w2[j][i];
  const dZ1 = dH1.map((d, i) => d * reluD(z1[i]));
  for (let j = 0; j < H1; j++) {
    for (let i = 0; i < INPUT; i++) {
      const g = dZ1[j] * x[i];
      w.mw1[j][i] = m * w.mw1[j][i] - lr * g;
      w.w1[j][i] += w.mw1[j][i];
    }
    w.mb1[j] = m * w.mb1[j] - lr * dZ1[j];
    w.b1[j] += w.mb1[j];
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('Loading library…');
const raw = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
const tracks = Object.values(raw).filter(s =>
  s.bpm > 0 && s.camelot && s.energy > 0
);
console.log(`  ${tracks.length} usable tracks\n`);

console.log(`Generating ${SAMPLES.toLocaleString()} training pairs…`);
const X = [];
const Y = [];
const n = tracks.length;

for (let i = 0; i < SAMPLES; i++) {
  const a = tracks[Math.floor(Math.random() * n)];
  const b = tracks[Math.floor(Math.random() * n)];
  if (a === b) { i--; continue; }
  const targetEnergy = Math.random();
  const pos = Math.random();
  X.push(transitionFeatures(a, b, targetEnergy, pos));
  Y.push(scoreTransition(a, b, targetEnergy));
}
console.log(`  Done.\n`);

// Shuffle
for (let i = X.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [X[i], X[j]] = [X[j], X[i]];
  [Y[i], Y[j]] = [Y[j], Y[i]];
}

const w = initWeights();
let lr = LR_INIT;

console.log('Training…');
for (let epoch = 0; epoch < EPOCHS; epoch++) {
  let loss = 0;
  const batches = Math.floor(SAMPLES / BATCH);
  for (let b = 0; b < batches; b++) {
    const start = b * BATCH;
    let batchLoss = 0;
    for (let k = 0; k < BATCH; k++) {
      const idx = start + k;
      const cache = forward(X[idx], w);
      batchLoss += (cache.out - Y[idx]) ** 2;
      backward(X[idx], Y[idx], cache, w, lr / BATCH, MOMENTUM);
    }
    loss += batchLoss / BATCH;
  }
  const mse = loss / batches;
  const rmse = Math.sqrt(mse);
  process.stdout.write(`\r  Epoch ${String(epoch + 1).padStart(2)}/${EPOCHS}  RMSE: ${rmse.toFixed(4)}  LR: ${lr.toFixed(5)}   `);
  lr *= LR_DECAY;
}
console.log('\n');

// Validate: compare model vs formula on 1000 held-out pairs
let correct = 0;
for (let i = 0; i < 1000; i++) {
  const a = tracks[Math.floor(Math.random() * n)];
  const b = tracks[Math.floor(Math.random() * n)];
  const c = tracks[Math.floor(Math.random() * n)];
  if (a === b || a === c) continue;
  const tgt = Math.random(), pos = Math.random();
  const scoreB = scoreTransition(a, b, tgt);
  const scoreC = scoreTransition(a, c, tgt);
  const predB = forward(transitionFeatures(a, b, tgt, pos), w).out;
  const predC = forward(transitionFeatures(a, c, tgt, pos), w).out;
  if ((scoreB > scoreC) === (predB > predC)) correct++;
}
console.log(`Pairwise ranking accuracy vs formula: ${(correct / 10).toFixed(1)}%\n`);

// Save — strip momentum buffers, convert to plain arrays
const model = {
  w1: w.w1.map(row => Array.from(row)),
  b1: Array.from(w.b1),
  w2: w.w2.map(row => Array.from(row)),
  b2: Array.from(w.b2),
  w3: Array.from(w.w3),
  b3: w.b3,
  version: 1,
  trainedOn: new Date().toISOString(),
  trainedSamples: SAMPLES,
};

fs.writeFileSync(MODEL_OUT_PATH, JSON.stringify(model), 'utf8');
const kb = (fs.statSync(MODEL_OUT_PATH).size / 1024).toFixed(1);
console.log(`Model saved → ${MODEL_OUT_PATH} (${kb} KB)`);
console.log(`  Params: ${H1 * INPUT + H1 + H2 * H1 + H2 + H2 + 1} total`);
