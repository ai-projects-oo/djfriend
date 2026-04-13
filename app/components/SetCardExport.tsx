import { useRef, useState } from 'react';
import type { SetTrack } from '../types';
import { camelotColor } from '../lib/camelotColors';

interface Props {
  tracks: SetTrack[];
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function totalDuration(tracks: SetTrack[]): string {
  const total = tracks.reduce((s, t) => s + (t.duration ?? 0), 0);
  return formatDuration(total);
}

function EnergyDot({ energy }: { energy: number }) {
  const filled = Math.round(energy * 5);
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            backgroundColor: i < filled
              ? energy < 0.4 ? '#3b82f6' : energy < 0.7 ? '#a855f7' : '#ef4444'
              : '#1e1e2e',
            display: 'inline-block',
          }}
        />
      ))}
    </span>
  );
}

export default function SetCardExport({ tracks, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [setName, setSetName] = useState('');

  async function handleExport() {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const link = document.createElement('a');
      link.download = `${setName.trim() || 'djfriend-set'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      setExporting(false);
    }
  }

  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex flex-col gap-4 w-full max-w-2xl max-h-[90vh]">
        {/* Controls */}
        <div className="flex items-center gap-3">
          <input
            value={setName}
            onChange={e => setSetName(e.target.value)}
            placeholder="Set name (optional)"
            className="flex-1 bg-[#12121a] border border-[#2a2a3a] rounded-md px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed]"
          />
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#7c3aed] text-white text-sm font-medium hover:bg-[#6d28d9] disabled:opacity-50 cursor-pointer transition-colors"
          >
            {exporting ? 'Exporting…' : '↓ Save PNG'}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-md border border-[#2a2a3a] text-[#94a3b8] text-sm hover:text-[#e2e8f0] hover:border-[#475569] cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Card preview — this is what gets exported */}
        <div className="overflow-y-auto rounded-xl border border-[#2a2a3a]">
          <div
            ref={cardRef}
            style={{
              backgroundColor: '#0a0a12',
              padding: '32px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              minWidth: 560,
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                {setName.trim() && (
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
                    {setName.trim()}
                  </div>
                )}
                <div style={{ fontSize: 12, color: '#475569' }}>{date}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#334155', marginBottom: 2 }}>
                  {tracks.length} tracks · {totalDuration(tracks)}
                </div>
                <div style={{ fontSize: 10, color: '#1e1e2e', fontWeight: 600, letterSpacing: '0.1em' }}>
                  DJFRIEND
                </div>
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: 1, backgroundColor: '#1e1e2e', marginBottom: 16 }} />

            {/* Track list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {tracks.map((track, i) => {
                const color = camelotColor(track.camelot);
                return (
                  <div
                    key={track.file}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 10px',
                      borderRadius: 6,
                      backgroundColor: i % 2 === 0 ? '#0d0d18' : 'transparent',
                    }}
                  >
                    {/* Index */}
                    <div style={{ width: 20, textAlign: 'right', fontSize: 11, color: '#334155', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {i + 1}
                    </div>

                    {/* Title / Artist */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {track.title}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {track.artist}
                      </div>
                    </div>

                    {/* BPM */}
                    <div style={{ fontSize: 11, color: '#64748b', width: 32, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {track.bpm > 0 ? Math.round(track.bpm) : '—'}
                    </div>

                    {/* Camelot key */}
                    <div style={{ flexShrink: 0 }}>
                      {track.camelot ? (
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 7px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 700,
                          fontFamily: 'monospace',
                          backgroundColor: color + '26',
                          color,
                          border: `1px solid ${color}66`,
                        }}>
                          {track.camelot}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#334155' }}>—</span>
                      )}
                    </div>

                    {/* Energy dots */}
                    <div style={{ flexShrink: 0 }}>
                      <EnergyDot energy={track.energy} />
                    </div>

                    {/* Duration */}
                    <div style={{ fontSize: 11, color: '#334155', width: 32, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {track.duration != null ? formatDuration(track.duration) : ''}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div style={{ height: 1, backgroundColor: '#1e1e2e', marginTop: 16, marginBottom: 12 }} />
            <div style={{ fontSize: 10, color: '#1e1e2e', textAlign: 'center', letterSpacing: '0.15em' }}>
              MADE WITH DJFRIEND
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
