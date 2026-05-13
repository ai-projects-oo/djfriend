import { useState, useRef, useEffect } from 'react';
import type { SetTrack, DJPreferences } from '../types';
import TrackRow from './TrackRow';
import { downloadM3U } from '../lib/m3uExport';
import { downloadRekordboxXml } from '../lib/rekordboxExport';
import { SpotifyIcon, RekordboxIcon, M3UIcon, CopyIcon } from './Icons';
import { parseCamelot } from '../lib/camelot';

const CAMELOT_TO_KEY: Record<string, string> = {
  '1a': 'Ab minor', '1b': 'B major', '2a': 'Eb minor', '2b': 'F# major',
  '3a': 'Bb minor', '3b': 'Db major', '4a': 'F minor', '4b': 'Ab major',
  '5a': 'C minor', '5b': 'Eb major', '6a': 'G minor', '6b': 'Bb major',
  '7a': 'D minor', '7b': 'F major', '8a': 'A minor', '8b': 'C major',
  '9a': 'E minor', '9b': 'G major', '10a': 'B minor', '10b': 'D major',
  '11a': 'F# minor', '11b': 'A major', '12a': 'C# minor', '12b': 'E major',
};

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
  tipConfig?: import('../types').TipConfig;
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
  onBulkReanalyze?: (indices: number[], bpmHint?: { min: number; max: number }) => Promise<void>;
  onBulkPatchBpm?: (indices: number[], multiplier: 2 | 0.5) => Promise<void>;
}

async function apiFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  return res.json();
}

function totalDurationMinutes(tracks: SetTrack[]): number {
  const totalSecs = tracks.reduce((s, t) => s + (t.duration ?? 0), 0);
  return Math.round(totalSecs / 60);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SetTracklist({ tracks, prefs, libraryLoaded, energyCheckThreshold = 0.12, showRekordboxExport, tipConfig, previewFile, previewPlaying, onPreview, onSwapTrack, onToggleLock, onRemoveTrack, onReorderTrack, onUpdateTrack, onExport, onExportSpotify }: Props) {
  const [exportOpen, setExportOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(loadVisibleColumns);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  // Global edit mode
  const [globalEditMode, setGlobalEditMode] = useState(false);
  const [editArtist, setEditArtist] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editGenre, setEditGenre] = useState('');
  const [editBpm, setEditBpm] = useState('');
  const [editCamelot, setEditCamelot] = useState('');
  const [editYear, setEditYear] = useState('');
  const [editComment, setEditComment] = useState('');
  const [saving, setSaving] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const columnsDropdownRef = useRef<HTMLDivElement>(null);
  const actionsDropdownRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  function openGlobalEdit() {
    setSelectedIndices(new Set(tracks.map((_, i) => i)));
    setEditArtist(''); setEditTitle(''); setEditGenre('');
    setEditBpm(''); setEditCamelot(''); setEditYear(''); setEditComment('');
    setGlobalEditMode(true);
    setActionsOpen(false);
  }

  function closeGlobalEdit() {
    setGlobalEditMode(false);
    setSelectedIndices(new Set());
  }

  async function saveGlobalEdit() {
    if (selectedIndices.size === 0) { closeGlobalEdit(); return; }
    setSaving(true);
    const bpmVal = parseFloat(editBpm);
    const yearVal = parseInt(editYear, 10);
    const normalizedCamelot = editCamelot.trim().toUpperCase();
    const parsedCamelot = normalizedCamelot ? parseCamelot(normalizedCamelot) : null;

    for (const idx of selectedIndices) {
      const track = tracks[idx];
      if (!track) continue;
      const patch: Record<string, unknown> = {};
      if (editTitle.trim()) patch.title = editTitle.trim();
      if (editArtist.trim()) patch.artist = editArtist.trim();
      if (editGenre.trim()) patch.genres = editGenre.split(',').map(g => g.trim()).filter(Boolean);
      if (!isNaN(bpmVal) && bpmVal > 0) patch.bpm = bpmVal;
      if (normalizedCamelot && parsedCamelot) { patch.camelot = normalizedCamelot; patch.key = CAMELOT_TO_KEY[normalizedCamelot.toLowerCase()] ?? ''; }
      if (!isNaN(yearVal) && yearVal > 0) patch.year = yearVal;
      if (editComment.trim()) patch.comment = editComment.trim();
      if (Object.keys(patch).length === 0) continue;
      try {
        await apiFetch('/api/track-meta', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: track.file, patch }) });
        onUpdateTrack(idx, {
          ...(patch.title ? { title: patch.title as string } : {}),
          ...(patch.artist ? { artist: patch.artist as string } : {}),
          ...(patch.genres ? { genre: (patch.genres as string[]).join(', ') } : {}),
          ...(patch.bpm ? { bpm: patch.bpm as number } : {}),
          ...(patch.camelot ? { camelot: patch.camelot as string, key: patch.key as string } : {}),
        });
      } catch { /* ignore individual failures */ }
    }
    setSaving(false);
    closeGlobalEdit();
  }

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

  // Close actions dropdown on outside click
  useEffect(() => {
    if (!actionsOpen) return;
    function handleClick(e: MouseEvent) {
      if (actionsDropdownRef.current && !actionsDropdownRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [actionsOpen]);

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
  const totalCols = 7 + visibleColumns.size + (globalEditMode ? 1 : 0);

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

          {/* Three-dots actions menu */}
          <div className="relative" ref={actionsDropdownRef}>
            <button
              onClick={() => setActionsOpen((o) => !o)}
              className={`flex items-center justify-center w-8 h-8 rounded-md border transition-colors cursor-pointer ${actionsOpen || globalEditMode ? 'border-[#7c3aed] bg-[#7c3aed22] text-[#a78bfa]' : 'bg-[#12121a] border-[#2a2a3a] text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0]'}`}
              title="More actions"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
            </button>
            {actionsOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 min-w-[160px] rounded-md border border-[#2a2a3a] bg-[#12121a] shadow-lg overflow-hidden py-1">
                <button
                  onClick={openGlobalEdit}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit
                </button>
              </div>
            )}
          </div>

          {/* Export */}
          <div className="relative" ref={exportDropdownRef}>
            <button
              onClick={() => setExportOpen((o) => !o)}
              disabled={tracks.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#12121a] border border-[#2a2a3a] text-sm text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#2a2a3a] disabled:hover:text-[#94a3b8]"
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

      {/* Global edit form */}
      {globalEditMode && (
        <div className="rounded-xl bg-[#0d0d14] border border-[#7c3aed]/40 px-4 py-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#a78bfa]">Edit selected tracks</span>
              <span className="text-[10px] text-[#475569]">— leave fields empty to keep current values</span>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" className="w-3.5 h-3.5 accent-[#7c3aed] cursor-pointer"
                checked={selectedIndices.size === tracks.length && tracks.length > 0}
                onChange={e => setSelectedIndices(e.target.checked ? new Set(tracks.map((_, i) => i)) : new Set())}
                title="Select all" />
              <span className="text-[10px] text-[#64748b]">{selectedIndices.size}/{tracks.length}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 min-w-[140px]">
              <label className="text-[10px] text-[#475569] uppercase tracking-wider">Artist</label>
              <input value={editArtist} onChange={e => setEditArtist(e.target.value)} placeholder="Keep current"
                className="bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] w-full placeholder:text-[#2a2a3a]" />
            </div>
            <div className="flex flex-col gap-1 min-w-[140px]">
              <label className="text-[10px] text-[#475569] uppercase tracking-wider">Title</label>
              <input value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Keep current"
                className="bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] w-full placeholder:text-[#2a2a3a]" />
            </div>
            <div className="flex flex-col gap-1 min-w-[160px]">
              <label className="text-[10px] text-[#475569] uppercase tracking-wider">Genre <span className="normal-case text-[#2a2a3a]">(comma-sep)</span></label>
              <input value={editGenre} onChange={e => setEditGenre(e.target.value)} placeholder="e.g. house, deep house"
                className="bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] w-full placeholder:text-[#2a2a3a]" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-[#475569] uppercase tracking-wider">BPM</label>
              <div className="flex items-center gap-1">
                <input type="number" value={editBpm} onChange={e => setEditBpm(e.target.value)} placeholder="Keep"
                  className="bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] w-16 placeholder:text-[#2a2a3a]" />
                <button type="button" onClick={() => { const v = parseFloat(editBpm); if (!isNaN(v) && v > 0) setEditBpm(String(Math.round(v * 2))); }}
                  className="px-1.5 py-1 text-[10px] rounded border border-[#2a2a3a] text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#7c3aed] transition-colors cursor-pointer tabular-nums">×2</button>
                <button type="button" onClick={() => { const v = parseFloat(editBpm); if (!isNaN(v) && v > 0) setEditBpm(String(Math.round(v / 2))); }}
                  className="px-1.5 py-1 text-[10px] rounded border border-[#2a2a3a] text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#7c3aed] transition-colors cursor-pointer tabular-nums">÷2</button>
              </div>
            </div>
            <div className="flex flex-col gap-1 w-16">
              <label className="text-[10px] text-[#475569] uppercase tracking-wider">Key</label>
              <input value={editCamelot} onChange={e => setEditCamelot(e.target.value)} placeholder="e.g. 7A"
                className="bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-1 text-xs font-mono text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] w-full placeholder:text-[#2a2a3a]" />
            </div>
            <div className="flex flex-col gap-1 w-16">
              <label className="text-[10px] text-[#475569] uppercase tracking-wider">Year</label>
              <input type="number" value={editYear} onChange={e => setEditYear(e.target.value)} placeholder="Keep"
                className="bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] w-full placeholder:text-[#2a2a3a]" />
            </div>
            <div className="flex flex-col gap-1 min-w-[160px]">
              <label className="text-[10px] text-[#475569] uppercase tracking-wider">Comment</label>
              <input value={editComment} onChange={e => setEditComment(e.target.value)} placeholder="Keep current"
                className="bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] w-full placeholder:text-[#2a2a3a]" />
            </div>
            <div className="flex items-end gap-2 pb-0.5">
              <button onClick={() => void saveGlobalEdit()} disabled={saving || selectedIndices.size === 0}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-[#7c3aed] text-white text-xs font-medium hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
                {saving ? 'Saving…' : `Save ${selectedIndices.size > 0 ? `(${selectedIndices.size})` : ''}`}
              </button>
              <button onClick={closeGlobalEdit} disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-[#2a2a3a] text-[#94a3b8] text-xs hover:text-[#e2e8f0] hover:border-[#475569] disabled:opacity-50 transition-colors cursor-pointer">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-[#1e1e2e] overflow-hidden" ref={tableContainerRef}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#0d0d14] border-b border-[#1e1e2e]">
                {globalEditMode && (
                  <th className="py-2 pl-3 pr-1 w-6">
                    <input type="checkbox" className="w-3.5 h-3.5 accent-[#7c3aed] cursor-pointer"
                      checked={selectedIndices.size === tracks.length && tracks.length > 0}
                      onChange={e => setSelectedIndices(e.target.checked ? new Set(tracks.map((_, i) => i)) : new Set())} />
                  </th>
                )}
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
                    isSelected={selectedIndices.has(idx)}
                    onSelect={globalEditMode ? () => setSelectedIndices(prev => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; }) : undefined}
                    fitInfo={computeFit(track, energyCheckThreshold)}
                    transition={transition}
                    visibleColumns={visibleColumns}
                    totalCols={totalCols}
                    totalTracks={tracks.length}
                    tipConfig={tipConfig}
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
