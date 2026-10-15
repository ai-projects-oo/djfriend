import { useState } from 'react';
import type { SetTrack } from '../types';
import { camelotColor } from '../lib/camelotColors';

interface SuggestionsStripProps {
  suggestions: SetTrack[];
  setDuration: number | null;
  actualDurationSec: number;
  onAdd: (track: SetTrack) => void;
  onExtend: (extraMinutes: 15 | 30) => void;
}

export default function SuggestionsStrip({ suggestions, setDuration, actualDurationSec, onAdd, onExtend }: SuggestionsStripProps) {
  const [expanded, setExpanded] = useState(false);

  const targetSec = setDuration != null ? setDuration * 60 : null;
  const overSec   = targetSec != null ? actualDurationSec - targetSec : 0;
  const overMin   = Math.round(overSec / 60);

  const isEmpty = suggestions.length === 0;

  return (
    <div className="border border-[#2c2c42] rounded-xl bg-[#1c1c2e] overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#12121a] transition-colors cursor-pointer text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#9aa8ba]">{expanded ? '▾' : '▸'}</span>
          <span className="text-xs font-medium text-[#b6c2d0]">
            {isEmpty
              ? setDuration === null
                ? 'All tracks are in your set'
                : 'No more tracks available'
              : `${suggestions.length} suggestion${suggestions.length !== 1 ? 's' : ''}`}
          </span>
          {overMin > 0 && (
            <span className="text-[10px] font-medium text-[#f59e0b]">· {overMin}m over target</span>
          )}
        </div>
        {!isEmpty && setDuration !== null && (
          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => onExtend(15)}
              className="px-2 py-0.5 text-[10px] rounded border border-[#363650] text-[#b6c2d0] hover:text-[#a78bfa] hover:border-[#7c3aed] transition-colors cursor-pointer"
              title="Extend target by 15 minutes"
            >
              +15m
            </button>
            <button
              type="button"
              onClick={() => onExtend(30)}
              className="px-2 py-0.5 text-[10px] rounded border border-[#363650] text-[#b6c2d0] hover:text-[#a78bfa] hover:border-[#7c3aed] transition-colors cursor-pointer"
              title="Extend target by 30 minutes"
            >
              +30m
            </button>
          </div>
        )}
      </button>

      {/* Banner when significantly over */}
      {overMin > 4 && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-[#451a03] border border-[#92400e] text-[11px] text-[#f59e0b]">
          Set is {overMin} minutes over your {setDuration}m target.
        </div>
      )}

      {/* Track list */}
      {expanded && !isEmpty && (
        <div className="border-t border-[#2c2c42] divide-y divide-[#1a1a28]">
          {suggestions.map((track, i) => {
            const keyColor = camelotColor(track.camelot);
            const topReason = track.selectionReason?.[0];
            return (
              <div
                key={`${track.file}-${i}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#12121a] transition-colors group"
              >
                {/* Energy bar */}
                <div className="w-1 h-8 rounded-full bg-[#2c2c42] shrink-0 relative overflow-hidden">
                  <div
                    className="absolute bottom-0 left-0 right-0 rounded-full"
                    style={{ height: `${track.energy * 100}%`, backgroundColor: '#7c3aed88' }}
                  />
                </div>

                {/* Track info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[#e2e8f0] truncate leading-tight">{track.title}</p>
                  <p className="text-[10px] text-[#b6c2d0] truncate leading-tight">{track.artist}</p>
                </div>

                {/* Metadata chips */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                    style={{ backgroundColor: keyColor + '22', color: keyColor, border: `1px solid ${keyColor}44` }}
                  >
                    {track.camelot}
                  </span>
                  <span className="text-[10px] text-[#9aa8ba] tabular-nums w-8 text-right">
                    {track.bpm > 0 ? Math.round(track.bpm) : '—'}
                  </span>
                </div>

                {/* Reason chip */}
                {topReason && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 hidden sm:block ${
                      topReason.quality === 'good' ? 'text-[#22c55e] bg-[#22c55e11]' :
                      topReason.quality === 'ok'   ? 'text-[#f59e0b] bg-[#f59e0b11]' :
                      'text-[#9aa8ba] bg-[#2c2c42]'
                    }`}
                    title={topReason.text}
                  >
                    {topReason.text.split('—')[0].trim()}
                  </span>
                )}

                {/* Add button */}
                <button
                  type="button"
                  onClick={() => onAdd(track)}
                  className="px-3 py-1 text-[10px] font-medium rounded border border-[#363650] text-[#b6c2d0] hover:text-white hover:bg-[#7c3aed] hover:border-[#7c3aed] transition-colors cursor-pointer shrink-0 opacity-0 group-hover:opacity-100"
                  aria-label={`Add ${track.title} to set`}
                >
                  Add
                </button>
              </div>
            );
          })}
        </div>
      )}

      {expanded && isEmpty && (
        <div className="border-t border-[#2c2c42] px-4 py-3 text-[11px] text-[#a3b0c2]">
          {setDuration === null
            ? 'All matching tracks are already in your set.'
            : 'No more tracks available in this source.'}
        </div>
      )}
    </div>
  );
}
