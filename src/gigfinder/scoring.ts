import type { GigFinderProfile, LeadScores, LocationClass, EvidenceFreshness } from './types.js'

export function locationFitScore(
  distanceKm: number | undefined,
  thresholds: GigFinderProfile['locationFitThresholds']
): number {
  if (distanceKm === undefined) return 50
  const threshold = thresholds.find(t => t.maxKm >= distanceKm)
  return threshold ? threshold.score : 20
}

export function locationClass(
  distanceKm: number | undefined,
  radiusKm: number
): LocationClass {
  if (distanceKm === undefined) return 'LOCAL'
  if (distanceKm <= radiusKm) return 'LOCAL'
  if (distanceKm <= radiusKm * 2.5) return 'TRAVEL'
  return 'DESTINATION'
}

export function evidenceFreshness(publishedAt: string | undefined): EvidenceFreshness {
  if (!publishedAt) return 'MODERATE'
  const now = Date.now()
  const published = new Date(publishedAt).getTime()
  if (isNaN(published)) return 'MODERATE'
  const daysDiff = (now - published) / (1000 * 60 * 60 * 24)
  if (daysDiff <= 7) return 'VERY_FRESH'
  if (daysDiff <= 30) return 'FRESH'
  if (daysDiff <= 90) return 'MODERATE'
  if (daysDiff <= 365) return 'OLD'
  return 'HISTORICAL'
}

export function freshnessMultiplier(f: EvidenceFreshness): number {
  switch (f) {
    case 'VERY_FRESH': return 1.0
    case 'FRESH': return 0.95
    case 'MODERATE': return 0.85
    case 'OLD': return 0.65
    case 'HISTORICAL': return 0.3
  }
}

export function overallScore(
  scores: Omit<LeadScores, 'overall'>,
  weights: GigFinderProfile['scoringWeights']
): number {
  const raw =
    scores.opportunity * weights.opportunity +
    scores.musicFit * weights.musicFit +
    scores.contactability * weights.contactability +
    scores.potentialValue * weights.potentialValue +
    scores.locationFit * weights.locationFit
  return Math.round(raw * 10) / 10
}
