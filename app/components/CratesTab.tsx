import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { DiscogsCollectionEntry, DiscogsRelease, Song } from '../types';
import { SpotifyIcon, DiscogsIcon, BeatportIcon, TraxsourceIcon } from './Icons';
import type { ManualData } from '../lib/discogsManualData';
import { saveManualData, saveRejected } from '../lib/discogsManualData';

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
      <svg viewBox="0 0 80 80" className="w-3/5 h-3/5 opacity-20" fill="currentColor">
        <circle cx="40" cy="40" r="38" className="text-[#475569]" />
        <circle cx="40" cy="40" r="28" className="text-[#0d0d14]" fill="#0d0d14" />
        <circle cx="40" cy="40" r="24" className="text-[#2a2a3a]" />
        <circle cx="40" cy="40" r="16" className="text-[#0d0d14]" fill="#0d0d14" />
        <circle cx="40" cy="40" r="12" className="text-[#334155]" />
        <circle cx="40" cy="40" r="4"  fill="#0d0d14" />
      </svg>
    </div>
  );
}

function proxyThumb(url?: string): string | undefined {
  if (!url) return undefined;
  return `/api/discogs/image-proxy?url=${encodeURIComponent(url)}`;
}

function AlbumArt({ release, thumbSrc, effectivelyMatched }: { release: DiscogsRelease; thumbSrc?: string; effectivelyMatched?: boolean }) {
  const [errored, setErrored] = useState(false);

  const matchRing =
    effectivelyMatched && release.matchConfidence === 'exact'  ? 'ring-2 ring-[#22c55e]' :
    effectivelyMatched && release.matchConfidence === 'fuzzy'  ? 'ring-2 ring-[#f59e0b]' :
    effectivelyMatched                                         ? 'ring-2 ring-[#7c3aed]' :
    '';

  return (
    <div className={`relative w-full flex items-center justify-center bg-[#0d0d14] rounded-md overflow-hidden min-h-[80px] ${matchRing}`}>
      {thumbSrc && !errored
        ? <img src={thumbSrc} alt={release.title} className="max-w-full w-auto h-auto max-h-[240px]" onError={() => setErrored(true)} />
        : <div className="aspect-square w-full"><VinylPlaceholder /></div>
      }
      {effectivelyMatched && (
        <div className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full shadow ${
          release.matchConfidence === 'exact' ? 'bg-[#22c55e]' :
          release.matchConfidence === 'fuzzy' ? 'bg-[#f59e0b]' :
          'bg-[#7c3aed]'
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

export default function CratesTab({
  collection, onSync, syncPhase, syncMessage, hasOAuth, hasSpotify,
  library, manualData, onManualDataChange, rejectedMatches, onRejectedChange,
}: Props) {
  const [query,  setQuery]  = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort,   setSort]   = useState<SortKey>('artist');

  const [editingComment, setEditingComment] = useState<number | null>(null);
  const [linking,        setLinking]        = useState<number | null>(null);

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
        <div className="grid grid-cols-3 gap-2">
          {releases.map(release => {
            const manual  = manualData.get(release.releaseId);
            const comment = manual?.comment;
            const thumb   = proxyThumb(release.thumb);
            const isEditComment = editingComment === release.releaseId;
            const isLinking     = linking === release.releaseId;

            const manualLinkedSong = manual?.matchedFile
              ? library.find(s => s.file === manual.matchedFile)
              : null;
            const effectivelyMatched = release.inLibrary || !!manualLinkedSong;
            const effectiveMatchedFile = release.matchedFile ?? manual?.matchedFile;
            const bpm     = release.bpm     ?? manualLinkedSong?.bpm     ?? manual?.bpm;
            const camelot = release.camelot ?? manualLinkedSong?.camelot ?? manual?.camelot;
            const energy  = release.energy  ?? manualLinkedSong?.energy;
            const isManualLink = !release.inLibrary && !!manualLinkedSong;
            const canEdit = !effectivelyMatched;
            const q = encodeURIComponent(`${release.artist} ${release.title}`);

            return (
              <div key={release.releaseId}
                className="group flex flex-col bg-[#12121a] rounded-lg border border-[#1a1a2a] hover:border-[#2a2a3a] transition-colors overflow-hidden relative">

                <AlbumArt release={release} thumbSrc={thumb} effectivelyMatched={effectivelyMatched} />

                {/* Info below art */}
                <div className="flex flex-col gap-1.5 p-2 relative">

                  {/* Artist + title */}
                  <div>
                    <p className="text-[11px] font-semibold text-[#e2e8f0] truncate leading-tight">{release.artist}</p>
                    <p className="text-[10px] text-[#64748b] truncate leading-tight mt-0.5">{release.title}</p>
                    {release.year && <p className="text-[9px] text-[#334155] mt-0.5">{release.year}</p>}
                  </div>

                  {/* BPM + Key row */}
                  {canEdit ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number" placeholder="BPM"
                        defaultValue={manual?.bpm ?? ''}
                        onBlur={e => saveField(release.releaseId, 'bpm', e.target.value)}
                        className="w-14 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#0d0d14] border border-[#2a2a3a] text-[#94a3b8] placeholder-[#2a2a3a] focus:outline-none focus:border-[#7c3aed] transition-colors tabular-nums"
                      />
                      <input
                        type="text" placeholder="Key"
                        defaultValue={manual?.camelot ?? ''}
                        onBlur={e => saveField(release.releaseId, 'camelot', e.target.value)}
                        className="w-10 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#0d0d14] border border-[#2a2a3a] text-[#a78bfa] placeholder-[#2a2a3a] focus:outline-none focus:border-[#7c3aed] transition-colors uppercase"
                      />
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {effectiveMatchedFile && (
                        <div className="flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            isManualLink ? 'bg-[#7c3aed]' :
                            release.matchConfidence === 'fuzzy' ? 'bg-[#f59e0b]' : 'bg-[#22c55e]'
                          }`} />
                          <p className="text-[9px] text-[#475569] truncate font-mono leading-tight flex-1">
                            {effectiveMatchedFile.split(/[\\/]/).pop()}
                          </p>
                          <button type="button"
                            onClick={() => isManualLink ? unlinkFile(release.releaseId) : rejectMatch(release.releaseId)}
                            className="flex-shrink-0 text-[#334155] hover:text-[#ef4444] transition-colors cursor-pointer"
                            title={isManualLink ? 'Remove link' : 'Remove match'}>
                            <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <line x1="12" y1="4" x2="4" y2="12"/><line x1="4" y1="4" x2="12" y2="12"/>
                            </svg>
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        {bpm && <span className="text-[10px] font-semibold text-[#94a3b8] tabular-nums">{bpm}</span>}
                        {camelot && <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-[#7c3aed22] text-[#a78bfa]">{camelot}</span>}
                        {energy != null && (
                          <div className="flex-1 h-1 rounded-full bg-[#1e1e2e] overflow-hidden" title={`Energy ${Math.round(energy * 100)}%`}>
                            <div className="h-full rounded-full bg-[#7c3aed]" style={{ width: `${energy * 100}%` }} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Comment (edit mode) */}
                  {isEditComment && (
                    <div className="flex flex-col gap-1">
                      <textarea ref={commentRef} placeholder="Notes…" defaultValue={comment ?? ''} rows={2}
                        className="w-full rounded px-1.5 py-1 text-[10px] bg-[#0d0d14] border border-[#2a2a3a] text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] resize-none" />
                      <div className="flex gap-1">
                        <button type="button" onClick={() => saveComment(release.releaseId)}
                          className="text-[9px] px-2 py-0.5 rounded bg-[#7c3aed] text-white cursor-pointer">Save</button>
                        <button type="button" onClick={() => setEditingComment(null)}
                          className="text-[9px] px-2 py-0.5 rounded border border-[#2a2a3a] text-[#64748b] cursor-pointer">Cancel</button>
                      </div>
                    </div>
                  )}
                  {!isEditComment && comment && (
                    <p className="text-[9px] text-[#475569] italic line-clamp-2 cursor-pointer hover:text-[#64748b]"
                      onClick={() => setEditingComment(release.releaseId)}>{comment}</p>
                  )}

                  {/* Action row: store links + link + note + print */}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <a href={`https://www.discogs.com/release/${release.releaseId}`} target="_blank" rel="noopener noreferrer"
                      className="text-[#475569] hover:text-white transition-colors cursor-pointer" title="Open on Discogs">
                      <DiscogsIcon size={13} />
                    </a>
                    <a href={`https://www.beatport.com/search/tracks?q=${q}`} target="_blank" rel="noopener noreferrer"
                      className="text-[#475569] hover:text-[#01ff95] transition-colors cursor-pointer" title="Search on Beatport">
                      <BeatportIcon size={13} />
                    </a>
                    <a href={`https://www.traxsource.com/search?term=${q}`} target="_blank" rel="noopener noreferrer"
                      className="text-[#475569] hover:text-[#00aaff] transition-colors cursor-pointer" title="Search on Traxsource">
                      <TraxsourceIcon size={13} />
                    </a>
                    {hasSpotify && (
                      <a href={`https://open.spotify.com/search/${q}`} target="_blank" rel="noopener noreferrer"
                        className="text-[#475569] hover:text-[#1db954] transition-colors cursor-pointer" title="Search on Spotify">
                        <SpotifyIcon size={13} />
                      </a>
                    )}
                    <div className="flex items-center gap-1.5 ml-auto">
                      <button type="button"
                        onClick={() => setLinking(isLinking ? null : release.releaseId)}
                        className={`transition-colors cursor-pointer ${isLinking ? 'text-[#7c3aed]' : 'text-[#334155] hover:text-[#a78bfa]'}`}
                        title="Link digital file">
                        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M7 9a3 3 0 0 0 4.243 0l2-2a3 3 0 0 0-4.243-4.243l-1 1"/>
                          <path d="M9 7a3 3 0 0 0-4.243 0l-2 2a3 3 0 0 0 4.243 4.243l1-1"/>
                        </svg>
                      </button>
                      <button type="button" onClick={() => setEditingComment(release.releaseId)}
                        className="text-[#334155] hover:text-[#a78bfa] transition-colors cursor-pointer" title="Add note">
                        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                          <path d="M2 2h12v9H9.5l-2 2.5L5.5 11H2V2zm1 1v7h2.9l1.6 2 1.6-2H13V3H3z"/>
                        </svg>
                      </button>
                      <button type="button"
                        onClick={() => printSticker({ artist: release.artist, title: release.title, year: release.year, bpm, camelot, genres: release.genres, styles: release.styles, comment, thumb })}
                        className="text-[#334155] hover:text-[#94a3b8] transition-colors cursor-pointer" title="Print sticker">
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
