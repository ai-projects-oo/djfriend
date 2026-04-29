import { useState, useEffect, useRef } from 'react';
import { RefreshCcw, Trash2, Pencil, Check, X, MoreVertical, RotateCcw, FolderOpen, Play, Pause, ExternalLink } from 'lucide-react';
import type { SetTrack } from '../types';
import { parseCamelot } from '../lib/camelot';
import { camelotColor } from '../lib/camelotColors';
import type { FitInfo, ColumnKey, TransitionInfo } from './SetTracklist';

interface Props {
  track: SetTrack;
  index: number;
  fitInfo?: FitInfo;
  transition?: TransitionInfo;
  visibleColumns: Set<ColumnKey>;
  totalCols: number;
  totalTracks?: number;
  onSwap: () => void;
  onToggleLock: () => void;
  onRemove: () => void;
  onUpdateTrack: (tags: { title?: string; artist?: string; genre?: string; bpm?: number; camelot?: string; key?: string; energy?: number }) => void;
  showHoverTips?: boolean;
  isPreviewPlaying?: boolean;
  onPreview?: (filePath: string) => void;
  // drag-to-reorder
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  isDragOver?: boolean;
}

const KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B']
const CAMELOT_MAJOR = ['8B','3B','10B','5B','12B','7B','2B','9B','4B','11B','6B','1B']
const CAMELOT_MINOR = ['5A','12A','7A','2A','9A','4A','11A','6A','1A','8A','3A','10A']
const CAMELOT_TO_KEY: Record<string, string> = {}
for (let i = 0; i < 12; i++) {
  CAMELOT_TO_KEY[CAMELOT_MAJOR[i].toLowerCase()] = `${KEY_NAMES[i]} Major`
  CAMELOT_TO_KEY[CAMELOT_MINOR[i].toLowerCase()] = `${KEY_NAMES[i]} Minor`
}

import { energyColor, theme } from '../lib/theme';

function energyBarColor(energy: number): string {
  return energyColor(energy);
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function camelotStep(num: number, delta: number): number {
  return ((num - 1 + delta + 120) % 12) + 1;
}

function getCompatibleKeys(camelot: string): {
  standard: string[];   // ±1 same letter + relative major/minor
  boost: string[];      // MixedInKey diagonal: ±1 with letter switch
  relax: string[];      // Major→Minor diagonal
  surge: string[];      // MixedInKey +2 clockwise: energy surge
  powerShift: string[]; // MixedInKey −5 (≡ +7 clockwise): dramatic lift
} {
  const parsed = parseCamelot(camelot);
  if (!parsed) return { standard: [], boost: [], relax: [], surge: [], powerShift: [] };
  const { num, letter } = parsed;
  const other = letter === 'A' ? 'B' : 'A';
  const prev = camelotStep(num, -1);
  const next = camelotStep(num,  1);
  const plus2 = camelotStep(num,  2);
  const minus5 = camelotStep(num, 7); // −5 CCW = +7 CW on 12-position wheel
  const diagonals = [`${next}${other}`, `${prev}${other}`];
  return {
    standard:   [`${prev}${letter}`, `${next}${letter}`, `${num}${other}`],
    boost:      letter === 'A' ? diagonals : [],
    relax:      letter === 'B' ? diagonals : [],
    surge:      [`${plus2}${letter}`],   // same mode, +2 positions — intentional energy jump
    powerShift: [`${minus5}${letter}`],  // same mode, −5 positions — dramatic but musical
  };
}

const TAG_COLORS = theme.tag;

function TagPill({ label, type }: { label: string; type: keyof typeof TAG_COLORS }) {
  const c = TAG_COLORS[type];
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {label}
    </span>
  );
}

export default function TrackRow({ track, index, fitInfo, transition, visibleColumns, totalCols, totalTracks = 20, showHoverTips = true, isPreviewPlaying = false, onPreview, onSwap, onToggleLock, onRemove, onUpdateTrack, onDragStart, onDragEnd, onDragOver, onDrop, isDragOver }: Props) {
  // Open popups downward for top-half rows, upward for bottom-half rows
  const openDown = index < totalTracks / 2;
  const [showKeyTooltip, setShowKeyTooltip] = useState(false);
  const [showFitTooltip, setShowFitTooltip] = useState(false);
  const [showEnergyTooltip, setShowEnergyTooltip] = useState(false);
  const [hoverHintIdx, setHoverHintIdx] = useState<number | null>(null);
  const [showTags, setShowTags] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [swapFlash, setSwapFlash] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const prevFileRef = useRef(track.file);
  useEffect(() => {
    if (prevFileRef.current !== track.file) {
      prevFileRef.current = track.file;
      setSwapFlash(true);
      const timer = setTimeout(() => setSwapFlash(false), 600);
      return () => clearTimeout(timer);
    }
  }, [track.file]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');
  const [editGenre, setEditGenre] = useState('');
  const [editBpm, setEditBpm] = useState('');
  const [editCamelot, setEditCamelot] = useState('');

  const barColor = energyBarColor(track.energy);
  const isLocal = Boolean(track.filePath);
  const isMp3 = track.filePath?.toLowerCase().endsWith('.mp3') ?? false;


  const { standard: compatibleKeys, boost: boostKeys, relax: relaxKeys, surge: surgeKeys, powerShift: powerShiftKeys } = getCompatibleKeys(track.camelot);

  function openEdit() {
    setEditTitle(track.title);
    setEditArtist(track.artist);
    setEditGenre(track.genres.join(', '));
    setEditBpm(track.bpm > 0 ? String(Math.round(track.bpm)) : '');
    setEditCamelot(track.camelot ?? '');
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setSaveError(null);
  }

  function handleRemove() {
    setRemoving(true);
    setTimeout(onRemove, 150);
  }

async function handleReanalyze() {
    if (!track.filePath || reanalyzing) return;
    setMenuOpen(false);
    setReanalyzing(true);
    try {
      const res = await fetch('/api/reanalyze-track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: track.filePath }),
      });
      const data = await res.json() as { ok?: boolean; bpm?: number; key?: string; camelot?: string; energy?: number; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Reanalysis failed');
      onUpdateTrack({ bpm: data.bpm, key: data.key, camelot: data.camelot, energy: data.energy });
    } catch { /* silently ignore — no UI for error here */ }
    finally { setReanalyzing(false); }
  }

  async function saveEdit() {
    setSaving(true);
    setSaveError(null);
    try {
      const tags: { title?: string; artist?: string; genre?: string; bpm?: number; camelot?: string; key?: string } = {};
      if (editTitle.trim() !== track.title) tags.title = editTitle.trim();
      if (editArtist.trim() !== track.artist) tags.artist = editArtist.trim();
      const currentGenre = track.genres.join(', ');
      if (editGenre.trim() !== currentGenre) tags.genre = editGenre.trim();
      const newBpm = parseFloat(editBpm);
      if (!isNaN(newBpm) && newBpm !== track.bpm) tags.bpm = newBpm;
      const normalizedCamelot = editCamelot.trim().toUpperCase();
      if (normalizedCamelot !== (track.camelot ?? '').toUpperCase()) {
        const parsed = parseCamelot(normalizedCamelot);
        if (parsed || normalizedCamelot === '') {
          tags.camelot = parsed ? normalizedCamelot : '';
          tags.key = parsed ? (CAMELOT_TO_KEY[normalizedCamelot.toLowerCase()] ?? '') : '';
        }
      }

      if (Object.keys(tags).length > 0) {
        // Only persist to file for local MP3s — for web imports just update in-memory state
        if (isLocal && isMp3) {
          const fileTags = { title: tags.title, artist: tags.artist, genre: tags.genre, bpm: tags.bpm }
          const res = await fetch('/api/update-tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: track.filePath, tags: fileTags }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(err.error ?? 'Save failed');
          }
        }
        onUpdateTrack(tags);
      }
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const rowStyle: React.CSSProperties = {
    opacity: removing ? 0 : 1,
    transition: 'opacity 150ms, background-color 600ms',
  };

  return (
    <>
      <tr
        className={`border-b border-[#1e1e2e] group ${swapFlash ? 'bg-green-900/20' : track.locked ? 'bg-[#f59e0b08]' : 'hover:bg-[#12121a]'} ${isDragOver ? 'border-t-2 border-t-[#7c3aed]' : ''}`}
        style={rowStyle}
        data-fit={fitInfo && fitInfo.level !== 'good' ? fitInfo.level : undefined}
        draggable={!editing}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {/* # */}
        <td className="py-3 pl-4 pr-2 w-10">
          <div className="relative w-5 h-4 flex items-center justify-center">
            <span
              className="group-hover:hidden text-[#475569] text-sm tabular-nums cursor-grab active:cursor-grabbing select-none"
              title="Drag to reorder"
            >
              {index + 1}
            </span>
            <div className="hidden group-hover:flex items-center gap-1">
              {track.filePath && onPreview ? (
                <button
                  onClick={() => onPreview(track.filePath!)}
                  className={`flex items-center justify-center cursor-pointer transition-colors ${isPreviewPlaying ? 'text-white' : 'text-[#7c3aed] hover:text-white'}`}
                  title={isPreviewPlaying ? 'Pause preview' : 'Preview'}
                >
                  {isPreviewPlaying
                    ? <Pause size={13} fill="currentColor" />
                    : <Play size={13} fill="currentColor" />}
                </button>
              ) : (
                <button
                  onClick={() => void fetch('/api/play-in-music', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: track.filePath, artist: track.artist, title: track.title }) })}
                  className="flex items-center justify-center text-[#7c3aed] hover:text-white cursor-pointer transition-colors"
                  title="Play in Apple Music"
                >
                  <Play size={13} fill="currentColor" />
                </button>
              )}
              {track.filePath && (
                <button
                  onClick={() => void fetch('/api/reveal-in-finder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: track.filePath }) })}
                  className="flex items-center justify-center text-[#475569] hover:text-[#94a3b8] cursor-pointer transition-colors"
                  title="Reveal in Finder"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </button>
              )}
            </div>
          </div>
        </td>

        {/* Title / Artist */}
        <td className="py-3 px-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {fitInfo && fitInfo.level !== 'good' && (
              <div className="relative flex-shrink-0">
                <span
                  className="cursor-default text-[10px] leading-none select-none block"
                  style={{ color: fitInfo.level === 'bad' ? '#ef4444' : '#f59e0b' }}
                  onMouseEnter={() => setShowFitTooltip(true)}
                  onMouseLeave={() => setShowFitTooltip(false)}
                >
                  ●
                </span>
                {showHoverTips && showFitTooltip && (
                  <div className={`absolute ${openDown ? 'top-full mt-1' : 'bottom-full mb-1'} left-0 z-50 w-56 rounded-md bg-[#1e1e2e] border border-[#2a2a3a] px-3 py-2 shadow-lg pointer-events-none`}
                    style={{ borderColor: fitInfo.level === 'bad' ? '#ef444466' : '#f59e0b66' }}
                  >
                    <p className="text-[10px] font-semibold mb-1.5"
                      style={{ color: fitInfo.level === 'bad' ? '#f87171' : '#fbbf24' }}
                    >
                      {fitInfo.level === 'bad' ? 'Needs replacing' : 'Fit issues'}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {fitInfo.reasons.map((r, i) => (
                        <li key={i} className="text-[11px] text-[#94a3b8] flex items-start gap-1.5">
                          <span className="flex-shrink-0 mt-0.5"
                            style={{ color: fitInfo.level === 'bad' ? '#ef4444' : '#f59e0b' }}
                          >·</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium text-[#e2e8f0] truncate">{track.title}</div>
              <div className="text-xs text-[#64748b] truncate">{track.artist}</div>
            </div>
          </div>
        </td>

        {/* Duration — optional */}
        {visibleColumns.has('time') && (
          <td className="py-3 px-2 text-[#94a3b8] text-xs tabular-nums whitespace-nowrap text-right">
            {track.duration != null ? formatDuration(track.duration) : '—'}
          </td>
        )}

        {/* BPM */}
        <td className="py-3 px-2 text-[#94a3b8] text-xs tabular-nums whitespace-nowrap text-right">
          {track.bpm > 0 ? track.bpm.toFixed(0) : '—'}
        </td>

        {/* Camelot key */}
        <td className="py-3 px-2 whitespace-nowrap">
          <div className="relative inline-block">
            {track.camelot ? (
              <span
                className="inline-block px-2 py-0.5 rounded text-xs font-mono font-semibold cursor-default"
                style={{ backgroundColor: camelotColor(track.camelot) + '26', color: camelotColor(track.camelot), border: `1px solid ${camelotColor(track.camelot)}66` }}
                onMouseEnter={() => setShowKeyTooltip(true)}
                onMouseLeave={() => setShowKeyTooltip(false)}
              >
                {track.camelot}
              </span>
            ) : (
              <button
                onClick={openEdit}
                className="inline-block px-2 py-0.5 rounded text-xs font-mono font-semibold border border-dashed border-[#2a2a3a] text-[#334155] hover:border-[#7c3aed] hover:text-[#7c3aed] transition-colors cursor-pointer"
                title="Key unknown — click to edit"
              >
                ?
              </button>
            )}
            {showHoverTips && showKeyTooltip && track.camelot && (
              <div className={`absolute left-full ${openDown ? 'top-0' : 'bottom-0'} ml-2 z-50 rounded-md bg-[#1e1e2e] border border-[#2a2a3a] px-3 py-2.5 text-xs text-[#e2e8f0] shadow-lg pointer-events-none whitespace-nowrap flex flex-col gap-1.5 min-w-[160px]`}>
                <div className="text-[9px] uppercase tracking-widest text-[#334155] mb-0.5">Next key options</div>
                {compatibleKeys.length > 0 && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#64748b]">Compatible</span>
                    <span className="font-mono text-[#94a3b8]">{compatibleKeys.join('  ')}</span>
                  </div>
                )}
                {boostKeys.length > 0 && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#f59e0b]">Energy boost ↑</span>
                    <span className="font-mono text-[#fbbf24]">{boostKeys.join('  ')}</span>
                  </div>
                )}
                {relaxKeys.length > 0 && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#60a5fa]">Relax ↓</span>
                    <span className="font-mono text-[#93c5fd]">{relaxKeys.join('  ')}</span>
                  </div>
                )}
                {surgeKeys.length > 0 && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#a78bfa]">Energy surge +2</span>
                    <span className="font-mono text-[#c4b5fd]">{surgeKeys.join('  ')}</span>
                  </div>
                )}
                {powerShiftKeys.length > 0 && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#f472b6]">Power shift −5</span>
                    <span className="font-mono text-[#f9a8d4]">{powerShiftKeys.join('  ')}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </td>

        {/* Energy bar */}
        <td className="py-3 px-2 pr-4">
          <div
            className="relative"
            onMouseEnter={() => setShowEnergyTooltip(true)}
            onMouseLeave={() => setShowEnergyTooltip(false)}
          >
            <div
              className="relative rounded-full bg-[#1e1e2e]"
              style={{ width: 56, height: 4 }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(track.energy * 100, 100).toFixed(1)}%`,
                  backgroundColor: barColor,
                }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                style={{
                  left: `${Math.min(Math.max(track.targetEnergy * 100, 0), 100).toFixed(1)}%`,
                  width: 1,
                  height: 6,
                  backgroundColor: 'rgba(255,255,255,0.4)',
                  transform: 'translate(-50%, -50%)',
                }}
              />
            </div>
            {showHoverTips && showEnergyTooltip && (
              <div className={`absolute ${openDown ? 'top-full mt-1' : 'bottom-full mb-2'} left-1/2 -translate-x-1/2 z-50 rounded bg-[#1e1e2e] border border-[#2a2a3a] px-2 py-1 text-[11px] text-[#e2e8f0] shadow-lg pointer-events-none whitespace-nowrap flex flex-col gap-0.5`}>
                <span>Energy <span style={{ color: barColor }}>{Math.round(track.energy * 100)}</span></span>
                <span className="text-[#475569]">Target {Math.round(track.targetEnergy * 100)}</span>
              </div>
            )}
          </div>
        </td>

        {/* Genre — optional */}
        {visibleColumns.has('genre') && (
          <td className="py-3 px-2">
            {track.genres && track.genres.length > 0 ? (
              <span
                className={`text-[10px] truncate max-w-[140px] block ${track.genresFromSpotify ? 'text-[#3d3d5c] italic' : 'text-[#475569]'}`}
                title={track.genres.join(', ') + (track.genresFromSpotify ? ' (from Spotify, may be inaccurate)' : '')}
              >
                {track.genres.slice(0, 2).join(' · ')}
                {track.genresFromSpotify && <span className="ml-0.5 opacity-50">~</span>}
              </span>
            ) : (
              <span className="text-[10px] text-[#2a2a3a]">—</span>
            )}
          </td>
        )}

        {/* Year — optional */}
        {visibleColumns.has('year') && (
          <td className="py-3 px-2 text-[#475569] text-xs tabular-nums">
            {track.year ?? <span className="text-[#2a2a3a]">—</span>}
          </td>
        )}

        {/* Comments — optional */}
        {visibleColumns.has('comment') && (
          <td className="py-3 px-2 max-w-[180px]">
            {track.comment ? (
              <span className="text-[10px] text-[#475569] truncate block" title={track.comment}>
                {track.comment}
              </span>
            ) : (
              <span className="text-[10px] text-[#2a2a3a]">—</span>
            )}
          </td>
        )}

        {/* Transition → next track */}
        <td className="py-3 px-2 whitespace-nowrap">
          {transition ? (
            <div className="flex items-center gap-1.5">
              {transition.bpmDelta > 0 && (
                <span
                  style={{
                    fontSize: '10px',
                    color: transition.bpmDeltaColor,
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: '0.02em',
                  }}
                >
                  {transition.bpmDir}{Math.round(transition.bpmDelta)}
                </span>
              )}
              {transition.hints.map((hint, hi) => (
                <span
                  key={hi}
                  className="relative inline-block"
                  onMouseEnter={() => setHoverHintIdx(hi)}
                  onMouseLeave={() => setHoverHintIdx(null)}
                  style={{
                    fontSize: '11px',
                    color: hint.color ?? '#475569',
                    cursor: 'default',
                    opacity: 0.7,
                    lineHeight: 1,
                    userSelect: 'none',
                  }}
                >
                  {hint.icon}
                  {showHoverTips && hoverHintIdx === hi && hint.tip && (
                    <div className={`absolute ${openDown ? 'top-full mt-1' : 'bottom-full mb-2'} right-0 z-50 rounded bg-[#1e1e2e] border border-[#2a2a3a] px-2 py-1 text-[11px] text-[#e2e8f0] shadow-lg pointer-events-none w-max max-w-[220px] leading-snug`}>
                      {hint.tip}
                    </div>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[10px] text-[#2a2a3a]">—</span>
          )}
        </td>

        {/* Actions — kebab menu */}
        <td className="py-3 pl-2 pr-4 text-right">
          <div className="relative flex items-center justify-end gap-1" ref={menuRef}>
            {/* Active state indicators (small dots) */}
            {track.locked && <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] flex-shrink-0" title="Locked" />}
            {(showTags || editing) && <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] flex-shrink-0" title="Panel open" />}
            {reanalyzing && <span className="text-[10px] text-[#475569] animate-pulse">…</span>}

            <button
              onClick={() => setMenuOpen(o => !o)}
              title="Track actions"
              aria-label="Track actions"
              className={`px-2 py-1 rounded-md border transition-colors cursor-pointer ${menuOpen ? 'border-[#7c3aed] bg-[#7c3aed22] text-[#a78bfa]' : 'border-[#2a2a3a] bg-[#12121a] text-[#475569] hover:border-[#7c3aed] hover:text-[#e2e8f0]'}`}
            >
              <MoreVertical size={14} />
            </button>

            {menuOpen && (
              <div className={`absolute right-0 ${openDown ? 'top-full mt-1' : 'bottom-full mb-1'} z-30 min-w-[175px] rounded-md border border-[#2a2a3a] bg-[#12121a] shadow-xl overflow-hidden py-1`}>

                {/* ── Lock ── */}
                <button
                  onClick={() => { onToggleLock(); setMenuOpen(false); }}
                  className={`w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs transition-colors cursor-pointer ${track.locked ? 'text-[#fbbf24] hover:bg-[#f59e0b0d]' : 'text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0]'}`}
                >
                  <span className="w-3.5 text-center">{track.locked ? '🔒' : '🔓'}</span>
                  {track.locked ? 'Unlock track' : 'Lock track'}
                </button>

                <div className="h-px bg-[#1e1e2e] my-1" />

                {/* ── Play / Open ── */}
                <button
                  onClick={() => { setMenuOpen(false); void fetch('/api/play-in-music', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: track.filePath, artist: track.artist, title: track.title }) }); }}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                >
                  <Play size={13} className="w-3.5 flex-shrink-0" />
                  Play in Apple Music
                </button>

                {track.spotifyId && (
                  <a
                    href={`https://open.spotify.com/track/${track.spotifyId}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#1db954] transition-colors cursor-pointer"
                  >
                    <ExternalLink size={13} className="w-3.5 flex-shrink-0" />
                    Open in Spotify
                  </a>
                )}

                <div className="h-px bg-[#1e1e2e] my-1" />

                {/* ── Edit / Swap / File ops ── */}
                <button
                  onClick={() => { if (editing) cancelEdit(); else openEdit(); setMenuOpen(false); }}
                  className={`w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs transition-colors cursor-pointer ${editing ? 'text-[#a78bfa] bg-[#7c3aed0d]' : 'text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0]'}`}
                >
                  <Pencil size={13} className="w-3.5 flex-shrink-0" />
                  {editing ? 'Close editor' : 'Edit tags'}
                </button>

                <button
                  onClick={() => { onSwap(); setMenuOpen(false); }}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                >
                  <RefreshCcw size={13} className="w-3.5 flex-shrink-0" />
                  Swap track
                </button>

{track.filePath && (
                  <button
                    onClick={() => void handleReanalyze()}
                    disabled={reanalyzing}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RotateCcw size={13} className="w-3.5 flex-shrink-0" />
                    {reanalyzing ? 'Reanalyzing…' : 'Re-analyze'}
                  </button>
                )}

                {track.filePath && (
                  <button
                    onClick={() => { setMenuOpen(false); void fetch('/api/reveal-in-finder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: track.filePath }) }); }}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                  >
                    <FolderOpen size={13} className="w-3.5 flex-shrink-0" />
                    Reveal in Finder
                  </button>
                )}

                {/* ── Info panels ── */}
                {track.semanticTags && (
                  <div className="h-px bg-[#1e1e2e] my-1" />
                )}

                {track.semanticTags && (
                  <button
                    onClick={() => { setShowTags(s => !s); setMenuOpen(false); }}
                    className={`w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs transition-colors cursor-pointer ${showTags ? 'text-[#a78bfa] bg-[#7c3aed0d]' : 'text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0]'}`}
                  >
                    <span className="w-3.5 text-center text-[11px]">✦</span>
                    {showTags ? 'Hide AI tags' : 'Show AI tags'}
                  </button>
                )}

                <div className="h-px bg-[#1e1e2e] my-1" />

                {/* ── Remove ── */}
                <button
                  onClick={() => { setMenuOpen(false); handleRemove(); }}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-[#94a3b8] hover:bg-[#ef444410] hover:text-[#ef4444] transition-colors cursor-pointer"
                >
                  <Trash2 size={13} className="w-3.5 flex-shrink-0" />
                  Remove
                </button>
              </div>
            )}
          </div>
        </td>
      </tr>

      {/* AI tags row */}
      {showTags && track.semanticTags && (
        <tr className="border-b border-[#1e1e2e] bg-[#0a0a12]">
          <td colSpan={totalCols} className="px-4 py-2.5">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {track.semanticTags.vibeTags.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] uppercase tracking-widest text-[#334155]">Vibe</span>
                  <div className="flex gap-1 flex-wrap">{track.semanticTags.vibeTags.map(t => <TagPill key={t} label={t} type="vibe" />)}</div>
                </div>
              )}
              {track.semanticTags.moodTags.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] uppercase tracking-widest text-[#334155]">Mood</span>
                  <div className="flex gap-1 flex-wrap">{track.semanticTags.moodTags.map(t => <TagPill key={t} label={t} type="mood" />)}</div>
                </div>
              )}
              {track.semanticTags.venueTags.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] uppercase tracking-widest text-[#334155]">Venue</span>
                  <div className="flex gap-1 flex-wrap">{track.semanticTags.venueTags.map(t => <TagPill key={t} label={t} type="venue" />)}</div>
                </div>
              )}
              {track.semanticTags.timeOfNightTags.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] uppercase tracking-widest text-[#334155]">Time</span>
                  <div className="flex gap-1 flex-wrap">{track.semanticTags.timeOfNightTags.map(t => <TagPill key={t} label={t} type="time" />)}</div>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] uppercase tracking-widest text-[#334155]">Vocal</span>
                <TagPill label={track.semanticTags.vocalType} type="vocal" />
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* Inline edit row */}
      {editing && (
        <tr className="border-b border-[#1e1e2e] bg-[#0d0d14]">
          <td colSpan={8} className="px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1 min-w-[160px]">
                <label className="text-[10px] text-[#475569] uppercase tracking-wider">Title</label>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] w-full"
                />
              </div>
              <div className="flex flex-col gap-1 min-w-[140px]">
                <label className="text-[10px] text-[#475569] uppercase tracking-wider">Artist</label>
                <input
                  value={editArtist}
                  onChange={e => setEditArtist(e.target.value)}
                  className="bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] w-full"
                />
              </div>
              <div className="flex flex-col gap-1 min-w-[160px]">
                <label className="text-[10px] text-[#475569] uppercase tracking-wider">Genre <span className="normal-case text-[#2a2a3a]">(comma-separated)</span></label>
                <input
                  value={editGenre}
                  onChange={e => setEditGenre(e.target.value)}
                  placeholder="e.g. house, deep house"
                  className="bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] w-full"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-[#475569] uppercase tracking-wider">BPM</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={editBpm}
                    onChange={e => setEditBpm(e.target.value)}
                    className="bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] w-16"
                  />
                  <button type="button" onClick={() => { const v = parseFloat(editBpm); if (!isNaN(v) && v > 0) setEditBpm(String(Math.round(v * 2))); }}
                    className="px-1.5 py-1 text-[10px] rounded border border-[#2a2a3a] text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#7c3aed] transition-colors cursor-pointer tabular-nums">
                    ×2
                  </button>
                  <button type="button" onClick={() => { const v = parseFloat(editBpm); if (!isNaN(v) && v > 0) setEditBpm(String(Math.round(v / 2))); }}
                    className="px-1.5 py-1 text-[10px] rounded border border-[#2a2a3a] text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#7c3aed] transition-colors cursor-pointer tabular-nums">
                    ÷2
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1 w-16">
                <label className="text-[10px] text-[#475569] uppercase tracking-wider">Key</label>
                <input
                  value={editCamelot}
                  onChange={e => setEditCamelot(e.target.value)}
                  placeholder="e.g. 7A"
                  className="bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-1 text-xs font-mono text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] w-full"
                />
              </div>
              <div className="flex items-end gap-2 pb-0.5">
                <button
                  onClick={() => void saveEdit()}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1 rounded-md bg-[#7c3aed] text-white text-xs font-medium hover:bg-[#6d28d9] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  <Check size={12} />
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1 rounded-md border border-[#2a2a3a] text-[#94a3b8] text-xs hover:text-[#e2e8f0] hover:border-[#475569] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <X size={12} />
                  Cancel
                </button>
                {saveError && <span className="text-xs text-[#ef4444]">{saveError}</span>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
