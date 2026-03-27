import { useState, useEffect } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  /** called after settings are saved successfully */
  onSaved: () => void
}

export default function SettingsModal({ open, onClose, onSaved }: Props) {
  const [musicFolder, setMusicFolder] = useState('')
  const [playlistsFolder, setPlaylistsFolder] = useState('')
  const [groqKey, setGroqKey] = useState('')
  const [hasGroqKey, setHasGroqKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingGroq, setSavingGroq] = useState(false)
  const [groqSaved, setGroqSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    fetch('/api/settings')
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
      const r = await fetch('/api/settings', {
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
      const r = await fetch('/api/settings', {
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

        <div className="space-y-4 mb-5">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[#475569]">Folders</h3>
          <div>
            <label className="block text-xs text-[#64748b] mb-1.5">Music library folder</label>
            <input
              type="text"
              value={musicFolder}
              onChange={e => setMusicFolder(e.target.value)}
              placeholder="/path/to/music"
              className="w-full rounded-md border border-[#2a2a3a] bg-[#12121a] px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-[#64748b] mb-1.5">Playlists folder</label>
            <input
              type="text"
              value={playlistsFolder}
              onChange={e => setPlaylistsFolder(e.target.value)}
              placeholder="/path/to/playlists"
              className="w-full rounded-md border border-[#2a2a3a] bg-[#12121a] px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] transition-colors"
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
