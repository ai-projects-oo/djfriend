import { useEffect, useRef, useState } from "react";
import type { Song } from "../types";
import type { Player } from "../hooks/usePlayer";
import { camelotColor } from "../lib/camelotColors";
import WaveformSeeker from "./WaveformSeeker";

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60); const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function AlbumArt({ filePath, size = 40 }: { filePath?: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!filePath) return;
    let alive = true;
    let url: string | null = null;
    fetch(`/api/album-art?path=${encodeURIComponent(filePath)}`)
      .then(r => (r.ok ? r.blob() : null))
      .then(blob => { if (alive && blob) { url = URL.createObjectURL(blob); setSrc(url); } })
      .catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [filePath]);
  return src
    ? <img src={src} alt="" className="rounded object-cover flex-shrink-0" style={{ width: size, height: size }} />
    : <div className="rounded bg-[#2c2c42] flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}><span className="text-sm text-[#424f63]">♪</span></div>;
}

const iconBtn = "w-8 h-8 flex items-center justify-center rounded-md text-[#8394a8] hover:text-[#e2e8f0] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors";

// ─── Queue panel ─────────────────────────────────────────────────────────────

function QueuePanel({ player, songsByFile, onClose }: { player: Player; songsByFile: Map<string, Song>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const { queue } = player;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);

  const row = (file: string, i: number, isCurrent: boolean) => {
    const s = songsByFile.get(file);
    return (
      <div key={`${file}-${i}`}
        draggable={!isCurrent}
        onDragStart={() => setDragFrom(i)}
        onDragOver={e => { if (dragFrom != null) e.preventDefault(); }}
        onDrop={() => { if (dragFrom != null && dragFrom !== i) player.move(dragFrom, i); setDragFrom(null); }}
        onDoubleClick={() => player.jumpTo(i)}
        className={`group flex items-center gap-2.5 px-3 py-1.5 rounded-md ${isCurrent ? "bg-[#7c3aed]/15" : "hover:bg-[#26263c] cursor-grab"}`}>
        <AlbumArt filePath={s?.filePath} size={28} />
        <div className="min-w-0 flex-1">
          <p className={`text-xs truncate ${isCurrent ? "text-white font-medium" : "text-[#cbd5e1]"}`}>{s?.title ?? file}</p>
          <p className="text-[10px] text-[#8394a8] truncate">{s?.artist}</p>
        </div>
        {s && s.bpm > 0 && <span className="text-[10px] text-[#64748b] tabular-nums">{Math.round(s.bpm)}</span>}
        {s?.camelot && <span className="text-[10px] font-semibold" style={{ color: camelotColor(s.camelot) }}>{s.camelot}</span>}
        {!isCurrent && (
          <button type="button" onClick={() => player.removeAt(i)} aria-label={`Remove ${s?.title ?? "track"} from queue`}
            className="opacity-0 group-hover:opacity-100 text-[#64748b] hover:text-[#ef4444] text-xs cursor-pointer">✕</button>
        )}
      </div>
    );
  };

  const upcoming = queue.items.slice(queue.index + 1);
  return (
    <div ref={ref} role="dialog" aria-label="Play queue"
      className="absolute bottom-full right-3 mb-2 w-96 max-h-[60vh] overflow-y-auto rounded-xl border border-[#363650] bg-[#20202e] shadow-2xl p-2 z-[90]">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-[#8394a8]">Now Playing</span>
        <button type="button" onClick={onClose} aria-label="Close queue" className="text-[#64748b] hover:text-[#e2e8f0] text-xs cursor-pointer">✕</button>
      </div>
      {queue.index >= 0 && row(queue.items[queue.index], queue.index, true)}
      <div className="flex items-center justify-between px-2 pt-3 pb-1">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-[#8394a8]">Up Next · {upcoming.length}</span>
        {upcoming.length > 0 && (
          <button type="button" onClick={player.clearUpNext} className="text-[10px] text-[#64748b] hover:text-[#a78bfa] cursor-pointer">Clear</button>
        )}
      </div>
      {upcoming.length === 0
        ? <p className="px-3 py-2 text-[11px] text-[#58656e]">Nothing queued. Right-click tracks → Play Next / Play Later.</p>
        : upcoming.map((f, j) => row(f, queue.index + 1 + j, false))}
    </div>
  );
}

// ─── Player bar ──────────────────────────────────────────────────────────────

/** App-wide player at the bottom of the window. Hidden until something is queued. */
export default function NowPlayingBar({ player, songsByFile }: { player: Player; songsByFile: Map<string, Song> }) {
  const [queueOpen, setQueueOpen] = useState(false);
  const s = player.currentSong;
  if (!s && player.queue.items.length === 0) return null;
  const cc = s ? camelotColor(s.camelot) : "#64748b";
  const dur = player.duration || s?.duration || 0;

  return (
    <div className="relative flex-shrink-0 border-t border-[#2c2c42] bg-[#12121a] px-3 py-2 flex items-center gap-3" role="region" aria-label="Player">
      {/* Track */}
      <div className="flex items-center gap-2.5 w-64 min-w-0 flex-shrink-0">
        <AlbumArt filePath={s?.filePath} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#e2e8f0] truncate">{s?.title ?? "—"}</p>
          <div className="flex items-center gap-1.5 text-[11px] text-[#8394a8] min-w-0">
            <span className="truncate">{s?.artist}</span>
            {s?.camelot && s.camelot !== "Unknown" && (
              <span className="text-[9px] font-semibold px-1 rounded flex-shrink-0" style={{ backgroundColor: cc + "26", color: cc, border: `1px solid ${cc}55` }}>{s.camelot}</span>
            )}
            {s && s.bpm > 0 && <span className="tabular-nums flex-shrink-0">{Math.round(s.bpm)}</span>}
          </div>
        </div>
      </div>

      {/* Transport */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button type="button" onClick={player.toggleShuffle} aria-pressed={player.queue.shuffle} aria-label="Shuffle" title="Shuffle"
          className={`${iconBtn} ${player.queue.shuffle ? "!text-[#a78bfa]" : ""}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
        </button>
        <button type="button" onClick={player.prev} disabled={!player.hasPrev} aria-label="Previous" className={iconBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
        </button>
        <button type="button" onClick={player.toggle} disabled={!s} aria-label={player.playing ? "Pause" : "Play"}
          className="w-9 h-9 rounded-full bg-[#7c3aed] hover:bg-[#6d28d9] flex items-center justify-center text-white cursor-pointer disabled:opacity-40 transition-colors mx-1">
          {player.loading && player.playing ? (
            <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" />
          ) : player.playing ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}><path d="M8 5v14l11-7z"/></svg>
          )}
        </button>
        <button type="button" onClick={player.next} disabled={!player.hasNext} aria-label="Next" className={iconBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
        </button>
        <button type="button" onClick={player.cycleRepeat} aria-label={`Repeat: ${player.queue.repeat}`} title={`Repeat: ${player.queue.repeat}`}
          className={`${iconBtn} relative ${player.queue.repeat !== "off" ? "!text-[#a78bfa]" : ""}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
          {player.queue.repeat === "one" && <span className="absolute top-0.5 right-0.5 text-[8px] font-bold">1</span>}
        </button>
      </div>

      {/* Progress */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-[10px] text-[#64748b] tabular-nums w-8 text-right flex-shrink-0">{fmt(player.time)}</span>
        {s?.waveform && s.waveform.length > 0 ? (
          <WaveformSeeker
            waveform={s.waveform}
            frequencyWaveform={s.frequencyWaveform}
            vocalTimeline={s.vocalTimeline}
            progress={dur > 0 ? player.time / dur : 0}
            duration={dur}
            height={32}
            onSeek={frac => player.seek(frac * dur)}
            className="flex-1"
          />
        ) : (
          <input type="range" min={0} max={dur || 1} step={0.5} value={Math.min(player.time, dur || 1)} aria-label="Seek"
            onChange={e => player.seek(Number(e.target.value))} className="flex-1 h-1 accent-[#7c3aed] cursor-pointer" />
        )}
        <span className="text-[10px] text-[#64748b] tabular-nums w-8 flex-shrink-0">{fmt(dur)}</span>
      </div>

      {/* Volume + queue */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-[#64748b]" aria-hidden><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
        <input type="range" min={0} max={1} step={0.01} value={player.volume} aria-label="Volume"
          onChange={e => player.setVolume(Number(e.target.value))} className="w-20 h-1 accent-[#7c3aed] cursor-pointer" />
        <button type="button" onClick={() => setQueueOpen(o => !o)} aria-expanded={queueOpen} aria-label="Queue" title="Queue"
          className={`${iconBtn} ${queueOpen ? "!text-[#a78bfa]" : ""}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18A3 3 0 1 0 19 17V8h3V6h-5z"/></svg>
        </button>
      </div>

      {queueOpen && <QueuePanel player={player} songsByFile={songsByFile} onClose={() => setQueueOpen(false)} />}
    </div>
  );
}
