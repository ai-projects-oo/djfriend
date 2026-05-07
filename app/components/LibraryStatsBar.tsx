import { useMemo } from "react";
import type { Song } from "../types";
import { BEATPORT_UMBRELLAS } from "../lib/genreUtils";

interface Props {
  songs: Song[];
  onScrollToMissing?: () => void;
}

export default function LibraryStatsBar({ songs, onScrollToMissing }: Props) {
  const stats = useMemo(() => {
    if (songs.length === 0) return null;

    const analyzed = songs.filter(s => s.bpm > 0 && s.key !== "Unknown" && s.key !== "").length;
    const missing = songs.filter(s => s.bpm === 0 || !s.key || s.key === "Unknown" || s.genres.length === 0).length;

    const bpms = songs.map(s => s.bpm).filter(b => b > 0);
    const bpmMin = bpms.length ? Math.round(Math.min(...bpms)) : null;
    const bpmMax = bpms.length ? Math.round(Math.max(...bpms)) : null;

    const genreCounts: Record<string, number> = {};
    for (const song of songs) {
      const matched = new Set<string>();
      for (const g of song.genres) {
        const lower = g.toLowerCase();
        for (const umbrella of BEATPORT_UMBRELLAS) {
          if (!matched.has(umbrella.label) && umbrella.phrases.some(p => lower.includes(p))) {
            matched.add(umbrella.label);
          }
        }
      }
      for (const label of matched) genreCounts[label] = (genreCounts[label] ?? 0) + 1;
    }
    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label]) => label);

    return { analyzed, missing, bpmMin, bpmMax, topGenres };
  }, [songs]);

  if (!stats) return null;

  const pct = Math.round((stats.analyzed / songs.length) * 100);

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-1 pb-3 border-b border-[#1e1e2e] mb-4">
      <Stat label="Tracks" value={songs.length.toLocaleString()} />
      <Stat label="Analyzed" value={`${pct}%`} dim={pct < 80} />
      {stats.bpmMin != null && (
        <Stat label="BPM range" value={`${stats.bpmMin}–${stats.bpmMax}`} />
      )}
      {stats.topGenres.length > 0 && (
        <Stat label="Top genres" value={stats.topGenres.join(" · ")} />
      )}
      {stats.missing > 0 && (
        <button
          type="button"
          onClick={onScrollToMissing}
          className="flex items-center gap-1.5 cursor-pointer group"
        >
          <span className="text-[10px] uppercase tracking-widest font-semibold text-[#ef4444]/70 group-hover:text-[#ef4444] transition-colors">
            Needs attention
          </span>
          <span className="text-[11px] font-semibold text-[#ef4444]/80 group-hover:text-[#ef4444] transition-colors tabular-nums">
            {stats.missing}
          </span>
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, dim }: { label: string; value: string | number; dim?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-widest font-semibold text-[#4b5568]">{label}</span>
      <span className={`text-[11px] font-semibold tabular-nums ${dim ? "text-[#f59e0b]" : "text-[#94a3b8]"}`}>{value}</span>
    </div>
  );
}
