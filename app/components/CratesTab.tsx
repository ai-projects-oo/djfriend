import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { DiscogsCollectionEntry, DiscogsRelease, Song, VinylTrackEntry, VinylReleaseData } from '../types';
import { SpotifyIcon, DiscogsIcon, BeatportIcon, TraxsourceIcon } from './Icons';
import type { ManualData } from '../lib/discogsManualData';
import { saveManualData, saveRejected } from '../lib/discogsManualData';
import { loadVinylStore, saveVinylStore, nextPosition, type VinylStore } from '../lib/vinylTracks';

const CAMELOT_RE = /^(1[0-2]|[1-9])[AB]$/i;

function printSticker(opts: {
  artist: string; title: string; year?: number;
  bpm?: number; camelot?: string; genres: string[]; styles: string[];
  comment?: string; thumb?: string;
}) {
  const { artist, title, year, bpm, camelot, genres, styles, comment, thumb } = opts;
  const genre = [...genres.slice(0, 2), ...styles.slice(0, 1)].join(' · ');
  const win = window.open('', '_blank', 'width=600,height=400');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sticker</title><style>
    @page { size: 3.5in 2in; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { width: 3.5in; height: 2in; font-family: 'Helvetica Neue', Arial, sans-serif;
           background: #fff; display: flex; align-items: stretch; overflow: hidden; }
    .thumb { width: 1.4in; min-width: 1.4in; background: #111;
             display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; }
    .vinyl-icon { opacity: 0.25; }
    .info { flex: 1; padding: 0.18in 0.16in; display: flex; flex-direction: column; gap: 0.04in; }
    .artist { font-size: 10pt; font-weight: 700; color: #111; line-height: 1.2;
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .title  { font-size: 8.5pt; color: #333; line-height: 1.2;
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tags   { margin-top: 0.06in; display: flex; gap: 0.06in; align-items: center; flex-wrap: wrap; }
    .badge  { font-size: 7pt; font-weight: 600; border: 1px solid #111; border-radius: 3px;
              padding: 1px 5px; white-space: nowrap; }
    .bpm    { font-size: 7pt; color: #333; white-space: nowrap; }
    .genre  { font-size: 6.5pt; color: #555; margin-top: 0.04in;
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .comment { font-size: 6.5pt; color: #444; margin-top: auto; padding-top: 0.05in;
               border-top: 0.5px solid #ddd; font-style: italic;
               overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .logo   { font-size: 5pt; color: #bbb; margin-top: auto; text-align: right; letter-spacing: 0.03em; }
  </style></head><body>
  <div class="thumb">
    ${thumb
      ? `<img src="${thumb}" />`
      : `<svg class="vinyl-icon" viewBox="0 0 80 80" width="64" height="64" fill="#888">
           <circle cx="40" cy="40" r="38"/><circle cx="40" cy="40" r="28" fill="#fff"/>
           <circle cx="40" cy="40" r="24" fill="#888"/><circle cx="40" cy="40" r="16" fill="#fff"/>
           <circle cx="40" cy="40" r="12" fill="#888"/><circle cx="40" cy="40" r="4" fill="#fff"/>
         </svg>`}
  </div>
  <div class="info">
    <div class="artist">${artist}</div>
    <div class="title">${title}</div>
    <div class="tags">
      ${camelot ? `<span class="badge">${camelot}</span>` : ''}
      ${bpm     ? `<span class="bpm">${bpm} BPM</span>` : ''}
      ${year    ? `<span class="bpm">${year}</span>` : ''}
    </div>
    ${genre   ? `<div class="genre">${genre}</div>` : ''}
    ${comment ? `<div class="comment">${comment}</div>` : ''}
    <div class="logo">DJFriend</div>
  </div>
  </body></html>`);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

type Filter  = 'all' | 'in-library' | 'not-in-library';
type SortKey = 'artist' | 'title' | 'year';

interface Props {
  collection:          DiscogsCollectionEntry | null;
  onSync:              () => void;
  syncPhase:           'idle' | 'syncing' | 'done' | 'error';
  syncMessage?:        string;
  hasOAuth:            boolean;
  hasSpotify?:         boolean;
  library:             Song[];
  manualData:          Map<number, ManualData>;
  onManualDataChange:  (m: Map<number, ManualData>) => void;
  rejectedMatches:     Set<number>;
  onRejectedChange:    (s: Set<number>) => void;
}

function VinylPlaceholder() {
  return (
    <div className="w-full h-full bg-[#0d0d14] flex items-center justify-center">
      <svg viewBox="0 0 80 80" className="w-3/5 h-3/5" fill="currentColor">
        <circle cx="40" cy="40" r="38" fill="#3f3f5a" />
        <circle cx="40" cy="40" r="28" fill="#0d0d14" />
        <circle cx="40" cy="40" r="24" fill="#2a2a40" />
        <circle cx="40" cy="40" r="16" fill="#0d0d14" />
        <circle cx="40" cy="40" r="12" fill="#3a3a52" />
        <circle cx="40" cy="40" r="4"  fill="#0d0d14" />
      </svg>
    </div>
  );
}

function proxyThumb(url?: string): string | undefined {
  if (!url) return undefined;
  return `/api/discogs/image-proxy?url=${encodeURIComponent(url)}`;
}

function AlbumArt({ release, imageSrc, isManualLink, effectivelyMatched }: {
  release: DiscogsRelease;
  imageSrc?: string;
  isManualLink?: boolean;
  effectivelyMatched?: boolean;
}) {
  const [errored, setErrored]       = useState(false);
  const [hiRes, setHiRes]           = useState<string | null>(null);
  const [hiResFailed, setHiResFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Lazy-fetch full-res image when card enters viewport
  useEffect(() => {
    if (hiRes || hiResFailed || !imageSrc) return;
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      obs.disconnect();
      fetch(`/api/discogs/release-image?id=${release.releaseId}`)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then((d: { uri?: string }) => {
          if (d.uri && !d.uri.includes('spacer.gif')) setHiRes(`/api/discogs/image-proxy?url=${encodeURIComponent(d.uri)}`);
          else setHiResFailed(true);
        })
        .catch(() => setHiResFailed(true));
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [release.releaseId, imageSrc, hiRes, hiResFailed]);

  const displaySrc = hiRes ?? imageSrc;

  return (
    <div ref={containerRef} className="relative w-full aspect-square bg-[#0d0d14] overflow-hidden">
      {displaySrc && !errored
        ? <img src={displaySrc} alt={release.title} className="w-full h-full object-cover" onError={() => { if (hiRes) { setHiRes(null); setHiResFailed(true); } else setErrored(true); }} />
        : <VinylPlaceholder />
      }
      {effectivelyMatched && (
        <div className={`absolute top-2 right-2 w-2.5 h-2.5 rounded-full shadow-lg ring-2 ring-black/40 ${
          isManualLink                        ? 'bg-[#7c3aed]' :
          release.matchConfidence === 'exact' ? 'bg-[#22c55e]' :
                                                'bg-[#f59e0b]'
        }`} />
      )}
    </div>
  );
}

/** Inline search picker for linking a digital file to a crate release */
function FilePicker({ library, onPick, onClose }: {
  library: Song[];
  onPick: (song: Song) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    if (!q.trim()) return library.slice(0, 8);
    const lo = q.toLowerCase();
    return library.filter(s =>
      s.artist.toLowerCase().includes(lo) ||
      s.title.toLowerCase().includes(lo) ||
      s.file.toLowerCase().includes(lo)
    ).slice(0, 8);
  }, [q, library]);

  return (
    <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[#0d0d14] border border-[#7c3aed] rounded-lg shadow-xl overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-[#2a2a3a]">
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-[#475569] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="6.5" cy="6.5" r="4"/><line x1="10" y1="10" x2="14" y2="14"/>
        </svg>
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search artist or title…"
          className="flex-1 bg-transparent text-[11px] text-[#e2e8f0] placeholder-[#334155] focus:outline-none"
          onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
        />
        <button type="button" onClick={onClose} className="text-[#475569] hover:text-[#94a3b8] cursor-pointer">
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="4" x2="4" y2="12"/><line x1="4" y1="4" x2="12" y2="12"/>
          </svg>
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {results.length === 0 && (
          <p className="text-center text-[#475569] text-[10px] py-4">No tracks found</p>
        )}
        {results.map(s => (
          <button key={s.file} type="button" onClick={() => onPick(s)}
            className="w-full text-left px-2.5 py-1.5 hover:bg-[#1a1a2a] transition-colors cursor-pointer border-b border-[#1a1a2a] last:border-0">
            <p className="text-[11px] text-[#94a3b8] font-medium truncate">{s.artist}</p>
            <p className="text-[10px] text-[#475569] truncate">{s.title}</p>
            {s.bpm > 0 && <p className="text-[9px] text-[#334155] tabular-nums">{Math.round(s.bpm)} BPM · {s.camelot}</p>}
          </button>
        ))}
      </div>
    </div>
  );
}

const CAMELOT_OPTIONS = [
  '1A','2A','3A','4A','5A','6A','7A','8A','9A','10A','11A','12A',
  '1B','2B','3B','4B','5B','6B','7B','8B','9B','10B','11B','12B',
];

function VinylTrackEditor({ releaseId, data, onChange }: {
  releaseId: number;
  data: VinylReleaseData;
  onChange: (d: VinylReleaseData) => void;
}) {
  const tracks = data.tracks;

  function updateTrack(id: string, patch: Partial<VinylTrackEntry>) {
    onChange({ ...data, tracks: tracks.map(t => t.id === id ? { ...t, ...patch } : t) });
  }

  function removeTrack(id: string) {
    onChange({ ...data, tracks: tracks.filter(t => t.id !== id) });
  }

  function addTrack() {
    const pos = nextPosition(tracks);
    const newTrack: VinylTrackEntry = { id: `${releaseId}-${Date.now()}`, position: pos };
    onChange({ ...data, tracks: [...tracks, newTrack] });
  }

  // Group by side letter for display
  const sides = useMemo(() => {
    const map = new Map<string, VinylTrackEntry[]>();
    for (const t of tracks) {
      const side = t.position.match(/^([A-Za-z]+)/)?.[1].toUpperCase() ?? '?';
      if (!map.has(side)) map.set(side, []);
      map.get(side)!.push(t);
    }
    return map;
  }, [tracks]);

  const inputCls = "bg-[#0d0d14] border border-[#1e1e2e] rounded px-1.5 py-1 text-[11px] text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] transition-colors";

  return (
    <div className="border-t border-[#ffffff10] mt-1 pt-2 flex flex-col gap-2">
      {/* Release-level genre */}
      <input
        type="text"
        value={data.genre ?? ''}
        onChange={e => onChange({ ...data, genre: e.target.value || undefined })}
        placeholder="Release genre…"
        className={`w-full ${inputCls}`}
      />

      {/* Track list */}
      {tracks.length > 0 && (
        <div className="flex flex-col gap-1">
          {[...sides.entries()].map(([side, sideTracks]) => (
            <div key={side}>
              <div className="text-[9px] uppercase tracking-widest text-[#334155] font-semibold mb-1">Side {side}</div>
              {sideTracks.map(track => (
                <div key={track.id} className="flex flex-col gap-1 mb-1.5 bg-[#0d0d14] rounded-md p-1.5 border border-[#1e1e2e]">
                  {/* Row 1: position + title + delete */}
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={track.position}
                      onChange={e => updateTrack(track.id, { position: e.target.value.toUpperCase() })}
                      className={`w-9 text-center font-bold text-[#a78bfa] ${inputCls}`}
                    />
                    <input
                      type="text"
                      value={track.title ?? ''}
                      onChange={e => updateTrack(track.id, { title: e.target.value || undefined })}
                      placeholder="Title…"
                      className={`flex-1 ${inputCls}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeTrack(track.id)}
                      className="text-[#334155] hover:text-[#ef4444] transition-colors cursor-pointer flex-shrink-0"
                    >
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="12" y1="4" x2="4" y2="12"/><line x1="4" y1="4" x2="12" y2="12"/>
                      </svg>
                    </button>
                  </div>
                  {/* Row 2: BPM + key + genre */}
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={track.bpm ?? ''}
                      onChange={e => updateTrack(track.id, { bpm: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="BPM"
                      className={`w-14 tabular-nums ${inputCls}`}
                    />
                    <select
                      value={track.camelot ?? ''}
                      onChange={e => updateTrack(track.id, { camelot: e.target.value || undefined })}
                      className={`w-14 ${inputCls} cursor-pointer`}
                    >
                      <option value="">Key</option>
                      {CAMELOT_OPTIONS.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <input
                      type="text"
                      value={track.genre ?? data.genre ?? ''}
                      onChange={e => updateTrack(track.id, { genre: e.target.value || undefined })}
                      placeholder="Genre"
                      className={`flex-1 ${inputCls}`}
                    />
                  </div>
                  {/* Row 3: comment */}
                  <input
                    type="text"
                    value={track.comment ?? ''}
                    onChange={e => updateTrack(track.id, { comment: e.target.value || undefined })}
                    placeholder="Comment…"
                    className={`w-full ${inputCls}`}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Add track */}
      <button
        type="button"
        onClick={addTrack}
        className="flex items-center justify-center gap-1 w-full py-1.5 rounded-md border border-dashed border-[#2a2a3a] text-[#475569] hover:border-[#7c3aed] hover:text-[#a78bfa] transition-colors cursor-pointer text-[11px]"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/>
        </svg>
        {nextPosition(tracks)}
      </button>
    </div>
  );
}

export default function CratesTab({
  collection, onSync, syncPhase, syncMessage, hasOAuth, hasSpotify,
  library, manualData, onManualDataChange, rejectedMatches, onRejectedChange,
}: Props) {
  const [query,  setQuery]  = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort,   setSort]   = useState<SortKey>('artist');

  const [editingComment,  setEditingComment]  = useState<number | null>(null);
  const [linking,         setLinking]         = useState<number | null>(null);
  const [expandedTracks,  setExpandedTracks]  = useState<number | null>(null);
  const [vinylStore,      setVinylStore]      = useState<VinylStore>(() => loadVinylStore());

  const commentRef = useRef<HTMLTextAreaElement>(null);

  const rejectMatch = useCallback((releaseId: number) => {
    const next = new Set(rejectedMatches).add(releaseId);
    saveRejected(next);
    onRejectedChange(next);
  }, [rejectedMatches, onRejectedChange]);

  const saveField = useCallback((releaseId: number, field: 'bpm' | 'camelot', raw: string) => {
    const next    = new Map(manualData);
    const current = next.get(releaseId) ?? {};
    if (field === 'bpm') {
      const n = parseFloat(raw);
      next.set(releaseId, { ...current, bpm: (!Number.isNaN(n) && n > 0) ? Math.round(n) : undefined });
    } else {
      const v = raw.trim().toUpperCase();
      next.set(releaseId, { ...current, camelot: CAMELOT_RE.test(v) ? v : undefined });
    }
    saveManualData(next);
    onManualDataChange(next);
  }, [manualData, onManualDataChange]);

  const saveComment = useCallback((releaseId: number) => {
    const val = commentRef.current?.value.trim() ?? '';
    const next = new Map(manualData);
    next.set(releaseId, { ...(next.get(releaseId) ?? {}), comment: val || undefined });
    saveManualData(next);
    onManualDataChange(next);
    setEditingComment(null);
  }, [manualData, onManualDataChange]);

  const linkFile = useCallback((releaseId: number, song: Song) => {
    const next = new Map(manualData);
    next.set(releaseId, { ...(next.get(releaseId) ?? {}), matchedFile: song.file });
    saveManualData(next);
    onManualDataChange(next);
    setLinking(null);
  }, [manualData, onManualDataChange]);

  const unlinkFile = useCallback((releaseId: number) => {
    const next = new Map(manualData);
    const curr = next.get(releaseId) ?? {};
    const { matchedFile: _, ...rest } = curr;
    void _;
    next.set(releaseId, rest);
    saveManualData(next);
    onManualDataChange(next);
  }, [manualData, onManualDataChange]);

  const updateVinylData = useCallback((releaseId: number, data: VinylReleaseData) => {
    const next = { ...vinylStore, [releaseId]: data };
    setVinylStore(next);
    saveVinylStore(next);
  }, [vinylStore]);

  const releases = useMemo<DiscogsRelease[]>(() => {
    if (!collection) return [];
    let list = collection.releases.map(r =>
      rejectedMatches.has(r.releaseId)
        ? { ...r, inLibrary: false as boolean, matchConfidence: undefined, matchedFile: undefined }
        : r
    );

    if (filter === 'in-library')     list = list.filter(r => r.inLibrary && r.matchConfidence === 'exact');
    if (filter === 'not-in-library') list = list.filter(r => !r.inLibrary || r.matchConfidence === 'fuzzy');

    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(r =>
        r.title.toLowerCase().includes(q) ||
        r.artist.toLowerCase().includes(q) ||
        r.genres.some(g => g.toLowerCase().includes(q)) ||
        r.styles.some(s => s.toLowerCase().includes(q)),
      );
    }

    return [...list].sort((a, b) => {
      if (sort === 'year')  return (b.year ?? 0) - (a.year ?? 0);
      if (sort === 'title') return a.title.localeCompare(b.title);
      return a.artist.localeCompare(b.artist);
    });
  }, [collection, filter, query, sort, rejectedMatches]);

  const inLibraryCount    = collection?.releases.filter(r => r.inLibrary && r.matchConfidence === 'exact' && !rejectedMatches.has(r.releaseId)).length ?? 0;
  const notInLibraryCount = (collection?.releases.length ?? 0) - inLibraryCount;

  if (!collection) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
        <div className="w-14 h-14 rounded-full bg-[#12121a] border border-[#2a2a3a] flex items-center justify-center">
          <svg className="w-7 h-7 text-[#475569]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
          </svg>
        </div>
        <div>
          <p className="text-sm text-[#94a3b8] font-medium mb-1">No collection synced yet</p>
          <p className="text-[11px] text-[#475569]">
            {hasOAuth ? 'Sync your Discogs collection to browse it here.' : 'Connect your Discogs account in Settings first.'}
          </p>
        </div>
        {syncPhase === 'error' && syncMessage && (
          <p className="text-[11px] text-[#ef4444] max-w-xs">{syncMessage}</p>
        )}
        {hasOAuth
          ? (
            <button type="button" onClick={onSync} disabled={syncPhase === 'syncing'}
              className="px-4 py-2 text-xs font-medium rounded-md bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
              {syncPhase === 'syncing' ? 'Syncing…' : '↺ Sync Collection'}
            </button>
          ) : (
            <button type="button" onClick={() => { window.location.href = '/api/discogs/connect' }}
              className="px-4 py-2 text-xs font-medium rounded-md border border-[#2a2a3a] text-[#94a3b8] hover:text-white hover:border-[#7c3aed] transition-colors cursor-pointer">
              Connect Discogs ↗
            </button>
          )
        }
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Toolbar ── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 space-y-2.5">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search artist, title, genre…"
          className="w-full rounded-md border border-[#2a2a3a] bg-[#12121a] px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] transition-colors"
        />

        <div className="flex items-center gap-2">
          {/* Filter pills */}
          <div className="flex rounded-md overflow-hidden border border-[#2a2a3a] text-[11px] font-medium">
            {([
              ['all',            `All ${collection.releases.length}`],
              ['in-library',     `+Digital ${inLibraryCount}`],
              ['not-in-library', `Vinyl only ${notInLibraryCount}`],
            ] as [Filter, string][]).map(([f, label]) => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={`px-2.5 py-1.5 transition-colors cursor-pointer ${filter === f ? 'bg-[#7c3aed] text-white' : 'text-[#64748b] hover:text-[#94a3b8]'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 ml-auto text-[11px] text-[#475569]">
            <span>Sort</span>
            {(['artist', 'title', 'year'] as SortKey[]).map(s => (
              <button key={s} type="button" onClick={() => setSort(s)}
                className={`px-2 py-1 rounded capitalize transition-colors cursor-pointer ${sort === s ? 'text-[#e2e8f0] bg-[#2a2a3a]' : 'hover:text-[#94a3b8]'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-[#334155]">
          <span>{releases.length} release{releases.length !== 1 ? 's' : ''}{query ? ' found' : ''}</span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] inline-block" />Exact match</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] inline-block" />Linked</span>
          </div>
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {releases.length === 0 && (
          <p className="text-center text-[#475569] text-sm pt-16">No releases match your filter.</p>
        )}
        <div className="grid grid-cols-6 gap-x-3 gap-y-5">
          {releases.map(release => {
            const manual  = manualData.get(release.releaseId);
            const comment = manual?.comment;
            const imageSrc = proxyThumb(release.coverImage ?? release.thumb);
            const isEditComment = editingComment === release.releaseId;
            const isLinking     = linking === release.releaseId;

            const manualLinkedSong = manual?.matchedFile
              ? library.find(s => s.file === manual.matchedFile)
              : null;
            const effectivelyMatched   = release.inLibrary || !!manualLinkedSong;
            const effectiveMatchedFile = release.matchedFile ?? manual?.matchedFile;
            const bpm     = release.bpm     ?? manualLinkedSong?.bpm     ?? manual?.bpm;
            const camelot = release.camelot ?? manualLinkedSong?.camelot ?? manual?.camelot;
            const energy  = release.energy  ?? manualLinkedSong?.energy;
            const isManualLink = !release.inLibrary && !!manualLinkedSong;
            const canEdit = !effectivelyMatched;
            const q = encodeURIComponent(`${release.artist} ${release.title}`);

            return (
              <div key={release.releaseId} className="group flex flex-col bg-white/15 rounded-lg overflow-hidden">

                {/* ── Art ── */}
                <AlbumArt
                  release={release}
                  imageSrc={imageSrc}
                  isManualLink={isManualLink}
                  effectivelyMatched={effectivelyMatched}
                />

                {/* ── Details ── */}
                <div className="px-2 pt-2 pb-2 flex flex-col gap-1.5">

                  {/* Title + artist */}
                  <div>
                    <p className="text-[11px] font-bold text-white leading-snug line-clamp-2">{release.title}</p>
                    <p className="text-[10px] font-medium text-white/70 leading-snug mt-0.5 truncate">{release.artist}</p>
                    {release.year && <p className="text-[10px] font-semibold text-white/40 mt-0.5">{release.year}</p>}
                  </div>

                  {/* BPM / key / energy */}
                  {canEdit ? (
                    <div className="flex items-center gap-1.5">
                      <input type="number" placeholder="BPM"
                        defaultValue={manual?.bpm ?? ''}
                        onBlur={e => saveField(release.releaseId, 'bpm', e.target.value)}
                        className="w-full rounded-md px-2 py-1.5 text-[12px] font-semibold bg-white/10 border border-white/20 text-white placeholder-white/30 focus:outline-none focus:border-[#7c3aed] focus:bg-white/15 transition-colors tabular-nums"
                      />
                      <input type="text" placeholder="Key"
                        defaultValue={manual?.camelot ?? ''}
                        onBlur={e => saveField(release.releaseId, 'camelot', e.target.value)}
                        className="w-full rounded-md px-2 py-1.5 text-[12px] font-semibold bg-white/10 border border-white/20 text-[#a78bfa] placeholder-white/30 focus:outline-none focus:border-[#7c3aed] focus:bg-white/15 transition-colors uppercase"
                      />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {bpm     && <span className="text-[11px] font-semibold text-white/80 tabular-nums">{Math.round(bpm)} BPM</span>}
                        {camelot && <span className="text-[11px] font-bold text-[#c4b5fd]">{camelot}</span>}
                        {energy != null && (
                          <div className="flex-1 min-w-[2rem] h-1.5 rounded-full bg-white/10 overflow-hidden" title={`Energy ${Math.round(energy * 100)}%`}>
                            <div className="h-full rounded-full bg-[#a78bfa]" style={{ width: `${energy * 100}%` }} />
                          </div>
                        )}
                      </div>
                      {effectiveMatchedFile && (
                        <div className="flex items-center gap-1">
                          <p className="text-[10px] text-white/40 truncate font-mono flex-1">
                            {effectiveMatchedFile.split(/[\\/]/).pop()}
                          </p>
                          <button type="button"
                            onClick={() => isManualLink ? unlinkFile(release.releaseId) : rejectMatch(release.releaseId)}
                            className="flex-shrink-0 text-white/30 hover:text-[#ef4444] transition-colors cursor-pointer"
                            title={isManualLink ? 'Remove link' : 'Remove match'}>
                            <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <line x1="12" y1="4" x2="4" y2="12"/><line x1="4" y1="4" x2="12" y2="12"/>
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Comment */}
                  {isEditComment ? (
                    <div className="flex flex-col gap-1.5">
                      <textarea ref={commentRef} placeholder="Notes…" defaultValue={comment ?? ''} rows={2}
                        className="w-full rounded px-2 py-1 text-[11px] bg-[#12121a] border border-[#2a2a3a] text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] resize-none" />
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => saveComment(release.releaseId)}
                          className="text-[10px] px-2.5 py-1 rounded bg-[#7c3aed] text-white cursor-pointer hover:bg-[#6d28d9] transition-colors">Save</button>
                        <button type="button" onClick={() => setEditingComment(null)}
                          className="text-[10px] px-2.5 py-1 rounded border border-[#2a2a3a] text-[#64748b] cursor-pointer hover:text-[#94a3b8] transition-colors">Cancel</button>
                      </div>
                    </div>
                  ) : comment ? (
                    <p className="text-[11px] text-white/40 italic line-clamp-2 cursor-pointer hover:text-white/60 transition-colors"
                      onClick={() => setEditingComment(release.releaseId)}>{comment}</p>
                  ) : null}

                  {/* ── Action row ── */}
                  <div className="flex items-center gap-2 pt-1">
                    <a href={`https://www.discogs.com/release/${release.releaseId}`} target="_blank" rel="noopener noreferrer"
                      className="text-white/35 hover:text-white transition-colors" title="Open on Discogs">
                      <DiscogsIcon size={14} />
                    </a>
                    <a href={`https://www.beatport.com/search/tracks?q=${q}`} target="_blank" rel="noopener noreferrer"
                      className="text-white/35 hover:text-[#01ff95] transition-colors" title="Search on Beatport">
                      <BeatportIcon size={14} />
                    </a>
                    <a href={`https://www.traxsource.com/search?term=${q}`} target="_blank" rel="noopener noreferrer"
                      className="text-white/35 hover:text-[#00aaff] transition-colors" title="Search on Traxsource">
                      <TraxsourceIcon size={14} />
                    </a>
                    {hasSpotify && (
                      <a href={`https://open.spotify.com/search/${q}`} target="_blank" rel="noopener noreferrer"
                        className="text-white/35 hover:text-[#1db954] transition-colors" title="Search on Spotify">
                        <SpotifyIcon size={14} />
                      </a>
                    )}
                    <div className="flex items-center gap-2 ml-auto">
                      <button type="button"
                        onClick={() => setExpandedTracks(expandedTracks === release.releaseId ? null : release.releaseId)}
                        className={`transition-colors cursor-pointer ${expandedTracks === release.releaseId ? 'text-[#a78bfa]' : 'text-white/35 hover:text-[#a78bfa]'}`}
                        title="Edit track list">
                        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <line x1="2" y1="4" x2="14" y2="4"/>
                          <line x1="2" y1="8" x2="14" y2="8"/>
                          <line x1="2" y1="12" x2="10" y2="12"/>
                        </svg>
                      </button>
                      <button type="button"
                        onClick={() => setLinking(isLinking ? null : release.releaseId)}
                        className={`transition-colors cursor-pointer ${isLinking ? 'text-[#a78bfa]' : 'text-white/35 hover:text-[#a78bfa]'}`}
                        title="Link digital file">
                        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M7 9a3 3 0 0 0 4.243 0l2-2a3 3 0 0 0-4.243-4.243l-1 1"/>
                          <path d="M9 7a3 3 0 0 0-4.243 0l-2 2a3 3 0 0 0 4.243 4.243l1-1"/>
                        </svg>
                      </button>
                      <button type="button" onClick={() => setEditingComment(release.releaseId)}
                        className="text-white/35 hover:text-[#a78bfa] transition-colors cursor-pointer" title="Add note">
                        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                          <path d="M2 2h12v9H9.5l-2 2.5L5.5 11H2V2zm1 1v7h2.9l1.6 2 1.6-2H13V3H3z"/>
                        </svg>
                      </button>
                      <button type="button"
                        onClick={() => printSticker({ artist: release.artist, title: release.title, year: release.year, bpm, camelot, genres: release.genres, styles: release.styles, comment, thumb: proxyThumb(release.thumb) })}
                        className="text-white/35 hover:text-white/80 transition-colors cursor-pointer" title="Print sticker">
                        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                          <path d="M4 1h8a1 1 0 011 1v3H3V2a1 1 0 011-1z"/>
                          <path d="M1 6h14a1 1 0 011 1v5a1 1 0 01-1 1h-2v1a1 1 0 01-1 1H4a1 1 0 01-1-1v-1H1a1 1 0 01-1-1V7a1 1 0 011-1zm2 3.5a.5.5 0 100 1 .5.5 0 000-1zM4 11h8v3H4v-3z"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* File picker dropdown */}
                  {isLinking && (
                    <FilePicker
                      library={library}
                      onPick={s => linkFile(release.releaseId, s)}
                      onClose={() => setLinking(null)}
                    />
                  )}

                  {/* Vinyl track editor */}
                  {expandedTracks === release.releaseId && (
                    <VinylTrackEditor
                      releaseId={release.releaseId}
                      data={vinylStore[release.releaseId] ?? { tracks: [] }}
                      onChange={d => updateVinylData(release.releaseId, d)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex-shrink-0 border-t border-[#1e1e2e] px-4 py-2 flex items-center justify-between">
        <span className="text-[10px] text-[#334155]">
          {collection.username} · {(() => {
            const d = Math.floor((+new Date() - collection.syncedAt) / 86400000);
            return d === 0 ? 'synced today' : `synced ${d}d ago`;
          })()}
        </span>
        <button type="button" onClick={onSync} disabled={syncPhase === 'syncing'}
          className="text-[11px] text-[#475569] hover:text-[#94a3b8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
          {syncPhase === 'syncing' ? 'Syncing…' : '↺ Re-sync'}
        </button>
      </div>
    </div>
  );
}
