export type LeadStatus =
  | 'NEW'
  | 'RESEARCHED'
  | 'READY_TO_CONTACT'
  | 'CONTACTED'
  | 'FOLLOW_UP'
  | 'REPLIED'
  | 'BOOKED'
  | 'NOT_INTERESTED'
  | 'REJECTED'

export type LocationClass = 'LOCAL' | 'TRAVEL' | 'DESTINATION'
export type ConfidenceLevel = 'VERIFIED' | 'INFERRED' | 'UNKNOWN'
export type OpportunityTier = 'HIGH_CONFIDENCE' | 'POTENTIAL' | 'WEAK' | 'REJECT'
export type EvidenceFreshness = 'VERY_FRESH' | 'FRESH' | 'MODERATE' | 'OLD' | 'HISTORICAL'

export interface EvidenceItem {
  sourceUrl: string
  sourceType: string
  discoveredAt: string
  publishedAt?: string
  summary: string
  freshness: EvidenceFreshness
}

export interface GenreClassification {
  genres: string[]
  confidence: number        // 0–100
  level: ConfidenceLevel
  evidenceBullets: string[]
  why: string
}

export interface GigContact {
  name?: string
  role?: string
  email?: string
  phone?: string
  whatsapp?: string
  instagram?: string
  facebook?: string
  linkedin?: string
  website?: string
  source?: string
  confidence: number        // 0–100
  whyThisContact: string
  bestChannel: string
  bestChannelReason: string
  secondaryChannel?: string
  secondaryChannelReason?: string
}

export interface LeadScores {
  opportunity: number       // 0–100
  contactability: number    // 0–100
  potentialValue: number    // 0–100
  locationFit: number       // 0–100
  overall: number           // 0–100 weighted
}

export interface GigLead {
  id: string
  venueName: string
  city: string
  country: string
  distanceKm?: number
  travelMinutes?: number
  locationClass: LocationClass
  opportunityDescription: string
  opportunityTier: OpportunityTier
  genre: GenreClassification
  scores: LeadScores
  contact: GigContact
  whyItFits: string[]
  evidence: EvidenceItem[]
  status: LeadStatus
  discoveredAt: string
  contactedAt?: string
  lastFollowUp?: string
  nextFollowUp?: string
  notes?: string
}

export interface GigFinderProfile {
  djName: string
  baseLocation: string
  baseLat?: number
  baseLon?: number
  searchRadiusKm: number
  maxTravelMinutes: number | null
  preferredAreas: string[]
  primaryGenres: string[]
  preferredCharacteristics: string[]
  avoidGenres: string[]
  preferredVenueTypes: string[]
  seedInstagramHandles?: string[]  // Known scene handles used to seed co-mention discovery
  minimumLeadScore: number
  scoringWeights: {
    opportunity: number
    contactability: number
    potentialValue: number
    locationFit: number
  }
  locationFitThresholds: { maxKm: number; score: number }[]
}

export interface SearchSession {
  id: string
  startedAt: string
  completedAt?: string
  status: 'RUNNING' | 'COMPLETED' | 'ERROR'
  queriesRun: number
  leadsFound: number
  leadsQualified: number
  error?: string
}
