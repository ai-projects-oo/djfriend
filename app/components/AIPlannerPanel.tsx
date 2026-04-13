import { useState, useRef, useEffect } from 'react'
import { apiFetch } from '../lib/apiFetch'
import type { ChatMessage, SetPlan } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  availableGenres: string[]
  librarySize: number
  onApplyPlan: (plan: SetPlan) => void
}

export default function AIPlannerPanel({ open, onClose, availableGenres, librarySize, onApplyPlan }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setError('')
    const userMsg: ChatMessage = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)
    try {
      const r = await apiFetch('/api/ai/plan-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, availableGenres, librarySize }),
      })
      const data = await r.json() as { ok: boolean; plan?: SetPlan; error?: string }
      if (!data.ok) throw new Error(data.error ?? 'Planning failed')
      const plan = data.plan!
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: plan.reasoning,
        plan,
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-80 flex flex-col border-l border-[#2a2a3a] bg-[#0d0d14] shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a3a]">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
          </svg>
          <span className="text-xs font-semibold uppercase tracking-widest text-[#94a3b8]">AI Planner</span>
        </div>
        <button onClick={onClose} className="text-[#475569] hover:text-[#94a3b8] transition-colors cursor-pointer" aria-label="Close AI planner">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className="text-xs text-[#475569] leading-relaxed">
            Describe your gig and I'll configure the energy curve, BPM range, and scoring weights for you.
            <br /><br />
            <span className="text-[#64748b]">e.g. "2-hour club set, late night, deep techno, build slowly to peak then close"</span>
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col gap-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[92%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'bg-[#7c3aed]/20 text-[#c4b5fd]'
                : 'bg-[#1a1a26] text-[#94a3b8] border border-[#2a2a3a]'
            }`}>
              {msg.content}
            </div>
            {msg.plan && (
              <div className="w-full bg-[#12121a] border border-[#2a2a3a] rounded-lg p-3 space-y-2">
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  {msg.plan.venueType && (
                    <span className="px-2 py-0.5 rounded bg-[#7c3aed]/10 text-[#a78bfa] border border-[#7c3aed]/20">{msg.plan.venueType}</span>
                  )}
                  {msg.plan.genre && msg.plan.genre !== 'Any' && (
                    <span className="px-2 py-0.5 rounded bg-[#1e1e2e] text-[#64748b] border border-[#2a2a3a]">{msg.plan.genre}</span>
                  )}
                  <span className="px-2 py-0.5 rounded bg-[#1e1e2e] text-[#64748b] border border-[#2a2a3a]">{msg.plan.bpmMin}–{msg.plan.bpmMax} BPM</span>
                  {msg.plan.setDuration && (
                    <span className="px-2 py-0.5 rounded bg-[#1e1e2e] text-[#64748b] border border-[#2a2a3a]">{msg.plan.setDuration} min</span>
                  )}
                </div>
                <button
                  onClick={() => onApplyPlan(msg.plan!)}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-xs font-medium transition-colors cursor-pointer"
                  aria-label="Apply this plan to the generator"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Apply to generator
                </button>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-[#475569]">
            <span className="animate-pulse">Planning…</span>
          </div>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-[#2a2a3a]">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            placeholder="Describe your gig…"
            disabled={loading}
            className="flex-1 rounded-md border border-[#2a2a3a] bg-[#12121a] px-3 py-2 text-xs text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] transition-colors disabled:opacity-50"
            aria-label="Describe your gig"
          />
          <button
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            className="px-3 py-2 rounded-md bg-[#7c3aed] hover:bg-[#6d28d9] text-white disabled:opacity-40 transition-colors cursor-pointer"
            aria-label="Send"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
