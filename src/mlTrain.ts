// Server-side MLP training — same architecture as app/lib/mlModel.ts
// 18 → ReLU(32) → ReLU(32) → Sigmoid(1)

export interface ModelWeights {
  w1: number[][]; b1: number[]
  w2: number[][]; b2: number[]
  w3: number[];   b3: number
  version: number
  trainedOn: string
  trainedSamples: number
}

function sigmoid(x: number) { return 1 / (1 + Math.exp(-x)) }

export function initWeights(): ModelWeights {
  const r = (scale: number) => (Math.random() * 2 - 1) * scale
  return {
    w1: Array.from({ length: 32 }, () => Array.from({ length: 18 }, () => r(Math.sqrt(2 / 50)))),
    b1: Array(32).fill(0),
    w2: Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => r(Math.sqrt(2 / 64)))),
    b2: Array(32).fill(0),
    w3: Array.from({ length: 32 }, () => r(Math.sqrt(2 / 33))),
    b3: 0,
    version: 0,
    trainedOn: new Date().toISOString(),
    trainedSamples: 0,
  }
}

export function mlpForward(x: number[], w: ModelWeights): number {
  const h1pre = w.w1.map((row, i) => row.reduce((s, v, j) => s + v * x[j], 0) + w.b1[i])
  const h1    = h1pre.map(v => Math.max(0, v))
  const h2pre = w.w2.map((row, i) => row.reduce((s, v, j) => s + v * h1[j], 0) + w.b2[i])
  const h2    = h2pre.map(v => Math.max(0, v))
  return sigmoid(w.w3.reduce((s, v, j) => s + v * h2[j], 0) + w.b3)
}

// Online SGD update using positive transition vectors (label=1) +
// synthetic negatives created by shuffling features (label=0).
export function trainOnVectors(
  weights: ModelWeights | null,
  vectors: number[][],
  epochs = 3,
  lr = 0.004,
): ModelWeights {
  const w = weights ?? initWeights()
  if (vectors.length === 0) return w

  // Build dataset
  const data: [number[], number][] = [
    ...vectors.map(v => [v, 1.0] as [number[], number]),
    ...vectors.map(v => {
      const s = [...v]
      for (let i = s.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [s[i], s[j]] = [s[j], s[i]]
      }
      return [s, 0.0] as [number[], number]
    }),
  ]

  for (let ep = 0; ep < epochs; ep++) {
    for (let i = data.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [data[i], data[j]] = [data[j], data[i]]
    }
    for (const [x, label] of data) {
      const h1pre = w.w1.map((row, i) => row.reduce((s, v, j) => s + v * x[j], 0) + w.b1[i])
      const h1    = h1pre.map(v => Math.max(0, v))
      const h2pre = w.w2.map((row, i) => row.reduce((s, v, j) => s + v * h1[j], 0) + w.b2[i])
      const h2    = h2pre.map(v => Math.max(0, v))
      const out   = sigmoid(w.w3.reduce((s, v, j) => s + v * h2[j], 0) + w.b3)
      const dOut  = out - label

      for (let j = 0; j < 32; j++) w.w3[j] -= lr * dOut * h2[j]
      w.b3 -= lr * dOut

      const dh2 = w.w3.map((v, j) => v * dOut * (h2pre[j] > 0 ? 1 : 0))
      for (let i = 0; i < 32; i++) {
        for (let j = 0; j < 32; j++) w.w2[i][j] -= lr * dh2[i] * h1[j]
        w.b2[i] -= lr * dh2[i]
      }

      const dh1 = Array.from({ length: 32 }, (_, j) =>
        w.w2.reduce((s, row, i) => s + row[j] * dh2[i], 0) * (h1pre[j] > 0 ? 1 : 0)
      )
      for (let i = 0; i < 32; i++) {
        for (let j = 0; j < 18; j++) w.w1[i][j] -= lr * dh1[i] * x[j]
        w.b1[i] -= lr * dh1[i]
      }
    }
  }

  w.version++
  w.trainedOn = new Date().toISOString()
  w.trainedSamples += vectors.length
  return w
}
