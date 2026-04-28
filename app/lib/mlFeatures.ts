// Pure feature extraction for the transition model.
// Input: two tracks + set context → 18-element feature vector.

import { camelotHarmonyScore, isCamelotClockwise, parseCamelot } from './camelot'

export const FEATURE_SIZE = 18

interface TrackInfo {
  bpm:     number
  energy:  number
  camelot: string
  genres:  string[]
}

export function transitionFeatures(
  a: TrackInfo,
  b: TrackInfo,
  targetEnergy: number,
  setPosition: number,  // 0–1
): number[] {
  const bpmA = a.bpm || 128
  const bpmB = b.bpm || 128

  const harmonyScore   = camelotHarmonyScore(a.camelot, b.camelot)
  const clockwise      = isCamelotClockwise(a.camelot, b.camelot) ? 1 : 0
  const sameKey        = a.camelot === b.camelot ? 1 : 0
  const isMinorA       = a.camelot.endsWith('A') ? 1 : 0
  const isMinorB       = b.camelot.endsWith('A') ? 1 : 0

  const bpmDeltaNorm   = Math.min(1, Math.abs(bpmB - bpmA) / 20)
  const bpmRatio       = Math.min(bpmA, bpmB) / Math.max(bpmA, bpmB)
  const energyDelta    = (b.energy - a.energy + 1) / 2    // normalized to 0–1
  const absEnergyDelta = Math.min(1, Math.abs(b.energy - a.energy) / 0.4)
  const targetDelta    = Math.min(1, Math.abs(b.energy - targetEnergy) / 0.4)

  // Camelot wheel position as sin/cos (encodes circular structure)
  const pA = parseCamelot(a.camelot)
  const pB = parseCamelot(b.camelot)
  const tA = ((pA?.num ?? 1) - 1) / 12
  const tB = ((pB?.num ?? 1) - 1) / 12
  const sinA = Math.sin(tA * 2 * Math.PI)
  const cosA = Math.cos(tA * 2 * Math.PI)
  const sinB = Math.sin(tB * 2 * Math.PI)
  const cosB = Math.cos(tB * 2 * Math.PI)

  // Genre overlap
  const setA = new Set(a.genres.map(g => g.toLowerCase()))
  const overlap = b.genres.filter(g => setA.has(g.toLowerCase())).length
  const genreOverlap = Math.min(1, overlap / Math.max(1, Math.max(a.genres.length, b.genres.length)))

  return [
    bpmRatio,         // 0–1: how well BPMs match
    bpmDeltaNorm,     // 0–1: BPM difference (normalized at 20 BPM)
    a.energy,         // 0–1
    b.energy,         // 0–1
    energyDelta,      // 0–1 (was -1..1, shifted)
    absEnergyDelta,   // 0–1
    targetDelta,      // 0–1: how far b.energy is from target
    harmonyScore,     // 0, 0.75, or 1.0
    clockwise,        // 0 or 1
    sameKey,          // 0 or 1
    isMinorA,         // 0 or 1
    isMinorB,         // 0 or 1
    genreOverlap,     // 0–1
    setPosition,      // 0–1
    sinA, cosA,       // camelot wheel A position
    sinB, cosB,       // camelot wheel B position
  ]
}
