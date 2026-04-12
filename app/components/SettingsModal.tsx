import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/apiFetch'

interface Props {
  open: boolean
  onClose: () => void
  /** called after settings are saved successfully */
  onSaved: () => void
  /** called after the database is cleared */
  onDatabaseCleared?: () => void
}

type PathStatus = 'idle' | 'checking' | 'ok' | 'missing'

export default function SettingsModal({ open, onClose, onSaved, onDatabaseCleared }: Props) {
  const [musicFolder, setMusicFolder] = useState('')
  const [playlistsFolder, setPlaylistsFolder] = useState('')
  const [musicFolderStatus, setMusicFolderStatus] = useState<PathStatus>('idle')
  const [playlistsFolderStatus, setPlaylistsFolderStatus] = useState<PathStatus>('idle')
  const [groqKey, setGroqKey] = useState('')
  const [hasGroqKey, setHasGroqKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingGroq, setSavingGroq] = useState(false)
  const [groqSaved, setGroqSaved] = useState(false)
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
    setMusicFolderStatus('idle')
    setPlaylistsFolderStatus('idle')
    apiFetch('/api/settings')
      .then(r => r.json())
      .then((d: { musicFolder: string; playlistsFolder: string; hasGroqKey: boolean }) => {
        setMusicFolder(d.musicFolder ?? '')
        setPlaylistsFolder(d.playlistsFolder ?? '')
        setHasGroqKey(d.hasGroqKey ?? false)
      })
      .catch(() => {})
  }, [open])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const body: Record<string, string> = { musicFolder: musicFolder.trim(), playlistsFolder: playlistsFolder.trim() }
      const r = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  async function saveGroqKey() {
    if (!groqKey.trim()) return
    setSavingGroq(true)
    setGroqSaved(false)
    try {
      const r = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groqApiKey: groqKey.trim() }),
      })
      if (!r.ok) throw new Error('Save failed')
      setGroqKey('')
      setHasGroqKey(true)
      setGroqSaved(true)
    } catch {
      setError('Failed to save Groq API key.')
    } finally {
      setSavingGroq(false)
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
      <div className="w-full max-w-md rounded-xl border border-[#2a2a3a] bg-[#0e0e16] shadow-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-[#e2e8f0]">Settings</h2>
          <button onClick={onClose} className="text-[#475569] hover:text-[#94a3b8] transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {!musicFolder && !playlistsFolder && (
          <div className="mb-5 rounded-lg border border-[#7c3aed44] bg-[#1a1030] px-4 py-3">
            <p className="text-xs text-[#a78bfa] leading-relaxed">
              Welcome to DJFriend. Set your <strong className="text-[#c4b5fd]">music folder</strong> and <strong className="text-[#c4b5fd]">playlists folder</strong> below to get started.
            </p>
          </div>
        )}

        <div className="space-y-4 mb-5">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[#475569]">Folders</h3>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-[#64748b]">Music library folder</label>
              {musicFolderStatus === 'checking' && <span className="text-[10px] text-[#475569]">Checking…</span>}
              {musicFolderStatus === 'ok' && <span className="text-[10px] text-[#22c55e]">✓ Found</span>}
              {musicFolderStatus === 'missing' && <span className="text-[10px] text-[#ef4444]">Folder not found</span>}
            </div>
            <input
              type="text"
              value={musicFolder}
              onChange={e => { setMusicFolder(e.target.value); setMusicFolderStatus('idle') }}
              onBlur={() => void checkPath(musicFolder, setMusicFolderStatus)}
              placeholder="/path/to/music"
              className={`w-full rounded-md border bg-[#12121a] px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#334155] focus:outline-none transition-colors ${
                musicFolderStatus === 'ok' ? 'border-[#22c55e]' :
                musicFolderStatus === 'missing' ? 'border-[#ef4444]' :
                'border-[#2a2a3a] focus:border-[#7c3aed]'
              }`}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-[#64748b]">Playlists folder</label>
              {playlistsFolderStatus === 'checking' && <span className="text-[10px] text-[#475569]">Checking…</span>}
              {playlistsFolderStatus === 'ok' && <span className="text-[10px] text-[#22c55e]">✓ Found</span>}
              {playlistsFolderStatus === 'missing' && <span className="text-[10px] text-[#ef4444]">Folder not found</span>}
            </div>
            <input
              type="text"
              value={playlistsFolder}
              onChange={e => { setPlaylistsFolder(e.target.value); setPlaylistsFolderStatus('idle') }}
              onBlur={() => void checkPath(playlistsFolder, setPlaylistsFolderStatus)}
              placeholder="/path/to/playlists"
              className={`w-full rounded-md border bg-[#12121a] px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#334155] focus:outline-none transition-colors ${
                playlistsFolderStatus === 'ok' ? 'border-[#22c55e]' :
                playlistsFolderStatus === 'missing' ? 'border-[#ef4444]' :
                'border-[#2a2a3a] focus:border-[#7c3aed]'
              }`}
            />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[#475569]">AI</h3>
          <p className="text-xs text-[#64748b] leading-relaxed">
            Get a free API key at{' '}
            <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" className="text-[#7c3aed] hover:underline">
              console.groq.com
            </a>
            {' '}— no credit card required.
          </p>
          <div>
            <label className="block text-xs text-[#64748b] mb-1.5">
              Groq API Key
              {hasGroqKey && !groqKey && !groqSaved && <span className="ml-2 text-[#22c55e]">✓ saved</span>}
              {groqSaved && <span className="ml-2 text-[#22c55e]">✓ saved</span>}
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={groqKey}
                onChange={e => { setGroqKey(e.target.value); setGroqSaved(false) }}
                placeholder={hasGroqKey ? 'Enter new key to replace' : 'gsk_…'}
                className="flex-1 rounded-md border border-[#2a2a3a] bg-[#12121a] px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] transition-colors"
                aria-label="Groq API key"
              />
              <button
                onClick={saveGroqKey}
                disabled={savingGroq || !groqKey.trim()}
                className="px-3 py-2 text-sm font-medium rounded-md bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                {savingGroq ? 'Saving…' : 'Save key'}
              </button>
            </div>
          </div>
        </div>

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

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[#64748b] hover:text-[#94a3b8] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-md bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
