import { useState, useEffect, useCallback, useRef } from "react";
import type { Song } from "../types";
import { camelotColor } from "../lib/camelotColors";

interface Props {
  song: Song;
  library: Song[];
  onClose: () => void;
  onSave: (file: string, patch: { artist?: string; title?: string; genres?: string[]; year?: number; comment?: string }) => Promise<void>;
  onNavigate: (song: Song) => void;
}

function AlbumArtLarge({ filePath }: { filePath?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!filePath) return;
    const url = `/api/album-art?path=${encodeURIComponent(filePath)}`;
    let alive = true;
    fetch(url).then(r => {
      if (!alive || !r.ok) { setFailed(true); return; }
      return r.blob();
    }).then(blob => {
      if (!alive || !blob) return;
      setSrc(URL.createObjectURL(blob));
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [filePath]);

  if (!src || failed) {
    return (
      <div className="w-20 h-20 rounded-lg bg-[#1e1e2e] flex items-center justify-center flex-shrink-0">
        <span className="text-3xl text-[#374151]">♪</span>
      </div>
    );
  }
  return <img src={src} alt="" className="w-20 h-20 rounded-lg object-cover flex-shrink-0 shadow-lg" />;
}

function energyColor(e: number): string {
  if (e >= 0.75) return "#a855f7";
  if (e >= 0.5)  return "#3b82f6";
  if (e >= 0.25) return "#22c55e";
  return "#64748b";
}

const inputCls = "w-full bg-[#0d0d14] border border-[#2a2a3a] rounded-lg px-3 py-2 text-sm text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] transition-colors";
const labelCls = "text-right text-xs text-[#4b5568] self-center whitespace-nowrap";

export default function TrackInfoModal({ song, library, onClose, onSave, onNavigate }: Props) {
  const [title, setTitle]     = useState(song.title);
  const [artist, setArtist]   = useState(song.artist);
  const [genres, setGenres]   = useState(song.genres.join(", "));
  const [year, setYear]       = useState(song.year != null ? String(song.year) : "");
  const [comment, setComment] = useState(song.comment ?? "");
  const [saving, setSaving]   = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);


  const isDirty = title !== song.title || artist !== song.artist || genres !== song.genres.join(", ")
    || year !== (song.year != null ? String(song.year) : "") || comment !== (song.comment ?? "");

  const currentIdx = library.findIndex(s => s.file === song.file);

  const handleSave = useCallback(async () => {
    if (!isDirty) { onClose(); return; }
    setSaving(true);
    const patch: { artist?: string; title?: string; genres?: string[]; year?: number; comment?: string } = {};
    if (title !== song.title)   patch.title  = title;
    if (artist !== song.artist) patch.artist = artist;
    if (genres !== song.genres.join(", ")) patch.genres = genres.split(",").map(g => g.trim()).filter(Boolean);
    if (year !== (song.year != null ? String(song.year) : "")) {
      const y = parseInt(year);
      if (!isNaN(y)) patch.year = y;
    }
    if (comment !== (song.comment ?? "")) patch.comment = comment;
    await onSave(song.file, patch);
    setSaving(false);
    onClose();
  }, [isDirty, title, artist, genres, year, comment, song, onSave, onClose]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowLeft" && currentIdx > 0) onNavigate(library[currentIdx - 1]);
    if (e.key === "ArrowRight" && currentIdx < library.length - 1) onNavigate(library[currentIdx + 1]);
  }, [onClose, onNavigate, library, currentIdx]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const cc = camelotColor(song.camelot);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="bg-[#12121a] border border-[#2a2a3a] rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header with album art */}
        <div className="bg-[#0d0d14] px-6 py-5 flex items-center gap-4 border-b border-[#1e1e2e]">
          <AlbumArtLarge filePath={song.filePath} />
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-[#e2e8f0] truncate">{song.title || "Unknown Title"}</p>
            <p className="text-sm text-[#64748b] truncate mt-0.5">{song.artist || "Unknown Artist"}</p>
            {/* Read-only audio stats */}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {song.camelot && song.camelot !== "Unknown" && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: cc + "26", color: cc, border: `1px solid ${cc}66` }}>{song.camelot}</span>
              )}
              {song.bpm > 0 && (
                <span className="text-[10px] text-[#64748b] tabular-nums">{Math.round(song.bpm)} BPM</span>
              )}
              <div className="flex items-center gap-1.5">
                <div className="w-10 h-1 bg-[#1e1e2e] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.round(song.energy * 100)}%`, backgroundColor: energyColor(song.energy) }} />
                </div>
                <span className="text-[10px] text-[#475569]">{Math.round(song.energy * 100)}</span>
              </div>
              {song.key && song.key !== "Unknown" && (
                <span className="text-[10px] text-[#475569]">{song.key}</span>
              )}
            </div>
          </div>
        </div>

        {/* Editable fields */}
        <div className="px-6 py-5 grid grid-cols-[80px_1fr] gap-x-4 gap-y-3">
          <label className={labelCls}>title</label>
          <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} autoFocus />

          <label className={labelCls}>artist</label>
          <input className={inputCls} value={artist} onChange={e => setArtist(e.target.value)} />

          <label className={labelCls}>genre</label>
          <input className={inputCls} value={genres} onChange={e => setGenres(e.target.value)} placeholder="e.g. Techno, Tech House" />

          <label className={labelCls}>year</label>
          <input className={inputCls} value={year} onChange={e => setYear(e.target.value)} placeholder="e.g. 2024" type="number" />

          <label className={labelCls}>comments</label>
          <textarea className={`${inputCls} resize-none`} value={comment} onChange={e => setComment(e.target.value)} rows={2} />
        </div>

        {/* Footer: nav + actions */}
        <div className="px-6 py-4 border-t border-[#1e1e2e] flex items-center justify-between bg-[#0d0d14]">
          {/* Prev / Next */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentIdx <= 0}
              onClick={() => onNavigate(library[currentIdx - 1])}
              className="w-7 h-7 flex items-center justify-center rounded text-[#4b5568] hover:text-[#94a3b8] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer text-sm"
              title="Previous track (←)"
            >‹</button>
            <span className="text-[10px] text-[#374151] tabular-nums w-16 text-center">{currentIdx + 1} / {library.length}</span>
            <button
              type="button"
              disabled={currentIdx >= library.length - 1}
              onClick={() => onNavigate(library[currentIdx + 1])}
              className="w-7 h-7 flex items-center justify-center rounded text-[#4b5568] hover:text-[#94a3b8] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer text-sm"
              title="Next track (→)"
            >›</button>
          </div>
          {/* Buttons */}
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-4 py-1.5 text-xs border border-[#2a2a3a] rounded-lg text-[#6b7280] hover:text-[#94a3b8] hover:border-[#374151] transition-colors cursor-pointer">
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !isDirty}
              onClick={handleSave}
              className="px-4 py-1.5 text-xs rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer font-medium"
            >
              {saving ? "Saving…" : "OK"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

