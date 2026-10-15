import React, { useState, useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type {
  GigLead,
  GigFinderProfile,
  GigLeadStatus,
  GigOpportunityTier,
  GigLocationClass,
  GigEvidenceFreshness,
} from '../types'
import { apiFetch } from '../services/apiFetch'
import { reverseGeocode } from '../services/geocode'
import { chatComplete } from '../services/openAiApi'
import { getAccessToken } from '../services/openAiAuth'

// ─── Utility helpers ──────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 90) return 'text-green-400'
  if (score >= 80) return 'text-yellow-400'
  return 'text-[#a6b5c8]'
}

function scoreBg(score: number): string {
  if (score >= 90) return 'bg-green-900/40 border-green-700/50'
  if (score >= 80) return 'bg-yellow-900/40 border-yellow-700/50'
  return 'bg-[#2c2c42] border-[#363650]'
}

function tierBadge(tier: GigOpportunityTier): { label: string; cls: string } {
  switch (tier) {
    case 'HIGH_CONFIDENCE': return { label: 'High Confidence', cls: 'bg-green-900/50 text-green-300 border-green-700/50' }
    case 'POTENTIAL': return { label: 'Potential', cls: 'bg-blue-900/50 text-blue-300 border-blue-700/50' }
    case 'WEAK': return { label: 'Weak', cls: 'bg-[#2c2c42] text-[#a6b5c8] border-[#363650]' }
    case 'REJECT': return { label: 'Reject', cls: 'bg-red-900/50 text-red-300 border-red-700/50' }
  }
}

function locationBadge(loc: GigLocationClass): { label: string; cls: string; emoji: string } {
  switch (loc) {
    case 'LOCAL': return { label: 'Local', cls: 'bg-green-900/40 text-green-300 border-green-700/40', emoji: '🟢' }
    case 'TRAVEL': return { label: 'Travel', cls: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/40', emoji: '🟡' }
    case 'DESTINATION': return { label: 'Destination', cls: 'bg-blue-900/40 text-blue-300 border-blue-700/40', emoji: '🔵' }
  }
}

function freshnessBadge(f: GigEvidenceFreshness): { label: string; cls: string } {
  switch (f) {
    case 'VERY_FRESH': return { label: 'Very Fresh', cls: 'bg-green-900/50 text-green-300' }
    case 'FRESH': return { label: 'Fresh', cls: 'bg-teal-900/50 text-teal-300' }
    case 'MODERATE': return { label: 'Moderate', cls: 'bg-blue-900/50 text-blue-300' }
    case 'OLD': return { label: 'Old', cls: 'bg-yellow-900/50 text-yellow-300' }
    case 'HISTORICAL': return { label: 'Historical', cls: 'bg-red-900/50 text-red-300' }
  }
}

const LEAD_STATUSES: GigLeadStatus[] = [
  'NEW', 'RESEARCHED', 'READY_TO_CONTACT', 'CONTACTED',
  'FOLLOW_UP', 'REPLIED', 'BOOKED', 'NOT_INTERESTED', 'REJECTED',
]

// ─── LeadCard ─────────────────────────────────────────────────────────────────

function LeadCard({ lead, onUpdate }: { lead: GigLead; onUpdate: (id: string, updates: Partial<GigLead>) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [showEvidence, setShowEvidence] = useState(false)
  const [showWhyItFits, setShowWhyItFits] = useState(false)
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [aiDraft, setAiDraft] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState<'summary' | 'draft' | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const hasAi = !!getAccessToken()
  const locInfo = locationBadge(lead.locationClass)
  const tierInfo = tierBadge(lead.opportunityTier)

  async function handleAiSummary() {
    setAiLoading('summary'); setAiError(null)
    try {
      const evidenceText = lead.evidence.map(e => `- ${e.summary ?? e.sourceUrl}`).join('\n')
      const contact = [lead.contact.instagram && `Instagram: @${lead.contact.instagram}`, lead.contact.email && `Email: ${lead.contact.email}`].filter(Boolean).join(', ')
      const summary = await chatComplete([
        { role: 'system', content: 'You are a concise analyst for a DJ booking assistant. Summarize venue leads in exactly 2 sentences.' },
        { role: 'user', content: `Summarize this venue lead in 2 sentences covering: venue type, booking frequency, recency, and best contact.\n\nVenue: ${lead.venueName}, ${lead.city}, ${lead.country}\nGenres: ${lead.genre?.genres?.join(', ') ?? 'unknown'}\nEvidence:\n${evidenceText}\nContact: ${contact || 'unknown'}\nWhy it fits: ${lead.whyItFits.join(', ')}` },
      ], { maxTokens: 120 })
      setAiSummary(summary)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI failed')
    } finally {
      setAiLoading(null)
    }
  }

  async function handleAiDraft() {
    setAiLoading('draft'); setAiError(null)
    try {
      const genres = lead.genre?.genres?.join(', ') ?? 'electronic'
      const draft = await chatComplete([
        { role: 'system', content: 'You write short, professional DJ booking pitch emails. Be specific to the venue, keep it under 150 words, conversational tone.' },
        { role: 'user', content: `Write a DJ booking pitch email for ${lead.venueName} in ${lead.city}, ${lead.country}.\nVenue genres: ${genres}\nOpportunity: ${lead.opportunityDescription}\nWhy I fit: ${lead.whyItFits.slice(0, 3).join('; ')}\n${lead.contact.name ? `Address to: ${lead.contact.name}` : ''}` },
      ], { maxTokens: 250 })
      setAiDraft(draft)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI failed')
    } finally {
      setAiLoading(null)
    }
  }

  function handleStatusChange(status: GigLeadStatus) {
    onUpdate(lead.id, { status })
  }

  function handleNotesSave() {
    if (notes !== (lead.notes ?? '')) {
      onUpdate(lead.id, { notes })
    }
  }

  return (
    <div className={`rounded-xl border p-4 ${scoreBg(lead.scores.overall)} transition-all`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-sm font-semibold text-[#e2e8f0] truncate">{lead.venueName}</h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${tierInfo.cls}`}>
              {tierInfo.label}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${locInfo.cls}`}>
              {locInfo.emoji} {locInfo.label}
            </span>
          </div>
          <p className="text-xs text-[#a6b5c8]">
            {lead.city}, {lead.country}
            {lead.distanceKm !== undefined && (
              <span className="ml-2 text-[#8394a8]">~{Math.round(lead.distanceKm)} km</span>
            )}
          </p>
          {(lead.contact.website ?? lead.evidence[0]?.sourceUrl) && (
            <a
              href={lead.contact.website ?? lead.evidence[0].sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-[#7c3aed] hover:text-[#a78bfa] truncate block max-w-[220px] mt-0.5"
              onClick={e => e.stopPropagation()}
            >
              {(() => { try { return new URL((lead.contact.website ?? lead.evidence[0].sourceUrl)!).hostname.replace(/^www\./, '') } catch { return lead.contact.website ?? lead.evidence[0].sourceUrl } })()}
            </a>
          )}
        </div>
        {/* Overall score badge */}
        <div className={`flex-shrink-0 w-12 h-12 rounded-lg border flex items-center justify-center ${scoreBg(lead.scores.overall)}`}>
          <span className={`text-lg font-bold ${scoreColor(lead.scores.overall)}`}>
            {Math.round(lead.scores.overall)}
          </span>
        </div>
      </div>

      {/* Genre pills */}
      {lead.genre.genres.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {lead.genre.genres.slice(0, 6).map(g => (
            <span key={g} className="text-[10px] bg-[#2c2c42] text-[#a78bfa] border border-[#363650] px-1.5 py-0.5 rounded">
              {g}
            </span>
          ))}
          <span className="text-[10px] text-[#8394a8]">{lead.genre.confidence}% confident</span>
        </div>
      )}

      {/* Score breakdown */}
      <div className="flex gap-3 text-[10px] text-[#a6b5c8] mb-3 flex-wrap">
        <span>Opp <span className={scoreColor(lead.scores.opportunity)}>{Math.round(lead.scores.opportunity)}</span></span>
        <span>Contact <span className={scoreColor(lead.scores.contactability)}>{Math.round(lead.scores.contactability)}</span></span>
        <span>Value <span className={scoreColor(lead.scores.potentialValue)}>{Math.round(lead.scores.potentialValue)}</span></span>
        <span>Location <span className={scoreColor(lead.scores.locationFit)}>{Math.round(lead.scores.locationFit)}</span></span>
      </div>

      {/* Opportunity description */}
      <p className="text-xs text-[#a6b5c8] mb-3 leading-relaxed">{lead.opportunityDescription}</p>

      {/* Expand button */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="text-xs text-[#7c3aed] hover:text-[#a78bfa] transition-colors mb-3 cursor-pointer"
      >
        {expanded ? '▲ Show less' : '▼ Show more'}
      </button>

      {expanded && (
        <div className="space-y-4">
          {/* Why it fits */}
          {lead.whyItFits.length > 0 && (
            <div>
              <button
                onClick={() => setShowWhyItFits(s => !s)}
                className="text-xs font-medium text-[#e2e8f0] mb-1.5 cursor-pointer hover:text-[#a78bfa]"
              >
                Why it fits {showWhyItFits ? '▲' : '▼'}
              </button>
              {(showWhyItFits || lead.whyItFits.length <= 3) && (
                <ul className="space-y-1">
                  {lead.whyItFits.map((item, i) => (
                    <li key={i} className="text-xs text-[#a6b5c8] flex gap-1.5">
                      <span className="text-[#7c3aed] shrink-0">•</span>
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              {!showWhyItFits && lead.whyItFits.length > 3 && (
                <button onClick={() => setShowWhyItFits(true)} className="text-[10px] text-[#8394a8] hover:text-[#a6b5c8] cursor-pointer">
                  +{lead.whyItFits.length - 3} more…
                </button>
              )}
            </div>
          )}

          {/* Contact box */}
          <div className="bg-[#1c1c2e] rounded-lg border border-[#2c2c42] p-3">
            <div className="text-[10px] uppercase tracking-widest text-[#8394a8] font-semibold mb-2">Contact</div>
            {lead.contact.name ? (
              <p className="text-sm font-medium text-[#e2e8f0] mb-0.5">{lead.contact.name}</p>
            ) : (
              <p className="text-sm text-[#8394a8] italic mb-0.5">No contact found</p>
            )}
            {lead.contact.role && <p className="text-xs text-[#a6b5c8] mb-2">{lead.contact.role}</p>}

            {/* Confidence bar */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-[#8394a8]">Confidence</span>
              <div className="flex-1 h-1 bg-[#2c2c42] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#7c3aed] rounded-full"
                  style={{ width: `${lead.contact.confidence}%` }}
                />
              </div>
              <span className="text-[10px] text-[#a6b5c8]">{lead.contact.confidence}%</span>
            </div>

            {/* Contact chips */}
            <div className="flex flex-wrap gap-1.5">
              {lead.contact.instagram && (
                <a href={`https://instagram.com/${lead.contact.instagram.replace('@', '')}`} target="_blank" rel="noreferrer"
                  className="text-[10px] bg-pink-900/30 text-pink-300 border border-pink-700/40 px-2 py-0.5 rounded flex items-center gap-1">
                  📸 {lead.contact.instagram}
                </a>
              )}
              {lead.contact.email && (
                <a href={`mailto:${lead.contact.email}`}
                  className="text-[10px] bg-[#2c2c42] text-[#a6b5c8] border border-[#363650] px-2 py-0.5 rounded">
                  ✉ {lead.contact.email}
                </a>
              )}
              {lead.contact.phone && (
                <span className="text-[10px] bg-[#2c2c42] text-[#a6b5c8] border border-[#363650] px-2 py-0.5 rounded">
                  📞 {lead.contact.phone}
                </span>
              )}
              {lead.contact.website && (
                <a href={lead.contact.website} target="_blank" rel="noreferrer"
                  className="text-[10px] bg-[#2c2c42] text-[#a6b5c8] border border-[#363650] px-2 py-0.5 rounded truncate max-w-[160px]">
                  🌐 {lead.contact.website}
                </a>
              )}
            </div>

            {lead.contact.bestChannel && (
              <p className="text-[10px] text-[#8394a8] mt-2">
                Best channel: <span className="text-[#a6b5c8]">{lead.contact.bestChannel}</span>
                {lead.contact.bestChannelReason && ` — ${lead.contact.bestChannelReason}`}
              </p>
            )}
          </div>

          {/* Evidence */}
          {lead.evidence.length > 0 && (
            <div>
              <button
                onClick={() => setShowEvidence(s => !s)}
                className="text-[10px] uppercase tracking-widest text-[#8394a8] font-semibold mb-2 cursor-pointer hover:text-[#a6b5c8]"
              >
                Evidence ({lead.evidence.length}) {showEvidence ? '▲' : '▼'}
              </button>
              {showEvidence && (
                <div className="space-y-2">
                  {lead.evidence.map((ev, i) => {
                    const fb = freshnessBadge(ev.freshness)
                    return (
                      <div key={i} className="bg-[#1c1c2e] rounded-lg border border-[#2c2c42] p-2.5">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <a href={ev.sourceUrl} target="_blank" rel="noreferrer"
                            className="text-[10px] text-[#7c3aed] hover:underline truncate flex-1">
                            {ev.sourceUrl}
                          </a>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${fb.cls}`}>{fb.label}</span>
                        </div>
                        <p className="text-[10px] text-[#a6b5c8] leading-relaxed">{ev.summary}</p>
                        {ev.publishedAt && (
                          <p className="text-[9px] text-[#8394a8] mt-1">{new Date(ev.publishedAt).toLocaleDateString()}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[#8394a8] font-semibold mb-1.5">Notes</div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={handleNotesSave}
              placeholder="Add notes…"
              rows={2}
              className="w-full bg-[#1c1c2e] border border-[#2c2c42] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] placeholder-[#8394a8] focus:outline-none focus:border-[#7c3aed] transition-colors resize-none"
            />
          </div>
        </div>
      )}

      {/* AI summary */}
      {aiSummary && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-[#7c3aed1a] border border-[#7c3aed33] text-xs text-[#c4b5fd] leading-relaxed">
          {aiSummary}
        </div>
      )}

      {/* AI draft */}
      {aiDraft && (
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-[#8394a8] font-semibold">Booking Pitch Draft</span>
            <button type="button" onClick={() => void navigator.clipboard.writeText(aiDraft)}
              className="text-[10px] text-[#8394a8] hover:text-[#a6b5c8] transition-colors cursor-pointer">Copy</button>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-xs text-[#a6b5c8] bg-[#1c1c2e] border border-[#2c2c42] rounded-lg px-3 py-2 leading-relaxed">{aiDraft}</pre>
        </div>
      )}

      {aiError && <p className="mt-2 text-xs text-red-400">{aiError}</p>}

      {/* Status row */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#2c2c42]">
        <select
          value={lead.status}
          onChange={e => handleStatusChange(e.target.value as GigLeadStatus)}
          className="text-xs bg-[#1c1c2e] border border-[#2c2c42] rounded-lg px-2 py-1 text-[#a6b5c8] focus:outline-none focus:border-[#7c3aed] cursor-pointer"
        >
          {LEAD_STATUSES.map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          {hasAi && (
            <>
              <button type="button" onClick={() => void handleAiSummary()} disabled={aiLoading !== null}
                title="AI: summarize this lead in 2 sentences"
                className="text-[10px] text-[#8394a8] hover:text-[#a78bfa] disabled:opacity-40 transition-colors cursor-pointer">
                {aiLoading === 'summary' ? '…' : '✦ Summarize'}
              </button>
              <button type="button" onClick={() => void handleAiDraft()} disabled={aiLoading !== null}
                title="AI: draft a booking pitch email"
                className="text-[10px] text-[#8394a8] hover:text-[#a78bfa] disabled:opacity-40 transition-colors cursor-pointer">
                {aiLoading === 'draft' ? '…' : '✍ Draft email'}
              </button>
            </>
          )}
          <span className="text-[10px] text-[#8394a8]">
            Found {new Date(lead.discoveredAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Tag selector ────────────────────────────────────────────────────────────

function TagSelector({
  label,
  options,
  selected,
  onChange,
  variant = 'default',
  allowCustom = false,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
  variant?: 'default' | 'avoid'
  allowCustom?: boolean
}) {
  const [addingCustom, setAddingCustom] = useState(false)
  const [customValue, setCustomValue] = useState('')

  function toggle(tag: string) {
    onChange(selected.includes(tag) ? selected.filter(t => t !== tag) : [...selected, tag])
  }
  function commitCustom() {
    const t = customValue.trim()
    if (t && !selected.includes(t)) onChange([...selected, t])
    setCustomValue('')
    setAddingCustom(false)
  }
  const activeCls = variant === 'avoid'
    ? 'bg-red-900/60 border-red-700/60 text-red-300'
    : 'bg-[#7c3aed]/20 border-[#7c3aed]/60 text-[#a78bfa]'
  const inactiveCls = 'bg-[#1c1c2e] border-[#2c2c42] text-[#8394a8] hover:border-[#363650] hover:text-[#a6b5c8]'
  const customTags = selected.filter(t => !options.includes(t))
  return (
    <div>
      <span className="text-[10px] uppercase tracking-widest text-[#8394a8] font-semibold block mb-2">
        {label}
        {allowCustom && selected.length === 0 && <span className="ml-2 normal-case tracking-normal text-[#424f63]">(empty = accept all)</span>}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map(tag => (
          <button
            key={tag}
            onClick={() => toggle(tag)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${selected.includes(tag) ? activeCls : inactiveCls}`}
          >
            {tag}
          </button>
        ))}
        {customTags.map(tag => (
          <button
            key={tag}
            onClick={() => toggle(tag)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${activeCls}`}
            title="Click to remove custom tag"
          >
            {tag} ✕
          </button>
        ))}
        {allowCustom && !addingCustom && (
          <button
            onClick={() => setAddingCustom(true)}
            className="text-[11px] px-2.5 py-1 rounded-full border border-dashed border-[#424f63] text-[#8394a8] hover:text-[#a6b5c8] hover:border-[#8394a8] transition-colors cursor-pointer"
          >
            + Add custom
          </button>
        )}
        {allowCustom && addingCustom && (
          <input
            autoFocus
            value={customValue}
            onChange={e => setCustomValue(e.target.value)}
            onBlur={commitCustom}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitCustom() }
              else if (e.key === 'Escape') { setCustomValue(''); setAddingCustom(false) }
            }}
            placeholder="e.g. natural wine bar"
            className="text-[11px] px-2.5 py-1 rounded-full border border-[#7c3aed]/60 bg-[#1c1c2e] text-[#e2e8f0] placeholder-[#8394a8] focus:outline-none min-w-[140px]"
          />
        )}
      </div>
    </div>
  )
}

// ─── Location map ─────────────────────────────────────────────────────────────

const CITY_COORDS: Record<string, [number, number]> = {
  'petah tikva': [32.089, 34.887], 'tel aviv': [32.085, 34.782],
  'ramat gan': [32.082, 34.813], 'givatayim': [32.071, 34.812],
  'herzliya': [32.166, 34.844], 'bnei brak': [32.083, 34.834],
  'holon': [32.011, 34.779], 'bat yam': [32.002, 34.750],
  'rishon lezion': [31.971, 34.789], 'rehovot': [31.895, 34.811],
  'netanya': [32.329, 34.860], 'kfar saba': [32.175, 34.907],
  'raanana': [32.184, 34.872], 'ashdod': [31.804, 34.650],
  'ashkelon': [31.665, 34.571], 'modiin': [31.898, 35.010],
  'jerusalem': [31.768, 35.214], 'haifa': [32.794, 34.990],
  'beer sheva': [31.252, 34.791], 'eilat': [29.558, 34.952],
}

const RADIUS_STEPS = [10, 25, 40, 60, 100, 200]

function parseCoordsFromLocation(loc: string): [number, number] {
  const norm = loc.toLowerCase().replace(/,.*/, '').trim()
  for (const [city, coords] of Object.entries(CITY_COORDS)) {
    if (norm.includes(city) || city.includes(norm)) return coords
  }
  return [32.089, 34.887] // default: Petah Tikva
}

function LocationMap({
  location,
  radiusKm,
  onLocationChange,
  onRadiusChange,
}: {
  location: string
  radiusKm: number
  onLocationChange: (loc: string, coords: [number, number]) => void
  onRadiusChange: (km: number) => void
}) {
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const circleRef = useRef<L.Circle | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const radiusIdx = RADIUS_STEPS.indexOf(radiusKm) === -1
    ? RADIUS_STEPS.findIndex(s => s >= radiusKm)
    : RADIUS_STEPS.indexOf(radiusKm)
  const sliderIdx = Math.max(0, radiusIdx === -1 ? RADIUS_STEPS.length - 1 : radiusIdx)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const initCoords = parseCoordsFromLocation(location)

    const icon = L.divIcon({
      html: `<div style="width:16px;height:16px;background:#7c3aed;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.6)"></div>`,
      className: '',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    })

    const map = L.map(containerRef.current, {
      center: initCoords,
      zoom: 9,
      zoomControl: true,
      attributionControl: true,
    })
    map.attributionControl.setPrefix(false)

    // OSM tile usage policy + ODbL: attribution must be visible on the map
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map)

    const marker = L.marker(initCoords, { icon, draggable: true }).addTo(map)
    const circle = L.circle(initCoords, {
      radius: radiusKm * 1000,
      color: '#7c3aed',
      fillColor: '#7c3aed',
      fillOpacity: 0.08,
      weight: 1.5,
    }).addTo(map)

    marker.on('dragend', async () => {
      const { lat, lng } = marker.getLatLng()
      circle.setLatLng([lat, lng])
      // Reverse geocode via Nominatim
      try {
        const address = await reverseGeocode(lat, lng)
        const city = address?.city ?? address?.town ?? address?.village ?? 'Unknown'
        const country = address?.country ?? ''
        onLocationChange(`${city}, ${country}`, [lat, lng])
      } catch {
        onLocationChange(`${lat.toFixed(4)}, ${lng.toFixed(4)}`, [lat, lng])
      }
    })

    map.on('click', async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng
      marker.setLatLng([lat, lng])
      circle.setLatLng([lat, lng])
      try {
        const address = await reverseGeocode(lat, lng)
        const city = address?.city ?? address?.town ?? address?.village ?? 'Unknown'
        const country = address?.country ?? ''
        onLocationChange(`${city}, ${country}`, [lat, lng])
      } catch {
        onLocationChange(`${lat.toFixed(4)}, ${lng.toFixed(4)}`, [lat, lng])
      }
    })

    mapRef.current = map
    markerRef.current = marker
    circleRef.current = circle

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
      circleRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update circle radius when slider changes
  useEffect(() => {
    circleRef.current?.setRadius(radiusKm * 1000)
  }, [radiusKm])

  return (
    <div>
      <div
        ref={containerRef}
        style={{ height: 200, borderRadius: 10, overflow: 'hidden', border: '1px solid #2c2c42' }}
      />
      <div className="flex items-center justify-between mt-2 px-0.5">
        <span className="text-[10px] text-[#8394a8] truncate max-w-[60%]">{location}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#8394a8]">Radius</span>
          <input
            type="range"
            min={0}
            max={RADIUS_STEPS.length - 1}
            step={1}
            value={sliderIdx}
            onChange={e => onRadiusChange(RADIUS_STEPS[Number(e.target.value)])}
            className="w-24 accent-[#7c3aed]"
          />
          <span className="text-[10px] text-[#a78bfa] w-10 text-right">{radiusKm} km</span>
        </div>
      </div>
    </div>
  )
}

// ─── Preset option lists ──────────────────────────────────────────────────────

const GENRE_OPTIONS = [
  'House', 'Disco House', 'Disco', 'Deep House', 'Afro House', 'Tech House',
  'Melodic House', 'Indie Dance', 'Funky House', 'Classic House',
  'Techno', 'Trance', 'Drum & Bass', 'Hip-Hop', 'R&B', 'Funk', 'Latin', 'Open Format',
]

const CHAR_OPTIONS = [
  'Underground', 'Non-mainstream', 'Disco influence', 'Funk', 'Soul',
  'Groove-oriented', 'Dancefloor-focused', 'Sunset', 'Beach', 'Rooftop',
  'Intimate', 'Late night', 'Outdoor', 'Festival vibes', 'Corporate', 'Boutique',
]

const VENUE_OPTIONS = [
  'Clubs', 'Nightclubs', 'Bars', 'Wine bars', 'Cocktail bars', 'Speakeasies',
  'Beer gardens', 'Cafes', 'Coffee bars', 'Restaurants', 'Bistros',
  'Rooftops', 'Terraces', 'Gardens', 'Beach venues', 'Boat parties', 'Yachts',
  'Hotels', 'Event venues', 'Warehouse parties', 'Jazz clubs', 'Live music venues',
  'Festivals', 'Promoters', 'Party collectives', 'Party series',
  'Private events', 'Corporate events',
]

const AREA_OPTIONS = [
  'Tel Aviv', 'Ramat Gan', 'Herzliya', 'Rishon LeZion', 'Petah Tikva',
  'Holon', 'Bat Yam', 'Givatayim', 'Bnei Brak', 'Netanya',
  'Kfar Saba', 'Ra\'anana', 'Rehovot', 'Ashdod', 'Jerusalem', 'Haifa', 'Eilat',
]

// ─── Profile Edit Modal ────────────────────────────────────────────────────────

function ProfileModal({
  profile,
  onSave,
  onClose,
}: {
  profile: GigFinderProfile
  onSave: (p: GigFinderProfile) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<GigFinderProfile>({ ...profile })

  function handleSave() {
    onSave(draft)
    onClose()
  }

  const labelCls = 'text-[10px] uppercase tracking-widest text-[#8394a8] font-semibold block mb-1'
  const inputCls = 'w-full bg-[#1c1c2e] border border-[#2c2c42] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] placeholder-[#8394a8] focus:outline-none focus:border-[#7c3aed] transition-colors'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="bg-[#20202e] border border-[#2c2c42] rounded-xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-6 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#e2e8f0]">Profile</h2>
          <button onClick={onClose} className="text-[#8394a8] hover:text-[#a6b5c8] cursor-pointer text-lg leading-none">✕</button>
        </div>

        {/* DJ Name */}
        <div>
          <label className={labelCls}>DJ Name</label>
          <input
            className={inputCls}
            value={draft.djName}
            onChange={e => setDraft(d => ({ ...d, djName: e.target.value }))}
          />
        </div>

        {/* Map + radius */}
        <div>
          <label className={labelCls}>Base Location</label>
          <LocationMap
            location={draft.baseLocation}
            radiusKm={draft.searchRadiusKm}
            onLocationChange={(loc, coords) => setDraft(d => ({ ...d, baseLocation: loc, baseLat: coords[0], baseLon: coords[1] }))}
            onRadiusChange={(km) => setDraft(d => ({ ...d, searchRadiusKm: km }))}
          />
        </div>

        {/* Preferred areas */}
        <TagSelector
          label="Preferred areas"
          options={AREA_OPTIONS}
          selected={draft.preferredAreas}
          onChange={v => setDraft(d => ({ ...d, preferredAreas: v }))}
        />

        {/* Genres */}
        <TagSelector
          label="My genres"
          options={GENRE_OPTIONS}
          selected={draft.primaryGenres}
          onChange={v => setDraft(d => ({ ...d, primaryGenres: v }))}
        />

        {/* Avoid genres */}
        <TagSelector
          label="Avoid"
          options={GENRE_OPTIONS}
          selected={draft.avoidGenres}
          onChange={v => setDraft(d => ({ ...d, avoidGenres: v }))}
          variant="avoid"
        />

        {/* Venue types */}
        <TagSelector
          label="Venue types"
          options={VENUE_OPTIONS}
          selected={draft.preferredVenueTypes}
          onChange={v => setDraft(d => ({ ...d, preferredVenueTypes: v }))}
          allowCustom
        />

        {/* Characteristics */}
        <TagSelector
          label="Vibe"
          options={CHAR_OPTIONS}
          selected={draft.preferredCharacteristics}
          onChange={v => setDraft(d => ({ ...d, preferredCharacteristics: v }))}
        />

        {/* Min lead score */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={labelCls + ' mb-0'}>Min lead score</label>
            <span className="text-[11px] text-[#a78bfa] font-medium">{draft.minimumLeadScore}</span>
          </div>
          <input
            type="range"
            min={50}
            max={95}
            step={5}
            value={draft.minimumLeadScore}
            onChange={e => setDraft(d => ({ ...d, minimumLeadScore: Number(e.target.value) }))}
            className="w-full accent-[#7c3aed]"
          />
          <div className="flex justify-between text-[9px] text-[#6b7a94] mt-0.5">
            <span>50 — more results</span>
            <span>95 — very strict</span>
          </div>
        </div>

        {/* Seed Instagram handles — the co-mention proxy for follower graph */}
        <div>
          <label className={labelCls}>Known Instagram handles (comma or space separated)</label>
          <p className="text-[10px] text-[#8394a8] mb-1.5 leading-relaxed">
            Handles of venues you already know from the scene. The finder searches pages that mention them and pulls out other handles co-mentioned nearby — the scene finds itself.
          </p>
          <input
            className={inputCls}
            placeholder="@kulialma, @nancyatnancy, @louloucafe__"
            value={(draft.seedInstagramHandles ?? []).join(', ')}
            onChange={e => {
              const handles = e.target.value
                .split(/[\s,]+/)
                .map(h => h.replace(/^@/, '').trim())
                .filter(Boolean)
              setDraft(d => ({ ...d, seedInstagramHandles: handles }))
            }}
          />
          {(draft.seedInstagramHandles ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {(draft.seedInstagramHandles ?? []).map(h => (
                <span key={h} className="text-[10px] bg-[#7c3aed]/20 text-[#a78bfa] border border-[#7c3aed]/40 px-2 py-0.5 rounded-full">
                  @{h}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-[#a6b5c8] border border-[#2c2c42] rounded-lg hover:border-[#363650] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-xs font-medium bg-[#7c3aed] text-white rounded-lg hover:bg-[#6d28d9] transition-colors cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── AddLeadModal ─────────────────────────────────────────────────────────────

function AddLeadModal({ onAdd, onClose }: { onAdd: (lead: GigLead) => void; onClose: () => void }) {
  const [venueName, setVenueName] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')
  const [email, setEmail] = useState('')
  const [instagram, setInstagram] = useState('')
  const [notes, setNotes] = useState('')

  const labelCls = 'text-[10px] uppercase tracking-widest text-[#8394a8] font-semibold block mb-1'
  const inputCls = 'w-full bg-[#1c1c2e] border border-[#2c2c42] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] placeholder-[#8394a8] focus:outline-none focus:border-[#7c3aed] transition-colors'

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!venueName.trim() || !city.trim() || !country.trim()) return
    const lead: GigLead = {
      id: crypto.randomUUID(),
      venueName: venueName.trim(),
      city: city.trim(),
      country: country.trim(),
      locationClass: 'LOCAL',
      opportunityDescription: '',
      opportunityTier: 'POTENTIAL',
      genre: { genres: [], confidence: 0, level: 'UNKNOWN', evidenceBullets: [], why: '' },
      scores: { opportunity: 0, contactability: 0, potentialValue: 0, locationFit: 0, overall: 0 },
      contact: {
        confidence: 0,
        whyThisContact: '',
        bestChannel: '',
        bestChannelReason: '',
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(instagram.trim() ? { instagram: instagram.trim().replace(/^@/, '') } : {}),
      },
      whyItFits: [],
      evidence: [],
      status: 'NEW',
      discoveredAt: new Date().toISOString(),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }
    onAdd(lead)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="bg-[#12121a] border border-[#2c2c42] rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#e2e8f0]">Add Lead</h2>
          <button onClick={onClose} className="text-[#8394a8] hover:text-[#a6b5c8] cursor-pointer text-lg leading-none">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelCls}>Venue Name <span className="text-[#ef4444]">*</span></label>
            <input className={inputCls} value={venueName} onChange={e => setVenueName(e.target.value)} placeholder="e.g. Kuli Alma" required />
          </div>
          <div>
            <label className={labelCls}>City <span className="text-[#ef4444]">*</span></label>
            <input className={inputCls} value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Tel Aviv" required />
          </div>
          <div>
            <label className={labelCls}>Country <span className="text-[#ef4444]">*</span></label>
            <input className={inputCls} value={country} onChange={e => setCountry(e.target.value)} placeholder="e.g. Israel" required />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input className={inputCls} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="booking@venue.com" />
          </div>
          <div>
            <label className={labelCls}>Instagram</label>
            <input className={inputCls} value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@venuehandle" />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea className={inputCls + ' resize-none'} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes…" rows={2} />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-[#a6b5c8] border border-[#2c2c42] rounded-lg hover:border-[#363650] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium bg-[#7c3aed] text-white rounded-lg hover:bg-[#6d28d9] transition-colors cursor-pointer"
            >
              Add Lead
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── GigFinderTab ─────────────────────────────────────────────────────────────

export default function GigFinderTab() {
  const [leads, setLeads] = useState<GigLead[]>([])
  const [profile, setProfile] = useState<GigFinderProfile | null>(null)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showRejected, setShowRejected] = useState(false)

  // Fetch on mount
  useEffect(() => {
    void apiFetch('/api/gigfinder/profile').then(r => r.json()).then(p => setProfile(p as GigFinderProfile)).catch(() => {})
    void apiFetch('/api/gigfinder/leads').then(r => r.json()).then(l => setLeads(l as GigLead[])).catch(() => {})
  }, [])

  const handleAddLead = useCallback((lead: GigLead) => {
    void apiFetch('/api/gigfinder/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lead),
    }).then(r => r.json()).then(created => {
      setLeads(prev => [created as GigLead, ...prev])
      setShowAddModal(false)
    }).catch(() => {})
  }, [])

  const handleClearLeads = useCallback(() => {
    if (!window.confirm('Clear all leads?')) return
    void apiFetch('/api/gigfinder/leads', { method: 'DELETE' })
      .then(() => { setLeads([]) })
      .catch(() => {})
  }, [])

  const handleUpdateLead = useCallback((id: string, updates: Partial<GigLead>) => {
    void apiFetch(`/api/gigfinder/leads/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }).then(r => r.json()).then(updated => {
      setLeads(prev => prev.map(l => l.id === id ? (updated as GigLead) : l))
    }).catch(() => {})
  }, [])

  const handleSaveProfile = useCallback((p: GigFinderProfile) => {
    void apiFetch('/api/gigfinder/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then(r => r.json()).then(saved => setProfile(saved as GigFinderProfile)).catch(() => {})
  }, [])

  const visibleLeads = leads.filter(l =>
    showRejected ? true : l.opportunityTier !== 'REJECT' && l.status !== 'REJECTED'
  ).sort((a, b) => b.scores.overall - a.scores.overall)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-4 border-b border-[#2c2c42] flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-[#e2e8f0]">Gig Finder</h1>
          {leads.length > 0 && (
            <span className="text-[10px] bg-[#363650] text-[#a6b5c8] px-1.5 py-0.5 rounded-full">
              {leads.length} leads
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {profile && (
            <button
              onClick={() => setShowProfileModal(true)}
              className="text-xs px-3 py-1.5 border border-[#2c2c42] text-[#a6b5c8] rounded-lg hover:border-[#363650] hover:text-[#e2e8f0] transition-colors cursor-pointer"
            >
              Edit Profile
            </button>
          )}
          {leads.length > 0 && (
            <button
              onClick={handleClearLeads}
              aria-label="Clear all leads"
              className="text-xs px-3 py-1.5 border border-[#2a1a1a] text-[#f87171] rounded-lg hover:border-[#3a2020] hover:text-[#fca5a5] transition-colors cursor-pointer"
            >
              Clear results
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            aria-label="Add lead"
            className="flex items-center gap-2 px-4 py-1.5 text-xs font-medium bg-[#7c3aed] text-white rounded-lg hover:bg-[#6d28d9] transition-colors cursor-pointer"
          >
            Add Lead
          </button>
        </div>
      </div>

      {/* Profile summary strip */}
      {profile && (
        <div className="px-4 py-2 border-b border-[#2c2c42] bg-[#1c1c2e] flex-shrink-0">
          <div className="flex items-center gap-4 text-[10px] text-[#8394a8] flex-wrap">
            <span>DJ: <span className="text-[#a6b5c8]">{profile.djName}</span></span>
            <span>Base: <span className="text-[#a6b5c8]">{profile.baseLocation}</span></span>
            <span>Radius: <span className="text-[#a6b5c8]">{profile.searchRadiusKm}km</span></span>
            <span>Min score: <span className="text-[#a6b5c8]">{profile.minimumLeadScore}</span></span>
            <span className="text-[#6b7a94]">|</span>
            {profile.primaryGenres.slice(0, 4).map(g => (
              <span key={g} className="text-[#7c3aed]">{g}</span>
            ))}
          </div>
        </div>
      )}

      {/* Lead list */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Controls */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] text-[#8394a8]">
            {visibleLeads.length} lead{visibleLeads.length !== 1 ? 's' : ''}
            {!showRejected && leads.some(l => l.opportunityTier === 'REJECT' || l.status === 'REJECTED') && (
              <span> (rejected hidden)</span>
            )}
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showRejected}
              onChange={e => setShowRejected(e.target.checked)}
              className="rounded"
            />
            <span className="text-[10px] text-[#8394a8]">Show rejected</span>
          </label>
        </div>

        {visibleLeads.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3">🎯</div>
            <p className="text-sm text-[#8394a8] mb-1">No leads yet</p>
            <p className="text-xs text-[#6b7a94]">Add your first lead with the "Add Lead" button above.</p>
          </div>
        )}

        <div className="space-y-3">
          {visibleLeads.map(lead => (
            <LeadCard key={lead.id} lead={lead} onUpdate={handleUpdateLead} />
          ))}
        </div>
      </div>

      {/* Profile modal */}
      {showProfileModal && profile && (
        <ProfileModal
          profile={profile}
          onSave={handleSaveProfile}
          onClose={() => setShowProfileModal(false)}
        />
      )}

      {showAddModal && (
        <AddLeadModal onAdd={handleAddLead} onClose={() => setShowAddModal(false)} />
      )}
    </div>
  )
}
