import React, { useState, useRef, useEffect } from 'react';
import type { SetTrack, DJPreferences } from '../types';
import TrackRow from './TrackRow';
import { downloadM3U } from '../lib/m3uExport';
import { downloadRekordboxXml } from '../lib/rekordboxExport';
import SetCardExport from './SetCardExport';
import { matchesGenrePref } from '../lib/genreUtils';
import { getAffinityKey, genreAffinityBonus } from '../lib/setGenerator';

export type FitLevel = 'good' | 'warn' | 'bad';

export interface FitInfo {
  level: FitLevel;
  reasons: string[];
}

// ─── Column definitions ────────────────────────────────────────────────────────

export type ColumnKey = 'time' | 'genre' | 'year' | 'comment';

const OPTIONAL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'time',    label: 'Time' },
  { key: 'genre',   label: 'Genre' },
  { key: 'year',    label: 'Year' },
  { key: 'comment', label: 'Comments' },
];

const LS_KEY = 'djfriend:visibleColumns';
const DEFAULT_VISIBLE: ColumnKey[] = ['time', 'genre'];

function loadVisibleColumns(): Set<ColumnKey> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ColumnKey[];
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch { /* ignore */ }
  return new Set(DEFAULT_VISIBLE);
}

function saveVisibleColumns(cols: Set<ColumnKey>) {
  localStorage.setItem(LS_KEY, JSON.stringify(Array.from(cols)));
}

// ─── Fit scoring ───────────────────────────────────────────────────────────────

function computeFit(track: SetTrack, prevTrack: SetTrack | null, prefs: DJPreferences): FitInfo {
  const reasons: string[] = [];
  let worst: FitLevel = 'good';

  function flag(level: FitLevel, reason: string) {
    reasons.push(reason);
    if (level === 'bad') worst = 'bad';
    else if (worst !== 'bad') worst = 'warn';
  }

  if (track.harmonicWarning) {
    flag('bad', 'Harmonic clash with previous track');
  }

  const eDelta = Math.abs(track.energy - track.targetEnergy);
  if (eDelta > 0.35) flag('bad', `Energy ${(eDelta * 100).toFixed(0)}% off target`);
  else if (eDelta > 0.20) flag('warn', `Energy ${(eDelta * 100).toFixed(0)}% off target`);

  if (prevTrack && track.bpm > 0 && prevTrack.bpm > 0) {
    const bDelta = Math.abs(track.bpm - prevTrack.bpm);
    if (bDelta > 20) flag('bad', `BPM jump of ${bDelta.toFixed(0)} from previous`);
    else if (bDelta > 12) flag('warn', `BPM jump of ${bDelta.toFixed(0)} from previous`);
  }

  if (prefs.genre !== 'Any' && !matchesGenrePref(track, prefs.genre)) {
    flag('warn', `Genre doesn't match filter (${prefs.genre.replace('~', '')})`);
  }

  const affinityKey = getAffinityKey(prefs.venueType, prefs.setPhase);
  if (affinityKey && genreAffinityBonus(track, affinityKey) === 0) {
    flag('warn', `Genre doesn't suit ${prefs.venueType} · ${prefs.setPhase}`);
  }

  return { level: worst, reasons };
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  tracks: SetTrack[];
  prefs: DJPreferences;
  libraryLoaded: boolean;
  onSwapTrack: (index: number) => void;
  onToggleLock: (index: number) => void;
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function SetTracklist({ tracks, prefs, libraryLoaded, onSwapTrack, onToggleLock, onRemoveTrack, onReorderTrack, onUpdateTrack, onExport, onExportSpotify }: Props) {
  const [exportOpen, setExportOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(loadVisibleColumns);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const columnsDropdownRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  function toggleColumn(key: ColumnKey) {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveVisibleColumns(next);
      return next;
    });
  }

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return;
    function handleClick(e: MouseEvent) {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [exportOpen]);

  // Close columns dropdown on outside click
  useEffect(() => {
    if (!columnsOpen) return;
    function handleClick(e: MouseEvent) {
      if (columnsDropdownRef.current && !columnsDropdownRef.current.contains(e.target as Node)) {
        setColumnsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [columnsOpen]);

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

  // Total column count for colSpan calculations
  const totalCols = 6 + visibleColumns.size; // 6 mandatory + optional

  function scrollToFirstWarning() {
    const el = tableContainerRef.current?.querySelector('[data-warning="true"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function scrollToFirstBadFit() {
    const el = tableContainerRef.current?.querySelector('[data-fit="bad"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <>
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

        <div className="flex items-center gap-2">
          {/* Column chooser */}
          <div className="relative" ref={columnsDropdownRef}>
            <button
              onClick={() => setColumnsOpen((o) => !o)}
              className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#12121a] border border-[#2a2a3a] text-sm text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer"
              title="Show/hide columns"
            >
              ⊞
              <span className="text-[10px]">▾</span>
            </button>
            {columnsOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-md border border-[#2a2a3a] bg-[#12121a] shadow-lg overflow-hidden py-1">
                {OPTIONAL_COLUMNS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => toggleColumn(key)}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0 text-[9px]"
                      style={{
                        borderColor: visibleColumns.has(key) ? '#7c3aed' : '#2a2a3a',
                        backgroundColor: visibleColumns.has(key) ? '#7c3aed' : 'transparent',
                        color: '#fff',
                      }}
                    >
                      {visibleColumns.has(key) ? '✓' : ''}
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Export */}
          <div className="relative" ref={exportDropdownRef}>
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
                  onClick={() => {
                    const text = tracks.map((t, i) =>
                      `${i + 1}. ${t.artist} — ${t.title}${t.bpm > 0 ? `  ${Math.round(t.bpm)} BPM` : ''}${t.camelot ? `  ${t.camelot}` : ''}`
                    ).join('\n');
                    void navigator.clipboard.writeText(text);
                    setExportOpen(false);
                  }}
                  className="w-full text-left flex items-center gap-2 px-4 py-2.5 text-sm text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                >
                  Copy as text
                </button>
                <button
                  onClick={() => { downloadM3U(tracks); onExport?.(); setExportOpen(false); }}
                  className="w-full text-left flex items-center gap-2 px-4 py-2.5 text-sm text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                >
                  Export as M3U
                </button>
                <button
                  onClick={() => { downloadRekordboxXml(tracks); onExport?.(); setExportOpen(false); }}
                  className="w-full text-left flex items-center gap-2 px-4 py-2.5 text-sm text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                >
                  Export to Rekordbox
                </button>
                <button
                  onClick={() => { setCardOpen(true); setExportOpen(false); }}
                  className="w-full text-left flex items-center gap-2 px-4 py-2.5 text-sm text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#1e1e2e]"
                >
                  Export as Image
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
      </div>

      {/* Table */}
      <div className="rounded-lg border border-[#1e1e2e] overflow-hidden" ref={tableContainerRef}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#0d0d14] border-b border-[#1e1e2e]">
                <th className="py-2 pl-4 pr-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider w-10">#</th>
                <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">Track</th>
                {visibleColumns.has('time') && (
                  <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider whitespace-nowrap">Time</th>
                )}
                <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">BPM</th>
                <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">Key</th>
                <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">Energy</th>
                {visibleColumns.has('genre') && (
                  <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">Genre</th>
                )}
                {visibleColumns.has('year') && (
                  <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">Year</th>
                )}
                {visibleColumns.has('comment') && (
                  <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">Comments</th>
                )}
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
                          colSpan={totalCols}
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
                      visibleColumns={visibleColumns}
                      totalCols={totalCols}
                      onSwap={() => onSwapTrack(idx)}
                      onToggleLock={() => onToggleLock(idx)}
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

    {cardOpen && (
      <SetCardExport tracks={tracks} onClose={() => setCardOpen(false)} />
    )}
    </>
  );
}
