import { useEffect, useRef, useState } from "react";
import type { SetTrack } from "../types";

interface Props {
  track: SetTrack;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  playing: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function fmt(seconds: number): string {
  if (!isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function PlayerBar({ track, audioRef, playing, onToggle, onClose }: Props) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => setDuration(audio.duration || 0);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    if (audio.duration) setDuration(audio.duration);
    setCurrentTime(audio.currentTime);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
    };
  }, [audioRef, track]);

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = barRef.current!.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
  }

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0d0d14] border-t border-[#1e1e2e] px-4 py-3 flex items-center gap-4">
      {/* Play / Pause */}
      <button
        onClick={onToggle}
        className="flex-shrink-0 w-9 h-9 rounded-full bg-[#7c3aed] hover:bg-[#6d28d9] flex items-center justify-center transition-colors cursor-pointer"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1"/>
            <rect x="14" y="4" width="4" height="16" rx="1"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        )}
      </button>

      {/* Track info */}
      <div className="flex-shrink-0 min-w-0 w-48">
        <div className="text-sm font-medium text-[#e2e8f0] truncate leading-tight">{track.title}</div>
        <div className="text-[11px] text-[#475569] truncate mt-0.5">
          {track.artist ?? ""}
          {track.bpm && <span className="ml-2 text-[#334155]">{Math.round(track.bpm)} BPM</span>}
          {track.camelot && <span className="ml-2 text-[#334155]">{track.camelot}</span>}
        </div>
      </div>

      {/* Progress */}
      <div className="flex-1 flex items-center gap-3 min-w-0">
        <span className="flex-shrink-0 text-[11px] text-[#475569] tabular-nums w-8 text-right">{fmt(currentTime)}</span>
        <div
          ref={barRef}
          onClick={seek}
          className="flex-1 h-1.5 bg-[#1e1e2e] rounded-full cursor-pointer relative overflow-hidden group"
        >
          <div
            className="absolute inset-y-0 left-0 bg-[#7c3aed] rounded-full transition-none"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className="flex-shrink-0 text-[11px] text-[#334155] tabular-nums w-8">{fmt(duration)}</span>
      </div>

      {/* Close */}
      <button
        onClick={onClose}
        className="flex-shrink-0 text-[#334155] hover:text-[#94a3b8] transition-colors cursor-pointer"
        aria-label="Close player"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}
