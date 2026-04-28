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

export function isValidModelWeights(w: unknown): w is ModelWeights {
  if (typeof w !== 'object' || w === null) return false
  const m = w as Record<string, unknown>
  return (
    Array.isArray(m.w1) && m.w1.length === 32 && (m.w1 as unknown[][])[0]?.length === 18 &&
    Array.isArray(m.b1) && m.b1.length === 32 &&
    Array.isArray(m.w2) && m.w2.length === 32 && (m.w2 as unknown[][])[0]?.length === 32 &&
    Array.isArray(m.b2) && m.b2.length === 32 &&
    Array.isArray(m.w3) && m.w3.length === 32 &&
    typeof m.b3 === 'number'
  )
}

// Weighted average of two models: result = a*αA + b*αB
export function blendModels(a: ModelWeights, b: ModelWeights, alphaA = 0.7): ModelWeights {
  if (!isValidModelWeights(b)) return a
  const aB = 1 - alphaA
  const blendVec = (va: number[], vb: number[]) => va.map((v, i) => v * alphaA + (vb[i] ?? 0) * aB)
  const blendMat = (ma: number[][], mb: number[][]) => ma.map((row, i) => blendVec(row, mb[i] ?? []))
  return {
    w1: blendMat(a.w1, b.w1), b1: blendVec(a.b1, b.b1),
    w2: blendMat(a.w2, b.w2), b2: blendVec(a.b2, b.b2),
    w3: blendVec(a.w3, b.w3), b3: a.b3 * alphaA + b.b3 * aB,
    version: Math.max(a.version, b.version),
    trainedOn: a.trainedOn,
    trainedSamples: a.trainedSamples + b.trainedSamples,
  }
}

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
