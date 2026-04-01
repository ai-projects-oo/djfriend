import { useState, useCallback, useEffect, useRef } from "react";
import type {
  HistoryEntry,
} from "./types";
import EnergyCurveEditor from "./components/EnergyCurveEditor";
import SetTracklist from "./components/SetTracklist";
import SettingsModal from "./components/SettingsModal";
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
} from "./lib/spotifyImport";
import { useLibrary } from "./hooks/useLibrary";
import { useSetGenerator } from "./hooks/useSetGenerator";
import { useSpotifyExport } from "./hooks/useSpotifyExport";
import { useSpotifyImport } from "./hooks/useSpotifyImport";
import { apiFetch, setAppPassword, getAppPassword } from "./lib/apiFetch";

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
  const [openHistoryExportId, setOpenHistoryExportId] = useState<string | null>(
    null,
  );
  const historyExportRef = useRef<HTMLDivElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(() =>
    localStorage.getItem('djfriend-onboarding-dismissed') === 'true'
  );
  const [playlistsFolder, setPlaylistsFolder] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [analyzeMenuOpen, setAnalyzeMenuOpen] = useState(false);
  const analyzeMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rbFileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFolderInputRef = useRef<HTMLInputElement | null>(null);

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

  // Click-outside for history export dropdown
  useEffect(() => {
    if (!openHistoryExportId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        historyExportRef.current &&
        !historyExportRef.current.contains(e.target as Node)
      ) {
        setOpenHistoryExportId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openHistoryExportId]);

  // Stable ref used to bridge setGeneratedSet (from useSetGenerator) into useLibrary's onNewAnalysis callback
  const onNewAnalysisRef = useRef<(() => void) | undefined>(undefined);

  const {
    library,
    setLibrary,
    libraryName,
    isAnalyzing,
    analysisProgress,
    folderPath,
    setFolderPath,
    playlistPicker,
    setPlaylistPicker,
    loadingPlaylists,
    analyzedApplePlaylists,
    error,
    openPlaylistPicker,
    runAppleMusicAnalysis,
    runFolderAnalysis,
    runPathListAnalysis,
    runRekordboxImport,
    runUploadAnalysis,
  } = useLibrary({ onNewAnalysis: () => onNewAnalysisRef.current?.() });

  const {
    prefs,
    setPrefs,
    curve,
    setCurve,
    generatedSet,
    setGeneratedSet,
    autoRegen,
    setAutoRegen,
    swapModal,
    setSwapModal,
    swapVisibleCount,
    setSwapVisibleCount,
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
    handleRemoveTrack,
    handleReorderTrack,
    handleUpdateTrack,
  } = useSetGenerator(library, setLibrary);

  // Wire setGeneratedSet into the bridge ref so useLibrary can reset the set on new analysis
  onNewAnalysisRef.current = () => setGeneratedSet([]);

  const handleLoadHistoryEntry = useCallback((entry: HistoryEntry) => {
    setPrefs(entry.prefs);
    setCurve(entry.curve);
    setGeneratedSet(entry.tracks);
    setAutoRegen(true);
    setActiveTab("Generator");
  }, [setPrefs, setCurve, setGeneratedSet, setAutoRegen]);

  const {
    spotifyExportStatus,
    setSpotifyExportStatus,
    m3uSavedPath,
    exportM3UToServer,
    handleExportM3U,
    startSpotifyExport,
    handleExportSpotify,
    handleToggleSpotifyMatch,
    handleConfirmSpotifyExport,
    handleRenameEntry,
  } = useSpotifyExport({ generatedSet, prefs, curve, playlistsFolder, setHistory });

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
    handleImport,
    handleBrowseSpotifyPlaylists,
  } = useSpotifyImport({ library, setHistory });

  const loadSettings = useCallback(() => {
    apiFetch('/api/settings')
      .then(r => r.json() as Promise<{ musicFolder?: string; playlistsFolder?: string }>)
      .then(d => {
        if (d.musicFolder) setFolderPath(prev => prev || d.musicFolder!)
        if (d.playlistsFolder !== undefined) setPlaylistsFolder(d.playlistsFolder)
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

  const progressPercent =
    analysisProgress.total > 0
      ? Math.min(
          100,
          Math.round(
            (analysisProgress.completed / analysisProgress.total) * 100,
          ),
        )
      : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#e2e8f0]">
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
          </div>

          <div className="flex items-center gap-2">
            {error && (
              <span className="text-xs text-[#ef4444] hidden sm:inline">
                {error}
              </span>
            )}
            {isAnalyzing && (
              <div className="hidden sm:flex items-center gap-2 min-w-[180px]">
                <div className="w-28 h-1.5 rounded-full bg-[#1f2937] overflow-hidden">
                  <div
                    className="h-full bg-[#7c3aed] transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="text-[10px] text-[#94a3b8] tabular-nums">
                  {analysisProgress.completed}/{analysisProgress.total}
                </span>
              </div>
            )}
            <div className="relative">
              <button
                onClick={() => { setSettingsOpen(true); if (!onboardingDismissed) { setOnboardingDismissed(true); localStorage.setItem('djfriend-onboarding-dismissed', 'true'); } }}
                title="Settings"
                className="p-1.5 text-[#475569] hover:text-[#94a3b8] transition-colors cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
              {!folderPath.trim() && !onboardingDismissed && (
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
                const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
                void runPathListAnalysis(lines, file.name.replace(/\.[^.]+$/, ''));
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
                disabled={isAnalyzing || loadingPlaylists}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-[#2a2a3a] bg-[#12121a] text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAnalyzing ? "Analyzing…" : loadingPlaylists ? "Loading…" : "Analyze"}
                <span className="text-[10px]">▾</span>
              </button>
              {analyzeMenuOpen && !isAnalyzing && !loadingPlaylists && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-md border border-[#2a2a3a] bg-[#12121a] shadow-lg overflow-hidden">
                  <button
                    onClick={() => { setAnalyzeMenuOpen(false); void openPlaylistPicker(); }}
                    className="w-full text-left px-4 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                  >
                    Apple Music
                  </button>
                  <button
                    onClick={() => { setAnalyzeMenuOpen(false); fileInputRef.current?.click(); }}
                    className="w-full text-left px-4 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#1e1e2e]"
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
          {(["Generator", "History", "Import"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === tab
                  ? "border-[#7c3aed] text-[#e2e8f0]"
                  : "border-transparent text-[#475569] hover:text-[#94a3b8]"
              }`}
            >
              {tab}
              {tab === "History" && history.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-[#2a2a3a] text-[#94a3b8] px-1.5 py-0.5 rounded-full">
                  {history.length}
                </span>
              )}
              {tab === "Import" && importHistory.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-[#2a2a3a] text-[#94a3b8] px-1.5 py-0.5 rounded-full">
                  {importHistory.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="sm:hidden px-4 pt-3">
          <p className="text-xs text-[#ef4444]">{error}</p>
        </div>
      )}

      {activeTab === "Generator" && library.length === 0 && (
        <div className="px-2 pt-6">
          <div className="rounded-lg border border-[#2a2a3a] bg-[#12121a] px-5 py-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={folderPath}
                onChange={e => setFolderPath(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void runFolderAnalysis(folderPath) }}
                placeholder="/path/to/music folder"
                className="flex-1 rounded-md border border-[#2a2a3a] bg-[#0d0d14] px-3 py-1.5 text-sm text-[#e2e8f0] placeholder-[#334155] focus:outline-none focus:border-[#7c3aed] transition-colors"
              />
              <button
                onClick={() => void runFolderAnalysis(folderPath)}
                disabled={isAnalyzing || !folderPath.trim()}
                className="px-3 py-1.5 text-sm rounded-md border border-[#2a2a3a] bg-[#12121a] text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAnalyzing ? 'Analyzing…' : 'Analyze Folder'}
              </button>
            </div>
            <p className="text-xs text-[#475569] mt-2">
              Or{" "}
              <button
                onClick={openPlaylistPicker}
                className="text-[#7c3aed] hover:underline cursor-pointer bg-transparent border-none p-0"
              >
                Analyze Apple Music
              </button>
            </p>
          </div>
        </div>
      )}

      {activeTab === "Generator" && (
        <main className="px-2 py-6">
          <div className="flex flex-col lg:flex-row lg:items-start gap-4">

            {/* ── LEFT SIDEBAR ── */}
            <div className="lg:w-96 xl:w-[26rem] flex-shrink-0 flex flex-col gap-4">

              {/* Card 1: Energy Curve */}
              <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-[#64748b]">
                    Energy Curve
                  </h2>
                  {autoRegen && (
                    <span className="text-[10px] text-[#475569] bg-[#0d0d14] border border-[#1e1e2e] px-2 py-0.5 rounded">
                      Live
                    </span>
                  )}
                </div>
                <EnergyCurveEditor points={curve} onChange={handleCurveChange} />
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

              {/* Card 3: Duration + Actions */}
              <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#4b5568] whitespace-nowrap">Duration</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {[30, 45, 60, 90, 120, 180].map(min => (
                      <button key={min} type="button"
                        onClick={() => setPrefs(p => ({ ...p, setDuration: min }))}
                        className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border"
                        style={{ backgroundColor: prefs.setDuration === min ? '#7c3aed' : 'transparent', color: prefs.setDuration === min ? '#fff' : '#64748b', borderColor: prefs.setDuration === min ? '#7c3aed' : '#2a2a3a' }}
                      >
                        {min}m
                      </button>
                    ))}
                  </div>
                  {filteredTrackCount > 0 && (
                    <span className="text-[10px] text-[#475569]">≈ {filteredTrackCount} tracks</span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={handleGenerate} disabled={library.length === 0} title="Generate a new set"
                    className="flex items-center justify-center gap-2 bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 rounded-md transition-colors cursor-pointer">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                    Generate
                  </button>
                  <button onClick={handleRegenerate} disabled={library.length === 0} title="Different mix from the same tracks"
                    className="flex items-center justify-center gap-2 bg-[#1e1e2e] hover:bg-[#2a2a3a] border border-[#2a2a3a] hover:border-[#475569] disabled:opacity-40 disabled:cursor-not-allowed text-[#94a3b8] hover:text-[#e2e8f0] text-sm font-medium py-2.5 rounded-md transition-colors cursor-pointer">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                    </svg>
                    Shuffle
                  </button>
                  <button onClick={handleGenerateNew} disabled={!canGenerateNew}
                    title={canGenerateNew ? 'Generate from tracks not in the current set' : 'Not enough tracks outside the current set'}
                    className="flex items-center justify-center gap-2 bg-[#1e1e2e] hover:bg-[#2a2a3a] border border-[#2a2a3a] hover:border-[#475569] disabled:opacity-40 disabled:cursor-not-allowed text-[#94a3b8] hover:text-[#e2e8f0] text-sm font-medium py-2.5 rounded-md transition-colors cursor-pointer">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
                      <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
                    </svg>
                    New tracks
                  </button>
                </div>
              </div>
            </div>

            {/* ── RIGHT: Generated Set ── */}
            <div className="flex-1 min-w-0">
              <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-[#475569] mb-4">
                  Generated Set
                </h2>
                <SetTracklist
                  tracks={generatedSet}
                  prefs={prefs}
                  libraryLoaded={library.length > 0}
                  onSwapTrack={handleSwapTrack}
                  onRemoveTrack={handleRemoveTrack}
                  onReorderTrack={handleReorderTrack}
                  onUpdateTrack={handleUpdateTrack}
                  onExport={handleExportM3U}
                  onExportSpotify={() => { void handleExportSpotify(); }}
                />
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
            playlistsFolder={playlistsFolder}
            exportM3UToServer={exportM3UToServer}
            startSpotifyExport={startSpotifyExport}
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

                return (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-[#1e1e2e] bg-[#12121a] overflow-hidden"
                  >
                    <button
                      onClick={() =>
                        setExpandedImportId(isExpanded ? null : entry.id)
                      }
                      className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-[#0d0d14] transition-colors cursor-pointer"
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
                        </span>
                        <span className="text-[#475569] text-xs">
                          {isExpanded ? "▲" : "▼"}
                        </span>
                      </div>
                    </button>

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
                                    : track.inLibrary
                                      ? "hover:bg-[#0d0d14]"
                                      : "bg-red-950/20 hover:bg-red-950/30"
                                }`}
                              >
                                <td className="py-2.5 pl-5 pr-2 w-10">
                                  <span
                                    className={`group-hover:hidden text-xs tabular-nums ${track.inLibrary ? "text-[#475569]" : "text-red-500/60"}`}
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
                                    className={`text-sm truncate max-w-xs ${track.unavailable ? "text-[#475569] italic" : track.inLibrary ? "text-[#e2e8f0]" : "text-red-400"}`}
                                  >
                                    {track.title}
                                  </div>
                                  {track.artist && (
                                    <div
                                      className={`text-[11px] truncate ${track.inLibrary ? "text-[#475569]" : "text-red-500/70"}`}
                                    >
                                      {track.artist}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-2 pr-5">
                                  {track.inLibrary || track.unavailable
                                    ? null
                                    : (() => {
                                        const key = `${entry.id}-${track.spotifyId}-${idx}`;
                                        const primaryArtist = track.artist
                                          ? track.artist.split(/\s*[,&]\s*/)[0].trim()
                                          : '';
                                        // Normalize title: replace filename-style " - " separator with space
                                        // so "Different Circles - Nicson Remix" → "Different Circles Nicson Remix"
                                        const normalizedTitle = track.title.replace(/\s+-\s+/g, ' ');
                                        // Base title: strip remix/mix/edit/dub/instrumental suffix for Bandcamp
                                        const baseTitle = track.title
                                          .replace(/\s+-\s+.*?(remix|mix|edit|dub|instrumental|rework|bootleg|flip|version|vip)\s*$/i, '')
                                          .replace(/\s+\(.*?(remix|mix|edit|dub|instrumental|rework|bootleg|flip|version|vip)\s*\)\s*$/i, '')
                                          .trim() || normalizedTitle;
                                        const qFull = encodeURIComponent(
                                          [primaryArtist, normalizedTitle].filter(Boolean).join(' '),
                                        );
                                        const qTitle = encodeURIComponent(baseTitle);
                                        return (
                                          <div
                                            ref={
                                              openStoreLinkKey === key
                                                ? storeLinkRef
                                                : null
                                            }
                                            className="relative inline-block"
                                          >
                                            <button
                                              onClick={() =>
                                                setOpenStoreLinkKey(
                                                  openStoreLinkKey === key
                                                    ? null
                                                    : key,
                                                )
                                              }
                                              className="text-[#475569] hover:text-[#7c3aed] transition-colors cursor-pointer"
                                              title="Find this track"
                                            >
                                              <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="18"
                                                height="18"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                              >
                                                {/* Shopping cart */}
                                                <circle cx="8" cy="21" r="1" fill="currentColor" stroke="none" />
                                                <circle cx="19" cy="21" r="1" fill="currentColor" stroke="none" />
                                                <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
                                                {/* Music note inside cart */}
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
          onClick={() => setPlaylistPicker(null)}
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
                onClick={() => setPlaylistPicker(null)}
              >
                Close
              </button>
            </div>
            {playlistPicker.length === 0 ? (
              <p className="text-sm text-[#94a3b8] py-4">
                No playlists found in Apple Music.
              </p>
            ) : (
              <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
                {playlistPicker.map((playlist) => {
                  const imported = analyzedApplePlaylists.has(playlist.name);
                  return (
                    <button
                      key={playlist.name}
                      onClick={() => runAppleMusicAnalysis(playlist.name)}
                      className="w-full text-left rounded-md border border-[#2a2a3a] bg-[#0d0d14] px-3 py-2.5 hover:border-[#7c3aed] transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-[#e2e8f0]">{playlist.name}</span>
                        {imported && (
                          <span className="text-[11px] font-semibold text-[#22c55e] flex-shrink-0">✓</span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#475569] mt-0.5">
                        {playlist.count} track{playlist.count === 1 ? "" : "s"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {swapModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => {
            setSwapModal(null);
            setSwapVisibleCount(5);
          }}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-[#2a2a3a] bg-[#12121a] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#e2e8f0]">
                Swap Suggestions
              </h3>
              <button
                className="text-xs text-[#94a3b8] hover:text-[#e2e8f0] cursor-pointer"
                onClick={() => {
                  setSwapModal(null);
                  setSwapVisibleCount(5);
                }}
              >
                Close
              </button>
            </div>

            {swapModal.suggestions.length === 0 ? (
              <div className="text-sm text-[#94a3b8] py-6">
                No fitting suggestions found for this slot with current set
                constraints.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto">
                  {swapModal.suggestions
                    .slice(0, swapVisibleCount)
                    .map(({ song, score }) => (
                      <button
                        key={song.file}
                        onClick={() => applySwapSuggestion(song)}
                        className="w-full text-left rounded-md border border-[#2a2a3a] bg-[#0d0d14] px-3 py-2 hover:border-[#7c3aed] transition-colors cursor-pointer"
                      >
                        <div className="text-sm text-[#e2e8f0] truncate">
                          {song.title} - {song.artist}
                        </div>
                        <div className="text-[11px] text-[#94a3b8] mt-1">
                          {song.camelot} • {Math.round(song.bpm)} BPM •{" "}
                          {Math.round(song.energy * 100)}% energy •{" "}
                          {song.duration != null ? `${Math.floor(song.duration / 60)}:${String(Math.round(song.duration % 60)).padStart(2, '0')}` : '—'}{" "}
                          • relevance {Math.round(score * 100)}%
                        </div>
                      </button>
                    ))}
                </div>

                {swapVisibleCount < swapModal.suggestions.length && (
                  <div className="mt-3 flex justify-center">
                    <button
                      onClick={() =>
                        setSwapVisibleCount((count) =>
                          Math.min(count + 5, swapModal.suggestions.length),
                        )
                      }
                      className="px-3 py-1.5 text-sm rounded-md border border-[#2a2a3a] bg-[#12121a] text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                    >
                      More
                    </button>
                  </div>
                )}
              </>
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

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => { loadSettings(); setLibrary([]); setGeneratedSet([]); }}
      />

      {m3uSavedPath && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-[#1a1a2e] border border-[#7c3aed] text-[#e2e8f0] text-xs rounded-lg px-4 py-2.5 shadow-lg max-w-sm truncate">
          Saved to {m3uSavedPath}
        </div>
      )}
    </div>
  );
}
