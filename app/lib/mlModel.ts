// Pure TypeScript MLP — inference only.
// Training happens in scripts/train-transition-model.mjs.
// All functions are pure — no side effects.

export interface ModelWeights {
  w1: number[][]  // [32][INPUT_SIZE]
  b1: number[]    // [32]
  w2: number[][]  // [32][32]
  b2: number[]    // [32]
  w3: number[]    // [32]
  b3: number
  version: number
  trainedOn: string
  trainedSamples: number
}

const relu = (x: number) => (x > 0 ? x : 0)
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

export function mlpForward(features: number[], w: ModelWeights): number {
  // Layer 1: input → hidden1
  const h1 = w.b1.map((b, j) =>
    relu(w.w1[j].reduce((s, wij, i) => s + wij * features[i], b))
  )
  // Layer 2: hidden1 → hidden2
  const h2 = w.b2.map((b, j) =>
    relu(w.w2[j].reduce((s, wij, i) => s + wij * h1[i], b))
  )
  // Output layer
  const logit = w.w3.reduce((s, wi, i) => s + wi * h2[i], w.b3)
  return sigmoid(logit)
}
