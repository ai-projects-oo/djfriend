import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../services/apiFetch'
import { redirectToSpotifyLogin, getStoredToken, clearStoredToken } from '../services/spotifyExport'
import { saveApiKey, clearSession as clearOpenAiKey } from '../services/openAiAuth'
import { validateApiKey } from '../services/openAiApi'
import type { OpenAiSession } from '../services/openAiAuth'
import { SpotifyIcon, RekordboxIcon } from './Icons'

type PathStatus = 'idle' | 'checking' | 'ok' | 'missing'

interface FolderInputProps {
  label: string
  labelIcon?: React.ReactNode
  value: string
  status: PathStatus
  placeholder: string
  hint?: string
  onChange: (v: string) => void
  onBlur: () => void
  onBrowse: () => Promise<void>
}

function FolderInput({ label, labelIcon, value, status, placeholder, hint, onChange, onBlur, onBrowse }: FolderInputProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs text-[#8394a8] flex items-center gap-1.5">
          {labelIcon}
          {label}
        </label>
        {status === 'checking' && <span className="text-[10px] text-[#8394a8]">Checking…</span>}
        {status === 'ok' && <span className="text-[10px] text-[#22c55e]">✓ Found</span>}
        {status === 'missing' && <span className="text-[10px] text-[#ef4444]">Folder not found</span>}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          className={`flex-1 rounded-md border bg-[#20202e] px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#3e4f65] focus:outline-none transition-colors ${
            status === 'ok' ? 'border-[#22c55e]' :
            status === 'missing' ? 'border-[#ef4444]' :
            'border-[#363650] focus:border-[#7c3aed]'
          }`}
        />
        <button
          type="button"
          onClick={() => void onBrowse()}
          className="px-3 py-2 text-xs rounded-md border border-[#363650] text-[#a6b5c8] hover:text-[#e2e8f0] hover:border-[#7c3aed] bg-[#20202e] transition-colors cursor-pointer whitespace-nowrap"
          aria-label={`Browse for ${label}`}
        >
          Browse…
        </button>
      </div>
      {hint && <p className="mt-1 text-[10px] text-[#8394a8]">{hint}</p>}
    </div>
  )
}

export interface OpenAiFeatures {
  enhancedAnalysis: boolean
  vinylAnalysis: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  /** called after settings are saved successfully; folderChanged = true when musicFolder was different */
  onSaved: (folderChanged: boolean) => void
  /** called after the database is cleared */
  onDatabaseCleared?: () => void
  /** if set, scroll to this section id after opening */
  scrollToSection?: string
  /** trigger a Discogs collection sync (credentials are stored server-side) */
  onSyncDiscogs?: () => void
  /** current Discogs collection (for staleness badge) */
  discogsCollection?: { syncedAt: number; totalReleases: number } | null
  /** current Discogs sync status */
  discogsSyncPhase?: 'idle' | 'syncing' | 'done' | 'error'
  discogsSyncMessage?: string
  /** current ChatGPT session (null = not signed in) */
  openAiSession?: OpenAiSession | null
  /** current feature toggles for OpenAI features */
  openAiFeatures?: OpenAiFeatures
  /** called when features change or user signs out */
  onOpenAiFeaturesChange?: (features: OpenAiFeatures | null) => void
}


const isElectron = navigator.userAgent.toLowerCase().includes('electron')

export default function SettingsModal({ open, onClose, onSaved, onDatabaseCleared, scrollToSection, onSyncDiscogs, discogsCollection, discogsSyncPhase, discogsSyncMessage, openAiSession, openAiFeatures, onOpenAiFeaturesChange }: Props) {
  // Desktop-only state
  const [musicFolder, setMusicFolder] = useState('')
  const loadedMusicFolder = useRef('')
  const [musicFolderStatus, setMusicFolderStatus] = useState<PathStatus>('idle')
  const [rekordboxFolder, setRekordboxFolder] = useState('')
  const [rekordboxFolderStatus, setRekordboxFolderStatus] = useState<PathStatus>('idle')
  const [saving, setSaving] = useState(false)

  const [analysisMode, setAnalysisMode] = useState<'performance' | 'normal' | 'power-saving'>('normal')
  const [shareTelemetry, setShareTelemetry] = useState(false)
  const [showTips, setShowTips] = useState(true)
  const [hasSpotifySecret, setHasSpotifySecret] = useState(false)
  const [savingSpotify, setSavingSpotify] = useState(false)
  const [spotifyConnected, setSpotifyConnected] = useState(false)
  const [openAiKeyInput, setOpenAiKeyInput] = useState('')
  const [savingOpenAiKey, setSavingOpenAiKey] = useState(false)
  const [openAiKeySaved, setOpenAiKeySaved] = useState(false)
  const [openAiKeyError, setOpenAiKeyError] = useState('')
  const [clearing, setClearing] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [error, setError] = useState('')

  const [hasDiscogsOAuth, setHasDiscogsOAuth] = useState(false)
  const [hasDiscogsConsumerKey, setHasDiscogsConsumerKey] = useState(false)
  const [discogsConnectedAs, setDiscogsConnectedAs] = useState('')


  const [mlStats, setMlStats] = useState<{ vectorCount: number; negativeCount: number; trainedSamples: number; modelVersion: number } | null>(null)

  async function checkPath(folderPath: string, setStatus: (s: PathStatus) => void) {
    if (!folderPath.trim()) { setStatus('idle'); return }
    setStatus('checking')
    try {
      const r = await apiFetch('/api/check-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: folderPath.trim() }),
      })
      const { exists } = await r.json() as { exists: boolean }
      setStatus(exists ? 'ok' : 'missing')
    } catch {
      setStatus('idle')
    }
  }

  useEffect(() => {
    if (!open) return
    apiFetch('/api/settings')
      .then(r => r.json())
      .then((d: { musicFolder: string; rekordboxFolder: string; hasSecret: boolean; analysisMode?: string; energyCheckThreshold?: number; shareTelemetry?: boolean; tipConfig?: { help: boolean; info: boolean; ai: boolean }; hasDiscogsOAuth?: boolean; discogsUsername?: string; hasDiscogsConsumerKey?: boolean; hasRapidApiKey?: boolean; openAiClientId?: string }) => {
        setMusicFolder(d.musicFolder ?? '')
        loadedMusicFolder.current = d.musicFolder ?? ''
        setRekordboxFolder(d.rekordboxFolder ?? '')
        setMusicFolderStatus('idle')
        setRekordboxFolderStatus('idle')
        if (d.analysisMode === 'performance' || d.analysisMode === 'power-saving') setAnalysisMode(d.analysisMode)
        else setAnalysisMode('normal')
        setShareTelemetry(d.shareTelemetry === true)
        if (d.tipConfig) setShowTips(d.tipConfig.help !== false || d.tipConfig.info !== false || d.tipConfig.ai !== false)
        setHasSpotifySecret(d.hasSecret ?? false)
        setSpotifyConnected(!!getStoredToken())
        setHasDiscogsOAuth(d.hasDiscogsOAuth ?? false)
        setHasDiscogsConsumerKey(d.hasDiscogsConsumerKey ?? false)
        setDiscogsConnectedAs(d.discogsUsername ?? '')
        void d; // openAiClientId no longer used (key stored in localStorage)
      })
      .catch(() => {})
    fetch('https://djfriend.onrender.com/api/telemetry/stats')
      .then(r => r.ok ? r.json() : null)
      .then((s: { vectorCount: number; negativeCount: number; trainedSamples: number; modelVersion: number } | null) => { if (s) setMlStats(s) })
      .catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open || !scrollToSection) return
    const el = document.getElementById(scrollToSection)
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }, [open, scrollToSection])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const r = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ musicFolder: musicFolder.trim(), rekordboxFolder: rekordboxFolder.trim(), analysisMode, energyCheckThreshold: 0.12, shareTelemetry, tipConfig: { help: showTips, info: showTips, ai: showTips } }),
      })
      if (!r.ok) throw new Error('Save failed')
      const folderChanged = musicFolder.trim() !== loadedMusicFolder.current
      onSaved(folderChanged)
      onClose()
    } catch {
      setError('Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  function disconnectSpotify() {
    clearStoredToken()
    setSpotifyConnected(false)
  }

  async function saveSpotify() {
    setSavingSpotify(true)
    try {
      await redirectToSpotifyLogin()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect to Spotify.')
      setSavingSpotify(false)
    }
    // Page will redirect — no finally cleanup needed
  }

  function triggerSync() {
    if (onSyncDiscogs) onSyncDiscogs()
  }

  async function handleSaveOpenAiKey(key = openAiKeyInput) {
    const trimmed = key.trim()
    if (!trimmed) return
    setSavingOpenAiKey(true)
    setOpenAiKeyError('')
    try {
      await validateApiKey(trimmed)
      saveApiKey(trimmed)
      setOpenAiKeySaved(true)
      setOpenAiKeyInput('')
      onOpenAiFeaturesChange?.({ ...(openAiFeatures ?? { enhancedAnalysis: false, vinylAnalysis: false }) })
    } catch (e) {
      setOpenAiKeyError(e instanceof Error ? e.message : 'Could not verify key.')
    } finally {
      setSavingOpenAiKey(false)
    }
  }

  function handleOpenAiKeyPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').trim()
    if (pasted.startsWith('sk-')) {
      e.preventDefault()
      setOpenAiKeyInput(pasted)
      setOpenAiKeyError('')
      setOpenAiKeySaved(false)
      void handleSaveOpenAiKey(pasted)
    }
  }


  async function clearDatabase() {
    setClearing(true)
    setError('')
    try {
      const r = await apiFetch('/api/clear-database', { method: 'POST' })
      if (!r.ok) throw new Error('Clear failed')
      setClearConfirm(false)
      onDatabaseCleared?.()
      onSaved(true)
      onClose()
    } catch {
      setError('Failed to clear database.')
    } finally {
      setClearing(false)
    }
  }

  const discogsDaysSince = discogsCollection
    ? Math.floor((+new Date() - discogsCollection.syncedAt) / 86400000)
    : null

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[#363650] bg-[#0e0e16] shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-[#e2e8f0]">Settings</h2>
          <button onClick={onClose} className="text-[#8394a8] hover:text-[#a6b5c8] transition-colors" aria-label="Close settings">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Desktop-only: Folders ─────────────────────────────────── */}
        {isElectron && (
          <div className="space-y-4 mb-5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-[#8394a8]">Folders</h3>

            {!musicFolder && (
              <div className="rounded-lg border border-[#7c3aed44] bg-[#1a1030] px-4 py-3">
                <p className="text-xs text-[#a78bfa] leading-relaxed">
                  Set your <strong className="text-[#c4b5fd]">music library folder</strong> to get started.
                </p>
              </div>
            )}

            <FolderInput
              label="Music library folder"
              value={musicFolder}
              status={musicFolderStatus}
              placeholder="/path/to/music"
              onChange={v => { setMusicFolder(v); setMusicFolderStatus('idle') }}
              onBlur={() => void checkPath(musicFolder, setMusicFolderStatus)}
              onBrowse={async () => {
                const picked = await window.electronAPI?.selectFolder()
                if (picked) { setMusicFolder(picked); void checkPath(picked, setMusicFolderStatus) }
              }}
            />

            <FolderInput
              label="Rekordbox XML folder"
              labelIcon={<RekordboxIcon size={12} className="opacity-60" />}
              value={rekordboxFolder}
              status={rekordboxFolderStatus}
              placeholder="/path/to/rekordbox/exports"
              hint="When set, Rekordbox XML exports save directly to this folder."
              onChange={v => { setRekordboxFolder(v); setRekordboxFolderStatus('idle') }}
              onBlur={() => void checkPath(rekordboxFolder, setRekordboxFolderStatus)}
              onBrowse={async () => {
                const picked = await window.electronAPI?.selectFolder()
                if (picked) { setRekordboxFolder(picked); void checkPath(picked, setRekordboxFolderStatus) }
              }}
            />
          </div>
        )}

        {/* ── Spotify (both platforms) ──────────────────────────────── */}
        <div className="mt-5 pt-5 border-t border-[#2c2c42] space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-[#8394a8] flex items-center gap-1.5">
              <SpotifyIcon size={13} className="text-[#1db954]" />
              Spotify
            </h3>
            {spotifyConnected && (
              <span className="text-[10px] text-[#22c55e]">✓ connected</span>
            )}
          </div>
          {spotifyConnected ? (
            <p className="text-xs text-[#8394a8] leading-relaxed">
              Spotify is connected. Import playlists and export sets directly from the app.
            </p>
          ) : hasSpotifySecret ? (
            <p className="text-xs text-[#8394a8] leading-relaxed">
              Connect your Spotify account to import playlists and export sets.
            </p>
          ) : (
            <p className="text-xs text-[#8394a8] leading-relaxed">
              To enable Spotify integration, reach out at{' '}
              <a href="mailto:obo_odedr@hotmail.com" className="text-[#1db954] hover:underline">
                obo_odedr@hotmail.com
              </a>
              {' '}to request access.
            </p>
          )}
          {spotifyConnected ? (
            <button
              onClick={disconnectSpotify}
              aria-label="Disconnect Spotify"
              className="px-4 py-2 text-sm font-medium rounded-md border border-[#ef4444]/40 text-[#f87171] hover:bg-[#ef4444]/10 transition-colors cursor-pointer"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={saveSpotify}
              disabled={savingSpotify}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-[#1db954] text-white hover:bg-[#17a349] disabled:opacity-40 transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed"
            >
              <SpotifyIcon size={14} />
              {savingSpotify ? 'Connecting…' : 'Connect Spotify'}
            </button>
          )}
        </div>

        {/* ── Performance ───────────────────────────────────────────── */}
        <div className="mt-5 pt-5 border-t border-[#2c2c42]">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[#8394a8] mb-3">Performance</h3>

          <div>
            <p className="text-xs text-[#8394a8] mb-2">Concurrent Process Mode</p>
            <div className="space-y-2">
              {(['performance', 'normal', 'power-saving'] as const).map(value => (
                <label key={value} className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="analysisMode"
                    value={value}
                    checked={analysisMode === value}
                    onChange={() => setAnalysisMode(value)}
                    className="w-4 h-4 cursor-pointer accent-[#7c3aed]"
                    aria-label={value}
                  />
                  <span className="text-sm text-[#e2e8f0] capitalize">{value === 'power-saving' ? 'Power saving' : value.charAt(0).toUpperCase() + value.slice(1)}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* ── Display ──────────────────────────────────────────────── */}
        <div className="mt-5 pt-5 border-t border-[#2c2c42]">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[#8394a8] mb-3">Display</h3>
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showTips}
              onChange={e => {
                setShowTips(e.target.checked)
                const tc = { help: e.target.checked, info: e.target.checked, ai: e.target.checked }
                apiFetch('/api/settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tipConfig: tc }),
                }).catch(() => {})
              }}
              className="w-4 h-4 cursor-pointer accent-[#7c3aed] flex-shrink-0"
              aria-label="Show tips"
            />
            <span className="flex flex-col">
              <span className="text-sm text-[#e2e8f0]">Show tips</span>
              <span className="text-[11px] text-[#8394a8]">Hover tooltips on tracks and controls</span>
            </span>
          </label>
        </div>

        {/* ── AI & Privacy ─────────────────────────────────────────── */}
        <div className="mt-5 pt-5 border-t border-[#2c2c42]">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[#8394a8] mb-3">AI & Privacy</h3>
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={shareTelemetry}
              onChange={e => {
                setShareTelemetry(e.target.checked)
                // auto-save immediately (works on both platforms)
                apiFetch('/api/settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ shareTelemetry: e.target.checked }),
                }).catch(() => {})
              }}
              className="mt-0.5 w-4 h-4 cursor-pointer accent-[#7c3aed]"
              aria-label="Share anonymous transition data to improve the community AI model"
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-[#e2e8f0]">Help improve the AI for everyone</span>
              <span className="text-[11px] text-[#8394a8]">
                Anonymously shares transition patterns (BPM, key, energy — no track names or metadata) after each set. Helps train a community model that benefits all DJFriend users.
              </span>
            </div>
          </label>
          {mlStats && (
            <div className="mt-3 rounded-lg bg-[#1c1c2e] border border-[#2c2c42] px-3 py-2.5 flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] text-[#8394a8]">Community model</span>
                <span className="text-[10px] text-[#6b7a94]">v{mlStats.modelVersion} · {mlStats.trainedSamples.toLocaleString()} transitions learned</span>
              </div>
              <div className="flex gap-3 text-right">
                <div className="flex flex-col items-end">
                  <span className="text-xs font-semibold text-[#a78bfa] tabular-nums">{mlStats.vectorCount.toLocaleString()}</span>
                  <span className="text-[10px] text-[#6b7a94]">positive</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-xs font-semibold text-[#f87171] tabular-nums">{mlStats.negativeCount.toLocaleString()}</span>
                  <span className="text-[10px] text-[#6b7a94]">rejected</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Discogs ──────────────────────────────────────────────── */}
        <div className="mt-5 pt-5 border-t border-[#2c2c42]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-[#8394a8]">Discogs</h3>
            {hasDiscogsOAuth && discogsConnectedAs && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#22c55e22] text-[#22c55e]">Connected as {discogsConnectedAs}</span>
            )}
          </div>

          <div className="space-y-3">
            {!hasDiscogsConsumerKey && (
              <p className="text-[11px] text-[#ef4444]">Discogs app credentials not configured. Contact the app developer.</p>
            )}

            {discogsCollection && discogsDaysSince !== null && (
              <p className={`text-[11px] ${discogsDaysSince >= 30 ? 'text-[#f59e0b]' : 'text-[#8394a8]'}`}>
                {discogsCollection.totalReleases} releases · synced {discogsDaysSince === 0 ? 'today' : `${discogsDaysSince}d ago`}
                {discogsDaysSince >= 30 && ' · collection may be out of date'}
              </p>
            )}

            {discogsSyncPhase === 'syncing' && (
              <p className="text-[11px] text-[#7c3aed]">Syncing collection…</p>
            )}
            {discogsSyncPhase === 'done' && (
              <p className="text-[11px] text-[#22c55e]">Collection synced.</p>
            )}
            {discogsSyncPhase === 'error' && discogsSyncMessage && (
              <p className="text-[11px] text-[#ef4444]">{discogsSyncMessage}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { window.location.href = '/api/discogs/connect' }}
                disabled={!hasDiscogsConsumerKey}
                className="px-3 py-2 text-xs font-medium rounded-md border border-[#363650] text-[#a6b5c8] hover:text-white hover:border-[#7c3aed] hover:bg-[#20202e] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {hasDiscogsOAuth ? 'Reconnect Discogs ↗' : 'Connect Discogs ↗'}
              </button>
              {hasDiscogsOAuth && (
                <button
                  type="button"
                  onClick={triggerSync}
                  disabled={discogsSyncPhase === 'syncing'}
                  className="px-3 py-2 text-xs font-medium rounded-md border border-[#363650] text-[#a6b5c8] hover:text-white hover:bg-[#7c3aed] hover:border-[#7c3aed] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {discogsSyncPhase === 'syncing' ? 'Syncing…' : '↺ Sync Collection'}
                </button>
              )}
            </div>
          </div>
        </div>

{/* ── OpenAI / AI Features ─────────────────────────────────── */}
        <div id="settings-gig-finder" className="mt-5 pt-5 border-t border-[#2c2c42]">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[#8394a8] mb-3">OpenAI</h3>

          {!openAiSession ? (
            <div className="flex flex-col gap-4">
              {/* How to get a key */}
              <div className="rounded-lg bg-[#1c1c2e] border border-[#2c2c42] p-3 flex flex-col gap-2">
                <p className="text-[11px] font-semibold text-[#a6b5c8]">How to get an API key</p>
                <ol className="text-[11px] text-[#8394a8] leading-relaxed list-decimal list-inside flex flex-col gap-1">
                  <li>Go to <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-[#a78bfa] hover:underline cursor-pointer">platform.openai.com/api-keys</a></li>
                  <li>Sign in or create a free account</li>
                  <li>Click <span className="text-[#e2e8f0]">Create new secret key</span></li>
                  <li>Copy the key (starts with <span className="font-mono text-[#e2e8f0]">sk-</span>) and paste it below</li>
                </ol>
                <p className="text-[10px] text-[#64748b] leading-relaxed">
                  Keys are stored locally on your device only — never sent to DJFriend servers. OpenAI charges per request; typical use costs a few cents per month.
                </p>
              </div>

              {/* Key input */}
              <div>
                <label className="text-[10px] text-[#8394a8] uppercase tracking-wider block mb-1.5">OpenAI API Key</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={openAiKeyInput}
                    onChange={e => { setOpenAiKeyInput(e.target.value); setOpenAiKeySaved(false); setOpenAiKeyError(''); }}
                    onPaste={handleOpenAiKeyPaste}
                    placeholder="Paste your sk-… key to connect instantly"
                    autoComplete="off"
                    className={`flex-1 px-3 py-1.5 text-xs rounded-md border bg-[#1c1c2e] text-[#e2e8f0] placeholder:text-[#5a6a80] focus:outline-none font-mono transition-colors ${openAiKeyError ? 'border-[#ef4444] focus:border-[#ef4444]' : 'border-[#363650] focus:border-[#7c3aed]'}`}
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveOpenAiKey()}
                    disabled={savingOpenAiKey || !openAiKeyInput.trim()}
                    className="px-4 py-1.5 text-xs rounded-md bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer font-medium whitespace-nowrap"
                  >
                    {savingOpenAiKey ? 'Verifying…' : openAiKeySaved ? '✓ Connected' : 'Connect'}
                  </button>
                </div>
                {openAiKeyError && (
                  <p className="mt-1.5 text-[11px] text-[#ef4444]">{openAiKeyError}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                  <span className="text-sm text-[#e2e8f0] font-medium">API key connected</span>
                </div>
                <button
                  type="button"
                  onClick={() => { clearOpenAiKey(); onOpenAiFeaturesChange?.(null); }}
                  className="text-xs text-[#8394a8] hover:text-[#ef4444] transition-colors cursor-pointer"
                >
                  Remove key
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-[10px] uppercase tracking-widest font-semibold text-[#8394a8] mb-1">Enable features</p>
                {([
                  { key: 'enhancedAnalysis' as const, label: 'Enhanced Track Analysis', desc: 'AI transition explanations, set narrative, and track finder' },
                  { key: 'vinylAnalysis' as const, label: 'Vinyl Auto-Detection', desc: 'Automatically detect genre and BPM for Discogs vinyl records' },
                ] as const).map(({ key, label, desc }) => {
                  const enabled = openAiFeatures?.[key] ?? false;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onOpenAiFeaturesChange?.({ ...(openAiFeatures ?? { enhancedAnalysis: false, vinylAnalysis: false }), [key]: !enabled })}
                      className="flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer text-left"
                      style={{ borderColor: enabled ? '#7c3aed' : '#2c2c42', backgroundColor: enabled ? '#7c3aed1a' : 'transparent' }}
                    >
                      <div className="mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors"
                        style={{ borderColor: enabled ? '#7c3aed' : '#363650', backgroundColor: enabled ? '#7c3aed' : 'transparent' }}>
                        {enabled && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-[#e2e8f0]">{label}</div>
                        <div className="text-[11px] text-[#8394a8] mt-0.5">{desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

{/* ── Danger Zone (both platforms) ─────────────────────────── */}
        <div className="mt-5 pt-5 border-t border-[#2c2c42]">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[#8394a8] mb-3">Danger Zone</h3>
          {!clearConfirm ? (
            <button
              onClick={() => setClearConfirm(true)}
              className="px-3 py-2 text-sm rounded-md border border-[#3f1a1a] text-[#f87171] hover:bg-[#1a0a0a] transition-colors cursor-pointer"
            >
              Clear database
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#f87171]">Delete all analyzed tracks?</span>
              <button
                onClick={clearDatabase}
                disabled={clearing}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#7f1d1d] text-white hover:bg-[#991b1b] disabled:opacity-50 transition-colors cursor-pointer"
              >
                {clearing ? 'Clearing…' : 'Yes, clear'}
              </button>
              <button
                onClick={() => setClearConfirm(false)}
                className="text-xs text-[#8394a8] hover:text-[#a6b5c8] transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-xs text-red-400">{error.split(/(obo_odedr@hotmail\.com)/).map((part, i) =>
          part === 'obo_odedr@hotmail.com' ? <a key={i} href="mailto:obo_odedr@hotmail.com" className="text-[#a78bfa] hover:underline">{part}</a> : part
        )}</p>}

        {/* Save button — desktop only (folders) */}
        {isElectron && (
          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-[#8394a8] hover:text-[#a6b5c8] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-md bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-50 transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
        {!isElectron && (
          <div className="flex justify-end mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-[#8394a8] hover:text-[#a6b5c8] transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
