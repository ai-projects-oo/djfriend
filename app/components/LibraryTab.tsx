import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import type { Song } from "../types";
import LibraryStatsBar from "./LibraryStatsBar";
import LibraryPlayer from "./LibraryPlayer";
import TrackInfoModal from "./TrackInfoModal";
import { camelotColor } from "../lib/camelotColors";
import { apiFetch } from "../lib/apiFetch";
import { downloadM3U } from "../lib/m3uExport";
import { patchTrackMeta } from "../lib/trackMeta";
import type { SetTrack } from "../types";
import { BEATPORT_UMBRELLAS } from "../lib/genreUtils";

// BPM ranges by genre category — used as re-analyze hints
const GENRE_BPM_PRESETS: Record<string, { min: number; max: number }> = {
  'Afro House':             { min: 118, max: 126 },
  'Amapiano':               { min: 110, max: 118 },
  'Ambient / Experimental': { min:  60, max: 100 },
  'Bass House':             { min: 124, max: 132 },
  'Breaks / Breakbeat':     { min: 120, max: 140 },
  'Deep House':             { min: 116, max: 126 },
  'Downtempo':              { min:  70, max: 110 },
  'Drum & Bass':            { min: 160, max: 180 },
  'Dubstep':                { min: 138, max: 145 },
  'Electro':                { min: 120, max: 135 },
  'Funky House':            { min: 120, max: 130 },
  'Hard Dance / Hardcore':  { min: 145, max: 170 },
  'Hard Techno':            { min: 140, max: 155 },
  'House':                  { min: 120, max: 132 },
  'Indie Dance':            { min: 118, max: 128 },
  'Jackin House':           { min: 122, max: 130 },
  'Melodic House & Techno': { min: 120, max: 132 },
  'Minimal / Deep Tech':    { min: 120, max: 132 },
  'Nu Disco / Disco':       { min: 100, max: 125 },
  'Organic House':          { min: 110, max: 122 },
  'Progressive House':      { min: 126, max: 134 },
  'Psy-Trance':             { min: 138, max: 150 },
  'Tech House':             { min: 124, max: 134 },
  'Techno':                 { min: 130, max: 148 },
  'Trance':                 { min: 128, max: 142 },
  'Trap / Future Bass':     { min:  60, max:  90 },
  'UK Garage / Bassline':   { min: 130, max: 140 },
  'Hip-Hop':                { min:  70, max: 110 },
  'R&B':                    { min:  60, max: 100 },
  'Latin':                  { min:  80, max: 110 },
  'Afrobeats':              { min:  90, max: 115 },
  'Pop':                    { min:  90, max: 130 },
  'Rock':                   { min:  90, max: 140 },
};

function detectGenrePreset(selectedSongs: Song[]): { min: number; max: number } | null {
  const counts: Record<string, number> = {};
  for (const song of selectedSongs) {
    for (const umbrella of BEATPORT_UMBRELLAS) {
      if (song.genres.some(g => umbrella.phrases.some(p => g.toLowerCase().includes(p)))) {
        counts[umbrella.label] = (counts[umbrella.label] ?? 0) + 1;
      }
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  return GENRE_BPM_PRESETS[top[0]] ?? null;
}

function toSetTrack(s: Song): SetTrack { return { ...s, slot: 0, targetEnergy: s.energy, harmonicWarning: false }; }

// ─── Types ────────────────────────────────────────────────────────────────────

type SortKey = "title" | "artist" | "bpm" | "key" | "energy" | "duration" | "year" | "dateAdded" | "genres" | "comment";
type OptionalCol = "duration" | "year" | "comment" | "dateAdded" | "vibeTags" | "moodTags" | "vocalType";

const OPTIONAL_COLS: { key: OptionalCol; label: string; ai?: boolean }[] = [
  { key: "duration",  label: "Duration" },
  { key: "year",      label: "Year" },
  { key: "comment",   label: "Comment" },
  { key: "dateAdded", label: "Date Added" },
  { key: "vibeTags",  label: "Vibe Tags",  ai: true },
  { key: "moodTags",  label: "Mood Tags",  ai: true },
  { key: "vocalType", label: "Vocal Type", ai: true },
];

const LS_KEY = "djfriend:libraryColumns";

interface ColFilters {
  bpmMin: string; bpmMax: string; key: string;
  energyMin: number; energyMax: number; genre: string; missingOnly: boolean;
}
const DEFAULT_FILTERS: ColFilters = { bpmMin: "", bpmMax: "", key: "", energyMin: 0, energyMax: 100, genre: "", missingOnly: false };

interface ContextMenu { x: number; y: number; song: Song }

interface Props {
  library: Song[];
  isInitializing?: boolean;
  onUpdateTrack: (file: string, patch: { artist?: string; title?: string; genres?: string[]; year?: number; comment?: string }) => void;
  onReanalyzed?: (file: string, update: { bpm: number; key: string; camelot: string; energy: number }) => void;
  onRemoveTracks?: (files: string[]) => void;
  onSendToGenerator?: (files: string[]) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function AiBadge() {
  return <span className="text-[8px] font-bold px-0.5 py-px rounded bg-[#7c3aed]/20 text-[#a78bfa] border border-[#7c3aed]/30 leading-none">AI</span>;
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function energyColor(e: number): string {
  if (e >= 0.75) return "#a855f7";
  if (e >= 0.5)  return "#3b82f6";
  if (e >= 0.25) return "#22c55e";
  return "#64748b";
}

function dupKey(s: Song): string {
  return `${s.artist.trim().toLowerCase()}|${s.title.trim().toLowerCase()}`;
}

function hasActiveFilters(f: ColFilters): boolean {
  return f.bpmMin !== "" || f.bpmMax !== "" || f.key !== "" || f.energyMin !== 0 || f.energyMax !== 100 || f.genre !== "" || f.missingOnly;
}

// ─── Album art ───────────────────────────────────────────────────────────────

function AlbumArt({ filePath }: { filePath?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!filePath || failed) return;
    let alive = true;
    fetch(`/api/album-art?path=${encodeURIComponent(filePath)}`)
      .then(r => { if (!alive || !r.ok) { setFailed(true); return; } return r.blob(); })
      .then(blob => { if (!alive || !blob) return; setSrc(URL.createObjectURL(blob)); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [filePath, failed]);

  if (!src || failed) {
    return <div className="w-8 h-8 rounded bg-[#1e1e2e] flex items-center justify-center flex-shrink-0"><span className="text-[10px] text-[#374151]">♪</span></div>;
  }
  return <img src={src} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />;
}

// ─── Sort header ─────────────────────────────────────────────────────────────

function SortHeader({ col, label, sortKey, sortAsc, onSort }: { col: SortKey; label: string; sortKey: SortKey; sortAsc: boolean; onSort: (k: SortKey) => void }) {
  return (
    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold text-[#4b5568] cursor-pointer hover:text-[#94a3b8] select-none transition-colors whitespace-nowrap" onClick={() => onSort(col)}>
      {label}{sortKey === col ? (sortAsc ? " ↑" : " ↓") : ""}
    </th>
  );
}

// ─── Context menu ─────────────────────────────────────────────────────────────

function RowContextMenu({ menu, onGetInfo, onPlay, onReanalyze, onSendToGenerator, onDelete, onExportM3U, onClose }: {
  menu: ContextMenu;
  onGetInfo: (s: Song) => void;
  onPlay: (s: Song) => void;
  onReanalyze: (s: Song) => void;
  onSendToGenerator?: (files: string[]) => void;
  onDelete: (s: Song) => void;
  onExportM3U: (s: Song) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [onClose]);

  const item = (label: string, onClick: () => void, danger = false) => (
    <button type="button" className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer rounded ${danger ? "text-[#ef4444]/80 hover:bg-[#ef4444]/10 hover:text-[#ef4444]" : "text-[#94a3b8] hover:bg-[#1e1e2e] hover:text-[#e2e8f0]"}`} onClick={() => { onClick(); onClose(); }}>{label}</button>
  );
  const sep = () => <div className="my-1 border-t border-[#1e1e2e]" />;

  return (
    <div ref={ref} className="fixed z-[100] bg-[#12121a] border border-[#2a2a3a] rounded-xl shadow-2xl py-1 min-w-[180px]" style={{ top: menu.y, left: menu.x }}>
      {item("Play", () => onPlay(menu.song))}
      {item("Get Info", () => onGetInfo(menu.song))}
      {sep()}
      {item("Re-analyze Audio", () => onReanalyze(menu.song))}
      {item("Export as M3U", () => onExportM3U(menu.song))}
      {onSendToGenerator && item("Send to Set Generator", () => onSendToGenerator([menu.song.file]))}
      {sep()}
      {item("Delete from Library", () => onDelete(menu.song), true)}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LibraryTab({ library, isInitializing, onUpdateTrack, onReanalyzed, onRemoveTracks, onSendToGenerator }: Props) {
  const [sortKey, setSortKey]   = useState<SortKey>("artist");
  const [sortAsc, setSortAsc]   = useState(true);
  const [search, setSearch]     = useState("");
  const [visibleCols, setVisibleCols] = useState<Set<OptionalCol>>(() => {
    try { const s = localStorage.getItem(LS_KEY); return s ? new Set(JSON.parse(s) as OptionalCol[]) : new Set(["duration", "comment"] as OptionalCol[]); }
    catch { return new Set(["duration", "comment"] as OptionalCol[]); }
  });
  const [colMenuOpen, setColMenuOpen]   = useState(false);
  const [filtersOpen, setFiltersOpen]   = useState(false);
  const [filters, setFilters]           = useState<ColFilters>(DEFAULT_FILTERS);
  const [dupsOpen, setDupsOpen]         = useState(false);
  const [reanalyzing, setReanalyzing]   = useState<Set<string>>(new Set());
  const [deleting, setDeleting]         = useState(false);
  const [dupSelections, setDupSelections] = useState<Record<string, Set<string>>>({});
  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [bulkBpmOpen, setBulkBpmOpen]   = useState(false);
  const [bulkBpmMin, setBulkBpmMin]     = useState('');
  const [bulkBpmMax, setBulkBpmMax]     = useState('');
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [infoSong, setInfoSong]         = useState<Song | null>(null);
  const [contextMenu, setContextMenu]   = useState<ContextMenu | null>(null);
  const [nowPlaying, setNowPlaying]     = useState<Song | null>(null);
  const lastClickedIdx = useRef<number>(-1);

  const colMenuRef  = useRef<HTMLDivElement>(null);
  const missingRowRef = useRef<HTMLTableRowElement>(null);

  const uniqueKeys = useMemo(() => {
    const keys = new Set(library.map(s => s.camelot).filter(k => k && k !== "Unknown"));
    return [...keys].sort((a, b) => { const na = parseInt(a); const nb = parseInt(b); return na !== nb ? na - nb : a.localeCompare(b); });
  }, [library]);

  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify([...visibleCols])); }, [visibleCols]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) setColMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const toggleCol = (key: OptionalCol) => {
    setVisibleCols(prev => { const n = new Set(prev); if (n.has(key)) { n.delete(key); } else { n.add(key); } return n; });
  };

  const dupGroups = useMemo(() => {
    const groups: Record<string, Song[]> = {};
    for (const s of library) { const k = dupKey(s); (groups[k] ??= []).push(s); }
    return Object.values(groups).filter(g => g.length > 1);
  }, [library]);

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    const bpmMin = filters.bpmMin !== "" ? parseFloat(filters.bpmMin) : null;
    const bpmMax = filters.bpmMax !== "" ? parseFloat(filters.bpmMax) : null;
    const eMin = filters.energyMin / 100;
    const eMax = filters.energyMax / 100;
    const gq = filters.genre.toLowerCase();
    const filtered = library.filter(s => {
      if (q && !s.title.toLowerCase().includes(q) && !s.artist.toLowerCase().includes(q)) return false;
      if (bpmMin !== null && s.bpm < bpmMin) return false;
      if (bpmMax !== null && s.bpm > bpmMax) return false;
      if (filters.key && s.camelot !== filters.key) return false;
      if (s.energy < eMin || s.energy > eMax) return false;
      if (gq && !s.genres.some(g => g.toLowerCase().includes(gq))) return false;
      if (filters.missingOnly && s.bpm > 0 && s.key && s.key !== "Unknown" && s.genres.length > 0) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "title":     cmp = a.title.localeCompare(b.title); break;
        case "artist":    cmp = a.artist.localeCompare(b.artist); break;
        case "bpm":       cmp = a.bpm - b.bpm; break;
        case "key":       cmp = a.camelot.localeCompare(b.camelot); break;
        case "energy":    cmp = a.energy - b.energy; break;
        case "duration":  cmp = (a.duration ?? 0) - (b.duration ?? 0); break;
        case "year":      cmp = (a.year ?? 0) - (b.year ?? 0); break;
        case "dateAdded": cmp = (a.dateAdded ?? 0) - (b.dateAdded ?? 0); break;
        case "genres":    cmp = (a.genres[0] ?? "").localeCompare(b.genres[0] ?? ""); break;
        case "comment":   cmp = (a.comment ?? "").localeCompare(b.comment ?? ""); break;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [library, search, filters, sortKey, sortAsc]);

  const firstMissingIdx = useMemo(() => rows.findIndex(s => s.bpm === 0 || !s.key || s.key === "Unknown" || s.genres.length === 0), [rows]);
  const handleSort = (key: SortKey) => { if (sortKey === key) setSortAsc(a => !a); else { setSortKey(key); setSortAsc(true); } };

  // ── Row selection (no checkboxes — macOS style) ────────────────────────────
  const handleRowClick = useCallback((e: React.MouseEvent, song: Song, idx: number) => {
    if (e.metaKey || e.ctrlKey) {
      // Toggle individual
      setSelected(prev => { const n = new Set(prev); if (n.has(song.file)) { n.delete(song.file); } else { n.add(song.file); } return n; });
      lastClickedIdx.current = idx;
    } else if (e.shiftKey && lastClickedIdx.current >= 0) {
      // Range select
      const from = Math.min(lastClickedIdx.current, idx);
      const to   = Math.max(lastClickedIdx.current, idx);
      setSelected(new Set(rows.slice(from, to + 1).map(r => r.file)));
    } else {
      // Single select (deselect all others)
      setSelected(new Set([song.file]));
      lastClickedIdx.current = idx;
    }
  }, [rows]);

  const handleSave = useCallback(async (file: string, patch: { artist?: string; title?: string; genres?: string[]; year?: number; comment?: string }) => {
    await patchTrackMeta(file, patch);
    onUpdateTrack(file, patch);
  }, [onUpdateTrack]);

  const handleReanalyze = useCallback(async (song: Song) => {
    setReanalyzing(prev => new Set(prev).add(song.file));
    try {
      const res = await apiFetch("/api/reanalyze-track", { method: "POST", body: JSON.stringify({ filePath: song.filePath ?? song.file }) });
      const data = await res.json() as { ok: boolean; bpm: number; key: string; camelot: string; energy: number };
      if (data.ok) onReanalyzed?.(song.file, data);
    } catch { /* non-fatal */ }
    setReanalyzing(prev => { const n = new Set(prev); n.delete(song.file); return n; });
  }, [onReanalyzed]);

  const handleDeleteSingle = useCallback(async (song: Song) => {
    try { await apiFetch("/api/remove-tracks", { method: "POST", body: JSON.stringify({ files: [song.file] }) }); onRemoveTracks?.([song.file]); }
    catch { /* non-fatal */ }
  }, [onRemoveTracks]);

  const handleExportM3U = useCallback((song: Song) => { downloadM3U([toSetTrack(song)], `${song.artist} - ${song.title}`); }, []);

  const handleExportSelectedM3U = useCallback(() => {
    const tracks = rows.filter(s => selected.has(s.file)).map(toSetTrack);
    if (!tracks.length) return;
    downloadM3U(tracks, `DJFriend Selection (${tracks.length} tracks)`);
  }, [rows, selected]);

  const toggleDupSelection = (gk: string, file: string) => {
    setDupSelections(prev => { const s = new Set(prev[gk] ?? []); if (s.has(file)) { s.delete(file); } else { s.add(file); } return { ...prev, [gk]: s }; });
  };

  const handleDeleteDups = useCallback(async (gk: string) => {
    const files = [...(dupSelections[gk] ?? [])];
    if (!files.length) return;
    setDeleting(true);
    try { await apiFetch("/api/remove-tracks", { method: "POST", body: JSON.stringify({ files }) }); onRemoveTracks?.(files); setDupSelections(prev => { const n = { ...prev }; delete n[gk]; return n; }); }
    catch { /* non-fatal */ }
    setDeleting(false);
  }, [dupSelections, onRemoveTracks]);

  const handleRowContextMenu = (e: React.MouseEvent, song: Song) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 200);
    setContextMenu({ x, y, song });
  };

  const nowPlayingIdx = nowPlaying ? rows.findIndex(s => s.file === nowPlaying.file) : -1;
  const sh = { sortKey, sortAsc, onSort: handleSort };
  const activeFilters = hasActiveFilters(filters);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isInitializing && library.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
            <circle cx="26" cy="26" r="22" stroke="#1e1e2e" strokeWidth="4" />
            <circle cx="26" cy="26" r="22" stroke="#7c3aed" strokeWidth="4" strokeLinecap="round"
              strokeDasharray="138.2" strokeDashoffset="103.7"
              style={{ transformOrigin: "26px 26px", animation: "spin 1.1s linear infinite" }} />
          </svg>
          <p className="text-sm text-[#475569]">Loading library…</p>
        </div>
      </div>
    );
  }

  if (!isInitializing && library.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <span className="text-3xl">🎵</span>
        <p className="text-sm text-[#475569]">No library loaded yet.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Fixed top section ─────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 pt-3">
        <LibraryStatsBar songs={library} onScrollToMissing={() => missingRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })} />
      </div>

      {/* Player */}
      <LibraryPlayer
        song={nowPlaying}
        onPrev={nowPlayingIdx > 0 ? () => setNowPlaying(rows[nowPlayingIdx - 1]) : undefined}
        onNext={nowPlayingIdx >= 0 && nowPlayingIdx < rows.length - 1 ? () => setNowPlaying(rows[nowPlayingIdx + 1]) : undefined}
      />

      {/* Duplicates banner */}
      {dupGroups.length > 0 && (
        <div className="flex-shrink-0 mx-4 mt-2 rounded-xl border border-[#ef4444]/30 bg-[#ef4444]/5 overflow-hidden">
          <button type="button" className="w-full flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-[#ef4444]/5 transition-colors" onClick={() => setDupsOpen(o => !o)}>
            <span className="text-[#ef4444]/80 text-xs">⚠</span>
            <span className="text-xs font-semibold text-[#ef4444]/80">{dupGroups.length} duplicate group{dupGroups.length > 1 ? "s" : ""} found</span>
            <span className="ml-auto text-[10px] text-[#ef4444]/50">{dupsOpen ? "▲" : "▼"}</span>
          </button>
          {dupsOpen && (
            <div className="border-t border-[#ef4444]/20 divide-y divide-[#1e1e2e] max-h-48 overflow-y-auto">
              {dupGroups.map(group => {
                const gk = dupKey(group[0]);
                const sel = dupSelections[gk] ?? new Set<string>();
                return (
                  <div key={gk} className="px-4 py-3">
                    <p className="text-xs font-semibold text-[#e2e8f0] mb-2">{group[0].artist} — {group[0].title}</p>
                    <div className="flex flex-col gap-1.5 mb-2.5">
                      {group.map(s => (
                        <label key={s.file} className="flex items-center gap-3 cursor-pointer group/dup">
                          <input type="checkbox" checked={sel.has(s.file)} onChange={() => toggleDupSelection(gk, s.file)} className="w-3.5 h-3.5 accent-[#ef4444] cursor-pointer flex-shrink-0" />
                          <span className={`text-[10px] font-mono truncate flex-1 transition-colors ${sel.has(s.file) ? "text-[#ef4444]/70 line-through" : "text-[#475569] group-hover/dup:text-[#94a3b8]"}`} title={s.filePath ?? s.file}>{s.filePath ?? s.file}</span>
                          <span className="text-[10px] text-[#374151] whitespace-nowrap">{s.bpm} BPM · {s.duration != null ? fmt(s.duration) : "—"}</span>
                        </label>
                      ))}
                    </div>
                    {sel.size > 0 && (
                      <button type="button" disabled={deleting} onClick={() => handleDeleteDups(gk)} className="text-[10px] px-2.5 py-1 rounded-md border border-[#ef4444]/40 text-[#ef4444]/80 hover:bg-[#ef4444]/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                        {deleting ? "Deleting…" : `Delete ${sel.size} selected`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Selection toolbar */}
      {selected.size > 0 && (
        <div className="flex-shrink-0 mx-4 mt-2 flex flex-col gap-2 px-3 py-2 rounded-xl bg-[#7c3aed]/10 border border-[#7c3aed]/30">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-[#a78bfa]">{selected.size} track{selected.size > 1 ? "s" : ""} selected</span>
            {onSendToGenerator && (
              <button type="button" onClick={() => { onSendToGenerator([...selected]); setSelected(new Set()); }} className="text-xs px-2.5 py-1 rounded-md bg-[#7c3aed] text-white hover:bg-[#6d28d9] transition-colors cursor-pointer">
                Use in Set Generator
              </button>
            )}
            <button
              type="button"
              disabled={!!bulkProgress}
              onClick={async () => {
                if (bulkBpmOpen) { setBulkBpmOpen(false); return; }
                // Re-analyze without BPM range
                const files = [...selected];
                setBulkProgress({ done: 0, total: files.length });
                for (let i = 0; i < files.length; i++) {
                  const song = library.find(s => s.file === files[i]);
                  if (!song) { setBulkProgress({ done: i + 1, total: files.length }); continue; }
                  try {
                    const res = await apiFetch('/api/reanalyze-track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: song.filePath ?? song.file }) });
                    if (res.ok) {
                      const d = await res.json() as { ok?: boolean; bpm?: number; key?: string; camelot?: string; energy?: number };
                      if (d.ok && d.bpm != null && d.key != null && d.camelot != null && d.energy != null) {
                        onReanalyzed?.(song.file, { bpm: d.bpm, key: d.key, camelot: d.camelot, energy: d.energy });
                      }
                    }
                  } catch { /* ignore */ }
                  setBulkProgress({ done: i + 1, total: files.length });
                }
                setBulkProgress(null);
              }}
              className="text-xs px-2.5 py-1 rounded-md border border-[#1e1e2e] text-[#64748b] hover:text-[#94a3b8] hover:border-[#374151] transition-colors cursor-pointer disabled:opacity-50"
            >
              {bulkProgress ? `Re-analyzing ${bulkProgress.done}/${bulkProgress.total}…` : 'Re-analyze'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!bulkBpmOpen) {
                  // Auto-detect BPM range from selected tracks' genres
                  const selectedSongs = [...selected].map(f => library.find(s => s.file === f)).filter((s): s is Song => s != null);
                  const preset = detectGenrePreset(selectedSongs);
                  if (preset) { setBulkBpmMin(String(preset.min)); setBulkBpmMax(String(preset.max)); }
                }
                setBulkBpmOpen(o => !o);
              }}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${bulkBpmOpen ? 'border-[#7c3aed]/60 text-[#a78bfa] bg-[#7c3aed]/10' : 'border-[#1e1e2e] text-[#64748b] hover:text-[#94a3b8] hover:border-[#374151]'}`}
            >
              Re-analyze BPM range…
            </button>
            {([2, 0.5] as const).map(mult => (
              <button key={mult} type="button" disabled={!!bulkProgress}
                onClick={async () => {
                  const files = [...selected];
                  for (const f of files) {
                    const song = library.find(s => s.file === f);
                    if (!song || !(song.bpm > 0)) continue;
                    const newBpm = Math.round(song.bpm * mult * 10) / 10;
                    try {
                      await apiFetch('/api/track-meta', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: f, patch: { bpm: newBpm } }) });
                      onReanalyzed?.(f, { bpm: newBpm, key: song.key ?? '', camelot: song.camelot ?? '', energy: song.energy ?? 0 });
                    } catch { /* ignore */ }
                  }
                }}
                className="text-xs px-2.5 py-1 rounded-md border border-[#1e1e2e] text-[#64748b] hover:text-[#a78bfa] hover:border-[#7c3aed]/40 transition-colors cursor-pointer disabled:opacity-50 tabular-nums">
                {mult === 2 ? '×2 BPM' : '÷2 BPM'}
              </button>
            ))}
            <button type="button" onClick={handleExportSelectedM3U} className="text-xs px-2.5 py-1 rounded-md border border-[#1e1e2e] text-[#64748b] hover:text-[#94a3b8] hover:border-[#374151] transition-colors cursor-pointer">
              Export M3U
            </button>
            <button type="button" onClick={() => { setSelected(new Set()); setBulkBpmOpen(false); }} className="ml-auto text-[10px] text-[#6b7280] hover:text-[#94a3b8] transition-colors cursor-pointer">Clear</button>
          </div>
          {bulkBpmOpen && (
            <div className="flex flex-col gap-2 pt-2 border-t border-[#7c3aed]/20">
              {/* Genre presets */}
              <div className="flex flex-wrap gap-1">
                {Object.entries(GENRE_BPM_PRESETS).map(([label, range]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => { setBulkBpmMin(String(range.min)); setBulkBpmMax(String(range.max)); }}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer
                      ${bulkBpmMin === String(range.min) && bulkBpmMax === String(range.max)
                        ? 'border-[#7c3aed] text-[#a78bfa] bg-[#7c3aed]/15'
                        : 'border-[#2a2a3a] text-[#475569] hover:text-[#94a3b8] hover:border-[#374151]'}`}
                  >
                    {label} <span className="opacity-50">{range.min}–{range.max}</span>
                  </button>
                ))}
              </div>
              {/* Manual inputs + run */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-[#64748b]">BPM range</span>
                <input type="number" placeholder="Min" value={bulkBpmMin} onChange={e => setBulkBpmMin(e.target.value)}
                  className="w-16 rounded px-2 py-1 text-xs text-[#e2e8f0] bg-[#0d0d14] border border-[#2a2a3a] focus:outline-none focus:border-[#7c3aed] text-center" />
                <span className="text-[#4b5568] text-xs">–</span>
                <input type="number" placeholder="Max" value={bulkBpmMax} onChange={e => setBulkBpmMax(e.target.value)}
                  className="w-16 rounded px-2 py-1 text-xs text-[#e2e8f0] bg-[#0d0d14] border border-[#2a2a3a] focus:outline-none focus:border-[#7c3aed] text-center" />
                <button
                  type="button"
                  disabled={!!bulkProgress}
                  onClick={async () => {
                    const min = parseFloat(bulkBpmMin), max = parseFloat(bulkBpmMax);
                    if (isNaN(min) || isNaN(max) || min >= max) return;
                    const files = [...selected];
                    setBulkProgress({ done: 0, total: files.length });
                    for (let i = 0; i < files.length; i++) {
                      const song = library.find(s => s.file === files[i]);
                      if (!song) { setBulkProgress({ done: i + 1, total: files.length }); continue; }
                      try {
                        const res = await apiFetch('/api/reanalyze-track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: song.filePath ?? song.file, bpmMin: min, bpmMax: max }) });
                        if (res.ok) {
                          const d = await res.json() as { ok?: boolean; bpm?: number; key?: string; camelot?: string; energy?: number };
                          if (d.ok && d.bpm != null && d.key != null && d.camelot != null && d.energy != null) {
                            onReanalyzed?.(song.file, { bpm: d.bpm, key: d.key, camelot: d.camelot, energy: d.energy });
                          }
                        }
                      } catch { /* ignore */ }
                      setBulkProgress({ done: i + 1, total: files.length });
                    }
                    setBulkProgress(null);
                    setBulkBpmOpen(false);
                  }}
                  className="px-2.5 py-1 text-[10px] rounded border border-[#7c3aed] text-[#a78bfa] hover:bg-[#7c3aed]/10 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {bulkProgress ? `${bulkProgress.done}/${bulkProgress.total}…` : 'Re-analyze'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search + filter + columns */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2">
        <input type="text" placeholder="Search title or artist…" value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-[#12121a] border border-[#1e1e2e] rounded-lg px-3 py-1.5 text-sm text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] transition-colors" />
        {(search || activeFilters) && <span className="text-[10px] text-[#475569] whitespace-nowrap">{rows.length} / {library.length}</span>}
        <button type="button" onClick={() => setFiltersOpen(o => !o)}
          className={`px-3 py-1.5 text-xs border rounded-lg transition-colors cursor-pointer flex-shrink-0 ${activeFilters ? "border-[#7c3aed]/60 text-[#a78bfa] bg-[#7c3aed]/10" : "border-[#1e1e2e] text-[#6b7280] hover:text-[#94a3b8]"}`}>
          Filter{activeFilters ? " ●" : ""}
        </button>
        <div className="relative flex-shrink-0" ref={colMenuRef}>
          <button type="button" onClick={() => setColMenuOpen(o => !o)} className="px-3 py-1.5 text-xs border border-[#1e1e2e] rounded-lg text-[#6b7280] hover:text-[#94a3b8] transition-colors cursor-pointer">Columns</button>
          {colMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-[#12121a] border border-[#2a2a3a] rounded-xl shadow-xl z-50 py-1 min-w-[150px]">
              {OPTIONAL_COLS.map(col => (
                <label key={col.key} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-[#1a1a2e] cursor-pointer">
                  <input type="checkbox" checked={visibleCols.has(col.key)} onChange={() => toggleCol(col.key)} className="w-3.5 h-3.5 accent-[#7c3aed] cursor-pointer" />
                  <span className="text-xs text-[#94a3b8] flex items-center gap-1.5">{col.label}{col.ai && <AiBadge />}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filter panel */}
      {filtersOpen && (
        <div className="flex-shrink-0 mx-4 rounded-xl border border-[#1e1e2e] bg-[#12121a] px-4 py-3 flex flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest font-semibold text-[#4b5568]">BPM</span>
            <div className="flex items-center gap-1">
              <input type="number" placeholder="Min" value={filters.bpmMin} onChange={e => setFilters(f => ({ ...f, bpmMin: e.target.value }))} className="w-16 bg-[#0d0d14] border border-[#1e1e2e] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed]" />
              <span className="text-[10px] text-[#374151]">–</span>
              <input type="number" placeholder="Max" value={filters.bpmMax} onChange={e => setFilters(f => ({ ...f, bpmMax: e.target.value }))} className="w-16 bg-[#0d0d14] border border-[#1e1e2e] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed]" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest font-semibold text-[#4b5568]">Key</span>
            <select value={filters.key} onChange={e => setFilters(f => ({ ...f, key: e.target.value }))} className="bg-[#0d0d14] border border-[#1e1e2e] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] cursor-pointer">
              <option value="">Any</option>
              {uniqueKeys.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest font-semibold text-[#4b5568]">Energy {filters.energyMin}–{filters.energyMax}</span>
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={100} value={filters.energyMin} onChange={e => setFilters(f => ({ ...f, energyMin: Math.min(Number(e.target.value), f.energyMax) }))} className="w-20 accent-[#7c3aed] cursor-pointer" />
              <input type="range" min={0} max={100} value={filters.energyMax} onChange={e => setFilters(f => ({ ...f, energyMax: Math.max(Number(e.target.value), f.energyMin) }))} className="w-20 accent-[#7c3aed] cursor-pointer" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest font-semibold text-[#4b5568]">Genre</span>
            <input type="text" placeholder="contains…" value={filters.genre} onChange={e => setFilters(f => ({ ...f, genre: e.target.value }))} className="w-28 bg-[#0d0d14] border border-[#1e1e2e] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed]" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest font-semibold text-[#4b5568]">Show</span>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={filters.missingOnly} onChange={e => setFilters(f => ({ ...f, missingOnly: e.target.checked }))} className="w-3.5 h-3.5 accent-[#7c3aed] cursor-pointer" />
              <span className="text-xs text-[#94a3b8]">Missing data only</span>
            </label>
          </div>
          {activeFilters && (
            <div className="flex flex-col justify-end">
              <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} className="text-[10px] text-[#6b7280] hover:text-[#94a3b8] transition-colors cursor-pointer">Clear filters</button>
            </div>
          )}
        </div>
      )}

      {/* ── Scrollable table ───────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto mt-2">
        <table className="w-full border-collapse">
          <thead className="bg-[#0a0a0f] sticky top-0 z-10">
            <tr className="border-b border-[#1e1e2e]">
              <th className="px-2 py-2 w-10" />
              <SortHeader col="title"     label="Title"    {...sh} />
              <SortHeader col="artist"    label="Artist"   {...sh} />
              <SortHeader col="bpm"       label="BPM"      {...sh} />
              <SortHeader col="key"       label="Key"      {...sh} />
              <SortHeader col="energy"    label="Energy"   {...sh} />
              <SortHeader col="genres"    label="Genres"   {...sh} />
              {visibleCols.has("duration")  && <SortHeader col="duration"  label="Duration"   {...sh} />}
              {visibleCols.has("year")      && <SortHeader col="year"      label="Year"       {...sh} />}
              {visibleCols.has("comment")   && <SortHeader col="comment"   label="Comment"    {...sh} />}
              {visibleCols.has("dateAdded") && <SortHeader col="dateAdded" label="Date Added" {...sh} />}
              {visibleCols.has("vibeTags")  && <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold text-[#4b5568]"><span className="flex items-center gap-1">Vibe <AiBadge /></span></th>}
              {visibleCols.has("moodTags")  && <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold text-[#4b5568]"><span className="flex items-center gap-1">Mood <AiBadge /></span></th>}
              {visibleCols.has("vocalType") && <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold text-[#4b5568]"><span className="flex items-center gap-1">Vocal <AiBadge /></span></th>}
              <th className="px-3 py-2 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e1e2e]">
            {rows.map((song, idx) => {
              const missingFields = [...(song.bpm === 0 ? ["BPM"] : []), ...(!song.key || song.key === "Unknown" ? ["Key"] : []), ...(song.genres.length === 0 ? ["Genres"] : [])];
              const isMissing   = missingFields.length > 0;
              const isFirst     = idx === firstMissingIdx;
              const analyzing   = reanalyzing.has(song.file);
              const isSelected  = selected.has(song.file);
              const isPlaying   = nowPlaying?.file === song.file;
              const cc = camelotColor(song.camelot);
              return (
                <tr
                  key={song.file}
                  ref={isFirst ? missingRowRef : undefined}
                  className={`group transition-colors cursor-default select-none ${isMissing ? "border-l-2 border-[#ef4444]/40" : ""} ${isSelected ? "bg-[#7c3aed]/10" : isPlaying ? "bg-[#7c3aed]/5" : "hover:bg-[#0d0d14]"}`}
                  onClick={e => handleRowClick(e, song, idx)}
                  onDoubleClick={() => { setNowPlaying(song); }}
                  onContextMenu={e => handleRowContextMenu(e, song)}
                >
                  {/* Play indicator / album art */}
                  <td className="px-2 py-1.5 relative">
                    <AlbumArt filePath={song.filePath} />
                    {isPlaying && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded">
                        <span className="text-[#7c3aed] text-xs">▶</span>
                      </div>
                    )}
                  </td>
                  {/* Title + missing chips */}
                  <td className="px-3 py-1.5 max-w-[200px]">
                    <span className="text-sm text-[#cbd5e1] block truncate">{song.title || "—"}</span>
                    {isMissing && (
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        {missingFields.map(f => <span key={f} className="text-[9px] px-1 py-0.5 rounded bg-[#ef4444]/10 text-[#ef4444]/70 border border-[#ef4444]/20 leading-none">No {f}</span>)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 max-w-[160px]"><span className="text-sm text-[#94a3b8] block truncate">{song.artist || "—"}</span></td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className={`text-xs tabular-nums font-medium ${song.bpm === 0 ? "text-[#ef4444]/70" : "text-[#94a3b8]"}`}>{song.bpm === 0 ? "—" : Math.round(song.bpm)}</span>
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {song.camelot && song.camelot !== "Unknown"
                      ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: cc + "26", color: cc, border: `1px solid ${cc}66` }} title={song.key}>{song.camelot}</span>
                      : <span className="text-[10px] text-[#ef4444]/60">—</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.round(song.energy * 100)}%`, backgroundColor: energyColor(song.energy) }} />
                      </div>
                      <span className="text-[10px] text-[#475569] tabular-nums w-6">{Math.round(song.energy * 100)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 max-w-[180px]"><span className="text-xs text-[#64748b] block truncate">{song.genres.join(", ") || "—"}</span></td>
                  {visibleCols.has("duration")  && <td className="px-3 py-1.5 whitespace-nowrap"><span className="text-xs text-[#475569] tabular-nums">{song.duration != null ? fmt(song.duration) : "—"}</span></td>}
                  {visibleCols.has("year")      && <td className="px-3 py-1.5 whitespace-nowrap"><span className="text-xs text-[#475569] tabular-nums">{song.year ?? "—"}</span></td>}
                  {visibleCols.has("comment")   && <td className="px-3 py-1.5 max-w-[200px]"><span className="text-xs text-[#475569] block truncate" title={song.comment}>{song.comment || "—"}</span></td>}
                  {visibleCols.has("dateAdded") && <td className="px-3 py-1.5 whitespace-nowrap"><span className="text-xs text-[#475569] tabular-nums">{song.dateAdded != null ? fmtDate(song.dateAdded) : "—"}</span></td>}
                  {visibleCols.has("vibeTags")  && <td className="px-3 py-1.5 max-w-[140px]"><span className="text-[10px] text-[#64748b] block truncate">{song.semanticTags?.vibeTags.join(", ") || "—"}</span></td>}
                  {visibleCols.has("moodTags")  && <td className="px-3 py-1.5 max-w-[140px]"><span className="text-[10px] text-[#64748b] block truncate">{song.semanticTags?.moodTags.join(", ") || "—"}</span></td>}
                  {visibleCols.has("vocalType") && <td className="px-3 py-1.5 whitespace-nowrap"><span className="text-[10px] text-[#64748b]">{song.semanticTags?.vocalType ?? "—"}</span></td>}
                  {/* Re-analyze */}
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      disabled={analyzing}
                      onClick={e => { e.stopPropagation(); handleReanalyze(song); }}
                      className={`transition-opacity text-[#475569] hover:text-[#94a3b8] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${isMissing || analyzing ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                      title={isMissing ? `Re-analyze to fix: ${missingFields.join(", ")}` : "Re-analyze audio"}
                    >
                      <span
                        className="text-sm inline-block"
                        style={analyzing ? { animation: "spin 1s linear infinite", animationDirection: "reverse" } : undefined}
                      >↺</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Get Info modal */}
      {infoSong && (
        <TrackInfoModal key={infoSong.file} song={infoSong} library={library} onClose={() => setInfoSong(null)} onSave={handleSave} onNavigate={setInfoSong} />
      )}

      {/* Context menu */}
      {contextMenu && (
        <RowContextMenu
          menu={contextMenu}
          onGetInfo={s => setInfoSong(s)}
          onPlay={s => setNowPlaying(s)}
          onReanalyze={handleReanalyze}
          onSendToGenerator={onSendToGenerator}
          onDelete={handleDeleteSingle}
          onExportM3U={handleExportM3U}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
