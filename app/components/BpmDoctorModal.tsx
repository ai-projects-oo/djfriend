import { useMemo, useState } from 'react';
import type { Song } from '../types';

interface BpmSuspect {
  song: Song;
  detectedBpm: number;
  suggestedBpm: number;
  reason: string;
}

interface Props {
  library: Song[];
  onApplyFixes: (fixes: Array<{ file: string; bpm: number }>) => void;
  onClose: () => void;
}

function detectSuspects(library: Song[]): BpmSuspect[] {
  const withBpm = library.filter(s => s.bpm > 0);
  if (withBpm.length < 3) return [];

  // Use median BPM of library as the reference "typical" tempo
  const sorted = [...withBpm].sort((a, b) => a.bpm - b.bpm);
  const median = sorted[Math.floor(sorted.length / 2)].bpm;

  const suspects: BpmSuspect[] = [];

  for (const song of withBpm) {
    const bpm = song.bpm;
    const doubled = bpm * 2;
    const halved = bpm / 2;

    const distCurrent = Math.abs(bpm - median);
    const distDoubled = Math.abs(doubled - median);
    const distHalved = Math.abs(halved - median);

    // Half-tempo: current BPM is far below median, doubling brings it much closer
    if (bpm < 90 && doubled >= 90 && doubled <= 200 && distDoubled < distCurrent * 0.6) {
      suspects.push({
        song,
        detectedBpm: bpm,
        suggestedBpm: Math.round(doubled * 10) / 10,
        reason: `${bpm} BPM looks like half-tempo — library median is ${Math.round(median)} BPM`,
      });
    }
    // Double-tempo: current BPM is far above median, halving brings it much closer
    else if (bpm > 160 && halved >= 60 && halved <= 160 && distHalved < distCurrent * 0.6) {
      suspects.push({
        song,
        detectedBpm: bpm,
        suggestedBpm: Math.round(halved * 10) / 10,
        reason: `${bpm} BPM looks like double-tempo — library median is ${Math.round(median)} BPM`,
      });
    }
  }

  return suspects.sort((a, b) => a.song.title.localeCompare(b.song.title));
}

export default function BpmDoctorModal({ library, onApplyFixes, onClose }: Props) {
  const suspects = useMemo(() => detectSuspects(library), [library]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(suspects.map(s => s.song.file)));
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(false);

  function toggle(file: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file); else next.add(file);
      return next;
    });
  }

  async function applyFixes() {
    const fixes = suspects
      .filter(s => selected.has(s.song.file))
      .map(s => ({ file: s.song.file, bpm: s.suggestedBpm }));
    if (fixes.length === 0) return;
    setApplying(true);
    try {
      await fetch('/api/bulk-fix-bpm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixes }),
      });
      onApplyFixes(fixes);
      setDone(true);
    } catch { /* ignore */ }
    finally { setApplying(false); }
  }

  const selectedCount = suspects.filter(s => selected.has(s.song.file)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xl mx-4 rounded-xl border border-[#2a2a3a] bg-[#0d0d14] shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e1e2e]">
          <div>
            <h2 className="text-sm font-semibold text-[#e2e8f0]">BPM Doctor</h2>
            <p className="text-xs text-[#475569] mt-0.5">
              {suspects.length === 0
                ? 'No half/double-tempo issues detected'
                : `${suspects.length} suspect${suspects.length === 1 ? '' : 's'} found`}
            </p>
          </div>
          <button onClick={onClose} className="text-[#475569] hover:text-[#e2e8f0] transition-colors cursor-pointer text-lg leading-none">×</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {done ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <span className="text-3xl">✓</span>
              <p className="text-sm text-[#22c55e]">{selectedCount} BPM{selectedCount === 1 ? '' : 's'} corrected</p>
              <p className="text-xs text-[#475569]">Regenerate your set to apply the changes.</p>
            </div>
          ) : suspects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <span className="text-3xl">✓</span>
              <p className="text-sm text-[#64748b]">All BPMs look correct.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {/* Select all */}
              <button
                onClick={() => setSelected(selected.size === suspects.length ? new Set() : new Set(suspects.map(s => s.song.file)))}
                className="text-left text-[10px] text-[#475569] hover:text-[#94a3b8] transition-colors cursor-pointer mb-2"
              >
                {selected.size === suspects.length ? 'Deselect all' : 'Select all'}
              </button>

              {suspects.map(s => {
                const isSelected = selected.has(s.song.file);
                return (
                  <button
                    key={s.song.file}
                    onClick={() => toggle(s.song.file)}
                    className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                      isSelected ? 'border-[#7c3aed] bg-[#7c3aed0d]' : 'border-[#1e1e2e] bg-[#12121a] opacity-50'
                    }`}
                  >
                    {/* Checkbox */}
                    <span
                      className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 text-[9px]"
                      style={{
                        borderColor: isSelected ? '#7c3aed' : '#2a2a3a',
                        backgroundColor: isSelected ? '#7c3aed' : 'transparent',
                        color: '#fff',
                      }}
                    >
                      {isSelected ? '✓' : ''}
                    </span>

                    {/* Track info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-[#e2e8f0] truncate">{s.song.title}</div>
                      <div className="text-[10px] text-[#64748b] truncate">{s.song.artist}</div>
                      <div className="text-[10px] text-[#475569] mt-0.5">{s.reason}</div>
                    </div>

                    {/* BPM correction arrow */}
                    <div className="flex items-center gap-2 flex-shrink-0 text-xs tabular-nums">
                      <span className="text-[#ef4444]">{s.detectedBpm}</span>
                      <span className="text-[#334155]">→</span>
                      <span className="text-[#22c55e] font-semibold">{s.suggestedBpm}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {!done && suspects.length > 0 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-[#1e1e2e]">
            <span className="text-xs text-[#475569]">{selectedCount} of {suspects.length} selected</span>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-1.5 rounded-md border border-[#2a2a3a] text-xs text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#475569] transition-colors cursor-pointer">
                Cancel
              </button>
              <button
                onClick={() => void applyFixes()}
                disabled={selectedCount === 0 || applying}
                className="px-4 py-1.5 rounded-md bg-[#7c3aed] text-white text-xs font-medium hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {applying ? 'Fixing…' : `Fix ${selectedCount} BPM${selectedCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
        {done && (
          <div className="px-5 py-4 border-t border-[#1e1e2e] flex justify-end">
            <button onClick={onClose} className="px-4 py-1.5 rounded-md bg-[#7c3aed] text-white text-xs font-medium hover:bg-[#6d28d9] transition-colors cursor-pointer">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
