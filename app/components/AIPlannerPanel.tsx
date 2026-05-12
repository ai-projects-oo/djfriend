import { useState, useRef, useEffect } from 'react';
import type { SetPlan } from '../types';
import { apiFetch } from '../lib/apiFetch';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  plan?: SetPlan;
  error?: boolean;
}

interface Props {
  onClose: () => void;
  onApply: (plan: SetPlan) => void;
  availableGenres: string[];
  librarySize: number;
}

export default function AIPlannerPanel({ onClose, onApply, availableGenres, librarySize }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'Describe your gig and I\'ll plan the perfect set. Try: "2 hour peak time techno set at a festival" or "warm-up house set for a bar, 90 minutes".' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  async function send() {
    const prompt = input.trim();
    if (!prompt || loading) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', text: prompt }]);
    setLoading(true);
    try {
      const res = await apiFetch('/api/ai/plan-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, librarySize, availableGenres }),
      });
      const data = await res.json() as { ok: boolean; plan?: SetPlan; error?: string };
      if (data.ok && data.plan) {
        setMessages(m => [...m, { role: 'assistant', text: data.plan!.reasoning ?? 'Here\'s your set plan.', plan: data.plan }]);
      } else {
        setMessages(m => [...m, { role: 'assistant', text: data.error ?? 'Something went wrong. Try again.', error: true }]);
      }
    } catch {
      setMessages(m => [...m, { role: 'assistant', text: 'Failed to reach the AI. Check your Groq API key in Settings.', error: true }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[360px] bg-[#0d0d14] border-l border-[#1e1e2e] flex flex-col z-40 shadow-2xl">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e] flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#a78bfa]">
            <path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/><path d="M20 14v6"/><path d="M17 17h6"/>
          </svg>
          <span className="text-xs font-semibold uppercase tracking-widest text-[#64748b]">AI Set Planner</span>
        </div>
        <button type="button" onClick={onClose} className="text-[#475569] hover:text-[#94a3b8] transition-colors cursor-pointer">
          <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="4" x2="4" y2="12"/><line x1="4" y1="4" x2="12" y2="12"/>
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col gap-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
              msg.role === 'user'
                ? 'bg-[#7c3aed] text-white'
                : msg.error
                  ? 'bg-[#1a0a0a] text-[#f87171] border border-[#3f1a1a]'
                  : 'bg-[#12121a] text-[#e2e8f0] border border-[#1e1e2e]'
            }`}>
              {msg.text}
            </div>
            {msg.plan && (
              <div className="w-full bg-[#12121a] border border-[#2a2a3a] rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="text-[#94a3b8] font-semibold tabular-nums">{msg.plan.bpmMin}–{msg.plan.bpmMax} BPM</span>
                    <span className="text-[#64748b]">target {msg.plan.bpmTarget}</span>
                  </div>
                </div>
                {/* Mini energy curve preview */}
                <div className="h-10 relative bg-[#0d0d14] rounded-md overflow-hidden">
                  <svg className="w-full h-full" viewBox="0 0 100 40" preserveAspectRatio="none">
                    <polyline
                      points={msg.plan.curve.map(p => `${p.x * 100},${(1 - p.y) * 40}`).join(' ')}
                      fill="none" stroke="#7c3aed" strokeWidth="2"
                    />
                    <polyline
                      points={[
                        '0,40',
                        ...msg.plan.curve.map(p => `${p.x * 100},${(1 - p.y) * 40}`),
                        '100,40',
                      ].join(' ')}
                      fill="#7c3aed22" stroke="none"
                    />
                  </svg>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-[#475569]">
                  <span>Harmonic {Math.round(msg.plan.scoringWeights.harmonicWeight * 100)}%</span>
                  <span>·</span>
                  <span>BPM {Math.round(msg.plan.scoringWeights.bpmWeight * 100)}%</span>
                  <span>·</span>
                  <span>Energy {Math.round((msg.plan.scoringWeights.energyWeight ?? 0) * 100)}%</span>
                </div>
                <button
                  type="button"
                  onClick={() => onApply(msg.plan!)}
                  className="w-full py-1.5 rounded-lg bg-[#7c3aed] text-white text-[12px] font-semibold hover:bg-[#6d28d9] transition-colors cursor-pointer"
                >
                  Apply to Generator
                </button>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-start">
            <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl px-3 py-2 text-[13px] text-[#475569]">
              Planning…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-[#1e1e2e]">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Describe your gig…"
            rows={2}
            disabled={loading}
            className="flex-1 rounded-xl border border-[#2a2a3a] bg-[#12121a] px-3 py-2 text-[13px] text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] transition-colors resize-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={send}
            disabled={loading || !input.trim()}
            className="p-2.5 rounded-xl bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer flex-shrink-0"
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="14" x2="8" y2="2"/><polyline points="3 7 8 2 13 7"/>
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-[#334155] mt-1.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
