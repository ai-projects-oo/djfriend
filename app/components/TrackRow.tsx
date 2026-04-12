import { useState, useEffect, useRef } from 'react';
import { RefreshCcw, Trash2, Pencil, Check, X } from 'lucide-react';
import type { SetTrack } from '../types';
import { parseCamelot } from '../lib/camelot';
import { camelotColor } from '../lib/camelotColors';
import type { FitInfo } from './SetTracklist';

interface Props {
  track: SetTrack;
  index: number;
  fitInfo?: FitInfo;
  onSwap: () => void;
  onRemove: () => void;
  onUpdateTrack: (tags: { title?: string; artist?: string; genre?: string; bpm?: number; camelot?: string; key?: string }) => void;
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

function energyBarColor(energy: number): string {
  if (energy < 0.4) return '#3b82f6';
  if (energy < 0.7) return '#a855f7';
  return '#ef4444';
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getCompatibleKeys(camelot: string): string[] {
  const parsed = parseCamelot(camelot);
  if (!parsed) return [];
  const { num, letter } = parsed;
  const other = letter === 'A' ? 'B' : 'A';
  const prev = num === 1 ? 12 : num - 1;
  const next = num === 12 ? 1 : num + 1;
  return [`${prev}${letter}`, `${next}${letter}`, `${num}${other}`];
}

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  vibe:  { bg: '#7c3aed22', text: '#a78bfa' },
  mood:  { bg: '#1d4ed822', text: '#60a5fa' },
  venue: { bg: '#06522022', text: '#34d399' },
  time:  { bg: '#92400e22', text: '#fbbf24' },
  vocal: { bg: '#4a044e22', text: '#e879f9' },
};

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

export default function TrackRow({ track, index, fitInfo, onSwap, onRemove, onUpdateTrack, onDragStart, onDragEnd, onDragOver, onDrop, isDragOver }: Props) {
  const [showHarmonicTooltip, setShowHarmonicTooltip] = useState(false);
  const [showKeyTooltip, setShowKeyTooltip] = useState(false);
  const [showFitTooltip, setShowFitTooltip] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [swapFlash, setSwapFlash] = useState(false);

  const prevFileRef = useRef(track.file);
  useEffect(() => {
    if (prevFileRef.current !== track.file) {
      prevFileRef.current = track.file;
      setSwapFlash(true);
      const timer = setTimeout(() => setSwapFlash(false), 600);
      return () => clearTimeout(timer);
    }
  }, [track.file]);

  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');
  const [editGenre, setEditGenre] = useState('');
  const [editBpm, setEditBpm] = useState('');
  const [editCamelot, setEditCamelot] = useState('');

  const barColor = energyBarColor(track.energy);
  const isLocal = Boolean(track.filePath);
  const isMp3 = track.filePath?.toLowerCase().endsWith('.mp3') ?? false;


  const compatibleKeys = getCompatibleKeys(track.camelot);

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
        className={`border-b border-[#1e1e2e] group ${swapFlash ? 'bg-green-900/20' : 'hover:bg-[#12121a]'} ${isDragOver ? 'border-t-2 border-t-[#7c3aed]' : ''}`}
        style={rowStyle}
        data-warning={track.harmonicWarning ? 'true' : undefined}
        data-fit={fitInfo && fitInfo.level !== 'good' ? fitInfo.level : undefined}
        draggable={!editing}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {/* # */}
        <td className="py-3 pl-4 pr-2 w-10">
          <div className="flex flex-col items-center gap-1">
            {/* Number / play toggle */}
            <div className="relative w-5 h-4 flex items-center justify-center">
              <span
                className="group-hover:hidden text-[#475569] text-sm tabular-nums cursor-grab active:cursor-grabbing select-none"
                title="Drag to reorder"
              >
                {index + 1}
              </span>
              <button
                onClick={() => void fetch('/api/play-in-music', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: track.filePath, artist: track.artist, title: track.title }) })}
                className="hidden group-hover:flex items-center justify-center text-[#7c3aed] hover:text-white cursor-pointer transition-colors"
                title="Play in Apple Music"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </button>
            </div>
            {/* Fit dot — always visible when there's an issue */}
            {fitInfo && fitInfo.level !== 'good' && (
              <div className="relative">
                <span
                  className="cursor-help text-[8px] leading-none select-none block"
                  style={{ color: fitInfo.level === 'bad' ? '#ef4444' : '#f59e0b' }}
                  onMouseEnter={() => setShowFitTooltip(true)}
                  onMouseLeave={() => setShowFitTooltip(false)}
                >
                  ●
                </span>
                {showFitTooltip && (
                  <div className="absolute top-full left-0 mt-1 z-50 w-56 rounded-md bg-[#1e1e2e] border border-[#2a2a3a] px-3 py-2 shadow-lg pointer-events-none"
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
          </div>
        </td>

        {/* Title / Artist */}
        <td className="py-3 px-2 min-w-0">
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[#e2e8f0] truncate">{track.title}</div>
              <div className="text-xs text-[#64748b] truncate">{track.artist}</div>
            </div>
            {track.harmonicWarning && (
              <div className="relative flex-shrink-0">
                <span
                  className="text-[#f59e0b] cursor-help text-base"
                  onMouseEnter={() => setShowHarmonicTooltip(true)}
                  onMouseLeave={() => setShowHarmonicTooltip(false)}
                >
                  ⚠
                </span>
                {showHarmonicTooltip && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-48 rounded-md bg-[#1e1e2e] border border-[#2a2a3a] px-3 py-2 text-xs text-[#e2e8f0] shadow-lg pointer-events-none">
                    Harmonic clash — this transition may sound dissonant. Consider pitch-shifting or adding an EQ breakdown.
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
          <div className="relative inline-block">
            {track.camelot ? (
              <span
                className="inline-block px-2 py-0.5 rounded text-xs font-mono font-semibold cursor-help"
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
            {showKeyTooltip && track.camelot && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 rounded-md bg-[#1e1e2e] border border-[#2a2a3a] px-3 py-2 text-xs text-[#e2e8f0] shadow-lg pointer-events-none whitespace-nowrap">
                {compatibleKeys.length > 0
                  ? `Compatible: ${compatibleKeys.join(', ')}`
                  : track.camelot}
              </div>
            )}
          </div>
        </td>

        {/* Energy bar + decimal */}
        <td className="py-3 px-2 pr-4">
          <div className="flex items-center gap-2">
            {/* Bar container: 56px wide, 4px tall, with target tick overlay */}
            <div
              className="relative flex-shrink-0 rounded-full bg-[#1e1e2e]"
              style={{ width: 56, height: 4 }}
              title={`Energy: ${track.energy.toFixed(2)} · Target: ${track.targetEnergy.toFixed(2)}`}
            >
              {/* Filled portion */}
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(track.energy * 100, 100).toFixed(1)}%`,
                  backgroundColor: barColor,
                }}
              />
              {/* Target energy tick: 1px wide, 6px tall, centred vertically on the 4px bar */}
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
            {/* Decimal value */}
            <span className="text-[10px] text-[#64748b] tabular-nums">
              {track.energy.toFixed(2)}
            </span>
          </div>
        </td>

        {/* Genre */}
        <td className="py-3 px-2 hidden xl:table-cell">
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

        {/* Actions */}
        <td className="py-3 pl-2 pr-4 text-right">
          <div className="flex items-center justify-end gap-1">
            {track.semanticTags && (
              <button
                onClick={() => setShowTags(s => !s)}
                title="AI tags"
                aria-label="Toggle AI tags"
                className={`px-2 py-1 text-[11px] rounded-md border transition-colors cursor-pointer ${showTags ? 'border-[#7c3aed] bg-[#7c3aed22] text-[#a78bfa]' : 'border-[#2a2a3a] bg-[#12121a] text-[#475569] hover:border-[#7c3aed] hover:text-[#a78bfa]'}`}
              >
                ✦
              </button>
            )}
            <button
              onClick={openEdit}
              title="Edit tags"
              aria-label="Edit tags"
              className="px-2 py-1 text-[11px] rounded-md border border-[#2a2a3a] bg-[#12121a] text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={onSwap}
              title="Swap track"
              aria-label="Swap track"
              className="px-2 py-1 text-[11px] rounded-md border border-[#2a2a3a] bg-[#12121a] text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer"
            >
              <RefreshCcw size={14} />
            </button>
            <button
              onClick={handleRemove}
              title="Remove track"
              aria-label="Remove track"
              className="px-2 py-1 text-[11px] rounded-md border border-[#2a2a3a] bg-[#12121a] text-[#94a3b8] hover:border-[#ef4444] hover:text-[#ef4444] transition-colors cursor-pointer"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>

      {/* AI tags row */}
      {showTags && track.semanticTags && (
        <tr className="border-b border-[#1e1e2e] bg-[#0a0a12]">
          <td colSpan={8} className="px-4 py-2.5">
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
