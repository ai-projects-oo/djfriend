import path from 'path'
import fs from 'fs'
import os from 'os'
import type { GigLead, GigFinderProfile } from './types.js'

const LEADS_PATH = path.join(os.homedir(), 'Music', 'djfriend-gigfinder-leads.json')
const PROFILE_PATH = path.join(os.homedir(), 'Music', 'djfriend-gigfinder-profile.json')

const DEFAULT_PROFILE: GigFinderProfile = {
  djName: 'Oz',
  baseLocation: 'Petah Tikva, Israel',
  baseLat: 32.089,
  baseLon: 34.887,
  searchRadiusKm: 40,
  maxTravelMinutes: null,
  preferredAreas: ['Tel Aviv', 'Ramat Gan', 'Herzliya', 'Rishon LeZion'],
  primaryGenres: ['House', 'Disco House', 'Classic House', 'Afro House', 'Deep House', 'Funky House', 'Melodic House', 'Indie Dance'],
  preferredCharacteristics: ['Underground', 'Non-mainstream', 'Disco influence', 'Funk', 'Soul', 'Groove-oriented', 'Dancefloor-focused', 'Sunset', 'Beach', 'Rooftop'],
  avoidGenres: ['Mainstream commercial EDM', 'Generic pop', 'Pure Latin/salsa'],
  preferredVenueTypes: ['Clubs', 'Rooftops', 'Beach venues', 'Restaurants', 'Hotels', 'Bars', 'Event venues', 'Festivals', 'Promoters', 'Party collectives'],
  minimumLeadScore: 45,
  scoringWeights: { opportunity: 0.35, contactability: 0.30, potentialValue: 0.20, locationFit: 0.15 },
  locationFitThresholds: [
    { maxKm: 10, score: 100 },
    { maxKm: 20, score: 90 },
    { maxKm: 30, score: 80 },
    { maxKm: 40, score: 65 },
    { maxKm: 60, score: 45 },
    { maxKm: Infinity, score: 20 },
  ],
}

function normalizeVenueName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
}

export function readProfile(): GigFinderProfile {
  try {
    if (!fs.existsSync(PROFILE_PATH)) return DEFAULT_PROFILE
    const raw = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8')) as GigFinderProfile
    return { ...DEFAULT_PROFILE, ...raw }
  } catch {
    return DEFAULT_PROFILE
  }
}

export function writeProfile(p: GigFinderProfile): void {
  const dir = path.dirname(PROFILE_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(p, null, 2), 'utf-8')
}

let _leadsCache: GigLead[] | null = null

export function readLeads(): GigLead[] {
  if (_leadsCache !== null) return _leadsCache
  try {
    if (!fs.existsSync(LEADS_PATH)) { _leadsCache = []; return _leadsCache }
    const raw = JSON.parse(fs.readFileSync(LEADS_PATH, 'utf-8')) as GigLead[]
    _leadsCache = Array.isArray(raw) ? raw : []
    return _leadsCache
  } catch {
    _leadsCache = []
    return _leadsCache
  }
}

export function writeLeads(leads: GigLead[]): void {
  const dir = path.dirname(LEADS_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(LEADS_PATH, JSON.stringify(leads, null, 2), 'utf-8')
  _leadsCache = leads
}

export function upsertLead(lead: GigLead): void {
  const leads = readLeads()
  const key = normalizeVenueName(lead.venueName) + '_' + normalizeVenueName(lead.city)
  const existingIdx = leads.findIndex(l =>
    normalizeVenueName(l.venueName) + '_' + normalizeVenueName(l.city) === key
  )
  if (existingIdx >= 0) {
    // Merge: preserve status and notes from existing, update rest
    leads[existingIdx] = {
      ...lead,
      status: leads[existingIdx].status,
      notes: leads[existingIdx].notes,
      contactedAt: leads[existingIdx].contactedAt,
      lastFollowUp: leads[existingIdx].lastFollowUp,
      nextFollowUp: leads[existingIdx].nextFollowUp,
    }
  } else {
    leads.push(lead)
  }
  writeLeads(leads)
}

export function updateLead(id: string, updates: Partial<GigLead>): GigLead | null {
  const leads = readLeads()
  const idx = leads.findIndex(l => l.id === id)
  if (idx < 0) return null
  leads[idx] = { ...leads[idx], ...updates }
  writeLeads(leads)
  return leads[idx]
}

export function deleteLead(id: string): boolean {
  const leads = readLeads()
  const idx = leads.findIndex(l => l.id === id)
  if (idx < 0) return false
  leads.splice(idx, 1)
  writeLeads(leads)
  return true
}
