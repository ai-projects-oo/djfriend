import { useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import type { SetTrack } from '../types';

interface Props {
  track: SetTrack;
  index: number;
  onSwap: () => void;
}

const CAMELOT_COLORS: Record<string, string> = {
  A: '#06b6d4', // cyan for minor keys
  B: '#7c3aed', // violet for major keys
};

function camelotBadgeColor(camelot: string): string {
  const letter = camelot.slice(-1).toUpperCase();
  return CAMELOT_COLORS[letter] ?? '#6b7280';
}

function energyBarColor(energy: number): string {
  if (energy < 0.4) return '#22c55e';
  if (energy < 0.7) return '#eab308';
  return '#ef4444';
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function TrackRow({ track, index, onSwap }: Props) {
  const [showTooltip, setShowTooltip] = useState(false);
  const artist = track.spotifyArtist ?? track.artist;
  const title = track.spotifyTitle ?? track.title;
  const barColor = energyBarColor(track.energy);

  return (
    <tr className="border-b border-[#1e1e2e] hover:bg-[#12121a] transition-colors group">
      {/* # */}
      <td className="py-3 pl-4 pr-2 text-[#475569] text-sm tabular-nums w-10">
        {index + 1}
      </td>

      {/* Title / Artist */}
      <td className="py-3 px-2 min-w-0">
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-[#e2e8f0] truncate">{title}</div>
            <div className="text-xs text-[#64748b] truncate">{artist}</div>
          </div>
          {track.harmonicWarning && (
            <div className="relative flex-shrink-0">
              <span
                className="text-[#f59e0b] cursor-help text-base"
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
              >
                ⚠
              </span>
              {showTooltip && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-48 rounded-md bg-[#1e1e2e] border border-[#2a2a3a] px-3 py-2 text-xs text-[#e2e8f0] shadow-lg pointer-events-none">
                  Harmonic clash — this transition may sound dissonant. Consider
                  pitch-shifting or adding an EQ breakdown.
                </div>
              )}
            </div>
          )}
        </div>
      </td>

      {/* Duration */}
      <td className="py-3 px-2 text-[#94a3b8] text-xs tabular-nums whitespace-nowrap">
        {track.duration != null ? formatDuration(track.duration) : '—'}
      </td>

      {/* BPM */}
      <td className="py-3 px-2 text-[#94a3b8] text-xs tabular-nums whitespace-nowrap">
        {track.bpm > 0 ? track.bpm.toFixed(0) : '—'}
      </td>

      {/* Camelot key */}
      <td className="py-3 px-2 whitespace-nowrap">
        <span
          className="inline-block px-2 py-0.5 rounded text-xs font-mono font-semibold text-white"
          style={{ backgroundColor: camelotBadgeColor(track.camelot) + '33', color: camelotBadgeColor(track.camelot), border: `1px solid ${camelotBadgeColor(track.camelot)}66` }}
        >
          {track.camelot}
        </span>
      </td>

      {/* Key name */}
      <td className="py-3 px-2 text-[#64748b] text-xs whitespace-nowrap hidden lg:table-cell">
        {track.key}
      </td>

      {/* Energy bar */}
      <td className="py-3 px-2 pr-4">
        <div className="flex items-center gap-2">
          <div className="w-16 h-2 rounded-full bg-[#1e1e2e] overflow-hidden flex-shrink-0">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${(track.energy * 100).toFixed(1)}%`,
                backgroundColor: barColor,
              }}
            />
          </div>
          <span className="text-[10px] text-[#475569] tabular-nums w-8">
            {(track.energy * 100).toFixed(0)}%
          </span>
        </div>
      </td>

      <td className="py-3 pl-2 pr-4 text-right">
        <button
          onClick={onSwap}
          title="Swap track"
          aria-label="Swap track"
          className="px-2 py-1 text-[11px] rounded-md border border-[#2a2a3a] bg-[#12121a] text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer"
        >
          <RefreshCcw size={14} />
        </button>
      </td>
    </tr>
  );
}
