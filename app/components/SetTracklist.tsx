import { useState, useRef, useEffect } from 'react';
import type { SetTrack, DJPreferences } from '../types';
import TrackRow from './TrackRow';
import { downloadM3U } from '../lib/m3uExport';
import { downloadRekordboxXml } from '../lib/rekordboxExport';
import { SpotifyIcon, RekordboxIcon, M3UIcon, CopyIcon } from './Icons';

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

// ─── Transition hints ─────────────────────────────────────────────────────────

interface TransitionHint {
  icon: string;
  tip: string;
  color?: string;
}

export interface TransitionInfo {
  bpmDelta: number;
  bpmDir: string;
  bpmDeltaColor: string;
  hints: TransitionHint[];
}

function computeTransitionHints(prev: SetTrack, next: SetTrack): TransitionHint[] {
  const hints: TransitionHint[] = [];
  const eDelta = next.energy - prev.energy;

  if (eDelta > 0.2) {
    hints.push({ icon: '↑', color: '#22c55e', tip: 'Energy build — gradually open up the highs and layer in percussion before dropping the next track' });
  } else if (eDelta < -0.2) {
    hints.push({ icon: '↓', color: '#60a5fa', tip: 'Energy drop — sweep the highs with a filter and ease off the bass to soften the transition' });
  } else {
    hints.push({ icon: '→', color: '#475569', tip: 'Smooth blend — beatmatch and crossfade gradually for a seamless transition' });
  }

  const prevVocal = prev.semanticTags?.vocalType;
  const nextVocal = next.semanticTags?.vocalType;
  if (prevVocal && prevVocal !== 'instrumental') {
    hints.push({ icon: '🎤', tip: 'Outgoing vocal — start mixing out before vocals end for a clean exit' });
  } else if (nextVocal && nextVocal !== 'instrumental') {
    hints.push({ icon: '🎤', tip: 'Incoming vocal — let the intro play; avoid clashing with the first vocal phrase' });
  }

  return hints;
}

// ─── Fit scoring ───────────────────────────────────────────────────────────────

function computeFit(track: SetTrack, warnThreshold: number): FitInfo {
  const reasons: string[] = [];
  let worst: FitLevel = 'good';

  function flag(level: FitLevel, reason: string) {
    reasons.push(reason);
    if (level === 'bad') worst = 'bad';
    else if (worst !== 'bad') worst = 'warn';
  }

  const eDelta = Math.abs(track.energy - track.targetEnergy);
  if (eDelta > 0.35) flag('bad', `Energy ${(eDelta * 100).toFixed(0)}% off target`);
  else if (eDelta > warnThreshold) flag('warn', `Energy ${(eDelta * 100).toFixed(0)}% off target`);

  return { level: worst, reasons };
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  tracks: SetTrack[];
  prefs: DJPreferences;
  libraryLoaded: boolean;
  energyCheckThreshold?: number;
  showRekordboxExport?: boolean;
  showHoverTips?: boolean;
  previewFile?: string | null;
  previewPlaying?: boolean;
  onPreview?: (filePath: string) => void;
  onSwapTrack: (index: number) => void;
  onToggleLock: (index: number) => void;
  onRemoveTrack: (index: number) => void;
  onReorderTrack: (fromIdx: number, toIdx: number) => void;
  onUpdateTrack: (index: number, tags: { title?: string; artist?: string; genre?: string; bpm?: number; camelot?: string; key?: string; energy?: number }) => void;
  onExport?: () => void;
  onExportSpotify?: () => void;
}

function totalDurationMinutes(tracks: SetTrack[]): number {
  const totalSecs = tracks.reduce((s, t) => s + (t.duration ?? 0), 0);
  return Math.round(totalSecs / 60);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SetTracklist({ tracks, prefs, libraryLoaded, energyCheckThreshold = 0.12, showRekordboxExport, showHoverTips = true, previewFile, previewPlaying, onPreview, onSwapTrack, onToggleLock, onRemoveTrack, onReorderTrack, onUpdateTrack, onExport, onExportSpotify }: Props) {
  const [exportOpen, setExportOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
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
  const badFitCount = tracks.filter((t) =>
    computeFit(t, energyCheckThreshold).level === 'bad'
  ).length;
  const warnFitCount = tracks.filter((t) =>
    computeFit(t, energyCheckThreshold).level === 'warn'
  ).length;

  // Total column count for colSpan calculations
  const totalCols = 7 + visibleColumns.size; // 7 mandatory (#, Track, BPM, Key, Energy, Transition, Actions) + optional

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
        </div>

        <div className="flex items-center gap-2">
          {/* Column chooser */}
          <div className="relative" ref={columnsDropdownRef}>
            <button
              onClick={() => setColumnsOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#12121a] border border-[#2a2a3a] text-xs text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer"
              title="Show/hide columns"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
              </svg>
              Columns
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
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 z-10 min-w-[175px] rounded-md border border-[#2a2a3a] bg-[#12121a] shadow-lg overflow-hidden">
                <button
                  onClick={() => {
                    const text = tracks.map((t, i) =>
                      `${i + 1}. ${t.artist} — ${t.title}${t.bpm > 0 ? `  ${Math.round(t.bpm)} BPM` : ''}${t.camelot ? `  ${t.camelot}` : ''}`
                    ).join('\n');
                    void navigator.clipboard.writeText(text);
                    setExportOpen(false);
                  }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2.5 text-sm text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                >
                  <CopyIcon size={14} className="shrink-0 opacity-60" />
                  Copy as text
                </button>
                <button
                  onClick={() => { downloadM3U(tracks); onExport?.(); setExportOpen(false); }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2.5 text-sm text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                >
                  <M3UIcon size={14} className="shrink-0 opacity-60" />
                  Export as M3U
                </button>
                {showRekordboxExport && (
                <button
                  onClick={() => { downloadRekordboxXml(tracks); onExport?.(); setExportOpen(false); }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2.5 text-sm text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                >
                  <RekordboxIcon size={14} className="shrink-0 opacity-60" />
                  Export to Rekordbox
                </button>
                )}
                {onExportSpotify && (
                  <button
                    onClick={() => { onExportSpotify(); setExportOpen(false); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2.5 text-sm text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#1e1e2e]"
                  >
                    <SpotifyIcon size={14} className="shrink-0 text-[#1db954]" />
                    Export to Spotify
                  </button>
                )}
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
                  <th className="py-2 px-2 text-right text-[10px] font-semibold text-[#475569] uppercase tracking-wider whitespace-nowrap">Time</th>
                )}
                <th className="py-2 px-2 text-right text-[10px] font-semibold text-[#475569] uppercase tracking-wider">BPM</th>
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
                <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider whitespace-nowrap">Next</th>
                <th className="py-2 pl-2 pr-4 text-right text-[10px] font-semibold text-[#475569] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((track, idx) => {
                const nextTrack = idx < tracks.length - 1 ? tracks[idx + 1] : null;

                // Transition row renders AFTER the current track (attached to the source)
                const bpmDelta = nextTrack && track.bpm > 0 && nextTrack.bpm > 0
                  ? Math.abs(nextTrack.bpm - track.bpm)
                  : 0;
                const bpmDir = nextTrack && track.bpm > 0 && nextTrack.bpm > 0
                  ? (track.bpm >= nextTrack.bpm ? '▲' : '▼')
                  : '';
                const bpmDeltaColor = bpmDelta <= 8 ? '#475569' : bpmDelta <= 15 ? '#f59e0b' : '#ef4444';

                const transitionHints = nextTrack ? computeTransitionHints(track, nextTrack) : [];

                const transition: TransitionInfo | undefined = nextTrack
                  ? { bpmDelta, bpmDir, bpmDeltaColor, hints: transitionHints }
                  : undefined;

                return (
                  <TrackRow
                    key={track.file}
                    track={track}
                    index={idx}
                    fitInfo={computeFit(track, energyCheckThreshold)}
                    transition={transition}
                    visibleColumns={visibleColumns}
                    totalCols={totalCols}
                    totalTracks={tracks.length}
                    showHoverTips={showHoverTips}
                    isPreviewPlaying={previewFile === track.filePath && (previewPlaying ?? false)}
                    onPreview={onPreview}
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
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    </>
  );
}
