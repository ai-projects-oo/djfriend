import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  GigLead,
  GigFinderProfile,
  GigLeadStatus,
  GigOpportunityTier,
  GigLocationClass,
  GigEvidenceFreshness,
} from '../types'
import { apiFetch } from '../lib/apiFetch'

// ─── Utility helpers ──────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 90) return 'text-green-400'
  if (score >= 80) return 'text-yellow-400'
  return 'text-[#94a3b8]'
}

function scoreBg(score: number): string {
  if (score >= 90) return 'bg-green-900/40 border-green-700/50'
  if (score >= 80) return 'bg-yellow-900/40 border-yellow-700/50'
  return 'bg-[#1e1e2e] border-[#2a2a3a]'
}

function tierBadge(tier: GigOpportunityTier): { label: string; cls: string } {
  switch (tier) {
    case 'HIGH_CONFIDENCE': return { label: 'High Confidence', cls: 'bg-green-900/50 text-green-300 border-green-700/50' }
    case 'POTENTIAL': return { label: 'Potential', cls: 'bg-blue-900/50 text-blue-300 border-blue-700/50' }
    case 'WEAK': return { label: 'Weak', cls: 'bg-[#1e1e2e] text-[#94a3b8] border-[#2a2a3a]' }
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
  const [copied, setCopied] = useState(false)
  const [notes, setNotes] = useState(lead.notes ?? '')
  const locInfo = locationBadge(lead.locationClass)
  const tierInfo = tierBadge(lead.opportunityTier)

  function handleCopyMessage() {
    void navigator.clipboard.writeText(lead.suggestedMessage)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
          <p className="text-xs text-[#94a3b8]">
            {lead.city}, {lead.country}
            {lead.distanceKm !== undefined && (
              <span className="ml-2 text-[#475569]">~{Math.round(lead.distanceKm)} km</span>
            )}
          </p>
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
            <span key={g} className="text-[10px] bg-[#1e1e2e] text-[#a78bfa] border border-[#2a2a3a] px-1.5 py-0.5 rounded">
              {g}
            </span>
          ))}
          <span className="text-[10px] text-[#475569]">{lead.genre.confidence}% confident</span>
        </div>
      )}

      {/* Score breakdown */}
      <div className="flex gap-3 text-[10px] text-[#94a3b8] mb-3 flex-wrap">
        <span>Opp <span className={scoreColor(lead.scores.opportunity)}>{Math.round(lead.scores.opportunity)}</span></span>
        <span>Fit <span className={scoreColor(lead.scores.musicFit)}>{Math.round(lead.scores.musicFit)}</span></span>
        <span>Contact <span className={scoreColor(lead.scores.contactability)}>{Math.round(lead.scores.contactability)}</span></span>
        <span>Value <span className={scoreColor(lead.scores.potentialValue)}>{Math.round(lead.scores.potentialValue)}</span></span>
        <span>Location <span className={scoreColor(lead.scores.locationFit)}>{Math.round(lead.scores.locationFit)}</span></span>
      </div>

      {/* Opportunity description */}
      <p className="text-xs text-[#94a3b8] mb-3 leading-relaxed">{lead.opportunityDescription}</p>

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
                    <li key={i} className="text-xs text-[#94a3b8] flex gap-1.5">
                      <span className="text-[#7c3aed] shrink-0">•</span>
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              {!showWhyItFits && lead.whyItFits.length > 3 && (
                <button onClick={() => setShowWhyItFits(true)} className="text-[10px] text-[#475569] hover:text-[#94a3b8] cursor-pointer">
                  +{lead.whyItFits.length - 3} more…
                </button>
              )}
            </div>
          )}

          {/* Contact box */}
          <div className="bg-[#0d0d14] rounded-lg border border-[#1e1e2e] p-3">
            <div className="text-[10px] uppercase tracking-widest text-[#475569] font-semibold mb-2">Contact</div>
            {lead.contact.name ? (
              <p className="text-sm font-medium text-[#e2e8f0] mb-0.5">{lead.contact.name}</p>
            ) : (
              <p className="text-sm text-[#475569] italic mb-0.5">No contact found</p>
            )}
            {lead.contact.role && <p className="text-xs text-[#94a3b8] mb-2">{lead.contact.role}</p>}

            {/* Confidence bar */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-[#475569]">Confidence</span>
              <div className="flex-1 h-1 bg-[#1e1e2e] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#7c3aed] rounded-full"
                  style={{ width: `${lead.contact.confidence}%` }}
                />
              </div>
              <span className="text-[10px] text-[#94a3b8]">{lead.contact.confidence}%</span>
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
                  className="text-[10px] bg-[#1e1e2e] text-[#94a3b8] border border-[#2a2a3a] px-2 py-0.5 rounded">
                  ✉ {lead.contact.email}
                </a>
              )}
              {lead.contact.phone && (
                <span className="text-[10px] bg-[#1e1e2e] text-[#94a3b8] border border-[#2a2a3a] px-2 py-0.5 rounded">
                  📞 {lead.contact.phone}
                </span>
              )}
              {lead.contact.website && (
                <a href={lead.contact.website} target="_blank" rel="noreferrer"
                  className="text-[10px] bg-[#1e1e2e] text-[#94a3b8] border border-[#2a2a3a] px-2 py-0.5 rounded truncate max-w-[160px]">
                  🌐 {lead.contact.website}
                </a>
              )}
            </div>

            {lead.contact.bestChannel && (
              <p className="text-[10px] text-[#475569] mt-2">
                Best channel: <span className="text-[#94a3b8]">{lead.contact.bestChannel}</span>
                {lead.contact.bestChannelReason && ` — ${lead.contact.bestChannelReason}`}
              </p>
            )}
          </div>

          {/* Suggested message */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-[#475569] font-semibold">Outreach message</span>
              <button
                onClick={handleCopyMessage}
                className="text-[10px] px-2 py-0.5 rounded bg-[#7c3aed]/20 text-[#a78bfa] border border-[#7c3aed]/30 hover:bg-[#7c3aed]/30 transition-colors cursor-pointer"
              >
                {copied ? '✓ Copied!' : 'Copy message'}
              </button>
            </div>
            <div className="bg-[#0d0d14] rounded-lg border border-[#1e1e2e] p-3 text-xs text-[#94a3b8] whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
              {lead.suggestedMessage}
            </div>
          </div>

          {/* Evidence */}
          {lead.evidence.length > 0 && (
            <div>
              <button
                onClick={() => setShowEvidence(s => !s)}
                className="text-[10px] uppercase tracking-widest text-[#475569] font-semibold mb-2 cursor-pointer hover:text-[#94a3b8]"
              >
                Evidence ({lead.evidence.length}) {showEvidence ? '▲' : '▼'}
              </button>
              {showEvidence && (
                <div className="space-y-2">
                  {lead.evidence.map((ev, i) => {
                    const fb = freshnessBadge(ev.freshness)
                    return (
                      <div key={i} className="bg-[#0d0d14] rounded-lg border border-[#1e1e2e] p-2.5">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <a href={ev.sourceUrl} target="_blank" rel="noreferrer"
                            className="text-[10px] text-[#7c3aed] hover:underline truncate flex-1">
                            {ev.sourceUrl}
                          </a>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${fb.cls}`}>{fb.label}</span>
                        </div>
                        <p className="text-[10px] text-[#94a3b8] leading-relaxed">{ev.summary}</p>
                        {ev.publishedAt && (
                          <p className="text-[9px] text-[#475569] mt-1">{new Date(ev.publishedAt).toLocaleDateString()}</p>
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
            <div className="text-[10px] uppercase tracking-widest text-[#475569] font-semibold mb-1.5">Notes</div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={handleNotesSave}
              placeholder="Add notes…"
              rows={2}
              className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:border-[#7c3aed] transition-colors resize-none"
            />
          </div>
        </div>
      )}

      {/* Status row */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#1e1e2e]">
        <select
          value={lead.status}
          onChange={e => handleStatusChange(e.target.value as GigLeadStatus)}
          className="text-xs bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-2 py-1 text-[#94a3b8] focus:outline-none focus:border-[#7c3aed] cursor-pointer"
        >
          {LEAD_STATUSES.map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <span className="text-[10px] text-[#475569]">
          Found {new Date(lead.discoveredAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  )
}

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

  function arrayField(key: keyof GigFinderProfile, value: string) {
    setDraft(d => ({ ...d, [key]: value.split(',').map(s => s.trim()).filter(Boolean) }))
  }

  function handleSave() {
    onSave(draft)
    onClose()
  }

  const labelCls = 'text-[10px] uppercase tracking-widest text-[#475569] font-semibold block mb-1'
  const inputCls = 'w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-xs text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:border-[#7c3aed] transition-colors'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-[#e2e8f0]">Edit GigFinder Profile</h2>
          <button onClick={onClose} className="text-[#475569] hover:text-[#94a3b8] cursor-pointer text-lg leading-none">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className={labelCls}>DJ Name</label>
            <input className={inputCls} value={draft.djName} onChange={e => setDraft(d => ({ ...d, djName: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Base Location</label>
            <input className={inputCls} value={draft.baseLocation} onChange={e => setDraft(d => ({ ...d, baseLocation: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Search Radius (km)</label>
              <input type="number" className={inputCls} value={draft.searchRadiusKm} onChange={e => setDraft(d => ({ ...d, searchRadiusKm: Number(e.target.value) }))} />
            </div>
            <div>
              <label className={labelCls}>Min Lead Score</label>
              <input type="number" className={inputCls} value={draft.minimumLeadScore} onChange={e => setDraft(d => ({ ...d, minimumLeadScore: Number(e.target.value) }))} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Preferred Areas (comma-separated)</label>
            <input className={inputCls} value={draft.preferredAreas.join(', ')} onChange={e => arrayField('preferredAreas', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Primary Genres (comma-separated)</label>
            <input className={inputCls} value={draft.primaryGenres.join(', ')} onChange={e => arrayField('primaryGenres', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Preferred Characteristics (comma-separated)</label>
            <input className={inputCls} value={draft.preferredCharacteristics.join(', ')} onChange={e => arrayField('preferredCharacteristics', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Avoid Genres (comma-separated)</label>
            <input className={inputCls} value={draft.avoidGenres.join(', ')} onChange={e => arrayField('avoidGenres', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Preferred Venue Types (comma-separated)</label>
            <input className={inputCls} value={draft.preferredVenueTypes.join(', ')} onChange={e => arrayField('preferredVenueTypes', e.target.value)} />
          </div>
        </div>

        <div className="flex gap-2 mt-6 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-[#94a3b8] border border-[#1e1e2e] rounded-lg hover:border-[#2a2a3a] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-xs font-medium bg-[#7c3aed] text-white rounded-lg hover:bg-[#6d28d9] transition-colors cursor-pointer"
          >
            Save Profile
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── GigFinderTab ─────────────────────────────────────────────────────────────

export default function GigFinderTab() {
  const [leads, setLeads] = useState<GigLead[]>([])
  const [profile, setProfile] = useState<GigFinderProfile | null>(null)
  const [searching, setSearching] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showRejected, setShowRejected] = useState(false)
  const logBoxRef = useRef<HTMLDivElement>(null)

  // Fetch on mount
  useEffect(() => {
    void apiFetch('/api/gigfinder/profile').then(r => r.json()).then(p => setProfile(p as GigFinderProfile)).catch(() => {})
    void apiFetch('/api/gigfinder/leads').then(r => r.json()).then(l => setLeads(l as GigLead[])).catch(() => {})
  }, [])

  // Scroll log to bottom on new entries
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
    }
  }, [logs])

  const handleSearch = useCallback(() => {
    if (searching) return
    setSearching(true)
    setLogs([])

    const evtSource = new EventSource('/api/gigfinder/search')
    evtSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as { type: string; message?: string; lead?: GigLead; session?: unknown }
        if (event.type === 'log' && event.message) {
          setLogs(l => [...l, event.message!])
        } else if (event.type === 'lead' && event.lead) {
          setLeads(prev => {
            const filtered = prev.filter(l => l.id !== event.lead!.id)
            return [...filtered, event.lead!].sort((a, b) => b.scores.overall - a.scores.overall)
          })
        } else if (event.type === 'done') {
          setLogs(l => [...l, 'Search complete.'])
          evtSource.close()
          setSearching(false)
          // Refresh leads list
          void apiFetch('/api/gigfinder/leads').then(r => r.json()).then(l => setLeads(l as GigLead[])).catch(() => {})
        } else if (event.type === 'error') {
          setLogs(l => [...l, `Error: ${event.message ?? 'Unknown error'}`])
          evtSource.close()
          setSearching(false)
        }
      } catch { /* skip malformed */ }
    }
    evtSource.onerror = () => {
      setLogs(l => [...l, 'Connection error. Search stopped.'])
      evtSource.close()
      setSearching(false)
    }
  }, [searching])

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
      <div className="px-4 py-4 border-b border-[#1e1e2e] flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-[#e2e8f0]">Gig Finder</h1>
          {leads.length > 0 && (
            <span className="text-[10px] bg-[#2a2a3a] text-[#94a3b8] px-1.5 py-0.5 rounded-full">
              {leads.length} leads
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {profile && (
            <button
              onClick={() => setShowProfileModal(true)}
              className="text-xs px-3 py-1.5 border border-[#1e1e2e] text-[#94a3b8] rounded-lg hover:border-[#2a2a3a] hover:text-[#e2e8f0] transition-colors cursor-pointer"
            >
              Edit Profile
            </button>
          )}
          <button
            onClick={handleSearch}
            disabled={searching}
            aria-label="Find gigs"
            className="flex items-center gap-2 px-4 py-1.5 text-xs font-medium bg-[#7c3aed] text-white rounded-lg hover:bg-[#6d28d9] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {searching && (
              <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            )}
            {searching ? 'Searching…' : 'Find Gigs'}
          </button>
        </div>
      </div>

      {/* Profile summary strip */}
      {profile && (
        <div className="px-4 py-2 border-b border-[#1e1e2e] bg-[#0d0d14] flex-shrink-0">
          <div className="flex items-center gap-4 text-[10px] text-[#475569] flex-wrap">
            <span>DJ: <span className="text-[#94a3b8]">{profile.djName}</span></span>
            <span>Base: <span className="text-[#94a3b8]">{profile.baseLocation}</span></span>
            <span>Radius: <span className="text-[#94a3b8]">{profile.searchRadiusKm}km</span></span>
            <span>Min score: <span className="text-[#94a3b8]">{profile.minimumLeadScore}</span></span>
            <span className="text-[#2a2a3a]">|</span>
            {profile.primaryGenres.slice(0, 4).map(g => (
              <span key={g} className="text-[#7c3aed]">{g}</span>
            ))}
          </div>
        </div>
      )}

      {/* Progress log */}
      {(searching || logs.length > 0) && (
        <div
          ref={logBoxRef}
          className="mx-4 mt-3 bg-[#0d0d14] border border-[#1e1e2e] rounded-lg p-3 h-28 overflow-y-auto flex-shrink-0 font-mono"
        >
          {logs.map((l, i) => (
            <div key={i} className="text-[10px] text-[#475569] leading-5">{l}</div>
          ))}
          {searching && (
            <div className="text-[10px] text-[#7c3aed] animate-pulse">Searching…</div>
          )}
        </div>
      )}

      {/* Lead list */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Controls */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] text-[#475569]">
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
            <span className="text-[10px] text-[#475569]">Show rejected</span>
          </label>
        </div>

        {visibleLeads.length === 0 && !searching && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3">🎯</div>
            <p className="text-sm text-[#475569] mb-1">No leads yet</p>
            <p className="text-xs text-[#2a2a3a]">
              Click "Find Gigs" to search for venues and events.
              <br />
              Make sure anthropicApiKey and tavilyApiKey are set in Settings.
            </p>
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
    </div>
  )
}
