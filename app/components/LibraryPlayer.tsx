import { useState, useRef, useEffect, useCallback } from "react";
import type { Song } from "../types";
import { camelotColor } from "../lib/camelotColors";

interface Props {
  song: Song | null;
  onPrev?: () => void;
  onNext?: () => void;
}

function AlbumArtSmall({ filePath }: { filePath?: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) return;
    let alive = true;
    fetch(`/api/album-art?path=${encodeURIComponent(filePath)}`)
      .then(r => r.ok ? r.blob() : null)
      .then(blob => { if (alive && blob) setSrc(URL.createObjectURL(blob)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [filePath]);

  if (!src) {
    return (
      <div className="w-10 h-10 rounded bg-[#1e1e2e] flex items-center justify-center flex-shrink-0">
        <span className="text-sm text-[#374151]">♪</span>
      </div>
    );
  }
  return <img src={src} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />;
}

function fmt(s: number): string {
  const m = Math.floor(s / 60); const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

export default function LibraryPlayer({ song, onPrev, onNext }: Props) {
  const audioRef    = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying]   = useState(false);
  const [current, setCurrent]   = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading]   = useState(false);

  // Reset when song changes
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    if (!song?.filePath) { el.src = ""; return; }
    el.src = `/api/audio-stream?path=${encodeURIComponent(song.filePath)}`;
  }, [song?.file]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !song) return;
    if (playing) { el.pause(); } else { void el.play(); }
  }, [playing, song]);

  const seek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Number(e.target.value);
  }, []);

  const cc = song ? camelotColor(song.camelot) : "#4b5568";

  if (!song) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1e1e2e] bg-[#0d0d14] flex-shrink-0">
        <div className="w-10 h-10 rounded bg-[#1e1e2e] flex items-center justify-center flex-shrink-0">
          <span className="text-sm text-[#374151]">♪</span>
        </div>
        <span className="text-xs text-[#374151]">Double-click a track to play</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#1e1e2e] bg-[#0d0d14] flex-shrink-0">
      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime ?? 0)}
        onDurationChange={() => setDuration(audioRef.current?.duration ?? 0)}
        onLoadStart={() => setLoading(true)}
        onCanPlay={() => setLoading(false)}
        onEnded={() => { setPlaying(false); onNext?.(); }}
      />

      <AlbumArtSmall filePath={song.filePath} />

      {/* Track info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-medium text-[#e2e8f0] truncate">{song.title}</p>
          {song.camelot && song.camelot !== "Unknown" && (
            <span className="text-[9px] font-semibold px-1 py-0.5 rounded flex-shrink-0" style={{ backgroundColor: cc + "26", color: cc, border: `1px solid ${cc}55` }}>{song.camelot}</span>
          )}
          {song.bpm > 0 && <span className="text-[10px] text-[#475569] flex-shrink-0 tabular-nums">{Math.round(song.bpm)}</span>}
        </div>
        <p className="text-xs text-[#64748b] truncate">{song.artist}</p>
        {/* Progress bar */}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] text-[#374151] tabular-nums w-6 flex-shrink-0">{fmt(current)}</span>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.5}
            value={current}
            onChange={seek}
            className="flex-1 h-1 accent-[#7c3aed] cursor-pointer"
            style={{ WebkitAppearance: "none" }}
          />
          <span className="text-[10px] text-[#374151] tabular-nums w-6 flex-shrink-0 text-right">{fmt(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button type="button" onClick={onPrev} disabled={!onPrev} className="w-7 h-7 flex items-center justify-center text-[#475569] hover:text-[#94a3b8] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
        </button>
        <button
          type="button"
          onClick={toggle}
          disabled={!song.filePath}
          className="w-8 h-8 rounded-full bg-[#7c3aed] hover:bg-[#6d28d9] flex items-center justify-center text-white cursor-pointer disabled:opacity-40 transition-colors"
          aria-label={playing ? "Pause" : "Play"}
        >
          {loading ? (
            <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" />
          ) : playing ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: "1px" }}><path d="M8 5v14l11-7z"/></svg>
          )}
        </button>
        <button type="button" onClick={onNext} disabled={!onNext} className="w-7 h-7 flex items-center justify-center text-[#475569] hover:text-[#94a3b8] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm2.5-6 5.5 3.9V8.1L8.5 12zM16 6v12h2V6h-2z"/></svg>
        </button>
      </div>
    </div>
  );
}
