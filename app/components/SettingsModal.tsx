import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/apiFetch'
import { redirectToSpotifyLogin } from '../lib/spotifyExport'
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
        <label className="text-xs text-[#64748b] flex items-center gap-1.5">
          {labelIcon}
          {label}
        </label>
        {status === 'checking' && <span className="text-[10px] text-[#475569]">Checking…</span>}
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
          className={`flex-1 rounded-md border bg-[#12121a] px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#334155] focus:outline-none transition-colors ${
            status === 'ok' ? 'border-[#22c55e]' :
            status === 'missing' ? 'border-[#ef4444]' :
            'border-[#2a2a3a] focus:border-[#7c3aed]'
          }`}
        />
        <button
          type="button"
          onClick={() => void onBrowse()}
          className="px-3 py-2 text-xs rounded-md border border-[#2a2a3a] text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#7c3aed] bg-[#12121a] transition-colors cursor-pointer whitespace-nowrap"
          aria-label={`Browse for ${label}`}
        >
          Browse…
        </button>
      </div>
      {hint && <p className="mt-1 text-[10px] text-[#475569]">{hint}</p>}
    </div>
  )
}

interface Props {
  open: boolean
  onClose: () => void
  /** called after settings are saved successfully */
  onSaved: () => void
  /** called after the database is cleared */
  onDatabaseCleared?: () => void
}


const isElectron = navigator.userAgent.toLowerCase().includes('electron')

export default function SettingsModal({ open, onClose, onSaved, onDatabaseCleared }: Props) {
  // Desktop-only state
  const [musicFolder, setMusicFolder] = useState('')
  const [musicFolderStatus, setMusicFolderStatus] = useState<PathStatus>('idle')
  const [rekordboxFolder, setRekordboxFolder] = useState('')
  const [rekordboxFolderStatus, setRekordboxFolderStatus] = useState<PathStatus>('idle')
  const [saving, setSaving] = useState(false)

  // AI state
  const [aiProvider, setAiProvider] = useState<string>('groq')
  const [aiApiKey, setAiApiKey] = useState('')
  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [hasAiKey, setHasAiKey] = useState(false)
  const [savingAi, setSavingAi] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  const [useAllCores, setUseAllCores] = useState(false)
  const [hasSpotifySecret, setHasSpotifySecret] = useState(false)
  const [savingSpotify, setSavingSpotify] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [error, setError] = useState('')

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
      .then((d: { musicFolder: string; rekordboxFolder: string; hasAIKey: boolean; hasSecret: boolean; aiProvider?: string; useAllCores?: boolean }) => {
        setMusicFolder(d.musicFolder ?? '')
        setRekordboxFolder(d.rekordboxFolder ?? '')
        setMusicFolderStatus('idle')
        setRekordboxFolderStatus('idle')
        setHasAiKey(d.hasAIKey ?? false)
        if (d.aiProvider) setAiProvider(d.aiProvider)
        setUseAllCores(d.useAllCores === true)
        setHasSpotifySecret(d.hasSecret ?? false)
      })
      .catch(() => {})
  }, [open])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const r = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ musicFolder: musicFolder.trim(), rekordboxFolder: rekordboxFolder.trim(), useAllCores }),
      })
      if (!r.ok) throw new Error('Save failed')
      onSaved()
      onClose()
    } catch {
      setError('Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  async function saveAiKey() {
    if (!aiApiKey.trim()) return
    setSavingAi(true)
    setAiSaved(false)
    try {
      const payload: Record<string, string> = { aiApiKey: aiApiKey.trim(), aiProvider }
      if (aiProvider === 'custom' && aiBaseUrl.trim()) payload.aiBaseUrl = aiBaseUrl.trim()
      const r = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!r.ok) throw new Error('Save failed')
      setAiApiKey('')
      setHasAiKey(true)
      setAiSaved(true)
    } catch {
      setError('Failed to save AI API key.')
    } finally {
      setSavingAi(false)
    }
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

  async function clearDatabase() {
    setClearing(true)
    setError('')
    try {
      const r = await apiFetch('/api/clear-database', { method: 'POST' })
      if (!r.ok) throw new Error('Clear failed')
      setClearConfirm(false)
      onDatabaseCleared?.()
      onSaved()
      onClose()
    } catch {
      setError('Failed to clear database.')
    } finally {
      setClearing(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[#2a2a3a] bg-[#0e0e16] shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-[#e2e8f0]">Settings</h2>
          <button onClick={onClose} className="text-[#475569] hover:text-[#94a3b8] transition-colors" aria-label="Close settings">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Desktop-only: Folders ─────────────────────────────────── */}
        {isElectron && (
          <div className="space-y-4 mb-5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-[#475569]">Folders</h3>

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

        {/* ── AI (both platforms) ───────────────────────────────────── */}
        <div className={`space-y-4 ${isElectron ? 'pt-5 border-t border-[#1e1e2e]' : ''}`}>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[#475569] flex items-center gap-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 8v4l2 2"/><circle cx="18" cy="6" r="3" fill="#7c3aed" stroke="none"/></svg>
            AI Engine
          </h3>

          {/* Onboarding banner — shown only when no key is configured yet */}
          {!hasAiKey && !aiSaved && (
            <div className="rounded-lg border border-[#7c3aed]/30 bg-[#7c3aed]/5 p-4 space-y-3">
              <p className="text-xs font-semibold text-[#a78bfa]">Connect your AI engine to unlock:</p>
              <ul className="space-y-1.5">
                {[
                  'Semantic track tagging — vibe, mood, venue fit',
                  'Smart set planning from a natural language prompt',
                  'Personalised scoring as your library grows',
                ].map(f => (
                  <li key={f} className="flex items-start gap-2 text-xs text-[#94a3b8]">
                    <span className="text-[#7c3aed] mt-px">✦</span>{f}
                  </li>
                ))}
              </ul>
              <div className="pt-1 border-t border-[#7c3aed]/20">
                <p className="text-xs text-[#64748b] mb-2">
                  <span className="text-[#a78bfa] font-semibold">Recommended: Groq</span> — free, no credit card, takes 2 minutes.
                </p>
                <ol className="space-y-1">
                  {[
                    <>Go to <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" className="text-[#7c3aed] hover:underline font-medium">console.groq.com</a> and sign up free</>,
                    <>Click <span className="text-[#e2e8f0]">API Keys → Create API key</span></>,
                    <>Paste it below and click <span className="text-[#e2e8f0]">Save key</span></>,
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-[#64748b]">
                      <span className="shrink-0 w-4 h-4 rounded-full bg-[#1e1e2e] text-[#7c3aed] text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {/* Connected state */}
          {(hasAiKey || aiSaved) && (
            <div className="flex items-center gap-2 rounded-lg border border-[#22c55e]/20 bg-[#22c55e]/5 px-3 py-2">
              <span className="text-[#22c55e] text-sm">&#10003;</span>
              <span className="text-xs text-[#86efac] font-medium">AI engine connected</span>
              <span className="text-xs text-[#4b5568] ml-auto capitalize">{aiProvider === 'openrouter' ? 'OpenRouter' : aiProvider === 'openai' ? 'OpenAI' : aiProvider === 'groq' ? 'Groq' : 'Custom'}</span>
            </div>
          )}

          <div>
            <label className="block text-xs text-[#64748b] mb-1.5">Provider</label>
            <select
              value={aiProvider}
              onChange={e => { setAiProvider(e.target.value); setAiSaved(false) }}
              className="w-full rounded-md border border-[#2a2a3a] bg-[#12121a] px-3 py-2 text-sm text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] transition-colors cursor-pointer"
            >
              <option value="groq">Groq — free, no credit card</option>
              <option value="openai">OpenAI (ChatGPT)</option>
              <option value="openrouter">OpenRouter — Claude, GPT-4, Llama & more</option>
              <option value="custom">Custom (any OpenAI-compatible endpoint)</option>
            </select>
          </div>

          {aiProvider !== 'custom' && (hasAiKey || aiSaved) && (
            <p className="text-xs text-[#4b5568] leading-relaxed">
              {aiProvider === 'groq' && <>Key stored locally on your machine — <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" className="text-[#7c3aed] hover:underline">console.groq.com</a> to manage.</>}
              {aiProvider === 'openai' && <>Key stored locally — <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-[#7c3aed] hover:underline">platform.openai.com</a> to manage.</>}
              {aiProvider === 'openrouter' && <>Key stored locally — <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-[#7c3aed] hover:underline">openrouter.ai</a> to manage.</>}
            </p>
          )}

          {aiProvider === 'custom' && (
            <div>
              <label className="block text-xs text-[#64748b] mb-1.5">Base URL</label>
              <input
                type="text"
                value={aiBaseUrl}
                onChange={e => setAiBaseUrl(e.target.value)}
                placeholder="https://your-endpoint.com/v1"
                className="w-full rounded-md border border-[#2a2a3a] bg-[#12121a] px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] transition-colors"
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-[#64748b] mb-1.5">
              {hasAiKey || aiSaved ? 'Replace API Key' : 'API Key'}
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={aiApiKey}
                onChange={e => { setAiApiKey(e.target.value); setAiSaved(false) }}
                placeholder={hasAiKey ? 'Paste new key to replace…' : aiProvider === 'groq' ? 'gsk_…' : 'sk-…'}
                className="flex-1 rounded-md border border-[#2a2a3a] bg-[#12121a] px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] transition-colors"
                aria-label="AI API key"
              />
              <button
                onClick={saveAiKey}
                disabled={savingAi || !aiApiKey.trim()}
                className="px-3 py-2 text-sm font-medium rounded-md bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-40 transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed"
              >
                {savingAi ? 'Saving…' : 'Save key'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Spotify (both platforms) ──────────────────────────────── */}
        <div className="mt-5 pt-5 border-t border-[#1e1e2e] space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-[#475569] flex items-center gap-1.5">
              <SpotifyIcon size={13} className="text-[#1db954]" />
              Spotify
            </h3>
            {hasSpotifySecret && (
              <span className="text-[10px] text-[#22c55e]">✓ connected</span>
            )}
          </div>
          {hasSpotifySecret ? (
            <p className="text-xs text-[#64748b] leading-relaxed">
              Spotify is connected. Import playlists and export sets directly from the app.
            </p>
          ) : (
            <p className="text-xs text-[#64748b] leading-relaxed">
              To enable Spotify integration, reach out at{' '}
              <a href="mailto:obo_odedr@hotmail.com" className="text-[#1db954] hover:underline">
                obo_odedr@hotmail.com
              </a>
              {' '}to request access.
            </p>
          )}
          {!hasSpotifySecret && (
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
        <div className="mt-5 pt-5 border-t border-[#1e1e2e]">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[#475569] mb-3">Performance</h3>
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useAllCores}
              onChange={(e) => setUseAllCores(e.target.checked)}
              className="mt-0.5 w-4 h-4 cursor-pointer accent-[#7c3aed]"
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-[#e2e8f0]">Use all CPU cores for analysis</span>
              <span className="text-[11px] text-[#64748b]">
                Spawns one audio worker per core (like Rekordbox). Much faster on large libraries but uses more CPU. Requires app restart to take effect.
              </span>
            </div>
          </label>
        </div>

        {/* ── Danger Zone (both platforms) ─────────────────────────── */}
        <div className="mt-5 pt-5 border-t border-[#1e1e2e]">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[#475569] mb-3">Danger Zone</h3>
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
                className="text-xs text-[#475569] hover:text-[#94a3b8] transition-colors cursor-pointer"
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
              className="px-4 py-2 text-sm text-[#64748b] hover:text-[#94a3b8] transition-colors cursor-pointer"
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
              className="px-4 py-2 text-sm text-[#64748b] hover:text-[#94a3b8] transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
