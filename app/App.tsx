import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type {
  HistoryEntry,
  DJPreferences,
} from "./types";
import EnergyCurveEditor from "./components/EnergyCurveEditor";
import SetTracklist from "./components/SetTracklist";
import SettingsModal from "./components/SettingsModal";
import AIPlannerPanel from "./components/AIPlannerPanel";
import CalendarPicker from "./components/CalendarPicker";
import HistoryTab from "./components/HistoryTab";
import { genreMatchesUmbrella, TAG_GROUPS } from "./lib/genreUtils";
import {
  exchangeCodeForToken,
  storeToken,
  getPendingExport,
  clearPendingExport,
  searchTracksOnSpotify,
} from "./lib/spotifyExport";
import {
  getPendingImport,
  clearPendingImport,
  fetchUserPlaylists,
  findSongsForImport,
} from "./lib/spotifyImport";
import { downloadM3U } from "./lib/m3uExport";
import { downloadRekordboxXml } from "./lib/rekordboxExport";
import { SpotifyIcon, RekordboxIcon, M3UIcon } from "./components/Icons";
import { useLibrary } from "./hooks/useLibrary";
import { useSetGenerator } from "./hooks/useSetGenerator";
import { useSpotifyExport } from "./hooks/useSpotifyExport";
import { useSpotifyImport } from "./hooks/useSpotifyImport";
import { apiFetch, setAppPassword, getAppPassword } from "./lib/apiFetch";
import { camelotColor } from "./lib/camelotColors";
import { findCrateGaps, setNeedsCrateSuggestions } from "./lib/crateBuilder";

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth/check')
      .then(r => r.json() as Promise<{ requiresPassword: boolean }>)
      .then(d => {
        if (!d.requiresPassword) { setIsAuthenticated(true); setAuthChecked(true); return; }
        const stored = getAppPassword();
        if (stored) {
          fetch('/api/settings', { headers: { 'X-App-Password': stored } })
            .then(r => { if (r.ok) { setIsAuthenticated(true); } else { setRequiresPassword(true); } })
            .catch(() => setRequiresPassword(true))
            .finally(() => setAuthChecked(true));
        } else {
          setRequiresPassword(true);
          setAuthChecked(true);
        }
      })
      .catch(() => { setIsAuthenticated(true); setAuthChecked(true); });
  }, []);

  const handlePasswordSubmit = useCallback(async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/settings', { headers: { 'X-App-Password': passwordInput } });
      if (res.ok) { setAppPassword(passwordInput); setIsAuthenticated(true); }
      else { setAuthError('Incorrect password.'); }
    } catch { setAuthError('Could not connect.'); }
    finally { setAuthLoading(false); }
  }, [passwordInput]);

  if (!authChecked) return <div className="min-h-screen bg-[#0a0a0f]" />;

  if (requiresPassword && !isAuthenticated) return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="bg-[#12121a] border border-white/10 rounded-xl p-8 w-80 flex flex-col gap-4">
        <h1 className="text-white font-semibold text-lg text-center">DJFriend</h1>
        <input
          type="password"
          className="bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#7c3aed]"
          placeholder="Password"
          value={passwordInput}
          onChange={e => setPasswordInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void handlePasswordSubmit(); }}
          autoFocus
        />
        {authError && <p className="text-red-400 text-xs text-center">{authError}</p>}
        <button
          onClick={() => void handlePasswordSubmit()}
          disabled={authLoading || !passwordInput}
          className="bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-40 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          {authLoading ? 'Checking…' : 'Enter'}
        </button>
      </div>
    </div>
  );

  return <AppInner />;
}

function AppInner() {
  const [activeTab, setActiveTab] = useState<
    "Generator" | "History" | "Import"
  >("Generator");
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem("djfriend-history");
      return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    } catch {
      return [];
    }
  });
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(
    null,
  );
  const [openHistoryExportId, setOpenHistoryExportId] = useState<string | null>(null);
  const historyExportRef = useRef<HTMLDivElement | null>(null);
  const [openImportExportId, setOpenImportExportId] = useState<string | null>(null);
  const importExportRef = useRef<HTMLDivElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [hasGroqKey, setHasGroqKey] = useState(false);
  const [hasSpotifyCredentials, setHasSpotifyCredentials] = useState(false);
  const [hasRekordboxFolder, setHasRekordboxFolder] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(() =>
    localStorage.getItem('djfriend-onboarding-dismissed') === 'true'
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateCalendar, setDateCalendar] = useState<'from' | 'to' | null>(null);
  const [analyzeMenuOpen, setAnalyzeMenuOpen] = useState(false);
  const [playlistSearch, setPlaylistSearch] = useState('');
  const [manualMatchKey, setManualMatchKey] = useState<string | null>(null);
  const [manualMatchQuery, setManualMatchQuery] = useState('');
  const manualSearchRef = useRef<HTMLDivElement | null>(null);
  const analyzeMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rbFileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFolderInputRef = useRef<HTMLInputElement | null>(null);
  const sourceDropdownRef = useRef<HTMLDivElement | null>(null);

  // Persist history to localStorage
  useEffect(() => {
    localStorage.setItem("djfriend-history", JSON.stringify(history));
  }, [history]);

  // Click-outside for analyze menu
  useEffect(() => {
    if (!analyzeMenuOpen) return;
    const handle = (e: MouseEvent) => {
      if (analyzeMenuRef.current && !analyzeMenuRef.current.contains(e.target as Node)) setAnalyzeMenuOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [analyzeMenuOpen]);

  // Click-outside for manual library search panel
  useEffect(() => {
    if (!manualMatchKey) return;
    const handle = (e: MouseEvent) => {
      if (manualSearchRef.current && !manualSearchRef.current.contains(e.target as Node)) {
        setManualMatchKey(null);
        setManualMatchQuery('');
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [manualMatchKey]);

  // Click-outside for history export dropdown
  useEffect(() => {
    if (!openHistoryExportId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (historyExportRef.current && !historyExportRef.current.contains(e.target as Node))
        setOpenHistoryExportId(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openHistoryExportId]);

  // Click-outside for import history export dropdown
  useEffect(() => {
    if (!openImportExportId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (importExportRef.current && !importExportRef.current.contains(e.target as Node))
        setOpenImportExportId(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openImportExportId]);

  // Stable ref used to bridge setGeneratedSet (from useSetGenerator) into useLibrary's onNewAnalysis callback
  const onNewAnalysisRef = useRef<(() => void) | undefined>(undefined);
  // Stable ref used to bridge setImportHistory (from useSpotifyImport) into useLibrary's onPlaylistImported callback
  const onPlaylistImportedRef = useRef<((songs: import('./types').Song[], label: string) => void) | undefined>(undefined);

  const {
    library,
    setLibrary,
    libraryName,
    isInitializing,
    enrichmentStatus,
    analysisQueue,
    cancelQueueItem,
    folderPath,
    setFolderPath,
    playlistPicker,
    setPlaylistPicker,
    loadingPlaylists,
    analyzedApplePlaylists,
    setAnalyzedApplePlaylists,
    error,
    openPlaylistPicker,
    runAppleMusicAnalysis,
    runPathListAnalysis,
    runRekordboxImport,
    runUploadAnalysis,
    runM3uWebImport,
  } = useLibrary({
    onNewAnalysis: () => onNewAnalysisRef.current?.(),
    onPlaylistImported: (songs, label) => onPlaylistImportedRef.current?.(songs, label),
  });

  // Playlist filter — which import entry restricts the generator pool
  const [playlistFilterId, setPlaylistFilterId] = useState<string | null>(null);
  // Controls visibility of the playlist picker select element in the Source card
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  // Visual-only loading state for the Generate CTA button
  const [isGenerating, setIsGenerating] = useState(false);

  // Click-outside for source playlist dropdown
  useEffect(() => {
    if (!sourceDropdownOpen) return;
    const handle = (e: MouseEvent) => {
      if (sourceDropdownRef.current && !sourceDropdownRef.current.contains(e.target as Node)) setSourceDropdownOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [sourceDropdownOpen]);

  // useSpotifyImport first so we have importHistory before calling useSetGenerator
  const {
    importHistory,
    setImportHistory,
    expandedImportId,
    setExpandedImportId,
    importUrl,
    setImportUrl,
    importStatus,
    setPendingImportUrl,
    spotifyPlaylistPicker,
    setSpotifyPlaylistPicker,
    loadingSpotifyPlaylists,
    setLoadingSpotifyPlaylists,
    openStoreLinkKey,
    setOpenStoreLinkKey,
    storeLinkRef,
    runImport,
    reloadEntry,
    handleImport,
    handleBrowseSpotifyPlaylists,
  } = useSpotifyImport({ library, setHistory });

  // Wire the playlist-imported callback now that setImportHistory is available
  useEffect(() => {
    onPlaylistImportedRef.current = (songs, label) => {
      const entry: import('./types').ImportEntry = {
        id: Date.now().toString(),
        name: label,
        timestamp: Date.now(),
        playlistId: `local-${Date.now()}`,
        tracks: songs.map(s => ({
          spotifyId: s.spotifyId ?? s.file,
          title: s.title,
          artist: s.artist,
          inLibrary: true,
          matchConfidence: 'exact' as const,
        })),
      };
      setImportHistory(prev => {
        const exists = prev.findIndex(e => e.name === label);
        if (exists >= 0) {
          const next = [...prev];
          next[exists] = entry;
          return next;
        }
        return [entry, ...prev];
      });
    };
  }, [setImportHistory]);

  // Derive the file set + duration for the active playlist filter (both memoized)
  const playlistFilterFiles = useMemo<Set<string> | undefined>(() => {
    if (!playlistFilterId) return undefined;
    const entry = importHistory.find(e => e.id === playlistFilterId);
    if (!entry) return undefined;
    const songs = findSongsForImport(entry.tracks, library);
    return songs.length > 0 ? new Set(songs.map(s => s.file)) : undefined;
  }, [playlistFilterId, importHistory, library]);

  const playlistTotalMinutes = useMemo<number>(() => {
    if (!playlistFilterId) return 0;
    const entry = importHistory.find(e => e.id === playlistFilterId);
    if (!entry) return 0;
    const songs = findSongsForImport(entry.tracks, library);
    return songs.reduce((s, t) => s + (t.duration ?? 210), 0) / 60;
  }, [playlistFilterId, importHistory, library]);

  const SET_DURATIONS = [30, 45, 60, 90, 120, 180] as const;
  // The only pill enabled in playlist mode: smallest duration that fits the playlist
  const minViablePill = useMemo<number | null>(() => {
    if (!playlistFilterId || playlistTotalMinutes <= 0) return null;
    return SET_DURATIONS.find(d => d >= playlistTotalMinutes) ?? 180;
  }, [playlistFilterId, playlistTotalMinutes]);

  // Auto-select effect wired below after setPrefs is available from useSetGenerator

  const {
    prefs,
    setPrefs,
    curve,
    setCurve,
    generatedSet,
    setGeneratedSet,
    setScoringWeights,
    swapModal,
    setSwapModal,
    availableGenres,
    genreGroups,
    availableTags,
    filteredTrackCount,
    canGenerateNew,
    handleGenerate,
    handleRegenerate,
    handleGenerateNew,
    selectGenre,
    handleCurveChange,
    handleSwapTrack,
    applySwapSuggestion,
    handleToggleLock,
    handleRemoveTrack,
    handleReorderTrack,
    handleUpdateTrack,
    handleLoadToSet,
    handleAppendTracks,
  } = useSetGenerator(library, setLibrary, playlistFilterFiles, history);

  // Wire setGeneratedSet into the bridge ref so useLibrary can reset the set on new analysis
  onNewAnalysisRef.current = () => { setGeneratedSet([]); };

  // Auto-select the min viable duration pill when playlist mode activates or playlist changes
  useEffect(() => {
    if (minViablePill !== null) {
      setPrefs(p => p.setDuration !== minViablePill ? { ...p, setDuration: minViablePill } : p);
    }
  }, [minViablePill, setPrefs]);

  const handleApplyPlan = useCallback((plan: import('./types').SetPlan) => {
    setCurve(plan.curve);
    setScoringWeights(plan.scoringWeights);
    if (plan.venueType) setPrefs(p => ({ ...p, venueType: plan.venueType as import('./types').VenueType }));
    if (plan.genre) setPrefs(p => ({ ...p, genre: plan.genre! }));
    if (plan.setDuration) setPrefs(p => ({ ...p, setDuration: plan.setDuration! }));
    setChatOpen(false);
  }, [setCurve, setScoringWeights, setPrefs]);

  const handleLoadHistoryEntry = useCallback((entry: HistoryEntry) => {
    // Migrate old history entries that used addedTimeFilter instead of dateFilter
    const migratedPrefs: DJPreferences = {
      ...entry.prefs,
      dateFilter: entry.prefs.dateFilter ?? { field: 'dateAdded', preset: 'all' },
    };
    delete (migratedPrefs as unknown as Record<string, unknown>)['addedTimeFilter'];
    setPrefs(migratedPrefs);
    setCurve(entry.curve);
    setGeneratedSet(entry.tracks);
    setActiveTab("Generator");
  }, [setPrefs, setCurve, setGeneratedSet]);

  const {
    spotifyExportStatus,
    setSpotifyExportStatus,
    handleExportM3U,
    startSpotifyExport,
    handleExportSpotify,
    handleToggleSpotifyMatch,
    handleConfirmSpotifyExport,
    handleRenameEntry,
  } = useSpotifyExport({ generatedSet, prefs, curve, setHistory });

  const handleExportImportM3U = useCallback(async (entry: import("./types").ImportEntry) => {
    const songs = findSongsForImport(entry.tracks, library);
    if (songs.length === 0) return;
    const setTracks = songs.map((s, i) => ({ ...s, slot: i, targetEnergy: s.energy, harmonicWarning: false }));
    const filename = `${entry.name.replace(/[^a-z0-9_\-. ]/gi, '_')}.m3u`;
    downloadM3U(setTracks, filename);
  }, [library]);

  const handleExportImportRekordbox = useCallback((entry: import("./types").ImportEntry) => {
    const songs = findSongsForImport(entry.tracks, library);
    if (songs.length === 0) return;
    const setTracks = songs.map((s, i) => ({ ...s, slot: i, targetEnergy: s.energy, harmonicWarning: false }));
    const filename = `${entry.name.replace(/[^a-z0-9_\-. ]/gi, '_')}.xml`;
    downloadRekordboxXml(setTracks, entry.name, filename);
  }, [library]);

  const handleLoadImportToSet = useCallback((entry: import("./types").ImportEntry) => {
    const songs = findSongsForImport(entry.tracks, library);
    if (songs.length === 0) return;
    handleLoadToSet(songs);
    setPlaylistFilterId(entry.id);
    setActiveTab('Generator');
  }, [library, handleLoadToSet, setPlaylistFilterId]);

  const loadSettings = useCallback(() => {
    apiFetch('/api/settings')
      .then(r => r.json() as Promise<{ musicFolder?: string; rekordboxFolder?: string; hasGroqKey?: boolean; hasSecret?: boolean }>)
      .then(d => {
        if (d.musicFolder) setFolderPath(prev => prev || d.musicFolder!)
        if (d.hasGroqKey !== undefined) setHasGroqKey(d.hasGroqKey)
        if (d.hasSecret !== undefined) setHasSpotifyCredentials(d.hasSecret)
        setHasRekordboxFolder(!!(d.rekordboxFolder && d.rekordboxFolder.trim()))
      })
      .catch(() => {})
  }, [setFolderPath]);

  useEffect(() => { loadSettings() }, [loadSettings]);

  // Handle Spotify OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;

    // Clean up the URL so the code isn't re-processed on refresh
    window.history.replaceState({}, "", window.location.pathname);

    void (async () => {
      try {
        const { access_token, expires_in } = await exchangeCodeForToken(code);
        storeToken(access_token, expires_in);

        const pending = getPendingExport();
        clearPendingExport();

        if (pending) {
          setSpotifyExportStatus({
            phase: "searching",
            completed: 0,
            total: pending.tracks.length,
          });
          const matches = await searchTracksOnSpotify(
            pending.tracks,
            access_token,
            (completed, total) =>
              setSpotifyExportStatus({ phase: "searching", completed, total }),
          );
          setSpotifyExportStatus({
            phase: "review",
            matches,
            playlistName: pending.name,
          });
        }

        const pendingImport = getPendingImport();
        clearPendingImport();
        if (pendingImport === "__browse__") {
          setActiveTab("Import");
          setLoadingSpotifyPlaylists(true);
          try {
            const playlists = await fetchUserPlaylists(access_token);
            setSpotifyPlaylistPicker(playlists);
          } finally {
            setLoadingSpotifyPlaylists(false);
          }
        } else if (pendingImport) {
          setActiveTab("Import");
          setImportUrl(pendingImport);
          setPendingImportUrl(pendingImport);
        }
      } catch (err) {
        setSpotifyExportStatus({
          phase: "error",
          message: err instanceof Error ? err.message : "Spotify auth failed.",
        });
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#e2e8f0]">
      {/* Startup initialization overlay */}
      {isInitializing && (
        <div className="fixed inset-0 z-50 bg-[#0a0a0f] flex flex-col items-center justify-center gap-6">
          <img src="/icon.png" alt="DJFriend" style={{ width: 64, height: 64, borderRadius: 16, objectFit: 'cover' }} />
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm font-medium text-[#e2e8f0]">Initializing library…</p>
            <p className="text-xs text-[#475569]">Loading tracks and matching imported playlists</p>
          </div>
          <div className="w-48 h-0.5 bg-[#1e1e2e] rounded-full overflow-hidden">
            <div className="h-full bg-[#7c3aed] rounded-full animate-pulse w-full" />
          </div>
        </div>
      )}
      {/* Header */}
      <header className="border-b border-[#1e1e2e] bg-[#0a0a0f] sticky top-0 z-40 pt-6">
        <div className="px-2 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
            <img src="/icon.png" alt="DJFriend" className="flex-shrink-0" style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'cover' }} />
            <span className="font-bold text-lg tracking-tight text-[#e2e8f0] flex-shrink-0">
              DJFriend
            </span>
            {libraryName && (
              <span className="hidden sm:inline text-xs text-[#475569] bg-[#12121a] border border-[#2a2a3a] px-2 py-0.5 rounded truncate min-w-0">
                {libraryName} · {library.length} tracks
                {library.some(s => s.semanticTags) && (
                  <span className="text-[#334155]"> · {library.filter(s => s.semanticTags).length} tagged</span>
                )}
              </span>
            )}
            {(() => {
              const missing = library.filter(s => s.bpm <= 0 || !s.camelot);
              if (missing.length === 0) return null;
              return (
                <span
                  className="hidden sm:inline text-xs text-[#f59e0b] bg-[#f59e0b0d] border border-[#f59e0b33] px-2 py-0.5 rounded cursor-default"
                  title={`${missing.length} track${missing.length === 1 ? '' : 's'} missing BPM or key — rescan to fix`}
                >
                  ⚠ {missing.length} incomplete
                </span>
              );
            })()}
            {!navigator.userAgent.toLowerCase().includes("electron") && libraryName.includes("(imported)") && (
              <span className="hidden sm:inline text-xs text-[#64748b] italic">
                BPM/key/energy are AI-estimated — not from audio analysis
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {error && (
              <span className="text-xs text-[#ef4444] hidden sm:inline">
                {error}
              </span>
            )}
            {analysisQueue.length > 0 && (
              <div className="hidden sm:flex flex-col gap-1">
                {analysisQueue.slice(0, 3).map((item) => {
                  const isAI = item.status === 'analyzing' && enrichmentStatus !== null;
                  const pct = isAI
                    ? (enrichmentStatus!.total > 0 ? Math.round((enrichmentStatus!.completed / enrichmentStatus!.total) * 100) : 100)
                    : (item.total > 0 ? Math.min(100, Math.round((item.completed / item.total) * 100)) : 0);
                  return (
                    <div key={item.playlistName} className="flex items-center gap-1.5">
                      <div className="w-24 h-1.5 rounded-full bg-[#1f2937] overflow-hidden flex-shrink-0">
                        <div
                          className={`h-full transition-all ${isAI ? 'bg-[#22c55e]' : item.status === 'analyzing' ? 'bg-[#7c3aed]' : 'bg-[#334155]'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className={`text-[10px] tabular-nums truncate max-w-[80px] ${isAI ? 'text-[#22c55e]' : item.status === 'analyzing' ? 'text-[#94a3b8]' : 'text-[#475569]'}`}>
                        {isAI
                          ? (enrichmentStatus!.total > 0 ? `AI ${enrichmentStatus!.completed}/${enrichmentStatus!.total}` : 'AI…')
                          : item.status === 'queued'
                            ? item.playlistName
                            : `${item.completed}/${item.total}`}
                      </span>
                      <button
                        onClick={() => cancelQueueItem(item.playlistName)}
                        aria-label={`Cancel ${item.playlistName}`}
                        className="text-[10px] text-[#475569] hover:text-red-400 transition-colors cursor-pointer leading-none flex-shrink-0"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="relative">
              {hasGroqKey && (
                <button
                  onClick={() => setChatOpen(o => !o)}
                  title="AI Set Planner"
                  aria-label="AI Set Planner"
                  className={`p-1.5 transition-colors cursor-pointer ${chatOpen ? 'text-[#7c3aed]' : 'text-[#475569] hover:text-[#94a3b8]'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                  </svg>
                </button>
              )}
              <button
                onClick={() => { setSettingsOpen(true); if (!onboardingDismissed) { setOnboardingDismissed(true); localStorage.setItem('djfriend-onboarding-dismissed', 'true'); } }}
                title="Settings"
                className="p-1.5 text-[#475569] hover:text-[#94a3b8] transition-colors cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
              {navigator.userAgent.toLowerCase().includes("electron") && !folderPath.trim() && !onboardingDismissed && (
                <div className="absolute right-0 top-full mt-2 z-50">
                  <div className="relative bg-[#7c3aed] text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap flex items-center gap-2">
                    <span className="absolute -top-1.5 right-3 w-3 h-3 bg-[#7c3aed] rotate-45" />
                    <span>Configure your folders to get started</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setOnboardingDismissed(true); localStorage.setItem('djfriend-onboarding-dismissed', 'true'); }}
                      className="ml-1 opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                      aria-label="Dismiss"
                    >×</button>
                  </div>
                </div>
              )}
            </div>
            {/* Hidden file input for M3U / TXT import */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".m3u,.m3u8,.txt"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const text = await file.text();
                const label = file.name.replace(/\.[^.]+$/, '');
                if (navigator.userAgent.toLowerCase().includes("electron")) {
                  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
                  void runPathListAnalysis(lines, label);
                } else {
                  // Web: parse playlist file and enrich via Spotify
                  const rawLines = text.split(/\r\n|\r|\n/);
                  const tracks: Array<{ artist: string; title: string }> = [];

                  // 1. Apple Music TSV export (first line has tab-separated headers starting with "Name")
                  const firstLine = rawLines[0] ?? '';
                  if (firstLine.includes('\t') && firstLine.split('\t')[0].trim() === 'Name') {
                    const headers = firstLine.split('\t').map(h => h.trim());
                    const nameIdx = headers.indexOf('Name');
                    const artistIdx = headers.indexOf('Artist');
                    for (let i = 1; i < rawLines.length; i++) {
                      const cols = rawLines[i].split('\t');
                      const name = cols[nameIdx]?.trim() ?? '';
                      const artist = artistIdx >= 0 ? (cols[artistIdx]?.trim() ?? '') : '';
                      if (name) tracks.push({ artist, title: name });
                    }
                  }
                  // 2. M3U/M3U8 with #EXTINF metadata
                  else if (rawLines.some(l => l.trim().startsWith('#EXTINF:'))) {
                    for (const line of rawLines) {
                      if (!line.trim().startsWith('#EXTINF:')) continue;
                      const meta = line.trim().replace(/^#EXTINF:[^,]*,/, '').trim();
                      const dashIdx = meta.indexOf(' - ');
                      if (dashIdx !== -1) {
                        tracks.push({ artist: meta.slice(0, dashIdx).trim(), title: meta.slice(dashIdx + 3).trim() });
                      } else {
                        tracks.push({ artist: '', title: meta });
                      }
                    }
                  }
                  // 3. Plain text / file path list
                  else {
                    for (const l of rawLines) {
                      const line = l.trim();
                      if (!line || line.startsWith('#')) continue;
                      const basename = line.replace(/\\/g, '/').split('/').pop() ?? line;
                      const name = basename.replace(/\.[^.]+$/, '').trim();
                      const dashIdx = name.indexOf(' - ');
                      if (dashIdx !== -1) {
                        tracks.push({ artist: name.slice(0, dashIdx).trim(), title: name.slice(dashIdx + 3).trim() });
                      } else {
                        tracks.push({ artist: '', title: name });
                      }
                    }
                  }

                  void runM3uWebImport(tracks, label);
                }
              }}
            />
            {/* Hidden file input for Rekordbox XML */}
            <input
              ref={rbFileInputRef}
              type="file"
              accept=".xml"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const text = await file.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, 'text/xml');
                const trackEls = Array.from(doc.querySelectorAll('TRACK[Location]'));
                const tracks = trackEls.flatMap(el => {
                  const loc = el.getAttribute('Location') ?? '';
                  // file://localhost/path/to/file.mp3 → /path/to/file.mp3
                  const filePath = decodeURIComponent(loc.replace(/^file:\/\/localhost/, '').replace(/^file:\/\//, ''));
                  const bpm = parseFloat(el.getAttribute('AverageBpm') ?? '0');
                  const duration = parseFloat(el.getAttribute('TotalTime') ?? '0');
                  const tonality = el.getAttribute('Tonality') ?? '';
                  if (!filePath || !tonality || bpm <= 0) return [];
                  return [{ path: filePath, title: el.getAttribute('Name') ?? '', artist: el.getAttribute('Artist') ?? '', bpm, tonality, duration }];
                });
                void runRekordboxImport(tracks);
              }}
            />
            <div className="relative" ref={analyzeMenuRef}>
              <button
                onClick={() => setAnalyzeMenuOpen(o => !o)}
                disabled={loadingPlaylists}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-[#2a2a3a] bg-[#12121a] text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingPlaylists ? "Loading…" : "Analyze"}
                <span className="text-[10px]">▾</span>
              </button>
              {analyzeMenuOpen && !loadingPlaylists && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-md border border-[#2a2a3a] bg-[#12121a] shadow-lg overflow-hidden">
                  {navigator.userAgent.toLowerCase().includes("electron") && (
                    <button
                      onClick={() => { setAnalyzeMenuOpen(false); void openPlaylistPicker(); }}
                      className="w-full text-left px-4 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                    >
                      Apple Music
                    </button>
                  )}
                  <button
                    onClick={() => { setAnalyzeMenuOpen(false); fileInputRef.current?.click(); }}
                    className="w-full text-left px-4 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                  >
                    Import M3U / TXT
                  </button>
                  <button
                    onClick={() => { setAnalyzeMenuOpen(false); rbFileInputRef.current?.click(); }}
                    className="w-full text-left px-4 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#1e1e2e]"
                  >
                    Import Rekordbox XML
                  </button>
                  <button
                    onClick={() => { setAnalyzeMenuOpen(false); uploadFolderInputRef.current?.click(); }}
                    className="w-full text-left px-4 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#1e1e2e]"
                  >
                    Upload Folder
                    <span className="ml-1.5 text-[10px] text-[#475569]">(web)</span>
                  </button>
                </div>
              )}
            </div>
            {/* Hidden file input for folder upload (web) */}
            <input
              ref={uploadFolderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is not in React's types
              webkitdirectory=""
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                e.target.value = '';
                if (!files || files.length === 0) return;
                void runUploadAnalysis(files);
              }}
            />
          </div>
        </div>

        {/* Tab nav */}
        <div className="px-2 flex gap-1">
          {(["Generator", "History", ...(hasSpotifyCredentials ? (["Import"] as const) : ([] as const))] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === tab
                  ? "border-[#7c3aed] text-[#e2e8f0]"
                  : "border-transparent text-[#475569] hover:text-[#94a3b8]"
              }`}
            >
              <span className="flex items-center gap-1.5">
                {tab === "Import" && <SpotifyIcon size={13} className="text-[#1db954]" />}
                {tab}
                {tab === "History" && history.length > 0 && (
                  <span className="text-[10px] bg-[#2a2a3a] text-[#94a3b8] px-1.5 py-0.5 rounded-full">
                    {history.length}
                  </span>
                )}
                {tab === "Import" && importHistory.length > 0 && (
                  <span className="text-[10px] bg-[#2a2a3a] text-[#94a3b8] px-1.5 py-0.5 rounded-full">
                    {importHistory.length}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="sm:hidden px-4 pt-3">
          <p className="text-xs text-[#ef4444]">{error}</p>
        </div>
      )}


      {activeTab === "Generator" && (
        <main className="px-2 py-6">
          <div className="flex flex-col lg:flex-row lg:items-stretch gap-4">

            {/* ── LEFT SIDEBAR ── */}
            <div className="lg:w-96 xl:w-[26rem] flex-shrink-0 flex flex-col gap-4">

              {/* Card 1: Energy Curve */}
              <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-[#64748b]">
                    Energy Curve
                  </h2>

                </div>
                <EnergyCurveEditor points={curve} onChange={handleCurveChange} setTracks={generatedSet.length > 0 ? generatedSet : undefined} />
              </div>

              {/* Card 2: Filters (only when tag data exists) */}
              {(availableTags.vibeTags.length + availableTags.moodTags.length + availableTags.venueTags.length + availableTags.timeOfNightTags.length + availableTags.vocalTypes.length + genreGroups.length + availableGenres.length) > 0 && (() => {
                const activeFilterCount = prefs.tagFilters.vibeTags.length + prefs.tagFilters.moodTags.length + prefs.tagFilters.vocalTypes.length + prefs.tagFilters.venueTags.length + prefs.tagFilters.timeOfNightTags.length;
                const activeList = [...prefs.tagFilters.vibeTags, ...prefs.tagFilters.moodTags, ...prefs.tagFilters.vocalTypes, ...prefs.tagFilters.venueTags, ...prefs.tagFilters.timeOfNightTags];
                return (
                  <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl overflow-hidden">
                    {/* Toggle header */}
                    <button
                      type="button"
                      onClick={() => setFiltersOpen(o => !o)}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#0d0d14] transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-widest text-[#64748b]">Filters</span>
                        {activeFilterCount > 0 && (
                          <span className="text-[10px] font-medium bg-[#7c3aed33] text-[#a78bfa] border border-[#7c3aed66] px-1.5 py-0.5 rounded-full tabular-nums">
                            {activeFilterCount}
                          </span>
                        )}
                      </div>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        className={`text-[#475569] transition-transform duration-150 ${filtersOpen ? 'rotate-180' : ''}`}>
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>

                    {/* Active filter summary — always visible when filters active */}
                    {activeFilterCount > 0 && (
                      <div className="px-5 pb-3 border-t border-[#1e1e2e] pt-3">
                        <div className="flex items-center gap-2 text-[11px] bg-[#0d0d14] border border-[#2a2a3a] rounded-md px-3 py-1.5">
                          <span className="text-[#475569] flex-shrink-0">{activeFilterCount} active:</span>
                          <span className="text-[#94a3b8] truncate">{activeList.join(' · ')}</span>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); setPrefs(p => ({ ...p, tagFilters: { vibeTags: [], moodTags: [], vocalTypes: [], venueTags: [], timeOfNightTags: [] } })); }}
                            className="ml-auto text-[#475569] hover:text-[#ef4444] transition-colors cursor-pointer flex-shrink-0"
                            title="Clear all filters"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Expanded filter pills */}
                    {filtersOpen && (
                      <div className={`px-4 pb-4 flex flex-col gap-4 ${activeFilterCount === 0 ? 'border-t border-[#1e1e2e] pt-4' : 'pt-2'}`}>
                        <div>
                          {/* Field selector toggle */}
                          <div className="flex items-center gap-1 mb-2">
                            <span className="text-[10px] uppercase tracking-widest font-semibold text-[#4b5568]">Date</span>
                            <div className="ml-2 flex rounded overflow-hidden border border-[#4c1d95]">
                              {(['dateAdded', 'releaseYear'] as const).map(f => {
                                const active = (prefs.dateFilter?.field ?? 'dateAdded') === f;
                                return (
                                  <button key={f} type="button"
                                    onClick={() => setPrefs(p => ({ ...p, dateFilter: { ...(p.dateFilter ?? { preset: 'all' }), field: f } }))}
                                    className="px-2 py-0.5 text-[10px] font-medium transition-all cursor-pointer"
                                    style={{ backgroundColor: active ? '#7c3aed' : 'transparent', color: active ? '#fff' : '#a78bfa' }}>
                                    {f === 'dateAdded' ? 'Date Added' : 'Release Year'}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          {/* Preset pills */}
                          <div className="flex flex-wrap gap-1.5">
                            {(['all', 'thisYear', 'lastYear', 'older', 'range'] as const).map(opt => {
                              const label = opt === 'all' ? 'All' : opt === 'thisYear' ? 'This Year' : opt === 'lastYear' ? 'Last Year' : opt === 'older' ? 'Older' : 'Range';
                              const active = (prefs.dateFilter?.preset ?? 'all') === opt;
                              return (
                                <button key={opt} type="button"
                                  onClick={() => { if (opt !== 'range') setDateCalendar(null); setPrefs(p => ({ ...p, dateFilter: { ...(p.dateFilter ?? { field: 'dateAdded' }), preset: opt } })); }}
                                  className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border"
                                  style={{
                                    backgroundColor: active ? '#7c3aed' : 'transparent',
                                    color: active ? '#fff' : '#a78bfa',
                                    borderColor: active ? '#7c3aed' : '#4c1d95',
                                  }}>
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                          {/* Calendar date range — shown only when preset = range */}
                          {(prefs.dateFilter?.preset ?? 'all') === 'range' && (
                            <div className="mt-2 space-y-1">
                              {/* From */}
                              <div>
                                <button type="button"
                                  onClick={() => setDateCalendar(c => c === 'from' ? null : 'from')}
                                  className="flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition-all cursor-pointer w-full"
                                  style={{ backgroundColor: dateCalendar === 'from' ? '#1e1e2e' : 'transparent', borderColor: '#4c1d95', color: '#a78bfa' }}>
                                  <span className="text-[#4b5568]">From</span>
                                  <span>{prefs.dateFilter?.rangeFrom ?? 'Ever'}</span>
                                </button>
                                {dateCalendar === 'from' && (
                                  <CalendarPicker
                                    value={prefs.dateFilter?.rangeFrom}
                                    clearLabel="Ever (no start limit)"
                                    onConfirm={date => {
                                      setPrefs(p => ({ ...p, dateFilter: { ...(p.dateFilter ?? { field: 'dateAdded', preset: 'range' }), rangeFrom: date } }));
                                      setDateCalendar(null);
                                    }}
                                  />
                                )}
                              </div>
                              {/* To */}
                              <div>
                                <button type="button"
                                  onClick={() => setDateCalendar(c => c === 'to' ? null : 'to')}
                                  className="flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition-all cursor-pointer w-full"
                                  style={{ backgroundColor: dateCalendar === 'to' ? '#1e1e2e' : 'transparent', borderColor: '#4c1d95', color: '#a78bfa' }}>
                                  <span className="text-[#4b5568]">To</span>
                                  <span>{prefs.dateFilter?.rangeTo ?? 'Now'}</span>
                                </button>
                                {dateCalendar === 'to' && (
                                  <CalendarPicker
                                    value={prefs.dateFilter?.rangeTo}
                                    clearLabel="Now (today)"
                                    onConfirm={date => {
                                      setPrefs(p => ({ ...p, dateFilter: { ...(p.dateFilter ?? { field: 'dateAdded', preset: 'range' }), rangeTo: date } }));
                                      setDateCalendar(null);
                                    }}
                                  />
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        {genreGroups.length > 0 && (
                          <div>
                            <span className="text-[10px] uppercase tracking-widest font-semibold text-[#4b5568] block mb-2">Genre</span>
                            <div className="flex flex-wrap gap-1.5">
                              {genreGroups.map(label => {
                                const value = `~${label}`;
                                const active = prefs.genre === value;
                                return (
                                  <button key={value} type="button" onClick={() => selectGenre(active ? 'Any' : value)}
                                    className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border"
                                    style={{ backgroundColor: active ? '#7c3aed' : 'transparent', color: active ? '#fff' : '#a78bfa', borderColor: active ? '#7c3aed' : '#4c1d95' }}>
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {availableGenres.length > 0 && (
                          <div>
                            <span className="text-[10px] uppercase tracking-widest font-semibold text-[#4b5568] block mb-2">User Genre</span>
                            <div className="flex flex-wrap gap-1.5">
                              {['Any', ...availableGenres].map(genre => {
                                const umbrellaActive = prefs.genre.startsWith('~') && genre !== 'Any' && genreMatchesUmbrella(genre, prefs.genre);
                                const active = prefs.genre === genre || umbrellaActive;
                                return (
                                  <button key={genre} type="button"
                                    onClick={() => selectGenre(active && !umbrellaActive && genre !== 'Any' ? 'Any' : genre)}
                                    className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border"
                                    style={{
                                      backgroundColor: umbrellaActive ? '#0c3a45' : active ? '#164e63' : 'transparent',
                                      color: umbrellaActive ? '#67e8f9' : active ? '#e2e8f0' : '#22d3ee',
                                      borderColor: umbrellaActive ? '#0e7490' : active ? '#06b6d4' : '#164e63',
                                    }}>
                                    {genre}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {TAG_GROUPS.map(({ key, label, color }) => {
                          const tags = availableTags[key] as string[];
                          if (tags.length === 0) return null;
                          const selectedTags = prefs.tagFilters[key] as string[];
                          return (
                            <div key={key}>
                              <span className="text-[10px] uppercase tracking-widest font-semibold text-[#4b5568] block mb-2">{label}</span>
                              <div className="flex flex-wrap gap-1.5">
                                {tags.map(tag => {
                                  const active = selectedTags.includes(tag);
                                  return (
                                    <button key={tag} type="button"
                                      onClick={() => {
                                        const current = prefs.tagFilters[key] as string[];
                                        const next = current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag];
                                        setPrefs(p => ({ ...p, tagFilters: { ...p.tagFilters, [key]: next } }));
                                      }}
                                      className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border"
                                      style={{
                                        backgroundColor: active ? color.activeBg : 'transparent',
                                        color: active ? '#fff' : color.inactiveText,
                                        borderColor: active ? color.activeBorder : color.inactiveBorder,
                                      }}
                                    >
                                      {tag}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Card 2.5: Source — visible when there are imported playlists */}
              {importHistory.length > 0 && (
                <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-widest font-semibold text-[#4b5568] whitespace-nowrap">Source</span>
                    <div className="flex gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => { setPlaylistFilterId(null); setSourceDropdownOpen(false); }}
                        className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border"
                        style={{ backgroundColor: !playlistFilterId ? '#7c3aed' : 'transparent', color: !playlistFilterId ? '#fff' : '#64748b', borderColor: !playlistFilterId ? '#7c3aed' : '#2a2a3a' }}
                      >
                        Full Library
                      </button>
                      <div className="relative" ref={sourceDropdownRef}>
                        <button
                          type="button"
                          onClick={() => setSourceDropdownOpen(v => !v)}
                          className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border truncate max-w-[200px] flex items-center gap-1"
                          style={{ backgroundColor: playlistFilterId ? '#7c3aed' : 'transparent', color: playlistFilterId ? '#fff' : '#64748b', borderColor: playlistFilterId ? '#7c3aed' : '#2a2a3a' }}
                          title={playlistFilterId ? (importHistory.find(e => e.id === playlistFilterId)?.name ?? 'Playlist') : 'Generate from an imported playlist'}
                        >
                          <span className="truncate max-w-[160px]">
                            {playlistFilterId
                              ? (importHistory.find(e => e.id === playlistFilterId)?.name ?? 'Playlist')
                              : 'From Playlist'}
                          </span>
                          <svg className="w-3 h-3 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </button>
                        {sourceDropdownOpen && (
                          <div className="absolute left-0 top-full mt-1 z-30 bg-[#12121a] border border-[#2a2a3a] rounded-lg shadow-xl py-1 min-w-[220px] max-h-60 overflow-y-auto">
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2 text-xs text-[#64748b] hover:bg-[#1e1e2e] transition-colors"
                              onClick={() => { setPlaylistFilterId(null); setSourceDropdownOpen(false); }}
                            >
                              — Full Library (no filter) —
                            </button>
                            {importHistory.map(entry => {
                              const inLib = entry.tracks.filter(t => t.inLibrary).length;
                              const isSelected = playlistFilterId === entry.id;
                              return (
                                <button
                                  key={entry.id}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-[#1e1e2e] transition-colors flex items-center justify-between gap-2"
                                  style={{ color: isSelected ? '#a78bfa' : '#e2e8f0', backgroundColor: isSelected ? '#1e1a2e' : undefined }}
                                  onClick={() => { setPlaylistFilterId(entry.id); setSourceDropdownOpen(false); }}
                                >
                                  <span className="truncate">{entry.name}</span>
                                  <span className="shrink-0 text-[10px] text-[#64748b] whitespace-nowrap">{inLib}/{entry.tracks.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {playlistFilterId && (() => {
                    const entry = importHistory.find(e => e.id === playlistFilterId);
                    if (!entry) return null;
                    const inLib = entry.tracks.filter(t => t.inLibrary).length;
                    return (
                      <p className="text-[11px] text-[#64748b]">
                        <span className="text-[#94a3b8] font-medium">{inLib}</span> of {entry.tracks.length} tracks matched in your library
                        {inLib === 0 && <span className="text-[#f59e0b] ml-1">— no tracks found, add them first</span>}
                      </p>
                    );
                  })()}
                </div>
              )}

              {/* Card 3: Duration + Actions */}
              {(() => {
                const FALLBACK_DURATION = 210;
                const GAP = 10;
                const setTotalSeconds = generatedSet.reduce((s, t) => s + (t.duration ?? FALLBACK_DURATION) + GAP, 0);
                const setTotalMinutes = setTotalSeconds / 60;
                return (
              <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#4b5568] whitespace-nowrap">Duration</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {/* "Any" pill — unlimited mode */}
                    <button type="button"
                      onClick={() => setPrefs(p => ({ ...p, setDuration: null }))}
                      disabled={minViablePill !== null}
                      title={minViablePill !== null ? 'Not available in playlist mode' : undefined}
                      className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{ backgroundColor: prefs.setDuration === null ? '#7c3aed' : 'transparent', color: prefs.setDuration === null ? '#fff' : '#64748b', borderColor: prefs.setDuration === null ? '#7c3aed' : '#2a2a3a' }}
                    >
                      Any
                    </button>
                    {SET_DURATIONS.map(min => {
                      const active = prefs.setDuration === min;
                      const tooShort = minViablePill === null && generatedSet.length > 0 && prefs.setDuration !== null && min < setTotalMinutes;
                      // In playlist mode: only the min viable pill is enabled
                      const lockedByPlaylist = minViablePill !== null && min !== minViablePill;
                      const disabled = tooShort || lockedByPlaylist;
                      const title = tooShort
                        ? `Current set is ~${Math.ceil(setTotalMinutes)}m — select a longer duration`
                        : lockedByPlaylist
                        ? min < (minViablePill ?? 0)
                          ? `Playlist is ~${Math.ceil(playlistTotalMinutes)}m — too short`
                          : `Use ${minViablePill}m to match the playlist length`
                        : undefined;
                      return (
                        <button key={min} type="button"
                          onClick={() => { if (!disabled) setPrefs(p => ({ ...p, setDuration: min })); }}
                          disabled={disabled}
                          title={title}
                          className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border disabled:opacity-30 disabled:cursor-not-allowed"
                          style={{ backgroundColor: active ? '#7c3aed' : 'transparent', color: active ? '#fff' : '#64748b', borderColor: active ? '#7c3aed' : '#2a2a3a' }}
                        >
                          {min}m
                        </button>
                      );
                    })}
                  </div>
                  {filteredTrackCount > 0 && (
                    <span className="text-[10px] text-[#475569]">≈ {filteredTrackCount} tracks</span>
                  )}
                </div>
                {/* Primary CTA — Generate */}
                <button
                  onClick={() => {
                    if (library.length === 0 || isGenerating) return;
                    setIsGenerating(true);
                    setTimeout(() => {
                      handleGenerate();
                      setIsGenerating(false);
                    }, 0);
                  }}
                  disabled={isInitializing || library.length === 0 || isGenerating}
                  title="Generate a new set"
                  aria-label="Generate set"
                  className="w-full flex items-center justify-center gap-2.5 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg cursor-pointer transition-all duration-200"
                  style={{
                    background: isGenerating
                      ? 'linear-gradient(135deg, #6d28d9, #5b21b6)'
                      : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                    padding: '12px 16px',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    boxShadow: isGenerating ? 'none' : undefined,
                  }}
                  onMouseEnter={e => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.background = 'linear-gradient(135deg, #8b5cf6, #7c3aed)';
                      e.currentTarget.style.boxShadow = '0 0 20px rgba(124,58,237,0.4)';
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = isGenerating
                      ? 'linear-gradient(135deg, #6d28d9, #5b21b6)'
                      : 'linear-gradient(135deg, #7c3aed, #6d28d9)';
                    e.currentTarget.style.boxShadow = '';
                  }}
                >
                  {isGenerating ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="animate-pulse">
                        <polygon points="5,3 19,12 5,21"/>
                      </svg>
                      <span className="animate-pulse">Generating…</span>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5,3 19,12 5,21"/>
                      </svg>
                      Generate
                    </>
                  )}
                </button>
                {/* Secondary actions — subordinate ghost buttons */}
                <div className="flex gap-2">
                  <button onClick={handleRegenerate} disabled={isInitializing || library.length === 0} title="Different mix from the same tracks"
                    className="flex-1 flex items-center justify-center gap-1.5 border border-[#2a2a3a] hover:border-[#475569] disabled:opacity-40 disabled:cursor-not-allowed text-[#64748b] hover:text-[#94a3b8] text-xs font-medium py-1.5 rounded-md transition-all duration-200 cursor-pointer">
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                    </svg>
                    Shuffle
                  </button>
                  <button onClick={handleGenerateNew} disabled={!canGenerateNew}
                    title={canGenerateNew ? 'Generate from tracks not in the current set' : 'Not enough tracks outside the current set'}
                    className="flex-1 flex items-center justify-center gap-1.5 border border-[#2a2a3a] hover:border-[#475569] disabled:opacity-40 disabled:cursor-not-allowed text-[#64748b] hover:text-[#94a3b8] text-xs font-medium py-1.5 rounded-md transition-all duration-200 cursor-pointer">
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
                      <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
                    </svg>
                    New tracks
                  </button>
                </div>
                {generatedSet.length > 0 && (
                  <button
                    onClick={handleAppendTracks}
                    disabled={isInitializing || library.length === 0}
                    title="Generate more tracks and append them to the current set"
                    className="w-full flex items-center justify-center gap-2 bg-[#1e1e2e] hover:bg-[#2a2a3a] border border-[#2a2a3a] hover:border-[#7c3aed] disabled:opacity-40 disabled:cursor-not-allowed text-[#94a3b8] hover:text-[#a78bfa] text-sm font-medium py-2 rounded-md transition-colors cursor-pointer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Append tracks
                  </button>
                )}
              </div>
                );
              })()}
            </div>

            {/* ── RIGHT: Generated Set ── */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5 flex flex-col flex-1">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-[#475569]">
                    Generated Set
                  </h2>
                </div>
                <SetTracklist
                  tracks={generatedSet}
                  prefs={prefs}
                  libraryLoaded={library.length > 0}
                  showRekordboxExport={hasRekordboxFolder}
                  onSwapTrack={handleSwapTrack}
                  onToggleLock={handleToggleLock}
                  onRemoveTrack={handleRemoveTrack}
                  onReorderTrack={handleReorderTrack}
                  onUpdateTrack={handleUpdateTrack}
                  onExport={handleExportM3U}
                  onExportSpotify={hasSpotifyCredentials ? () => { void handleExportSpotify(); } : undefined}
                />

                {/* Crate Suggestions */}
                {generatedSet.length > 0 && setNeedsCrateSuggestions(generatedSet) && (() => {
                  const gaps = findCrateGaps(generatedSet, prefs);
                  if (gaps.length === 0) return null;
                  return (
                    <div className="mt-4 rounded-xl border border-[#f59e0b33] bg-[#0d0a00] p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <span className="text-xs font-semibold uppercase tracking-widest text-[#f59e0b]">Crate Suggestions</span>
                        <span className="text-[10px] text-[#78350f]">{gaps.length} gap{gaps.length !== 1 ? 's' : ''} found</span>
                      </div>
                      <ul className="space-y-2">
                        {gaps.map((gap, i) => (
                          <li key={i} className="flex items-start gap-3">
                            <span className="text-[10px] text-[#78350f] shrink-0 mt-0.5 w-8 text-right">{Math.round(gap.setPosition * 100)}%</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-[#fbbf24] font-mono truncate">{gap.suggestedSearch}</p>
                              <p className="text-[10px] text-[#78350f] mt-0.5">
                                keys: {gap.camelotNeeded.join(', ')} · energy ≈{gap.targetEnergy.toFixed(2)} · {gap.bpmRange.min}–{gap.bpmRange.max} BPM
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
              </div>
            </div>

          </div>
        </main>
      )}

      {activeTab === "History" && (
        <main className="px-2 py-6">
          <HistoryTab
            history={history}
            setHistory={setHistory}
            setImportHistory={setImportHistory}
            expandedHistoryId={expandedHistoryId}
            setExpandedHistoryId={setExpandedHistoryId}
            openHistoryExportId={openHistoryExportId}
            setOpenHistoryExportId={setOpenHistoryExportId}
            historyExportRef={historyExportRef}
            showRekordboxExport={hasRekordboxFolder}
            startSpotifyExport={hasSpotifyCredentials ? startSpotifyExport : undefined}
            handleRenameEntry={handleRenameEntry}
            onLoadEntry={handleLoadHistoryEntry}
          />
        </main>
      )}

      {activeTab === "Import" && (
        <main className="px-2 py-6">
          {/* Import input */}
          <div className="mb-6 rounded-xl border border-[#1e1e2e] bg-[#12121a] p-5">
            <div className="flex items-center gap-2 mb-3">
              <SpotifyIcon size={16} className="text-[#1db954] shrink-0" />
              <h2 className="text-sm font-semibold text-[#e2e8f0]">
                Import Spotify Playlist
              </h2>
              <span className="text-[10px] font-semibold bg-[#7c3aed22] text-[#a78bfa] border border-[#7c3aed44] px-1.5 py-0.5 rounded uppercase tracking-wide">Pro</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleImport();
                }}
                placeholder="Add playlist Spotify link"
                className="flex-1 bg-[#0d0d14] border border-[#2a2a3a] rounded-lg px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:border-[#7c3aed] transition-colors"
              />
              <button
                onClick={handleImport}
                disabled={
                  !importUrl.trim() || importStatus?.phase === "loading"
                }
                className="px-4 py-2 text-sm font-medium bg-[#7c3aed] text-white rounded-lg hover:bg-[#6d28d9] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Import
              </button>
              <button
                onClick={() => {
                  void handleBrowseSpotifyPlaylists();
                }}
                disabled={
                  loadingSpotifyPlaylists || importStatus?.phase === "loading"
                }
                className="px-4 py-2 text-sm font-medium border border-[#2a2a3a] text-[#94a3b8] rounded-lg hover:text-[#e2e8f0] hover:border-[#7c3aed] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap"
              >
                {loadingSpotifyPlaylists ? "Loading…" : "Browse my playlists"}
              </button>
            </div>
            {importStatus?.phase === "loading" && (
              <p className="mt-2 text-xs text-[#94a3b8]">
                {importStatus.total > 0
                  ? `Loading tracks… ${importStatus.loaded} / ${importStatus.total}`
                  : "Connecting to Spotify…"}
              </p>
            )}
            {importStatus?.phase === "error" && (
              <p className="mt-2 text-xs text-red-400">
                {importStatus.message}
                {' '}
                <span className="text-[#94a3b8]">For Spotify integration support, contact us at <a href="mailto:obo_odedr@hotmail.com" className="text-[#a78bfa] hover:underline">obo_odedr@hotmail.com</a>.</span>
              </p>
            )}
          </div>

          {/* Import history */}
          {importHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#475569] gap-3">
              <span className="text-4xl">🎵</span>
              <p className="text-sm">
                No playlists imported yet. Paste a Spotify playlist URL above.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {importHistory.map((entry) => {
                const isExpanded = expandedImportId === entry.id;
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
                const inLibraryCount = entry.tracks.filter(
                  (t) => t.inLibrary,
                ).length;
                const fuzzyCount = entry.tracks.filter(
                  (t) => t.inLibrary && t.matchConfidence === 'partial',
                ).length;

                return (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-[#1e1e2e] bg-[#12121a] overflow-hidden"
                  >
                    <div className="flex items-center">
                      <button
                        onClick={() =>
                          setExpandedImportId(isExpanded ? null : entry.id)
                        }
                        className="flex-1 min-w-0 flex items-center gap-3 px-5 py-4 text-left hover:bg-[#0d0d14] transition-colors cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[#e2e8f0] truncate">
                            {entry.name}
                          </div>
                          <div className="text-xs text-[#475569] mt-0.5">
                            {label}
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-3">
                          <span className="text-xs text-[#94a3b8]">
                            <span className="text-[#7c3aed] font-medium">
                              {inLibraryCount}
                            </span>
                            <span className="text-[#475569]">
                              {" "}
                              / {entry.tracks.length} in library
                            </span>
                            {fuzzyCount > 0 && (
                              <span className="ml-1.5 text-yellow-500/80" title={`${fuzzyCount} track${fuzzyCount > 1 ? 's' : ''} matched by title/artist (not exact)`}>
                                ~{fuzzyCount}
                              </span>
                            )}
                          </span>
                          <span className="text-[#475569] text-xs">
                            {isExpanded ? "▲" : "▼"}
                          </span>
                        </div>
                      </button>
                      <button
                        onClick={() => handleLoadImportToSet(entry)}
                        disabled={inLibraryCount === 0}
                        aria-label="Load to generator"
                        title={inLibraryCount === 0 ? 'No matched tracks to load' : `Load ${inLibraryCount} matched track${inLibraryCount !== 1 ? 's' : ''} into the generator`}
                        className="shrink-0 px-3 py-4 text-xs transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed text-[#475569] hover:text-[#7c3aed] disabled:hover:text-[#475569]"
                      >
                        →&nbsp;Set
                      </button>
                      {/* Import export dropdown */}
                      <div className="relative shrink-0" ref={openImportExportId === entry.id ? importExportRef : null}>
                        <button
                          onClick={() => setOpenImportExportId(id => id === entry.id ? null : entry.id)}
                          disabled={inLibraryCount === 0 || entry.tracks.length === 0}
                          title={inLibraryCount !== entry.tracks.length ? `${entry.tracks.length - inLibraryCount} track(s) missing` : 'Export'}
                          className="px-3 py-4 text-xs transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed text-[#475569] hover:text-[#a78bfa] disabled:hover:text-[#475569]"
                        >
                          Export <span className="text-[9px]">▾</span>
                        </button>
                        {openImportExportId === entry.id && (
                          <div className="absolute right-0 bottom-full mb-1 z-20 min-w-[175px] rounded-md border border-[#2a2a3a] bg-[#12121a] shadow-lg overflow-hidden">
                            <button
                              onClick={() => { void handleExportImportM3U(entry); setOpenImportExportId(null); }}
                              className="w-full text-left flex items-center gap-2 px-3 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                            ><M3UIcon size={13} className="shrink-0 opacity-60" />Export as M3U</button>
                            {hasRekordboxFolder && (
                            <button
                              onClick={() => { handleExportImportRekordbox(entry); setOpenImportExportId(null); }}
                              className="w-full text-left flex items-center gap-2 px-3 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#1e1e2e]"
                            ><RekordboxIcon size={13} className="shrink-0 opacity-60" />Export to Rekordbox</button>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => void reloadEntry(entry)}
                        aria-label="Reload from Spotify"
                        title="Reload from Spotify"
                        className="shrink-0 px-3 py-4 text-[#475569] hover:text-[#7c3aed] transition-colors cursor-pointer"
                      >
                        ↻
                      </button>
                      <button
                        onClick={() => {
                          setImportHistory(prev => prev.filter(e => e.id !== entry.id));
                          if (expandedImportId === entry.id) setExpandedImportId(null);
                        }}
                        aria-label="Remove playlist"
                        className="shrink-0 px-4 py-4 text-[#475569] hover:text-red-400 transition-colors cursor-pointer"
                      >
                        ✕
                      </button>
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
                              <th className="py-2 px-2 pr-5 text-left text-[10px] font-semibold text-[#475569] uppercase tracking-wider w-8"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.tracks.map((track, idx) => (
                              <tr
                                key={`${track.spotifyId}-${idx}`}
                                className={`group border-t border-[#1e1e2e] ${
                                  track.unavailable
                                    ? "opacity-40"
                                    : !track.inLibrary
                                      ? "bg-red-950/20 hover:bg-red-950/30"
                                      : track.matchConfidence === 'partial'
                                        ? "bg-yellow-950/20 hover:bg-yellow-950/30"
                                        : "hover:bg-[#0d0d14]"
                                }`}
                              >
                                <td className="py-2.5 pl-5 pr-2 w-10">
                                  <span
                                    className={`group-hover:hidden text-xs tabular-nums ${!track.inLibrary ? "text-red-500/60" : track.matchConfidence === 'partial' ? "text-yellow-500/60" : "text-[#475569]"}`}
                                  >
                                    {idx + 1}
                                  </span>
                                  {!track.unavailable && (
                                    <button
                                      onClick={() => {
                                        if (track.inLibrary) {
                                          void apiFetch("/api/play-in-music", {
                                            method: "POST",
                                            headers: {
                                              "Content-Type":
                                                "application/json",
                                            },
                                            body: JSON.stringify({
                                              artist: track.artist,
                                              title: track.title,
                                            }),
                                          });
                                        } else {
                                          window.open(
                                            `spotify:track:${track.spotifyId}`,
                                          );
                                        }
                                      }}
                                      className="hidden group-hover:flex items-center justify-center text-[#7c3aed] hover:text-white cursor-pointer transition-colors"
                                      title={
                                        track.inLibrary
                                          ? "Play in Apple Music"
                                          : "Play in Spotify"
                                      }
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
                                  )}
                                </td>
                                <td className="py-2.5 px-2">
                                  <div
                                    className={`text-sm ${track.unavailable ? "text-[#475569] italic" : !track.inLibrary ? "text-red-400" : track.matchConfidence === 'partial' ? "text-yellow-300/90" : "text-[#22c55e]/90"}`}
                                  >
                                    {track.title}
                                  </div>
                                  {track.artist && (
                                    <div
                                      className={`text-[11px] ${!track.inLibrary ? "text-red-500/70" : track.matchConfidence === 'partial' ? "text-yellow-500/70" : "text-[#22c55e]/50"}`}
                                    >
                                      {track.artist}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-2 pr-5">
                                  {(track.inLibrary && track.matchConfidence !== 'partial') || track.unavailable
                                    ? null
                                    : (() => {
                                        const key = `${entry.id}-${track.spotifyId}-${idx}`;
                                        const primaryArtist = track.artist
                                          ? track.artist.split(/\s*[,&]\s*/)[0].trim()
                                          : '';
                                        const normalizedTitle = track.title.replace(/\s+-\s+/g, ' ');
                                        const baseTitle = track.title
                                          .replace(/\s+-\s+.*?(remix|mix|edit|dub|instrumental|rework|bootleg|flip|version|vip)\s*$/i, '')
                                          .replace(/\s+\(.*?(remix|mix|edit|dub|instrumental|rework|bootleg|flip|version|vip)\s*\)\s*$/i, '')
                                          .trim() || normalizedTitle;
                                        const qFull = encodeURIComponent(
                                          [primaryArtist, normalizedTitle].filter(Boolean).join(' '),
                                        );
                                        const qTitle = encodeURIComponent(baseTitle);
                                        const isSearchOpen = manualMatchKey === key;
                                        const searchResults = isSearchOpen && manualMatchQuery.trim()
                                          ? library
                                              .filter(s => {
                                                const q = manualMatchQuery.toLowerCase();
                                                return (
                                                  s.title.toLowerCase().includes(q) ||
                                                  (s.artist ?? '').toLowerCase().includes(q)
                                                );
                                              })
                                              .slice(0, 8)
                                          : [];
                                        return (
                                          <div className="flex items-center gap-1.5">
                                            {/* Store links button */}
                                            <div
                                              ref={openStoreLinkKey === key ? storeLinkRef : null}
                                              className="relative inline-block"
                                            >
                                              <button
                                                onClick={() =>
                                                  setOpenStoreLinkKey(
                                                    openStoreLinkKey === key ? null : key,
                                                  )
                                                }
                                                className="text-[#475569] hover:text-[#7c3aed] transition-colors cursor-pointer"
                                                title="Find this track"
                                              >
                                                <svg
                                                  xmlns="http://www.w3.org/2000/svg"
                                                  width="16"
                                                  height="16"
                                                  viewBox="0 0 24 24"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  strokeWidth="2"
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                >
                                                  <circle cx="8" cy="21" r="1" fill="currentColor" stroke="none" />
                                                  <circle cx="19" cy="21" r="1" fill="currentColor" stroke="none" />
                                                  <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
                                                  <path d="M11 16v-5l5-1.3v5" strokeWidth="1.5" />
                                                  <circle cx="11" cy="16" r="1.1" fill="currentColor" stroke="none" />
                                                  <circle cx="16" cy="14.7" r="1.1" fill="currentColor" stroke="none" />
                                                </svg>
                                              </button>
                                              {openStoreLinkKey === key && (
                                                <div className="absolute right-0 bottom-full mb-1 z-10 min-w-[160px] rounded-md border border-[#2a2a3a] bg-[#12121a] shadow-lg overflow-hidden">
                                                  <div className="px-4 py-2 text-[10px] text-[#475569] uppercase tracking-wider border-b border-[#1e1e2e]">Find on…</div>
                                                  <a
                                                    href={`https://www.beatport.com/search/tracks?q=${qFull}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={() => setOpenStoreLinkKey(null)}
                                                    className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                                                  >
                                                    <img src="https://www.google.com/s2/favicons?domain=beatport.com&sz=16" width="14" height="14" className="rounded-sm flex-shrink-0" alt="" />
                                                    Beatport
                                                  </a>
                                                  <a
                                                    href={`https://bandcamp.com/search?q=${qTitle}&item_type=t`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={() => setOpenStoreLinkKey(null)}
                                                    className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#1e1e2e]"
                                                  >
                                                    <img src="https://www.google.com/s2/favicons?domain=bandcamp.com&sz=16" width="14" height="14" className="rounded-sm flex-shrink-0" alt="" />
                                                    Bandcamp
                                                  </a>
                                                  <a
                                                    href={`https://www.traxsource.com/search?term=${qFull}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={() => setOpenStoreLinkKey(null)}
                                                    className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#1e1e2e]"
                                                  >
                                                    <img src="https://www.google.com/s2/favicons?domain=traxsource.com&sz=16" width="14" height="14" className="rounded-sm flex-shrink-0" alt="" />
                                                    Traxsource
                                                  </a>
                                                </div>
                                              )}
                                            </div>
                                            {/* Manual library search button */}
                                            <div
                                              ref={isSearchOpen ? manualSearchRef : null}
                                              className="relative inline-block"
                                            >
                                              <button
                                                onClick={() => {
                                                  if (isSearchOpen) {
                                                    setManualMatchKey(null);
                                                    setManualMatchQuery('');
                                                  } else {
                                                    setManualMatchKey(key);
                                                    setManualMatchQuery('');
                                                    setOpenStoreLinkKey(null);
                                                  }
                                                }}
                                                className={`transition-colors cursor-pointer ${isSearchOpen ? 'text-[#7c3aed]' : 'text-[#475569] hover:text-[#7c3aed]'}`}
                                                title="Search in library"
                                                aria-label="Search in library"
                                              >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                  <circle cx="11" cy="11" r="8" />
                                                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                                </svg>
                                              </button>
                                              {isSearchOpen && (
                                                <div className="absolute right-0 bottom-full mb-1 z-20 w-64 rounded-md border border-[#2a2a3a] bg-[#12121a] shadow-xl overflow-hidden">
                                                  <input
                                                    autoFocus
                                                    type="text"
                                                    value={manualMatchQuery}
                                                    onChange={e => setManualMatchQuery(e.target.value)}
                                                    onKeyDown={e => { if (e.key === 'Escape') { setManualMatchKey(null); setManualMatchQuery(''); } }}
                                                    placeholder="Search library…"
                                                    className="w-full bg-transparent px-3 py-2 text-xs text-[#e2e8f0] placeholder-[#475569] focus:outline-none border-b border-[#1e1e2e]"
                                                  />
                                                  {searchResults.length > 0 ? (
                                                    <div className="max-h-48 overflow-y-auto">
                                                      {searchResults.map(song => (
                                                        <button
                                                          key={song.file}
                                                          onClick={() => {
                                                            setImportHistory(prev => prev.map(e => e.id === entry.id
                                                              ? {
                                                                  ...e,
                                                                  tracks: e.tracks.map((t, i) => i === idx
                                                                    ? { ...t, inLibrary: true, matchConfidence: 'exact' as const, manualMatchFile: song.file }
                                                                    : t
                                                                  ),
                                                                }
                                                              : e
                                                            ));
                                                            setManualMatchKey(null);
                                                            setManualMatchQuery('');
                                                          }}
                                                          className="w-full text-left px-3 py-2 text-xs hover:bg-[#1a1a2e] transition-colors border-t border-[#1e1e2e] first:border-t-0 cursor-pointer"
                                                        >
                                                          <div className="text-[#e2e8f0] truncate">{song.title}</div>
                                                          <div className="text-[#475569] truncate">{song.artist}</div>
                                                        </button>
                                                      ))}
                                                    </div>
                                                  ) : manualMatchQuery.trim() ? (
                                                    <div className="px-3 py-2.5 text-xs text-[#475569]">No results</div>
                                                  ) : (
                                                    <div className="px-3 py-2.5 text-xs text-[#475569]">Type to search your library…</div>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })()}
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
          )}
        </main>
      )}

      {spotifyPlaylistPicker && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setSpotifyPlaylistPicker(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[#2a2a3a] bg-[#12121a] flex flex-col max-h-[70vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e] shrink-0">
              <h3 className="text-sm font-semibold text-[#e2e8f0]">
                Your Spotify Playlists
              </h3>
              <button
                className="text-xs text-[#94a3b8] hover:text-[#e2e8f0] cursor-pointer"
                onClick={() => setSpotifyPlaylistPicker(null)}
              >
                Close
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {spotifyPlaylistPicker.length === 0 ? (
                <p className="text-sm text-[#94a3b8] px-4 py-6 text-center">
                  No playlists found.
                </p>
              ) : (
                spotifyPlaylistPicker.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={() => {
                      setSpotifyPlaylistPicker(null);
                      void runImport(
                        `https://open.spotify.com/playlist/${pl.id}`,
                        library,
                      );
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 border-b border-[#1e1e2e] hover:bg-[#1a1a2e] transition-colors cursor-pointer text-left"
                  >
                    {pl.imageUrl && (
                      <img
                        src={pl.imageUrl}
                        alt=""
                        className="w-9 h-9 rounded object-cover shrink-0"
                      />
                    )}
                    {!pl.imageUrl && (
                      <div className="w-9 h-9 rounded bg-[#2a2a3a] shrink-0 flex items-center justify-center text-[#475569] text-xs">
                        ♪
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[#e2e8f0] truncate">
                        {pl.name}
                      </div>
                      <div className="text-[11px] text-[#475569]">
                        {pl.trackCount} tracks
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {playlistPicker && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => { setPlaylistPicker(null); setPlaylistSearch(''); }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[#2a2a3a] bg-[#12121a] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#e2e8f0]">
                Select a Playlist
              </h3>
              <button
                className="text-xs text-[#94a3b8] hover:text-[#e2e8f0] cursor-pointer"
                onClick={() => { setPlaylistPicker(null); setPlaylistSearch(''); }}
              >
                Close
              </button>
            </div>
            {playlistPicker.length > 0 && (
              <input
                type="text"
                placeholder="Search playlists…"
                value={playlistSearch}
                onChange={(e) => setPlaylistSearch(e.target.value)}
                autoFocus
                className="w-full mb-3 px-3 py-2 text-sm rounded-md border border-[#2a2a3a] bg-[#0d0d14] text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:border-[#7c3aed] transition-colors"
              />
            )}
            {playlistPicker.length === 0 ? (
              <p className="text-sm text-[#94a3b8] py-4">
                No playlists found in Apple Music.
              </p>
            ) : (() => {
              const filtered = playlistPicker.filter(p =>
                p.name.toLowerCase().includes(playlistSearch.toLowerCase())
              );
              return filtered.length === 0 ? (
                <p className="text-sm text-[#94a3b8] py-4 text-center">No playlists match "{playlistSearch}".</p>
              ) : (
                <div className="flex flex-col gap-1 max-h-[55vh] overflow-y-auto">
                  {filtered.map((playlist) => {
                    const imported = analyzedApplePlaylists.has(playlist.name) || importHistory.some(e => e.name === playlist.name);
                    return (
                      <button
                        key={playlist.name}
                        onClick={() => runAppleMusicAnalysis(playlist.name)}
                        className="w-full text-left rounded-md border px-3 py-2.5 hover:border-[#7c3aed] transition-colors cursor-pointer"
                        style={{ borderColor: imported ? '#16a34a' : '#2a2a3a', backgroundColor: imported ? '#0d1f13' : '#0d0d14' }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-[#e2e8f0]">{playlist.name}</span>
                          {imported && (
                            <svg className="w-4 h-4 text-[#22c55e] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          )}
                        </div>
                        <div className="text-[11px] text-[#475569] mt-0.5">
                          {playlist.count} track{playlist.count === 1 ? "" : "s"}
                          {imported && <span className="text-[#16a34a] ml-1.5">· imported</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {swapModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setSwapModal(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[#2a2a3a] bg-[#12121a] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[#64748b]">
                Best replacements
              </h3>
              <button
                className="text-xs text-[#475569] hover:text-[#e2e8f0] cursor-pointer transition-colors"
                onClick={() => setSwapModal(null)}
              >
                ✕
              </button>
            </div>

            {swapModal.suggestions.length === 0 ? (
              <p className="text-sm text-[#475569] py-4 text-center">
                No other tracks in your library fit this slot well enough.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-[#1e1e2e]">
                {swapModal.suggestions.map(({ song, breakdown }) => {
                  const color = camelotColor(song.camelot);
                  const eDeltaSign = breakdown.energyDelta >= 0 ? '+' : '';
                  const harmonicOk = (breakdown.harmonicPrev ?? 1) >= 0.75 && (breakdown.harmonicNext ?? 1) >= 0.75;
                  const bpmOk = Math.abs(breakdown.bpmDeltaPrev ?? 0) <= 8 && Math.abs(breakdown.bpmDeltaNext ?? 0) <= 8;
                  return (
                    <button
                      key={song.file}
                      onClick={() => applySwapSuggestion(song)}
                      className="w-full text-left px-2 py-3 hover:bg-[#0d0d14] transition-colors cursor-pointer group rounded-lg"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[#e2e8f0] truncate group-hover:text-white">
                            {song.title}
                          </div>
                          <div className="text-xs text-[#64748b] truncate mt-0.5">
                            {song.artist}
                          </div>
                        </div>
                        {/* Key badge */}
                        {song.camelot && (
                          <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold mt-0.5"
                            style={{ backgroundColor: color + '26', color, border: `1px solid ${color}44` }}>
                            {song.camelot}
                          </span>
                        )}
                      </div>
                      {/* Stats row */}
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[10px] tabular-nums" style={{ color: bpmOk ? '#475569' : '#f59e0b' }}>
                          {song.bpm > 0 ? `${Math.round(song.bpm)} BPM` : '—'}
                        </span>
                        <span className="text-[10px] tabular-nums" style={{ color: Math.abs(breakdown.energyDelta) <= 0.2 ? '#475569' : '#f59e0b' }}>
                          E {eDeltaSign}{(breakdown.energyDelta * 100).toFixed(0)}%
                        </span>
                        {/* Signal dots */}
                        <div className="flex items-center gap-1 ml-auto">
                          <span title="Harmonic fit" style={{ color: harmonicOk ? '#22c55e' : '#f59e0b', fontSize: 8 }}>♪</span>
                          {breakdown.venueFit && <span title="Venue fit" style={{ color: '#22c55e', fontSize: 8 }}>✦</span>}
                          {breakdown.tagOverlap && <span title="Shared vibe tags" style={{ color: '#a855f7', fontSize: 8 }}>●</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {spotifyExportStatus && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => {
            if (
              spotifyExportStatus.phase === "done" ||
              spotifyExportStatus.phase === "error"
            ) {
              setSpotifyExportStatus(null);
            }
          }}
        >
          <div
            className={`w-full rounded-xl border border-[#2a2a3a] bg-[#12121a] p-6 ${spotifyExportStatus.phase === "review" ? "max-w-lg" : "max-w-sm"}`}
            onClick={(e) => e.stopPropagation()}
          >
            {spotifyExportStatus.phase === "searching" && (
              <>
                <h3 className="text-sm font-semibold text-[#e2e8f0] mb-4">
                  Searching Spotify…
                </h3>
                <div className="flex flex-col gap-3">
                  <div className="w-full h-1.5 rounded-full bg-[#1f2937] overflow-hidden">
                    <div
                      className="h-full bg-[#1db954] transition-all"
                      style={{
                        width:
                          spotifyExportStatus.total > 0
                            ? `${Math.round((spotifyExportStatus.completed / spotifyExportStatus.total) * 100)}%`
                            : "0%",
                      }}
                    />
                  </div>
                  <span className="text-xs text-[#94a3b8] tabular-nums">
                    {spotifyExportStatus.completed} /{" "}
                    {spotifyExportStatus.total} tracks
                  </span>
                </div>
              </>
            )}

            {spotifyExportStatus.phase === "review" && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-[#e2e8f0]">
                    Review Spotify matches
                  </h3>
                  <span className="text-xs text-[#475569]">
                    {
                      spotifyExportStatus.matches.filter(
                        (m) => m.match && !m.excluded,
                      ).length
                    }{" "}
                    / {spotifyExportStatus.matches.length} will be added
                  </span>
                </div>
                <div className="flex flex-col max-h-[55vh] overflow-y-auto mb-4">
                  {spotifyExportStatus.matches.map(
                    ({ track, match, confidence, excluded }, idx) => (
                      <div
                        key={track.file}
                        className={`grid grid-cols-[20px_1fr_1fr_24px] gap-2 items-start py-1.5 border-b border-[#1e1e2e] last:border-0 ${excluded ? "opacity-40" : ""}`}
                      >
                        <span className="text-[11px] text-[#475569] tabular-nums pt-0.5">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs text-[#e2e8f0] truncate">
                            {track.title}
                          </div>
                          <div className="text-[11px] text-[#475569] truncate">
                            {track.artist}
                          </div>
                        </div>
                        <div className="min-w-0">
                          {match ? (
                            <>
                              <div
                                className={`text-xs truncate ${confidence === "exact" ? "text-[#1db954]" : "text-[#f59e0b]"}`}
                              >
                                {match.name}
                              </div>
                              <div className="text-[11px] text-[#475569] truncate">
                                {match.artists}
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-[#ef4444]">
                              Not found
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handleToggleSpotifyMatch(idx)}
                          title={
                            excluded ? "Re-include" : "Remove from playlist"
                          }
                          className="mt-0.5 text-[#475569] hover:text-[#e2e8f0] transition-colors cursor-pointer text-xs leading-none"
                        >
                          {excluded ? "↩" : "✕"}
                        </button>
                      </div>
                    ),
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      void handleConfirmSpotifyExport(
                        spotifyExportStatus.matches,
                        spotifyExportStatus.playlistName,
                      );
                    }}
                    disabled={spotifyExportStatus.matches.every(
                      (m) => !m.match || m.excluded,
                    )}
                    className="flex-1 px-4 py-2 rounded-md bg-[#1db954] text-[#000] text-sm font-semibold hover:bg-[#1ed760] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Create playlist
                  </button>
                  <button
                    onClick={() => setSpotifyExportStatus(null)}
                    className="px-4 py-2 rounded-md border border-[#2a2a3a] text-sm text-[#94a3b8] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {spotifyExportStatus.phase === "creating" && (
              <p className="text-sm text-[#94a3b8]">Creating playlist…</p>
            )}

            {spotifyExportStatus.phase === "done" && (
              <>
                <h3 className="text-sm font-semibold text-[#e2e8f0] mb-3">
                  Playlist created
                </h3>
                <p className="text-sm text-[#94a3b8] mb-4">
                  {spotifyExportStatus.matched} of {spotifyExportStatus.total}{" "}
                  tracks added.
                </p>
                <div className="flex gap-2">
                  <a
                    href={spotifyExportStatus.playlistUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setSpotifyExportStatus(null)}
                    className="flex-1 text-center px-4 py-2 rounded-md bg-[#1db954] text-[#000] text-sm font-semibold hover:bg-[#1ed760] transition-colors"
                  >
                    Open in Spotify
                  </a>
                  <button
                    onClick={() => setSpotifyExportStatus(null)}
                    className="px-4 py-2 rounded-md border border-[#2a2a3a] text-sm text-[#94a3b8] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </>
            )}

            {spotifyExportStatus.phase === "error" && (
              <>
                <h3 className="text-sm font-semibold text-[#ef4444] mb-3">
                  Export failed
                </h3>
                <p className="text-sm text-[#94a3b8] mb-4">
                  {spotifyExportStatus.message}
                </p>
                <button
                  onClick={() => setSpotifyExportStatus(null)}
                  className="px-4 py-2 rounded-md border border-[#2a2a3a] text-sm text-[#94a3b8] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <AIPlannerPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        availableGenres={availableGenres}
        librarySize={library.length}
        onApplyPlan={handleApplyPlan}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => { loadSettings(); setLibrary([]); setGeneratedSet([]); }}
        onDatabaseCleared={() => setAnalyzedApplePlaylists(new Set())}
      />

    </div>
  );
}
