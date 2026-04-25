import type { HistoryEntry, SetTrack, CurvePoint } from "../types";
import { camelotColor } from "../lib/camelotColors";
import { buildSvgPath } from "../lib/curveInterpolation";
import { downloadM3U } from "../lib/m3uExport";
import { downloadRekordboxXml } from "../lib/rekordboxExport";
import { computeSetScore, SCORE_THRESHOLDS } from "../lib/setScore";

import { SpotifyIcon, RekordboxIcon, M3UIcon } from "./Icons";
import { ARC_PRESETS } from "./EnergyCurveEditor";

interface HistoryTabProps {
  history: HistoryEntry[];
  setHistory: React.Dispatch<React.SetStateAction<HistoryEntry[]>>;
  setImportHistory: React.Dispatch<React.SetStateAction<import("../types").ImportEntry[]>>;
  expandedHistoryId: string | null;
  setExpandedHistoryId: React.Dispatch<React.SetStateAction<string | null>>;
  openHistoryExportId: string | null;
  setOpenHistoryExportId: React.Dispatch<React.SetStateAction<string | null>>;
  historyExportRef: React.RefObject<HTMLDivElement | null>;
  showRekordboxExport?: boolean;
  startSpotifyExport?: (tracks: SetTrack[], playlistName: string) => Promise<void>;
  handleRenameEntry: (id: string, newName: string) => void;
  onLoadEntry: (entry: HistoryEntry) => void;
}

function getCurvePresetName(curve: CurvePoint[]): string {
  const yValues = curve.map(p => p.y);
  for (const [name, presetY] of Object.entries(ARC_PRESETS)) {
    if (presetY.length === yValues.length && presetY.every((v, i) => Math.abs(v - yValues[i]) < 0.001)) {
      return name;
    }
  }
  return 'Custom curve';
}

export default function HistoryTab({
  history,
  setHistory,
  setImportHistory,
  expandedHistoryId,
  setExpandedHistoryId,
  openHistoryExportId,
  setOpenHistoryExportId,
  historyExportRef,
  showRekordboxExport,
  startSpotifyExport,
  handleRenameEntry,
  onLoadEntry,
}: HistoryTabProps) {
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-[#475569] gap-3">
        <span className="text-4xl">📋</span>
        <p className="text-sm">
          No playlists exported yet. Generate a set and click Export as
          M3U.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end mb-2">
        <button
          onClick={() => {
            if (confirm("Clear all history? This cannot be undone.")) {
              setHistory([]);
              setImportHistory([]);
              localStorage.removeItem("djfriend-history");
              localStorage.removeItem("djfriend-imports");
            }
          }}
          className="text-xs text-[#475569] hover:text-[#ef4444] transition-colors cursor-pointer"
        >
          Clear all history
        </button>
      </div>
      {history.map((entry) => {
        const isExpanded = expandedHistoryId === entry.id;
        const date = new Date(entry.timestamp);
        const label =
          date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          }) +
          " · " +
          date.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          });

        // Mini curve: 300×56 viewBox, no padding
        const miniW = 300;
        const miniH = 56;
        const miniPath = buildSvgPath(entry.curve, miniW, miniH, 120);
        const miniFill = miniPath
          ? `${miniPath} L ${miniW} ${miniH} L 0 ${miniH} Z`
          : "";
        const curveTitle = getCurvePresetName(entry.curve);
        const score = computeSetScore(entry.tracks);
        const scoreColor = score === null ? '' : score.total >= SCORE_THRESHOLDS.good ? 'text-green-400 border-green-400/30' : score.total >= SCORE_THRESHOLDS.fair ? 'text-amber-400 border-amber-400/30' : 'text-red-400 border-red-400/30';
        const scoreTooltip = score ? `Harmonic: ${Math.round((1 - score.harmonicRate) * 100)}% · Energy fit: ${Math.round((1 - score.avgEnergyError) * 100)}% · BPM flow: ${Math.round(score.bpmSmoothness * 100)}%` : '';

        const prefTags = [
          `${entry.prefs.setDuration} min`,
          entry.prefs.venueType,
          entry.prefs.setPhase,
          ...(entry.prefs.genres ?? []),
        ];

        return (
          <div
            key={entry.id}
            className="rounded-xl border border-[#1e1e2e] bg-[#12121a] overflow-hidden"
          >
            {/* Editable name */}
            <div className="px-5 pt-4 pb-2">
              <input
                value={entry.name}
                onChange={(e) =>
                  handleRenameEntry(entry.id, e.target.value)
                }
                className="w-full bg-transparent text-sm font-semibold text-[#e2e8f0] border-b border-transparent hover:border-[#2a2a3a] focus:border-[#7c3aed] focus:outline-none pb-0.5 transition-colors"
              />
            </div>
            {/* Tags + mini curve (always visible) */}
            <div className="px-5 pt-1 pb-3 flex items-start gap-4">
              <div className="flex flex-wrap gap-1.5 flex-1">
                {prefTags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-[#1a1a2e] border border-[#2a2a3a] text-[#94a3b8]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="w-44 shrink-0 rounded-md overflow-hidden border border-[#1e1e2e] bg-[#0d0d14]" title={curveTitle}>
                <svg
                  viewBox={`0 0 ${miniW} ${miniH}`}
                  width="100%"
                  height={miniH}
                  preserveAspectRatio="none"
                  style={{ display: "block" }}
                >
                  {miniFill && (
                    <path
                      d={miniFill}
                      fill="#7c3aed"
                      fillOpacity="0.15"
                    />
                  )}
                  {miniPath && (
                    <path
                      d={miniPath}
                      fill="none"
                      stroke="#7c3aed"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {entry.curve.map((pt, i) => (
                    <circle
                      key={i}
                      cx={pt.x * miniW}
                      cy={(1 - pt.y) * miniH}
                      r="3"
                      fill="#7c3aed"
                    />
                  ))}
                </svg>
              </div>
              {score !== null && (
                <div
                  className="shrink-0 self-center flex items-center gap-3 px-3 py-2 rounded-lg border border-[#1e1e2e] bg-[#0d0d14]"
                  role="status"
                  aria-label={`Set quality score ${score.total} out of 100. ${scoreTooltip}`}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-[#64748b]">Score</span>
                    <span className={`text-lg font-bold tabular-nums leading-none ${scoreColor.split(' ')[0]}`}>{score.total}</span>
                  </div>
                  <div className="w-px h-9 bg-[#1e1e2e]" />
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] text-[#64748b]">Harmonic</span>
                      <span className="text-[10px] font-semibold text-[#e2e8f0]">{Math.round((1 - score.harmonicRate) * 100)}%</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] text-[#64748b]">Energy</span>
                      <span className="text-[10px] font-semibold text-[#e2e8f0]">{Math.round((1 - score.avgEnergyError) * 100)}%</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] text-[#64748b]">BPM flow</span>
                      <span className="text-[10px] font-semibold text-[#e2e8f0]">{Math.round(score.bpmSmoothness * 100)}%</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center border-t border-[#1e1e2e]">
              <button
                onClick={() =>
                  setExpandedHistoryId(isExpanded ? null : entry.id)
                }
                className="flex-1 flex items-center gap-3 px-5 py-3 text-left hover:bg-[#0d0d14] transition-colors cursor-pointer"
              >
                <span className="text-[#7c3aed] text-sm font-medium">
                  {entry.tracks.length} tracks
                </span>
                <span className="text-xs text-[#475569]">{label}</span>
                <span className="text-[#475569] text-xs ml-auto">
                  {isExpanded ? "▲" : "▼"}
                </span>
              </button>
              {/* Load into generator */}
              <button
                onClick={() => onLoadEntry(entry)}
                title="Load into generator"
                className="border-l border-[#1e1e2e] shrink-0 flex items-center gap-1.5 px-4 py-3 text-xs text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#0d0d14] transition-colors cursor-pointer"
              >
                ↩ Load
              </button>
              <div
                ref={
                  openHistoryExportId === entry.id
                    ? historyExportRef
                    : null
                }
                className="relative border-l border-[#1e1e2e] shrink-0"
              >
                <button
                  onClick={() =>
                    setOpenHistoryExportId(
                      openHistoryExportId === entry.id
                        ? null
                        : entry.id,
                    )
                  }
                  className="flex items-center gap-1.5 px-4 py-3 text-xs text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#0d0d14] transition-colors cursor-pointer"
                >
                  Export <span className="text-[9px]">▾</span>
                </button>
                {openHistoryExportId === entry.id && (
                  <div className="absolute right-0 bottom-full mb-1 z-10 min-w-[175px] rounded-md border border-[#2a2a3a] bg-[#12121a] shadow-lg overflow-hidden">
                    <button
                      onClick={() => { downloadM3U(entry.tracks, `${entry.name}.m3u`); setOpenHistoryExportId(null); }}
                      className="w-full text-left flex items-center gap-2 px-3 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                    >
                      <M3UIcon size={13} className="shrink-0 opacity-60" />
                      Export as M3U
                    </button>
                    {showRekordboxExport && (
                    <button
                      onClick={() => {
                        downloadRekordboxXml(entry.tracks, entry.name, `${entry.name}.xml`);
                        setOpenHistoryExportId(null);
                      }}
                      className="w-full text-left flex items-center gap-2 px-3 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#1e1e2e]"
                    >
                      <RekordboxIcon size={13} className="shrink-0 opacity-60" />
                      Export to Rekordbox
                    </button>
                    )}
                    {startSpotifyExport && (
                      <button
                        onClick={() => {
                          void startSpotifyExport(entry.tracks, entry.name);
                          setOpenHistoryExportId(null);
                        }}
                        className="w-full text-left flex items-center gap-2 px-3 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#1e1e2e]"
                      >
                        <SpotifyIcon size={13} className="shrink-0 text-[#1db954]" />
                        Export to Spotify
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-[#1e1e2e]">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-[#0d0d14]">
                      <th className="py-2 pl-5 pr-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider w-10">
                        #
                      </th>
                      <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">
                        Track
                      </th>
                      <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">
                        BPM
                      </th>
                      <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">
                        Key
                      </th>
                      <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider">
                        Energy
                      </th>
                      <th className="py-2 px-2 pr-5 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider hidden xl:table-cell">
                        Genre
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.tracks.map((track, idx) => (
                      <tr
                        key={track.file}
                        className="group border-t border-[#1e1e2e] hover:bg-[#0d0d14]"
                      >
                        <td className="py-2.5 pl-5 pr-2 w-10">
                          <span className="group-hover:hidden text-xs text-[#475569] tabular-nums">
                            {idx + 1}
                          </span>
                          <button
                            onClick={() =>
                              void fetch("/api/play-in-music", {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  filePath: track.filePath,
                                  artist: track.artist,
                                  title: track.title,
                                }),
                              })
                            }
                            className="hidden group-hover:flex items-center justify-center text-[#7c3aed] hover:text-white cursor-pointer transition-colors"
                            title="Play in Apple Music"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                            >
                              <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                          </button>
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="text-sm text-[#e2e8f0] truncate max-w-xs">
                            {track.title}
                          </div>
                          <div className="text-[11px] text-[#475569] truncate">
                            {track.artist}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-sm text-[#94a3b8] tabular-nums">
                          {Math.round(track.bpm)}
                        </td>
                        <td className="py-2.5 px-2">
                          {track.camelot ? (
                            <span
                              className="inline-block px-2 py-0.5 rounded text-xs font-mono font-semibold"
                              style={{ backgroundColor: camelotColor(track.camelot) + '26', color: camelotColor(track.camelot), border: `1px solid ${camelotColor(track.camelot)}66` }}
                            >
                              {track.camelot}
                            </span>
                          ) : (
                            <span className="text-[#475569] text-sm">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-sm text-[#94a3b8] tabular-nums">
                          {Math.round(track.energy * 100)}%
                        </td>
                        <td className="py-2.5 px-2 pr-5 hidden xl:table-cell">
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
