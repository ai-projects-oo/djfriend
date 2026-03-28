import { useState, useEffect, useRef } from 'react';
import { RefreshCcw, Trash2, Pencil, Check, X } from 'lucide-react';
import type { SetTrack } from '../types';
import { parseCamelot } from '../lib/camelot';

interface Props {
  track: SetTrack;
  index: number;
  onSwap: () => void;
  onRemove: () => void;
  onUpdateTrack: (tags: { title?: string; artist?: string; genre?: string; bpm?: number }) => void;
  // drag-to-reorder
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  isDragOver?: boolean;
}

const CAMELOT_COLORS: Record<string, string> = {
  A: '#06b6d4',
  B: '#7c3aed',
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

export default function TrackRow({ track, index, onSwap, onRemove, onUpdateTrack, onDragStart, onDragEnd, onDragOver, onDrop, isDragOver }: Props) {
  const [showHarmonicTooltip, setShowHarmonicTooltip] = useState(false);
  const [showKeyTooltip, setShowKeyTooltip] = useState(false);
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

  const barColor = energyBarColor(track.energy);
  const isLocal = Boolean(track.filePath);
  const isMp3 = track.filePath?.toLowerCase().endsWith('.mp3') ?? false;

  const energyDelta = track.energy - track.targetEnergy;
  const absDelta = Math.abs(energyDelta);
  const deltaColor = absDelta <= 0.05 ? '#22c55e' : absDelta <= 0.15 ? '#eab308' : '#f97316';
  const deltaSign = energyDelta >= 0 ? '+' : '';

  const compatibleKeys = getCompatibleKeys(track.camelot);

  function openEdit() {
    setEditTitle(track.title);
    setEditArtist(track.artist);
    setEditGenre(track.genres.join(', '));
    setEditBpm(track.bpm > 0 ? String(Math.round(track.bpm)) : '');
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
      const tags: { title?: string; artist?: string; genre?: string; bpm?: number } = {};
      if (editTitle.trim() !== track.title) tags.title = editTitle.trim();
      if (editArtist.trim() !== track.artist) tags.artist = editArtist.trim();
      const currentGenre = track.genres.join(', ');
      if (editGenre.trim() !== currentGenre) tags.genre = editGenre.trim();
      const newBpm = parseFloat(editBpm);
      if (!isNaN(newBpm) && newBpm !== track.bpm) tags.bpm = newBpm;

      if (Object.keys(tags).length > 0) {
        const res = await fetch('/api/update-tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: track.filePath, tags }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? 'Save failed');
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
        draggable={!editing}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {/* # */}
        <td className="py-3 pl-4 pr-2 w-10">
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
            <span
              className="inline-block px-2 py-0.5 rounded text-xs font-mono font-semibold cursor-help"
              style={{ backgroundColor: camelotBadgeColor(track.camelot) + '33', color: camelotBadgeColor(track.camelot), border: `1px solid ${camelotBadgeColor(track.camelot)}66` }}
              onMouseEnter={() => setShowKeyTooltip(true)}
              onMouseLeave={() => setShowKeyTooltip(false)}
            >
              {track.camelot}
            </span>
            {showKeyTooltip && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 rounded-md bg-[#1e1e2e] border border-[#2a2a3a] px-3 py-2 text-xs text-[#e2e8f0] shadow-lg pointer-events-none whitespace-nowrap">
                {compatibleKeys.length > 0
                  ? `Compatible: ${compatibleKeys.join(', ')}`
                  : track.camelot}
              </div>
            )}
          </div>
        </td>

        {/* Energy bar + delta */}
        <td className="py-3 px-2 pr-4">
          <div className="flex items-center gap-2">
            <div className="w-16 h-2 rounded-full bg-[#1e1e2e] overflow-hidden flex-shrink-0">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${(track.energy * 100).toFixed(1)}%`, backgroundColor: barColor }}
              />
            </div>
            <span className="text-[10px] text-[#475569] tabular-nums w-8">
              {(track.energy * 100).toFixed(0)}%
            </span>
            <span
              className="text-[10px] tabular-nums w-9 hidden xl:inline"
              style={{ color: deltaColor }}
              title={`Target: ${(track.targetEnergy * 100).toFixed(0)}%`}
            >
              {deltaSign}{(energyDelta * 100).toFixed(0)}%
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
            {isLocal && isMp3 && (
              <button
                onClick={openEdit}
                title="Edit tags"
                aria-label="Edit tags"
                className="px-2 py-1 text-[11px] rounded-md border border-[#2a2a3a] bg-[#12121a] text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer"
              >
                <Pencil size={14} />
              </button>
            )}
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
              <div className="flex flex-col gap-1 w-20">
                <label className="text-[10px] text-[#475569] uppercase tracking-wider">BPM</label>
                <input
                  type="number"
                  value={editBpm}
                  onChange={e => setEditBpm(e.target.value)}
                  className="bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] w-full"
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
