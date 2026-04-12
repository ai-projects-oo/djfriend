import React, { useState, useRef, useEffect } from 'react';
import type { SetTrack, DJPreferences } from '../types';
import TrackRow from './TrackRow';
import { downloadM3U } from '../lib/m3uExport';
import { matchesGenrePref } from '../lib/genreUtils';
import { getAffinityKey, genreAffinityBonus } from '../lib/setGenerator';

export type FitLevel = 'good' | 'warn' | 'bad';

export interface FitInfo {
  level: FitLevel;
  reasons: string[];
}

function computeFit(track: SetTrack, prevTrack: SetTrack | null, prefs: DJPreferences): FitInfo {
  const reasons: string[] = [];
  let worst: FitLevel = 'good';

  function flag(level: FitLevel, reason: string) {
    reasons.push(reason);
    if (level === 'bad') worst = 'bad';
    else if (worst !== 'bad') worst = 'warn';
  }

  // Harmonic clash
  if (track.harmonicWarning) {
    flag('bad', 'Harmonic clash with previous track');
  }

  // Energy vs target
  const eDelta = Math.abs(track.energy - track.targetEnergy);
  if (eDelta > 0.35) flag('bad', `Energy ${(eDelta * 100).toFixed(0)}% off target`);
  else if (eDelta > 0.20) flag('warn', `Energy ${(eDelta * 100).toFixed(0)}% off target`);

  // BPM jump from previous
  if (prevTrack && track.bpm > 0 && prevTrack.bpm > 0) {
    const bDelta = Math.abs(track.bpm - prevTrack.bpm);
    if (bDelta > 20) flag('bad', `BPM jump of ${bDelta.toFixed(0)} from previous`);
    else if (bDelta > 12) flag('warn', `BPM jump of ${bDelta.toFixed(0)} from previous`);
  }

  // Genre filter mismatch
  if (prefs.genre !== 'Any' && !matchesGenrePref(track, prefs.genre)) {
    flag('warn', `Genre doesn't match filter (${prefs.genre.replace('~', '')})`);
  }

  // Venue/phase affinity
  const affinityKey = getAffinityKey(prefs.venueType, prefs.setPhase);
  if (affinityKey && genreAffinityBonus(track, affinityKey) === 0) {
    flag('warn', `Genre doesn't suit ${prefs.venueType} · ${prefs.setPhase}`);
  }

  return { level: worst, reasons };
}

interface Props {
  tracks: SetTrack[];
  prefs: DJPreferences;
  libraryLoaded: boolean;
  onSwapTrack: (index: number) => void;
  onRemoveTrack: (index: number) => void;
  onReorderTrack: (fromIdx: number, toIdx: number) => void;
  onUpdateTrack: (index: number, tags: { title?: string; artist?: string; genre?: string; bpm?: number; camelot?: string; key?: string }) => void;
  onExport?: () => void;
  onExportSpotify?: () => void;
}

function totalDurationMinutes(tracks: SetTrack[]): number {
  const totalSecs = tracks.reduce((s, t) => s + (t.duration ?? 0), 0);
  return Math.round(totalSecs / 60);
}

export default function SetTracklist({ tracks, prefs, libraryLoaded, onSwapTrack, onRemoveTrack, onReorderTrack, onUpdateTrack, onExport, onExportSpotify }: Props) {
  const [exportOpen, setExportOpen] = useState(false);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [exportOpen]);

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[#475569] gap-3">
        <span className="text-4xl">🎵</span>
        {!libraryLoaded ? (
          <p className="text-sm">Load a library above to get started.</p>
        ) : (
          <p className="text-sm">Hit ▶ to generate your set.</p>
        )}
      </div>
    );
  }

  const duration = totalDurationMinutes(tracks);
  const warnings = tracks.filter((t) => t.harmonicWarning).length;
  const badFitCount = tracks.filter((t, i) =>
    computeFit(t, i > 0 ? tracks[i - 1] : null, prefs).level === 'bad'
  ).length;
  const warnFitCount = tracks.filter((t, i) =>
    computeFit(t, i > 0 ? tracks[i - 1] : null, prefs).level === 'warn'
  ).length;

  function scrollToFirstWarning() {
    const el = tableContainerRef.current?.querySelector('[data-warning="true"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function scrollToFirstBadFit() {
    const el = tableContainerRef.current?.querySelector('[data-fit="bad"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Stats bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex flex-wrap gap-4 text-sm text-[#94a3b8]">
          <span>
            <span className="text-[#e2e8f0] font-semibold">{tracks.length}</span> tracks
          </span>
          <span>
            <span className="text-[#e2e8f0] font-semibold">~{duration}</span> min
          </span>
          <span>
            Target: <span className="text-[#e2e8f0] font-semibold">{prefs.setDuration}</span> min
          </span>
          {badFitCount > 0 && (
            <button
              onClick={scrollToFirstBadFit}
              className="text-[#ef4444] hover:text-[#f87171] transition-colors cursor-pointer text-xs"
              title="Jump to first track needing replacement"
            >
              ● {badFitCount} {badFitCount === 1 ? 'track needs' : 'tracks need'} replacing
            </button>
          )}
          {warnFitCount > 0 && (
            <button
              onClick={() => {
                const el = tableContainerRef.current?.querySelector('[data-fit="warn"]');
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              className="text-[#f59e0b] hover:text-[#fbbf24] transition-colors cursor-pointer text-xs"
              title="Jump to first track with fit warnings"
            >
              ● {warnFitCount} {warnFitCount === 1 ? 'track has' : 'tracks have'} fit issues
            </button>
          )}
          {warnings > 0 && badFitCount === 0 && warnFitCount === 0 && (
            <button
              onClick={scrollToFirstWarning}
              className="text-[#f59e0b] hover:text-[#fbbf24] transition-colors cursor-pointer text-xs"
              title="Jump to first harmonic warning"
            >
              ⚠ {warnings} harmonic {warnings === 1 ? 'warning' : 'warnings'}
            </button>
          )}
        </div>

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setExportOpen((o) => !o)}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#12121a] border border-[#2a2a3a] text-sm text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer"
          >
            <span>↓</span>
            Export
            <span className="text-[10px]">▾</span>
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full mt-1 z-10 min-w-[160px] rounded-md border border-[#2a2a3a] bg-[#12121a] shadow-lg overflow-hidden">
              <button
                onClick={() => { downloadM3U(tracks); onExport?.(); setExportOpen(false); }}
                className="w-full text-left flex items-center gap-2 px-4 py-2.5 text-sm text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
              >
                Export as M3U
              </button>
              <button
                onClick={() => { onExportSpotify?.(); setExportOpen(false); }}
                className="w-full text-left flex items-center gap-2 px-4 py-2.5 text-sm text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#1e1e2e]"
              >
                <span className="flex-1">Export to Spotify</span>
                <span className="text-[10px] font-semibold bg-[#7c3aed22] text-[#a78bfa] border border-[#7c3aed44] px-1.5 py-0.5 rounded uppercase tracking-wide">Pro</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-[#1e1e2e] overflow-hidden" ref={tableContainerRef}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#0d0d14] border-b border-[#1e1e2e]">
                <th className="py-2 pl-4 pr-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider w-10">#</th>
                <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">Track</th>
                <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider whitespace-nowrap">Time</th>
                <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">BPM</th>
                <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">Key</th>
                <th className="py-2 px-2 pr-4 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">Energy</th>
                <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider hidden xl:table-cell">Genre</th>
                <th className="py-2 pl-2 pr-4 text-right text-[10px] font-semibold text-[#475569] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((track, idx) => {
                const prevTrack = idx > 0 ? tracks[idx - 1] : null;
                const bpmDelta = prevTrack && track.bpm > 0 && prevTrack.bpm > 0
                  ? Math.abs(track.bpm - prevTrack.bpm)
                  : 0;
                const bpmDir = prevTrack && track.bpm > 0 && prevTrack.bpm > 0
                  ? (track.bpm >= prevTrack.bpm ? '▲' : '▼')
                  : '';
                const bpmDeltaColor = bpmDelta <= 8 ? '#475569' : bpmDelta <= 15 ? '#f59e0b' : '#ef4444';

                return (
                  <React.Fragment key={track.file}>
                    {bpmDelta > 0 && (
                      <tr>
                        <td
                          colSpan={8}
                          className="text-center"
                          style={{ height: '16px', padding: '0', lineHeight: '16px' }}
                        >
                          <span
                            style={{
                              fontSize: '10px',
                              color: bpmDeltaColor,
                              fontVariantNumeric: 'tabular-nums',
                              letterSpacing: '0.02em',
                            }}
                          >
                            {bpmDir}{Math.round(bpmDelta)} BPM
                          </span>
                        </td>
                      </tr>
                    )}
                    <TrackRow
                      track={track}
                      index={idx}
                      fitInfo={computeFit(track, prevTrack, prefs)}
                      onSwap={() => onSwapTrack(idx)}
                      onRemove={() => onRemoveTrack(idx)}
                      onUpdateTrack={(tags) => onUpdateTrack(idx, tags)}
                      onDragStart={() => setDraggingIdx(idx)}
                      onDragEnd={() => { setDraggingIdx(null); setDragOverIdx(null); }}
                      onDragOver={(e) => { e.preventDefault(); if (draggingIdx !== null && draggingIdx !== idx) setDragOverIdx(idx); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (draggingIdx !== null && draggingIdx !== idx) {
                          onReorderTrack(draggingIdx, idx);
                        }
                        setDraggingIdx(null);
                        setDragOverIdx(null);
                      }}
                      isDragOver={dragOverIdx === idx}
                    />
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
