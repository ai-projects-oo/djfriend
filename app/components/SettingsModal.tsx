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

  const [useAllCores, setUseAllCores] = useState(false)
  const [energyCheckThreshold, setEnergyCheckThreshold] = useState(12)
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
      .then((d: { musicFolder: string; rekordboxFolder: string; hasSecret: boolean; useAllCores?: boolean; energyCheckThreshold?: number }) => {
        setMusicFolder(d.musicFolder ?? '')
        setRekordboxFolder(d.rekordboxFolder ?? '')
        setMusicFolderStatus('idle')
        setRekordboxFolderStatus('idle')
        setUseAllCores(d.useAllCores === true)
        setEnergyCheckThreshold(Math.round((d.energyCheckThreshold ?? 0.12) * 100))
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
        body: JSON.stringify({ musicFolder: musicFolder.trim(), rekordboxFolder: rekordboxFolder.trim(), useAllCores, energyCheckThreshold: energyCheckThreshold / 100 }),
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

          {/* Energy Check threshold */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-[#e2e8f0]">Energy check sensitivity</label>
              <span className="text-sm font-semibold text-[#a78bfa] tabular-nums">{energyCheckThreshold}%</span>
            </div>
            <input
              type="range"
              min={12}
              max={50}
              step={1}
              value={energyCheckThreshold}
              onChange={e => setEnergyCheckThreshold(Number(e.target.value))}
              className="w-full accent-[#7c3aed] cursor-pointer"
            />
            <p className="text-[11px] text-[#64748b] mt-1">
              Flag tracks whose actual energy differs from the curve target by more than this amount. Lower = stricter. Minimum 12%.
            </p>
          </div>

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
