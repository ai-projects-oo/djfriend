import { useState, useEffect } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  /** called after settings are saved successfully */
  onSaved: () => void
}

export default function SettingsModal({ open, onClose, onSaved }: Props) {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [hasSecret, setHasSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    fetch('/api/settings')
      .then(r => r.json())
      .then((d: { spotifyClientId: string; hasSecret: boolean }) => {
        setClientId(d.spotifyClientId ?? '')
        setHasSecret(d.hasSecret)
      })
      .catch(() => {})
  }, [open])

  async function save() {
    if (!clientId.trim()) { setError('Client ID is required.'); return }
    if (!clientSecret.trim() && !hasSecret) { setError('Client Secret is required.'); return }
    setSaving(true)
    setError('')
    try {
      const body: Record<string, string> = { spotifyClientId: clientId.trim() }
      if (clientSecret.trim()) body.spotifyClientSecret = clientSecret.trim()
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('Save failed')
      setClientSecret('')
      setHasSecret(true)
      onSaved()
      onClose()
    } catch {
      setError('Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[#2a2a3a] bg-[#0e0e16] shadow-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-[#e2e8f0]">Spotify Settings</h2>
          <button onClick={onClose} className="text-[#475569] hover:text-[#94a3b8] transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p className="text-xs text-[#64748b] mb-5 leading-relaxed">
          Create a free app at{' '}
          <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-[#7c3aed] hover:underline">
            developer.spotify.com
          </a>{' '}
          to get your Client ID and Secret.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[#64748b] mb-1.5">Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              placeholder="32-character hex string"
              className="w-full rounded-md border border-[#2a2a3a] bg-[#12121a] px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-[#64748b] mb-1.5">
              Client Secret{hasSecret && !clientSecret && <span className="ml-2 text-[#22c55e]">✓ saved</span>}
            </label>
            <input
              type="password"
              value={clientSecret}
              onChange={e => setClientSecret(e.target.value)}
              placeholder={hasSecret ? 'Enter new secret to replace' : '32-character hex string'}
              className="w-full rounded-md border border-[#2a2a3a] bg-[#12121a] px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
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
