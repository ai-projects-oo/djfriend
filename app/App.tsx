import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { HistoryEntry, DJPreferences, TipConfig, DiscogsMode, DJSystem, ChannelKind, ManualData, VinylStore, Song, Playlist, SmartCriteria } from "./types";
import { DEFAULT_TIP_CONFIG, DEFAULT_DJ_SYSTEM, vinylDeckCount } from "./types";
import EnergyCurveEditor from "./components/EnergyCurveEditor";
import SetTracklist from "./components/SetTracklist";
import SettingsModal from "./components/SettingsModal";
import CalendarPicker from "./components/CalendarPicker";
import HistoryTab from "./components/HistoryTab";
import LibraryTab from "./components/LibraryTab";
import { genreMatchesUmbrella, matchesGenrePrefs, TAG_GROUPS } from "./lib/genreUtils";
import GenrePicker from "./components/GenrePicker";
import { parseRekordboxXml } from "./lib/rekordboxImport";
import { GENRE_BPM_RANGES } from "./lib/bpmRanges";
import {
  exchangeCodeForToken,
  storeToken,
  getPendingExport,
  clearPendingExport,
  searchTracksOnSpotify,
  getStoredToken,
  createPlaylistFromSpotifyIds,
} from "./services/spotifyExport";
import {
  getPendingImport,
  clearPendingImport,
  fetchUserPlaylists,
  fetchAudioFeatures,
} from "./services/spotifyImport";
import {
  findSongsForImport,
  spotifyTrackToSong,
  findPartialMatchSong,
} from "./lib/spotifyImport";
import { downloadM3U, downloadRekordboxXml } from "./services/downloads";
import { SpotifyIcon, M3UIcon } from "./components/Icons";
import { useLibrary, ALL_APPLE_MUSIC } from "./hooks/useLibrary";
import { useSetGenerator } from "./hooks/useSetGenerator";
import { useSpotifyExport } from "./hooks/useSpotifyExport";
import { useSpotifyImport } from "./hooks/useSpotifyImport";
import { useDiscogsCollection } from "./hooks/useDiscogsCollection";
import { getDiscogsMatchedFiles } from "./lib/discogsCollection";
import { loadVinylStore, saveVinylStore } from "./services/vinylStore";
import { buildVinylSongs } from "./lib/vinylSongs";
import { apiFetch, setAppPassword, getAppPassword } from "./services/apiFetch";
import { loadManualData, loadRejected } from "./services/discogsManualData";
import { camelotColor } from "./lib/camelotColors";
import { transitionFeatures } from "./lib/mlFeatures";
import { blendModels, isValidModelWeights } from "./lib/mlModel";
import { SCORE_THRESHOLDS } from "./lib/setScore";
import { findCrateGaps } from "./lib/crateBuilder";
import { generateSet } from "./lib/setGenerator";
import SuggestionsStrip from "./components/SuggestionsStrip";
import CratesTab from "./components/CratesTab";
import OnboardingModal from "./components/OnboardingModal";
import PlayerBar from "./components/PlayerBar";
import GigFinderTab from "./components/GigFinderTab";
import LoaderStatus from "./components/LoaderStatus";
import LibrarySidebar from "./components/LibrarySidebar";
import type { ContainingSource, LibraryView, SourceItem } from "./lib/libraryView";
import { usePlaylists } from "./hooks/usePlaylists";
import { resolvePlaylist } from "./lib/playlists";
import { materializeSmartPlaylists, evaluateSmart, playStatsByFile } from "./lib/smartPlaylists";
import SmartPlaylistEditor from "./components/SmartPlaylistEditor";
import UndoToast from "./components/UndoToast";
import NowPlayingBar from "./components/NowPlayingBar";
import TrackContextMenu, { type TrackMenuState } from "./components/TrackContextMenu";
import TrackInfoModal from "./components/TrackInfoModal";
import { exportTrackM3U, reanalyzeTrack, removeTracksFromLibrary } from "./services/trackActions";
import { patchTrackMeta } from "./services/trackMeta";
import { usePlayer } from "./hooks/usePlayer";
import { buildAppleMusicJob, type AppleMusicExportOptions } from "./lib/appleMusicExport";
import AppleMusicExportDialog from "./components/AppleMusicExportDialog";
import {
  getStoredSession,
  clearSession as clearOpenAiSession,
  type OpenAiSession,
} from "./services/openAiAuth";
import { chatComplete } from "./services/openAiApi";

const SET_DURATIONS = [30, 45, 60, 90, 120, 180] as const;
const MIX_OVERLAP_SEC = 120; // 2-minute crossfade overlap per transition

function InfoMark({ text, align = 'left' }: { text: string; align?: 'left' | 'right' }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  function show() {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ top: r.top - 8, left: align === 'right' ? r.right : r.left });
    setVisible(true);
  }

  return (
    <div ref={ref} className="relative flex-shrink-0" onMouseEnter={show} onMouseLeave={() => setVisible(false)}>
      <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center cursor-default transition-colors ${visible ? 'border-[#a78bfa] bg-[#7c3aed22]' : 'border-[#424f63] hover:border-[#a78bfa] hover:bg-[#7c3aed22]'}`}>
        <span className={`text-[8px] leading-none select-none transition-colors ${visible ? 'text-[#a78bfa]' : 'text-[#b6c2d0]'}`}>i</span>
      </div>
      {visible && (
        <div
          className="pointer-events-none"
          style={{
            position: 'fixed',
            zIndex: 9999,
            top: pos.top,
            ...(align === 'right' ? { right: window.innerWidth - pos.left } : { left: pos.left }),
            transform: 'translateY(-100%)',
            width: '208px',
          }}
        >
          <div className="bg-[#26263c] border border-[#3a3a56] rounded-lg p-2.5 shadow-xl">
            <p className="text-[10px] text-[#ccd5df] leading-relaxed">{text}</p>
          </div>
          <div className={`w-2 h-2 bg-[#26263c] border-r border-b border-[#3a3a56] rotate-45 -mt-1 ${align === 'right' ? 'mr-1.5 ml-auto' : 'ml-1.5'}`} />
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/check")
      .then((r) => r.json() as Promise<{ requiresPassword: boolean }>)
      .then((d) => {
        if (!d.requiresPassword) {
          setIsAuthenticated(true);
          setAuthChecked(true);
          return;
        }
        const stored = getAppPassword();
        if (stored) {
          fetch("/api/settings", { headers: { "X-App-Password": stored } })
            .then((r) => {
              if (r.ok) {
                setIsAuthenticated(true);
              } else {
                setRequiresPassword(true);
              }
            })
            .catch(() => setRequiresPassword(true))
            .finally(() => setAuthChecked(true));
        } else {
          setRequiresPassword(true);
          setAuthChecked(true);
        }
      })
      .catch(() => {
        setIsAuthenticated(true);
        setAuthChecked(true);
      });
  }, []);

  const handlePasswordSubmit = useCallback(async () => {
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/settings", {
        headers: { "X-App-Password": passwordInput },
      });
      if (res.ok) {
        setAppPassword(passwordInput);
        setIsAuthenticated(true);
      } else {
        setAuthError("Incorrect password.");
      }
    } catch {
      setAuthError("Could not connect.");
    } finally {
      setAuthLoading(false);
    }
  }, [passwordInput]);

  if (!authChecked) return <div className="min-h-screen bg-[#16161e]" />;

  if (requiresPassword && !isAuthenticated)
    return (
      <div className="min-h-screen bg-[#16161e] flex items-center justify-center">
        <div className="bg-[#20202e] border border-white/10 rounded-xl p-8 w-80 flex flex-col gap-4">
          <h1 className="text-white font-semibold text-lg text-center">
            DJFriend
          </h1>
          <input
            type="password"
            className="bg-[#16161e] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#7c3aed]"
            placeholder="Password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handlePasswordSubmit();
            }}
            autoFocus
          />
          {authError && (
            <p className="text-red-400 text-xs text-center">{authError}</p>
          )}
          <button
            onClick={() => void handlePasswordSubmit()}
            disabled={authLoading || !passwordInput}
            className="bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-40 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            {authLoading ? "Checking…" : "Enter"}
          </button>
        </div>
      </div>
    );

  return <AppInner />;
}

function AppInner() {
  const [activeTab, setActiveTab] = useState<
    "Set Generator" | "Library" | "Crates" | "History" | "Gig Finder"
  >("Library");
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem("djfriend-history");
      return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    } catch {
      return [];
    }
  });
  const [historyLoadedFromDisk, setHistoryLoadedFromDisk] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(
    null,
  );
  const [openHistoryExportId, setOpenHistoryExportId] = useState<string | null>(
    null,
  );
  const historyExportRef = useRef<HTMLDivElement | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ latestVersion: string; downloadUrl: string } | null>(null);
  const [mlWeights, setMlWeights] = useState<import('./lib/mlModel').ModelWeights | null>(null);
  const [shareTelemetry, setShareTelemetry] = useState(false);
  const [tipConfig, setTipConfig] = useState<TipConfig>(DEFAULT_TIP_CONFIG);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsScrollTo, setSettingsScrollTo] = useState<string | undefined>()
  const [spotifyPickerSearch, setSpotifyPickerSearch] = useState("");
  const [reanalyzingLibrary, setReanalyzingLibrary] = useState(false);
  const [reanalyzeProgress, setReanalyzeProgress] = useState("");
  const [hasSpotifyCredentials, setHasSpotifyCredentials] = useState(false);
  const [hasRekordboxFolder, setHasRekordboxFolder] = useState(false);
  const [openAiSession, setOpenAiSession] = useState<OpenAiSession | null>(() => getStoredSession());
  const [openAiFeatures, setOpenAiFeatures] = useState<import('./components/SettingsModal').OpenAiFeatures>(() => {
    try { return JSON.parse(localStorage.getItem('djfriend-openai-features') ?? 'null') ?? { enhancedAnalysis: false, vinylAnalysis: false }; }
    catch { return { enhancedAnalysis: false, vinylAnalysis: false }; }
  });
  const [hasDiscogsOAuth, setHasDiscogsOAuth] = useState(false);
  const [isMacOS, setIsMacOS] = useState(true); // assume macOS until settings load
  const energyCheckThreshold = 0.12;
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => localStorage.getItem("djfriend-onboarding-dismissed") === "true",
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateCalendar, setDateCalendar] = useState<"from" | "to" | null>(null);
  const [analyzeMenuOpen, setAnalyzeMenuOpen] = useState(false);
  const [playlistSearch, setPlaylistSearch] = useState("");
  const [selectedPlaylists, setSelectedPlaylists] = useState<string[]>([]);
  const [playlistBpmHints, setPlaylistBpmHints] = useState<Map<string, { min: number; max: number } | undefined>>(new Map());
  const MAX_APPLE_PLAYLISTS = 3;
  const [manualMatchKey, setManualMatchKey] = useState<string | null>(null);
  const [manualMatchQuery, setManualMatchQuery] = useState("");
  const [partialHoverKey, setPartialHoverKey] = useState<string | null>(null);
  const manualSearchRef = useRef<HTMLDivElement | null>(null);
  const analyzeMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rbFileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFolderInputRef = useRef<HTMLInputElement | null>(null);
  const sourceDropdownRef = useRef<HTMLDivElement | null>(null);

  // Load history from disk on startup (supercedes localStorage)
  useEffect(() => {
    apiFetch('/api/history')
      .then(r => r.json() as Promise<HistoryEntry[]>)
      .then(entries => {
        if (entries.length > 0) setHistory(entries);
        setHistoryLoadedFromDisk(true);
      })
      .catch(() => setHistoryLoadedFromDisk(true));
  }, []);

  // Persist history to localStorage + disk on every change
  useEffect(() => {
    localStorage.setItem("djfriend-history", JSON.stringify(history));
    if (historyLoadedFromDisk) {
      apiFetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(history),
      }).catch(() => {});
    }
  }, [history, historyLoadedFromDisk]);

  // Click-outside for analyze menu
  useEffect(() => {
    if (!analyzeMenuOpen) return;
    const handle = (e: MouseEvent) => {
      if (
        analyzeMenuRef.current &&
        !analyzeMenuRef.current.contains(e.target as Node)
      )
        setAnalyzeMenuOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [analyzeMenuOpen]);

  // Click-outside for manual library search panel
  useEffect(() => {
    if (!manualMatchKey) return;
    const handle = (e: MouseEvent) => {
      if (
        manualSearchRef.current &&
        !manualSearchRef.current.contains(e.target as Node)
      ) {
        setManualMatchKey(null);
        setManualMatchQuery("");
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [manualMatchKey]);

  // Click-outside for history export dropdown
  useEffect(() => {
    if (!openHistoryExportId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        historyExportRef.current &&
        !historyExportRef.current.contains(e.target as Node)
      )
        setOpenHistoryExportId(null);
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
    isInitializing,
    initStatus,
    enrichmentStatus,
    analysisQueue,
    cancelQueueItem,
    setFolderPath,
    playlistPicker,
    setPlaylistPicker,
    loadingPlaylists,
    analyzedApplePlaylists,
    setAnalyzedApplePlaylists,
    applePlaylistFiles,
    applePlaylistFolders,
    setApplePlaylistFiles,
    error,
    openPlaylistPicker,
    runAppleMusicAnalysis,
    runPathListAnalysis,
    runRekordboxImport,
    runUploadAnalysis,
    runM3uWebImport,
  } = useLibrary({
    onNewAnalysis: () => onNewAnalysisRef.current?.(),
  });

  // Auto-dismiss onboarding once library is populated
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (library.length > 0 && !onboardingDismissed) {
      setOnboardingDismissed(true);
      localStorage.setItem("djfriend-onboarding-dismissed", "true");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.length]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Playlist filter — which import entries restrict the generator pool (multi-select)
  const [playlistFilterIds, setPlaylistFilterIds] = useState<string[]>([]);
  const playlistsApi = usePlaylists();
  // Playlists as the app reads them: smart playlists' tracks computed from their rules.
  // `smartNow` is fixed per session so "in the last N days" rules don't change on every render.
  const [smartNow] = useState(() => Date.now());
  const playlistLib = useMemo(
    () => materializeSmartPlaylists(playlistsApi.library, library, history, smartNow),
    [playlistsApi.library, library, history, smartNow],
  );
  const [smartEditor, setSmartEditor] = useState<{ playlist: Playlist | null; folderId?: string } | null>(null);
  const [libraryView, setLibraryView] = useState<LibraryView>({ kind: "all" });
  // Spotify importing lives in the Library (it used to be its own tab)
  const openSpotifyImports = useCallback(() => {
    setActiveTab("Library");
    setLibraryView({ kind: "imports" });
  }, []);
  const [playlistToRename, setPlaylistToRename] = useState<string | undefined>(undefined);
  const [musicExport, setMusicExport] = useState<{ ids: string[] | "all"; title: string } | null>(null);
  // Selection from Library tab — set when user taps "Use in Set Generator"
  const [librarySelection, setLibrarySelection] = useState<Set<string> | null>(null);
  // Controls visibility of the playlist picker select element in the Source card
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  // Visual-only loading state for the Generate CTA button
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasAttemptedGenerate, setHasAttemptedGenerate] = useState(false);
  const [bulkOpError, setBulkOpError] = useState<string | null>(null);
  const [aiSuggestQuery, setAiSuggestQuery] = useState('');
  const [aiSuggestLoading, setAiSuggestLoading] = useState(false);
  const [aiSuggestResults, setAiSuggestResults] = useState<import('./types').Song[]>([]);

  // Click-outside for source playlist dropdown
  useEffect(() => {
    if (!sourceDropdownOpen) return;
    const handle = (e: MouseEvent) => {
      if (
        sourceDropdownRef.current &&
        !sourceDropdownRef.current.contains(e.target as Node)
      )
        setSourceDropdownOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
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
    copiedLinkKey,
    setCopiedLinkKey,
    runImport,
    reloadEntry,
    handleImport,
    handleBrowseSpotifyPlaylists,
  } = useSpotifyImport({ library, setHistory });

  const {
    discogsCollection,
    discogsMode,
    setDiscogsMode,
    syncStatus: discogsSyncStatus,
    syncCollection: syncDiscogsCollection,
  } = useDiscogsCollection(library);

  const discogsDaysSince = discogsCollection
    ? Math.floor((+new Date() - discogsCollection.syncedAt) / 86400000)
    : null;

  // Crates manual data + rejected — lifted here so vinylFiles can be derived reactively
  const [cratesManualData, setCratesManualData] = useState<Map<number, ManualData>>(loadManualData);
  const [cratesRejected, setCratesRejected]     = useState<Set<number>>(loadRejected);
  // Per-track vinyl data (AI BPM/key/genre) — shared by CratesTab (editing) and the set generator
  const [vinylStore, setVinylStore] = useState<VinylStore>(loadVinylStore);
  const vinylStoreLoaded = useRef(false);
  useEffect(() => {
    if (!vinylStoreLoaded.current) { vinylStoreLoaded.current = true; return; }
    try { saveVinylStore(vinylStore); } catch { /* quota */ }
  }, [vinylStore]);

  // Vinyl records with no digital copy, usable by the generator in Mixed/Vinyl mode
  const vinylSongs = useMemo(
    () => buildVinylSongs(discogsCollection, vinylStore, cratesManualData, cratesRejected, library),
    [discogsCollection, vinylStore, cratesManualData, cratesRejected, library],
  );

  // DJ System config — channel count and type per channel
  const [djSystem, setDjSystem] = useState<DJSystem>(() => {
    try {
      const raw = localStorage.getItem('djfriend-dj-system');
      if (raw) return JSON.parse(raw) as DJSystem;
    } catch { /* */ }
    return DEFAULT_DJ_SYSTEM;
  });

  const handleSetDjSystem = useCallback((sys: DJSystem) => {
    setDjSystem(sys);
    try { localStorage.setItem('djfriend-dj-system', JSON.stringify(sys)); } catch { /* */ }
  }, []);

  const djVinylDecks = vinylDeckCount(djSystem);
  const turntables: 1 | 2 = djVinylDecks <= 1 ? 1 : 2;

  // Build the set of vinyl file paths eligible for the turntable constraint
  const vinylFiles = useMemo<Set<string> | undefined>(() => {
    if (djVinylDecks === 0 || !discogsCollection) return undefined;
    const files = new Set<string>();
    for (const r of discogsCollection.releases) {
      if (cratesRejected.has(r.releaseId)) continue;
      if (r.matchedFile) {
        const linked = library.find(s => s.file === r.matchedFile);
        if (linked && linked.bpm > 0 && linked.camelot && linked.energy != null) { files.add(r.matchedFile); continue; }
      }
      const manual = cratesManualData.get(r.releaseId);
      if (manual?.matchedFile) {
        const linked = library.find(s => s.file === manual.matchedFile);
        if (linked && linked.bpm > 0 && linked.camelot && linked.energy != null) files.add(manual.matchedFile);
      }
    }
    for (const s of vinylSongs) files.add(s.file);
    return files.size > 0 ? files : undefined;
  }, [djVinylDecks, discogsCollection, cratesRejected, cratesManualData, library, vinylSongs]);

  // Derive the file set for the active playlist filter (union across all selected IDs)
  // IDs can be a Spotify import entry ID, "apple:<playlistName>", or "__selection__"
  const playlistFilterFiles = useMemo<Set<string> | undefined>(() => {
    if (playlistFilterIds.length === 0) return undefined;
    const combined = new Set<string>();
    for (const id of playlistFilterIds) {
      if (id === "__selection__") {
        if (librarySelection) librarySelection.forEach(f => combined.add(f));
        continue;
      }
      if (id.startsWith("pl:")) {
        const pl = playlistLib.playlists.find(p => p.id === id.slice(3));
        if (pl) {
          const inLibrary = new Set(library.map(s => s.file));
          pl.tracks.forEach(f => { if (inLibrary.has(f)) combined.add(f); });
        }
        continue;
      }
      if (id.startsWith("apple:")) {
        const name = id.slice(6);
        const files = applePlaylistFiles[name];
        if (files && files.length > 0) {
          const fileSet = new Set(files);
          library.filter(s => fileSet.has(s.file) || fileSet.has(s.filePath ?? '')).forEach(s => combined.add(s.file));
        }
        continue;
      }
      const entry = importHistory.find((e) => e.id === id);
      if (entry) findSongsForImport(entry.tracks, library).forEach(s => combined.add(s.file));
    }
    return combined.size > 0 ? combined : undefined;
  }, [playlistFilterIds, importHistory, library, applePlaylistFiles, librarySelection, playlistLib]);

  // ── Library sidebar: resolve the selected view to songs ──────────────────
  const songsByFile = useMemo(() => new Map(library.map(s => [s.file, s])), [library]);
  const player = usePlayer(songsByFile);
  const songsByPath = useMemo(() => {
    const m = new Map<string, Song>();
    for (const s of library) { m.set(s.file, s); if (s.filePath) m.set(s.filePath, s); }
    return m;
  }, [library]);

  // Songs for any sidebar view, in that view's order (tracks missing from the library are skipped)
  const resolveLibraryView = useCallback((v: LibraryView): { songs: Song[]; missing: number } | null => {
    const unique = (list: Song[]) => { const seen = new Set<string>(); return list.filter(s => !seen.has(s.file) && seen.add(s.file)); };
    switch (v.kind) {
      case "all":
      case "imports": return null;
      case "playlist": {
        const p = playlistLib.playlists.find(x => x.id === v.id);
        return p ? resolvePlaylist(p, songsByFile) : null;
      }
      case "apple": {
        const files = applePlaylistFiles[v.name] ?? [];
        const songs = files.map(f => songsByPath.get(f)).filter((s): s is Song => !!s);
        return { songs: unique(songs), missing: files.length - songs.length };
      }
      case "spotify": {
        const entry = importHistory.find(e => e.id === v.id);
        return entry ? { songs: unique(findSongsForImport(entry.tracks, library)), missing: 0 } : null;
      }
      case "set": {
        const entry = history.find(h => h.id === v.id);
        return entry ? { songs: unique(entry.tracks.map(t => songsByFile.get(t.file) ?? t)), missing: 0 } : null;
      }
    }
  }, [playlistLib, songsByFile, songsByPath, applePlaylistFiles, importHistory, history, library]);

  const libraryViewData = useMemo(() => {
    const resolved = resolveLibraryView(libraryView);
    const v = resolved ? libraryView : ({ kind: "all" } as LibraryView);
    switch (v.kind) {
      case "playlist": return { key: `pl:${v.id}`, title: playlistLib.playlists.find(p => p.id === v.id)?.name ?? "Playlist", ...resolved!, playlistId: v.id };
      case "apple":    return { key: `apple:${v.name}`, title: v.name, ...resolved! };
      case "spotify":  return { key: `spotify:${v.id}`, title: importHistory.find(e => e.id === v.id)?.name ?? "Spotify playlist", ...resolved! };
      case "set":      return { key: `set:${v.id}`, title: history.find(h => h.id === v.id)?.name ?? "Set", ...resolved! };
      default:         return { key: "all", title: "All Tracks", songs: undefined, missing: 0 };
    }
  }, [libraryView, resolveLibraryView, playlistLib, importHistory, history]);
  const activePlaylistId = "playlistId" in libraryViewData ? libraryViewData.playlistId : undefined;
  const activeIsSmart = !!activePlaylistId && !!playlistLib.playlists.find(p => p.id === activePlaylistId)?.smart;

  // Live match count for the smart playlist editor
  const countSmartMatches = useCallback((criteria: SmartCriteria) => {
    const members = new Map(playlistLib.playlists.map(p => [p.id, new Set(p.tracks)]));
    return evaluateSmart(criteria, library, {
      now: smartNow,
      stats: playStatsByFile(history),
      members: id => members.get(id) ?? new Set(),
    }).length;
  }, [playlistLib, library, history, smartNow]);

  const playlistCounts = useMemo(
    () => new Map(playlistLib.playlists.map(p => [p.id, p.tracks.filter(f => songsByFile.has(f)).length])),
    [playlistLib, songsByFile],
  );
  const appleSources = useMemo<SourceItem[]>(
    () => Object.keys(applePlaylistFiles).sort((a, b) => a.localeCompare(b)).map(name => {
      const v: LibraryView = { kind: "apple", name };
      const group = applePlaylistFolders[name];
      return { view: v, label: name, count: resolveLibraryView(v)?.songs.length ?? 0, ...(group ? { group } : {}) };
    }),
    [applePlaylistFiles, applePlaylistFolders, resolveLibraryView],
  );
  const spotifySources = useMemo<SourceItem[]>(
    () => importHistory.map(e => ({ view: { kind: "spotify", id: e.id } as LibraryView, label: e.name, count: e.tracks.filter(t => t.inLibrary).length })),
    [importHistory],
  );
  const setSources = useMemo<SourceItem[]>(
    () => [...history].sort((a, b) => b.timestamp - a.timestamp).map(h => ({ view: { kind: "set", id: h.id } as LibraryView, label: h.name, count: h.tracks.length })),
    [history],
  );

  // ── "Add to Last Playlist" / "Show in Playlist" ──────────────────────────
  const [lastPlaylistId, setLastPlaylistId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ file: string; nonce: number } | undefined>(undefined);
  const [selectedLibraryFiles, setSelectedLibraryFiles] = useState<string[]>([]);
  const { createPlaylist: createPl, addTracks: addPlTracks } = playlistsApi;

  const newPlaylistFrom = useCallback((name: string, files: string[], source?: { kind: "apple-music" | "spotify" | "set"; ref: string }) => {
    const id = createPl(name, { tracks: files, source });
    setLibraryView({ kind: "playlist", id });
    setLastPlaylistId(id);
    return id;
  }, [createPl]);

  const addToPlaylist = useCallback((id: string, files: string[]) => {
    addPlTracks(id, files);
    setLastPlaylistId(id);
  }, [addPlTracks]);
  const lastPlaylist = useMemo(() => {
    const p = lastPlaylistId ? playlistLib.playlists.find(x => x.id === lastPlaylistId) : undefined;
    return p ? { id: p.id, name: p.name } : undefined;
  }, [lastPlaylistId, playlistLib]);

  // file → DJFriend playlists containing it
  const playlistsByFile = useMemo(() => {
    const m = new Map<string, Playlist[]>();
    for (const p of playlistLib.playlists) for (const f of p.tracks) {
      const list = m.get(f);
      if (list) list.push(p); else m.set(f, [p]);
    }
    return m;
  }, [playlistLib]);
  const playlistNamesFor = useCallback((file: string) => (playlistsByFile.get(file) ?? []).map(p => p.name), [playlistsByFile]);
  const highlightPlaylistIds = useMemo(
    () => new Set(selectedLibraryFiles.flatMap(f => (playlistsByFile.get(f) ?? []).map(p => p.id))),
    [selectedLibraryFiles, playlistsByFile],
  );

  // Apple Music imports and saved sets that contain a track (DJFriend playlists come from playlistsByFile)
  const containingSources = useCallback((song: Song): ContainingSource[] => {
    const paths = new Set([song.file, song.filePath].filter((p): p is string => !!p));
    const apple = Object.entries(applePlaylistFiles)
      .filter(([, files]) => files.some(f => paths.has(f)))
      .map(([name]) => ({ group: "Apple Music", label: name, view: { kind: "apple", name } as LibraryView }));
    const sets = history
      .filter(h => h.tracks.some(t => t.file === song.file))
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(h => ({ group: "Sets", label: h.name, view: { kind: "set", id: h.id } as LibraryView }));
    return [...apple.sort((a, b) => a.label.localeCompare(b.label)), ...sets];
  }, [applePlaylistFiles, history]);

  // ── Generate a set from a playlist / imported source ──────────────────────
  // Switches the generator's source, opens the Set Generator and generates once the source is applied.
  const pendingGenerate = useRef(false);
  const generateFrom = useCallback((filterId: string) => {
    setPlaylistFilterIds([filterId]);
    setActiveTab("Set Generator");
    pendingGenerate.current = true;
  }, []);
  const generateFromView = useCallback((v: LibraryView) => {
    if (v.kind === "playlist") generateFrom(`pl:${v.id}`);
    else if (v.kind === "apple") generateFrom(`apple:${v.name}`);
    else if (v.kind === "spotify") generateFrom(v.id);
  }, [generateFrom]);

  const { expandToPlaylist } = playlistsApi;
  const showIn = useCallback((view: LibraryView, file: string) => {
    setActiveTab("Library");
    if (view.kind === "playlist") expandToPlaylist(view.id);
    setLibraryView(view);
    setReveal({ file, nonce: Date.now() });
  }, [expandToPlaylist]);

  // ── Track actions shared by the library table and the player's right-click menu ──
  const updateTrack = useCallback((file: string, patch: Partial<Song>) => {
    setLibrary(lib => lib.map(s => s.file === file ? { ...s, ...patch } : s));
  }, [setLibrary]);
  const removeTracks = useCallback((files: string[]) => {
    setLibrary(lib => lib.filter(s => !files.includes(s.file)));
  }, [setLibrary]);
  const sendToGenerator = useCallback((files: string[]) => {
    setLibrarySelection(new Set(files));
    setPlaylistFilterIds(["__selection__"]);
    setActiveTab("Set Generator");
  }, []);
  const newPlaylistFromFiles = useCallback((files: string[]) => {
    const id = newPlaylistFrom("Untitled Playlist", files);
    setPlaylistToRename(id);
  }, [newPlaylistFrom]);
  const [playerMenu, setPlayerMenu] = useState<TrackMenuState | null>(null);
  const [playerInfoSong, setPlayerInfoSong] = useState<Song | null>(null);

  const prepareMusicExport = useCallback(
    (opts: AppleMusicExportOptions) => buildAppleMusicJob(playlistLib, musicExport?.ids ?? [], songsByFile, opts),
    [playlistLib, musicExport, songsByFile],
  );
  const playlistNames = useMemo(() => new Map(playlistLib.playlists.map(p => [p.id, p.name])), [playlistLib]);

  const exportPlaylistFile = useCallback((name: string, songs: Song[], format: "M3U" | "XML") => {
    if (format === "M3U") downloadM3U(songs.map((s, i) => ({ ...s, slot: i, targetEnergy: s.energy, harmonicWarning: false })), name);
    else downloadRekordboxXml(songs, name, `${name}.xml`);
  }, []);

  const playlistTotalMinutes = useMemo<number>(() => {
    if (playlistFilterIds.length === 0 || !playlistFilterFiles) return 0;
    const songs = library.filter(s => playlistFilterFiles.has(s.file));
    return songs.reduce((s, t) => s + (t.duration ?? 210), 0) / 60;
  }, [playlistFilterIds, playlistFilterFiles, library]);

  // Moved outside to avoid lint dep warning — it's a constant

  // The only pill enabled in playlist mode: smallest duration that fits the playlist
  const minViablePill = useMemo<number | null>(() => {
    if (playlistFilterIds.length === 0 || playlistTotalMinutes <= 0) return null;
    return SET_DURATIONS.find((d) => d >= playlistTotalMinutes) ?? 180;
  }, [playlistFilterIds, playlistTotalMinutes]);

  // Discogs pool intersection — "crates" mode hard-filters the pool
  const discogsCrateFiles = useMemo<Set<string> | undefined>(() => {
    if (discogsMode === 'library' || !discogsCollection) return undefined;
    const files = getDiscogsMatchedFiles(discogsCollection, library);
    for (const s of vinylSongs) files.add(s.file);
    return files;
  }, [discogsMode, discogsCollection, library, vinylSongs]);

  // Pool the generator draws from — vinyl-only records join in Mixed/Vinyl mode
  const generatorLibrary = useMemo(
    () => (discogsMode !== 'library' && vinylSongs.length > 0 ? [...library, ...vinylSongs] : library),
    [discogsMode, library, vinylSongs],
  );

  // Effective playlist filter files — intersects playlist + discogs when both are active
  const effectiveFilterFiles = useMemo<Set<string> | undefined>(() => {
    if (!discogsCrateFiles && !playlistFilterFiles) return undefined;
    if (!discogsCrateFiles) return playlistFilterFiles;
    if (!playlistFilterFiles) return discogsCrateFiles.size > 0 ? discogsCrateFiles : undefined;
    const intersection = new Set([...playlistFilterFiles].filter(f => discogsCrateFiles.has(f)));
    return intersection.size > 0 ? intersection : undefined;
  }, [playlistFilterFiles, discogsCrateFiles]);

  // Auto-select effect wired below after setPrefs is available from useSetGenerator

  const {
    prefs,
    setPrefs,
    curve,
    setCurve,
    generatedSet,
    setGeneratedSet,
    swapModal,
    setSwapModal,
    availableGenres,
    genreGroups,
    availableTags,
    filteredTrackCount,
    setScore,
    handleGenerate,
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
    canAppendTracks,
    scoringWeights,
    setScoringWeights,
    setSuggestions,
    insertSuggestion,
  } = useSetGenerator(
    generatorLibrary,
    setLibrary,
    effectiveFilterFiles,
    history,
    mlWeights,
    discogsMode === 'crates-first' ? discogsCrateFiles : undefined,
    discogsMode === 'crates-first' ? 0.12 : undefined,
    vinylFiles,
    turntables,
  );

  // Genre picker counts: tracks in the generator's current source matching the given genres
  const genrePool = useMemo(
    () => (effectiveFilterFiles ? generatorLibrary.filter(s => effectiveFilterFiles.has(s.file)) : generatorLibrary),
    [generatorLibrary, effectiveFilterFiles],
  );
  const genreCountFor = useCallback(
    (values: string[]) => genrePool.reduce((n, s) => n + (matchesGenrePrefs(s, values) ? 1 : 0), 0),
    [genrePool],
  );

  // ⌘Z / Ctrl+Z undoes the last playlist edit in the Library (not while typing in a field)
  const { undo: undoPlaylists, canUndo: canUndoPlaylists } = playlistsApi;
  useEffect(() => {
    if (activeTab !== "Library") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z" && canUndoPlaylists) {
        e.preventDefault();
        undoPlaylists();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTab, undoPlaylists, canUndoPlaylists]);

  // Run a generation requested by "Generate Set" once the new source has been applied
  useEffect(() => {
    if (!pendingGenerate.current || activeTab !== "Set Generator") return;
    // One request = one attempt: a source with no library tracks must not trigger a generate later
    pendingGenerate.current = false;
    if (!playlistFilterFiles || library.length === 0) return;
    setTimeout(() => {
      setIsGenerating(true);
      setHasAttemptedGenerate(true);
      setTimeout(() => { handleGenerate(); setIsGenerating(false); }, 0);
    }, 0);
  }, [activeTab, playlistFilterFiles, library.length, handleGenerate]);

  const energyIssues = useMemo(
    () => generatedSet.filter(t => Math.abs(t.energy - t.targetEnergy) > energyCheckThreshold),
    [generatedSet, energyCheckThreshold],
  );
  const libraryEnergyRange = useMemo(() => {
    const pool = effectiveFilterFiles
      ? library.filter(s => effectiveFilterFiles.has(s.file))
      : library;
    if (pool.length === 0) return null;
    let min = Infinity, max = -Infinity;
    for (const s of pool) {
      if (s.energy > 0) { min = Math.min(min, s.energy); max = Math.max(max, s.energy); }
    }
    return min < max ? { min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100 } : null;
  }, [library, effectiveFilterFiles]);

  const crateGapsEligible = useMemo(
    () => Boolean(setScore && (setScore.harmonicRate > 0.2 || setScore.avgEnergyError > 0.15)),
    [setScore],
  );
  const [crateGapsRequested, setCrateGapsRequested] = useState(false);
  const crateGaps = useMemo(
    () => crateGapsRequested && crateGapsEligible ? findCrateGaps(generatedSet, prefs) : [],
    [generatedSet, prefs, crateGapsEligible, crateGapsRequested],
  );

  // Reset analysis request when the set changes
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setCrateGapsRequested(false); }, [generatedSet]);

  const [energyCheckOpen, setEnergyCheckOpen] = useState(true);
  const [crateGapsOpen, setCrateGapsOpen] = useState(true);
  const [spotifyGeneratingId, setSpotifyGeneratingId] = useState<string | null>(null);
  const [missingExportId, setMissingExportId] = useState<string | null>(null);
  const [missingExportResult, setMissingExportResult] = useState<{ entryId: string; url: string; count: number; isPublic?: boolean } | null>(null);
  const [missingExportError, setMissingExportError] = useState<{ entryId: string; message: string } | null>(null);

  // Clamp curve points into the library energy range whenever it changes.
  // Without this, default y=0.3 or y=0.9 values render outside the SVG viewport
  // when the library's actual energy is a narrow band like 0.50–0.73.
  useEffect(() => {
    if (!libraryEnergyRange) return;
    const { min, max } = libraryEnergyRange;
    setCurve(pts => {
      if (pts.every(p => p.y >= min && p.y <= max)) return pts; // already in range
      return pts.map(p => ({ ...p, y: Math.max(min, Math.min(max, p.y)) }));
    });
  }, [libraryEnergyRange, setCurve]);

  // Wire setGeneratedSet into the bridge ref so useLibrary can reset the set on new analysis
  useEffect(() => {
    onNewAnalysisRef.current = () => {
      setGeneratedSet([]);
    };
  }, [setGeneratedSet]);

  // Clear generated set when anything that defines the source pool or set shape changes
  useEffect(() => {
    setGeneratedSet([]);
  }, [
    playlistFilterIds,   // playlist filter changed
    discogsMode,         // library/mixed/vinyl mode changed
    prefs.genres,        // genre filter changed → different pool
    prefs.bpmMin,        // BPM floor changed → different pool
    prefs.bpmMax,        // BPM ceiling changed → different pool
    prefs.setDuration,   // duration changed → wrong number of tracks
    djSystem,            // vinyl channel constraints changed → different eligibility
    librarySelection,    // library tab selection changed → different pool
    setGeneratedSet,
  ]);

  // Auto-select the min viable duration pill when playlist mode activates or playlist changes
  useEffect(() => {
    if (minViablePill !== null) {
      setPrefs((p) =>
        p.setDuration !== minViablePill
          ? { ...p, setDuration: minViablePill }
          : p,
      );
    }
  }, [minViablePill, setPrefs]);

  const handleLoadHistoryEntry = useCallback(
    (entry: HistoryEntry) => {
      // Migrate old history entries
      const raw = entry.prefs as unknown as Record<string, unknown>;
      const migratedPrefs: DJPreferences = {
        ...entry.prefs,
        // genre: string → genres: string[] (old format had a single genre string)
        genres: Array.isArray(entry.prefs.genres)
          ? entry.prefs.genres
          : typeof raw["genre"] === "string" && raw["genre"] !== "Any"
            ? [raw["genre"] as string]
            : [],
        dateFilter: entry.prefs.dateFilter ?? {
          field: "dateAdded",
          preset: "all",
        },
      };
      delete (migratedPrefs as unknown as Record<string, unknown>)[
        "addedTimeFilter"
      ];
      delete (migratedPrefs as unknown as Record<string, unknown>)["genre"];
      setPrefs(migratedPrefs);
      setCurve(entry.curve);
      setGeneratedSet(entry.tracks);
      setActiveTab("Set Generator");
    },
    [setPrefs, setCurve, setGeneratedSet],
  );


  const {
    spotifyExportStatus,
    setSpotifyExportStatus,
    handleExportM3U,
    startSpotifyExport,
    handleExportSpotify,
    handleToggleSpotifyMatch,
    handleConfirmSpotifyExport,
    handleRenameEntry,
    handleRateEntry,
    handleNoteEntry,
  } = useSpotifyExport({ generatedSet, prefs, curve, setHistory });

  const handleExportImportM3U = useCallback(
    async (entry: import("./types").ImportEntry) => {
      const songs = findSongsForImport(entry.tracks, library);
      if (songs.length === 0) return;
      const setTracks = songs.map((s, i) => ({
        ...s,
        slot: i,
        targetEnergy: s.energy,
        harmonicWarning: false,
      }));
      const filename = `${entry.name.replace(/[^a-z0-9_\-. ]/gi, "_")}.m3u`;
      downloadM3U(setTracks, filename);
    },
    [library],
  );



  const handleLoadImportToSet = useCallback(
    (entry: import("./types").ImportEntry) => {
      const songs = findSongsForImport(entry.tracks, library);
      if (songs.length === 0) return;
      handleLoadToSet(songs);
      setPlaylistFilterIds([entry.id]);
      setActiveTab("Set Generator");
    },
    [library, handleLoadToSet, setPlaylistFilterIds],
  );

  const handleGenerateFromSpotify = useCallback(
    async (entry: import("./types").ImportEntry) => {
      const token = getStoredToken();
      if (!token) return;
      setSpotifyGeneratingId(entry.id);
      try {
        const localSongs = findSongsForImport(entry.tracks, library);
        const localIds = new Set(localSongs.map(s => s.spotifyId).filter(Boolean));
        const unmatched = entry.tracks.filter(
          t => !t.inLibrary && !t.unavailable && t.spotifyId && !localIds.has(t.spotifyId),
        );
        const featureMap = unmatched.length > 0
          ? await fetchAudioFeatures(unmatched.map(t => t.spotifyId), token).catch(() => new Map())
          : new Map();
        const spotifySongs = unmatched
          .filter(t => featureMap.has(t.spotifyId))
          .map(t => spotifyTrackToSong(t, featureMap.get(t.spotifyId)!));
        const pool = [...localSongs, ...spotifySongs];
        if (pool.length === 0) return;
        const set = generateSet(pool, prefs, curve);
        setGeneratedSet(set);
        setActiveTab("Set Generator");
      } finally {
        setSpotifyGeneratingId(null);
      }
    },
    [library, prefs, curve, setGeneratedSet],
  );

  const handleExportMissingToSpotify = useCallback(async (entry: import('./types').ImportEntry) => {
    const missingIds = entry.tracks
      .filter(t => !t.inLibrary && !t.unavailable && t.spotifyId)
      .map(t => t.spotifyId);
    if (missingIds.length === 0) return;
    if (!window.confirm(`Create a Spotify playlist of the ${missingIds.length} tracks you don't have?\n\nSpotify makes playlists created by apps public. Afterwards, open it in Spotify → ••• → Make private.`)) return;
    const token = getStoredToken();
    if (!token) {
      setMissingExportError({ entryId: entry.id, message: "Connect Spotify first — log in via the Spotify section in Settings." });
      setTimeout(() => setMissingExportError(null), 4000);
      return;
    }
    setMissingExportId(entry.id);
    setMissingExportResult(null);
    setMissingExportError(null);
    try {
      const { playlistUrl, count, isPublic } = await createPlaylistFromSpotifyIds(
        missingIds,
        `Don't have from ${entry.name}`,
        token,
      );
      setMissingExportResult({ entryId: entry.id, url: playlistUrl, count, isPublic });
      setTimeout(() => setMissingExportResult(null), isPublic ? 20000 : 8000);
    } catch (err) {
      setMissingExportError({ entryId: entry.id, message: err instanceof Error ? err.message : "Failed to create playlist." });
      setTimeout(() => setMissingExportError(null), 5000);
    } finally {
      setMissingExportId(null);
    }
  }, []);

  const handleAiSuggest = useCallback(async (query: string) => {
    if (!query.trim() || library.length === 0) return;
    setAiSuggestLoading(true);
    setAiSuggestResults([]);
    try {
      const raw = await chatComplete([
        { role: 'system', content: 'You are a DJ assistant. Given a free-text track request, output a JSON object with these fields: bpmMin (number), bpmMax (number), energyMin (number 0-1), energyMax (number 0-1), camelot (string[] of acceptable Camelot keys, empty means any), vibes (string[] of keywords). Output JSON only.' },
        { role: 'user', content: query },
      ], { maxTokens: 120 });
      type Profile = { bpmMin?: number; bpmMax?: number; energyMin?: number; energyMax?: number; camelot?: string[]; vibes?: string[] };
      const profile = JSON.parse(raw.replace(/```json|```/g, '').trim()) as Profile;
      const scored = library
        .filter(s => {
          if (profile.bpmMin && s.bpm < profile.bpmMin) return false;
          if (profile.bpmMax && s.bpm > profile.bpmMax) return false;
          if (profile.energyMin && (s.energy ?? 0) < profile.energyMin) return false;
          if (profile.energyMax && (s.energy ?? 0) > profile.energyMax) return false;
          if (profile.camelot?.length && !profile.camelot.includes(s.camelot ?? '')) return false;
          return true;
        })
        .map(s => {
          const bpmMid = ((profile.bpmMin ?? 60) + (profile.bpmMax ?? 180)) / 2;
          const eMid = ((profile.energyMin ?? 0) + (profile.energyMax ?? 1)) / 2;
          const score = 1 - (Math.abs(s.bpm - bpmMid) / 50 + Math.abs((s.energy ?? 0.5) - eMid));
          return { s, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(({ s }) => s);
      setAiSuggestResults(scored);
    } catch { /* silent */ }
    finally { setAiSuggestLoading(false); }
  }, [library]);

  const loadSettings = useCallback(() => {
    apiFetch("/api/settings")
      .then(
        (r) =>
          r.json() as Promise<{
            musicFolder?: string;
            rekordboxFolder?: string;
            hasSecret?: boolean;
          }>,
      )
      .then((d) => {
        if (d.musicFolder) setFolderPath((prev) => prev || d.musicFolder!);
        if (d.hasSecret !== undefined) setHasSpotifyCredentials(d.hasSecret);
        if ((d as { hasDiscogsOAuth?: boolean }).hasDiscogsOAuth !== undefined) setHasDiscogsOAuth(!!(d as { hasDiscogsOAuth?: boolean }).hasDiscogsOAuth);
        setHasRekordboxFolder(
          !!(d.rekordboxFolder && d.rekordboxFolder.trim()),
        );
        if ((d as { platform?: string }).platform) setIsMacOS((d as { platform?: string }).platform === 'darwin');
        if ((d as { shareTelemetry?: boolean }).shareTelemetry !== undefined) setShareTelemetry((d as { shareTelemetry?: boolean }).shareTelemetry === true);
        if ((d as { tipConfig?: TipConfig }).tipConfig) setTipConfig({ ...DEFAULT_TIP_CONFIG, ...(d as { tipConfig: TipConfig }).tipConfig });
      })
      .catch(() => {});
  }, [setFolderPath]);

  useEffect(() => {
    loadSettings();
    apiFetch('/api/dj-software-status')
      .then(r => r.ok ? r.json() as Promise<{ rekordbox: boolean }> : null)
      .then(d => { if (d?.rekordbox) setHasRekordboxFolder(true); })
      .catch(() => {});
  }, [loadSettings]);

  // Handle Discogs OAuth callback — /discogs-callback?oauth_token=…&oauth_verifier=…
  useEffect(() => {
    if (!window.location.pathname.startsWith('/discogs-callback')) return;
    const params = new URLSearchParams(window.location.search);
    const oauthToken    = params.get('oauth_token');
    const oauthVerifier = params.get('oauth_verifier');
    window.history.replaceState({}, '', '/');
    if (!oauthToken || !oauthVerifier) return;
    apiFetch('/api/discogs/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oauth_token: oauthToken, oauth_verifier: oauthVerifier }),
    })
      .then(r => r.json())
      .then((d: { ok: boolean; username?: string }) => { if (d.ok) loadSettings(); })
      .catch(() => {});
  }, [loadSettings]);

  // Load local ML model then silently blend with community model from Render
  useEffect(() => {
    apiFetch('/api/ml-model')
      .then(r => r.ok ? r.json() : null)
      .then((local: import('./lib/mlModel').ModelWeights | null) => {
        if (local) setMlWeights(local);
        // Fetch community model in background — blend if both available
        fetch('https://djfriend.onrender.com/api/community-model')
          .then(r => r.ok ? r.json() : null)
          .then((community: unknown) => {
            if (!isValidModelWeights(community)) return;
            setMlWeights(prev => prev ? blendModels(prev, community, 0.7) : community);
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  // Fire-and-forget: send anonymous transition vectors when a set is generated (opt-in only).
  // If the user regenerates within 20s the previous set is treated as rejected (negative label).
  const prevGeneratedSetRef = useRef<{ set: typeof generatedSet; time: number } | null>(null);
  useEffect(() => {
    if (!shareTelemetry) return;
    if (generatedSet.length < 2) return;
    if (generatedSet === prevGeneratedSetRef.current?.set) return;

    const now = Date.now();
    const prev = prevGeneratedSetRef.current;

    function extractVectors(set: typeof generatedSet): number[][] {
      const vecs: number[][] = [];
      const n = set.length;
      for (let i = 1; i < n; i++) {
        const a = set[i - 1], b = set[i];
        if (!a.bpm || !b.bpm || !a.camelot || !b.camelot) continue;
        // Spotify's developer terms forbid using Spotify content to train ML models — drop Spotify-sourced genres
        const own = (t: typeof a) => (t.genresFromSpotify ? { ...t, genres: [] } : t);
        vecs.push(transitionFeatures(own(a), own(b), b.targetEnergy, i / (n - 1)));
      }
      return vecs;
    }

    // Previous set was rejected if user regenerated within 20 seconds
    if (prev && now - prev.time < 20_000) {
      const negVectors = extractVectors(prev.set);
      if (negVectors.length > 0) {
        fetch('https://djfriend.onrender.com/api/telemetry/transitions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vectors: negVectors, negative: true }),
        }).catch(() => {});
      }
    }

    // Current set is a positive example
    const vectors = extractVectors(generatedSet);
    prevGeneratedSetRef.current = { set: generatedSet, time: now };
    if (vectors.length === 0) return;
    fetch('https://djfriend.onrender.com/api/telemetry/transitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vectors }),
    }).catch(() => {});
  }, [generatedSet, shareTelemetry]);

  // Space bar toggles audio preview play/pause
  const hasPlayerTrack = !!player.currentSong;
  const togglePlayer = player.toggle;
  // Starting the player stops a Set Generator preview
  useEffect(() => {
    if (player.playing) audioRef.current?.pause();
  }, [player.playing]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      const audio = audioRef.current;
      if (audio && previewFile) {
        if (audio.paused) { void audio.play(); setPreviewPlaying(true); }
        else { audio.pause(); setPreviewPlaying(false); }
        return;
      }
      if (hasPlayerTrack) togglePlayer();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewFile, hasPlayerTrack, togglePlayer]);

  // Check for app updates once on mount
  useEffect(() => {
    apiFetch('/api/check-update')
      .then(r => r.json() as Promise<{ hasUpdate: boolean; latestVersion: string; downloadUrl: string }>)
      .then(d => { if (d.hasUpdate) setUpdateInfo({ latestVersion: d.latestVersion, downloadUrl: d.downloadUrl }) })
      .catch(() => {});
  }, []);

  // Handle Spotify OAuth callback
  useEffect(() => {
    if (!window.location.pathname.startsWith('/callback')) return;
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
          openSpotifyImports();
          setLoadingSpotifyPlaylists(true);
          try {
            const playlists = await fetchUserPlaylists(access_token);
            setSpotifyPlaylistPicker(playlists);
          } finally {
            setLoadingSpotifyPlaylists(false);
          }
        } else if (pendingImport) {
          openSpotifyImports();
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
  }, [setImportUrl, setLoadingSpotifyPlaylists, setPendingImportUrl, setSpotifyExportStatus, setSpotifyPlaylistPicker, openSpotifyImports]);


  const previewTrack = previewFile
    ? (generatedSet.find(t => t.filePath === previewFile) ?? null)
    : null;

  return (
    <div className="h-screen bg-[#16161e] text-[#e2e8f0] flex flex-col overflow-hidden">
      {/* Hidden audio element for in-app preview */}
      <audio
        ref={audioRef}
        onEnded={() => { setPreviewPlaying(false); setPreviewFile(null); }}
        onPause={() => setPreviewPlaying(false)}
        onPlay={() => { setPreviewPlaying(true); player.pause(); }}
      />
      {/* Update available banner */}
      {updateInfo && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-[#1a1030] border-b border-[#7c3aed44] text-xs">
          <span className="text-[#a78bfa]">
            ✦ DJFriend <span className="font-semibold text-[#c4b5fd]">v{updateInfo.latestVersion}</span> is available
          </span>
          <div className="flex items-center gap-3">
            <a
              href={updateInfo.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1 rounded-md bg-[#7c3aed] text-white hover:bg-[#6d28d9] transition-colors font-medium"
            >
              Download
            </a>
            <button
              onClick={() => setUpdateInfo(null)}
              className="text-[#b6c2d0] hover:text-[#ccd6e2] transition-colors"
              aria-label="Dismiss update notification"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {/* Startup initialization overlay */}
      {isInitializing && (
        <div className="fixed inset-0 z-50 bg-[#16161e] flex flex-col items-center justify-center gap-6">
          <img
            src="/icon.png"
            alt="DJFriend"
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              objectFit: "cover",
            }}
          />
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm font-medium text-[#e2e8f0]">
              Initializing library…
            </p>
            <LoaderStatus label={initStatus.label} detail={initStatus.detail} />
          </div>
          <div className="w-48 h-0.5 bg-[#2c2c42] rounded-full overflow-hidden">
            <div className="h-full bg-[#7c3aed] rounded-full animate-pulse w-full" />
          </div>
        </div>
      )}
      {/* Header */}
      <header className="border-b border-[#2c2c42] bg-[#16161e] sticky top-0 z-40 pt-6">
        <div className="px-2 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
            <img
              src="/icon.png"
              alt="DJFriend"
              className="flex-shrink-0"
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                objectFit: "cover",
              }}
            />
            <span className="font-bold text-lg tracking-tight text-[#e2e8f0] flex-shrink-0">
              DJFriend
            </span>
            {libraryName && (
              <span className="hidden sm:inline text-xs text-[#b6c2d0] bg-[#20202e] border border-[#363650] px-2 py-0.5 rounded truncate min-w-0">
                {libraryName} · {library.length} tracks
                {library.some((s) => s.semanticTags) && (
                  <span className="text-[#b6c2d0]">
                    {" "}
                    · {library.filter((s) => s.semanticTags).length} tagged
                  </span>
                )}
              </span>
            )}
            {(() => {
              const missing = library.filter((s) => s.bpm <= 0 || !s.camelot);
              if (missing.length === 0) return null;
              return (
                <span
                  className="hidden sm:inline text-xs text-[#f59e0b] bg-[#f59e0b0d] border border-[#f59e0b33] px-2 py-0.5 rounded cursor-default"
                  title={`${missing.length} track${missing.length === 1 ? "" : "s"} missing BPM or key — rescan to fix`}
                >
                  ⚠ {missing.length} incomplete
                </span>
              );
            })()}
            {!navigator.userAgent.toLowerCase().includes("electron") &&
              libraryName.includes("(imported)") && (
                <span className="hidden sm:inline text-xs text-[#b6c2d0] italic">
                  BPM/key/energy are AI-estimated — not from audio analysis
                </span>
              )}
            {library.length > 0 && (
              <button
                onClick={async () => {
                  setReanalyzingLibrary(true);
                  setReanalyzeProgress("Starting...");
                  try {
                    const res = await fetch("/api/reanalyze-library", {
                      method: "POST",
                    });
                    if (!res.body) return;
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = "";
                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;
                      buffer += decoder.decode(value, { stream: true });
                      const lines = buffer.split("\n");
                      buffer = lines.pop() || "";
                      for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                          const event = JSON.parse(line) as {
                            type: string;
                            completed?: number;
                            total?: number;
                            file?: string;
                            updated?: number;
                          };
                          if (
                            event.type === "progress" &&
                            event.completed != null &&
                            event.total != null
                          ) {
                            setReanalyzeProgress(
                              `${event.completed}/${event.total}`,
                            );
                          } else if (event.type === "done") {
                            setReanalyzeProgress(
                              `Done — ${event.updated} updated`,
                            );
                          }
                        } catch {
                          /* ignore parse errors */
                        }
                      }
                    }
                    // Reload library to reflect updated values
                    setTimeout(() => window.location.reload(), 1200);
                  } catch {
                    /* ignore */
                  } finally {
                    setReanalyzingLibrary(false);
                  }
                }}
                disabled={reanalyzingLibrary}
                className="hidden sm:inline text-xs text-[#b6c2d0] bg-[#20202e] border border-[#363650] px-2 py-0.5 rounded hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title="Re-run full analysis on every track — updates BPM, key, energy, and AI tags (vibe, mood, vocal type)."
              >
                {reanalyzingLibrary
                  ? `⟳ ${reanalyzeProgress}`
                  : "⟳ Re-analyze library"}
              </button>
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
                  const aiActive =
                    item.status === "analyzing" &&
                    enrichmentStatus !== null &&
                    enrichmentStatus.total > 0;
                  const aiPct = aiActive
                    ? Math.round(
                        (enrichmentStatus!.completed /
                          enrichmentStatus!.total) *
                          100,
                      )
                    : 0;
                  const trackPct = item.total > 0
                    ? Math.min(
                        100,
                        Math.round((item.completed / item.total) * 100),
                      )
                    : 0;
                  return (
                    <div
                      key={item.playlistName}
                      className="flex items-center gap-1.5"
                    >
                      {aiActive && (
                        <div
                          className="flex items-center gap-1 flex-shrink-0"
                          title={`AI ${enrichmentStatus!.completed}/${enrichmentStatus!.total}`}
                        >
                          <span className="text-[9px] uppercase tracking-wider text-[#22c55e] font-semibold">
                            AI
                          </span>
                          <div className="w-10 h-1 rounded-full bg-[#262f3e] overflow-hidden">
                            <div
                              className="h-full bg-[#22c55e] transition-all"
                              style={{ width: `${aiPct}%` }}
                            />
                          </div>
                        </div>
                      )}
                      <div className="w-24 h-1.5 rounded-full bg-[#262f3e] overflow-hidden flex-shrink-0">
                        <div
                          className={`h-full transition-all ${item.status === "analyzing" ? "bg-[#7c3aed]" : "bg-[#3e4f65]"}`}
                          style={{ width: `${trackPct}%` }}
                        />
                      </div>
                      <span
                        className={`text-[10px] tabular-nums truncate max-w-[80px] ${item.status === "analyzing" ? "text-[#ccd6e2]" : "text-[#b6c2d0]"}`}
                      >
                        {item.status === "queued"
                          ? (item.playlistName === ALL_APPLE_MUSIC ? "All of Apple Music" : item.playlistName)
                          : item.total === 0 ? "Reading…" : `${item.completed}/${item.total}`}
                      </span>
                      <button
                        onClick={() => cancelQueueItem(item.playlistName)}
                        aria-label={`Cancel ${item.playlistName === ALL_APPLE_MUSIC ? "Apple Music library import" : item.playlistName}`}
                        className="text-[10px] text-[#b6c2d0] hover:text-red-400 transition-colors cursor-pointer leading-none flex-shrink-0"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}


            <div className="relative">
              <button
                onClick={() => setSettingsOpen(true)}
                title="Settings"
                className="p-1.5 text-[#b6c2d0] hover:text-[#ccd6e2] transition-colors cursor-pointer"
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
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </div>
            {/* Hidden file input for M3U / TXT import */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".m3u,.m3u8,.txt"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const text = await file.text();
                const label = file.name.replace(/\.[^.]+$/, "");
                if (navigator.userAgent.toLowerCase().includes("electron")) {
                  const lines = text
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter((l) => l.length > 0 && !l.startsWith("#"));
                  void runPathListAnalysis(lines, label);
                } else {
                  // Web: parse playlist file and enrich via Spotify
                  const rawLines = text.split(/\r\n|\r|\n/);
                  const tracks: Array<{ artist: string; title: string }> = [];

                  // 1. Apple Music TSV export (first line has tab-separated headers starting with "Name")
                  const firstLine = rawLines[0] ?? "";
                  if (
                    firstLine.includes("\t") &&
                    firstLine.split("\t")[0].trim() === "Name"
                  ) {
                    const headers = firstLine.split("\t").map((h) => h.trim());
                    const nameIdx = headers.indexOf("Name");
                    const artistIdx = headers.indexOf("Artist");
                    for (let i = 1; i < rawLines.length; i++) {
                      const cols = rawLines[i].split("\t");
                      const name = cols[nameIdx]?.trim() ?? "";
                      const artist =
                        artistIdx >= 0 ? (cols[artistIdx]?.trim() ?? "") : "";
                      if (name) tracks.push({ artist, title: name });
                    }
                  }
                  // 2. M3U/M3U8 with #EXTINF metadata
                  else if (
                    rawLines.some((l) => l.trim().startsWith("#EXTINF:"))
                  ) {
                    for (const line of rawLines) {
                      if (!line.trim().startsWith("#EXTINF:")) continue;
                      const meta = line
                        .trim()
                        .replace(/^#EXTINF:[^,]*,/, "")
                        .trim();
                      const dashIdx = meta.indexOf(" - ");
                      if (dashIdx !== -1) {
                        tracks.push({
                          artist: meta.slice(0, dashIdx).trim(),
                          title: meta.slice(dashIdx + 3).trim(),
                        });
                      } else {
                        tracks.push({ artist: "", title: meta });
                      }
                    }
                  }
                  // 3. Plain text / file path list
                  else {
                    for (const l of rawLines) {
                      const line = l.trim();
                      if (!line || line.startsWith("#")) continue;
                      const basename =
                        line.replace(/\\/g, "/").split("/").pop() ?? line;
                      const name = basename.replace(/\.[^.]+$/, "").trim();
                      const dashIdx = name.indexOf(" - ");
                      if (dashIdx !== -1) {
                        tracks.push({
                          artist: name.slice(0, dashIdx).trim(),
                          title: name.slice(dashIdx + 3).trim(),
                        });
                      } else {
                        tracks.push({ artist: "", title: name });
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
                e.target.value = "";
                if (!file) return;
                const text = await file.text();
                const { tracks } = parseRekordboxXml(text);
                // Filter out tracks with no valid path; keep bpm=0 tracks so DJFriend can analyze them
                const validTracks = tracks.filter(t => t.path.length > 0);
                void runRekordboxImport(validTracks);
              }}
            />
            <div className="relative" ref={analyzeMenuRef}>
              <button
                onClick={() => setAnalyzeMenuOpen((o) => !o)}
                disabled={loadingPlaylists}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-[#363650] bg-[#20202e] text-[#ccd6e2] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingPlaylists ? "Loading…" : "Analyze"}
                <span className="text-[10px]">▾</span>
              </button>
              {analyzeMenuOpen && !loadingPlaylists && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-md border border-[#363650] bg-[#20202e] shadow-lg overflow-hidden">
                  {navigator.userAgent.toLowerCase().includes("electron") && isMacOS && (
                    <button
                      onClick={() => {
                        setAnalyzeMenuOpen(false);
                        void openPlaylistPicker();
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs text-[#ccd6e2] hover:bg-[#26263c] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                    >
                      Apple Music
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setAnalyzeMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="w-full text-left px-4 py-2.5 text-xs text-[#ccd6e2] hover:bg-[#26263c] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                  >
                    Import M3U / TXT
                  </button>
                  <button
                    onClick={() => {
                      setAnalyzeMenuOpen(false);
                      rbFileInputRef.current?.click();
                    }}
                    className="w-full text-left px-4 py-2.5 text-xs text-[#ccd6e2] hover:bg-[#26263c] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#2c2c42]"
                  >
                    Import Rekordbox XML
                  </button>
                  <button
                    onClick={() => {
                      setAnalyzeMenuOpen(false);
                      uploadFolderInputRef.current?.click();
                    }}
                    className="w-full text-left px-4 py-2.5 text-xs text-[#ccd6e2] hover:bg-[#26263c] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#2c2c42]"
                  >
                    Upload Folder
                    <span className="ml-1.5 text-[10px] text-[#b6c2d0]">
                      (web)
                    </span>
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
                e.target.value = "";
                if (!files || files.length === 0) return;
                void runUploadAnalysis(files);
              }}
            />
          </div>
        </div>

        {/* Tab nav */}
        <div className="px-2 flex gap-1">
          {(["Library", "Set Generator", "History", "Crates", "Gig Finder"] as const).map((tab) => {
            const isCratesLocked = tab === "Crates" && !hasDiscogsOAuth;
            const isLocked = isCratesLocked;
            return (
              <button
                key={tab}
                onClick={() => {
                  if (isCratesLocked) { setSettingsOpen(true); return; }
                  setActiveTab(tab as typeof activeTab);
                }}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                  isLocked
                    ? "border-transparent text-[#5a5a7a] hover:text-[#b6c2d0]"
                    : activeTab === tab
                    ? "border-[#7c3aed] text-[#e2e8f0]"
                    : "border-transparent text-[#b6c2d0] hover:text-[#ccd6e2]"
                }`}
                title={isCratesLocked ? "Connect Discogs in Settings to unlock Crates" : undefined}
              >
                <span className="flex items-center gap-1.5">
                  {tab === "Crates"
                    ? <img src={new URL('./assets/discogs-logo.svg', import.meta.url).href} alt="Discogs" className="h-3.5 w-auto" style={{ filter: isCratesLocked ? 'brightness(0.18)' : activeTab === 'Crates' ? 'brightness(0.92)' : 'brightness(0.38)' }} />
                    : tab}
                  {isLocked && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-50"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  )}
                  {tab === "Library" && isInitializing && (
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-[#7c3aed]/30 border-t-[#7c3aed] animate-spin inline-block" />
                  )}
                  {tab === "Library" && !isInitializing && library.length > 0 && (
                    <span className="text-[10px] bg-[#363650] text-[#ccd6e2] px-1.5 py-0.5 rounded-full">
                      {library.length}
                    </span>
                  )}
                  {tab === "History" && history.length > 0 && (
                    <span className="text-[10px] bg-[#363650] text-[#ccd6e2] px-1.5 py-0.5 rounded-full">
                      {history.length}
                    </span>
                  )}
                  {tab === "Crates" && discogsCollection && (
                    <span className="text-[10px] bg-[#363650] text-[#ccd6e2] px-1.5 py-0.5 rounded-full">
                      {discogsCollection.releases.length}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Tab content — flex-1 so each tab fills remaining viewport height */}
      <div className="flex-1 min-h-0 flex flex-col">
      {error && (
        <div className="sm:hidden px-4 pt-3 flex-shrink-0">
          <p className="text-xs text-[#ef4444]">{error}</p>
        </div>
      )}

      {activeTab === "Set Generator" && (
        <main className="px-2 flex-1 min-h-0 overflow-hidden">
          <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 h-full py-6">
            {/* ── LEFT SIDEBAR ── */}
            <div className="lg:w-96 xl:w-[26rem] flex-shrink-0 flex flex-col gap-4 lg:overflow-y-auto">

              {/* Card 1: Source — visible when playlists exist (Apple Music or Spotify) */}
              {Object.keys(applePlaylistFiles).length === 0 && importHistory.length === 0 && playlistLib.playlists.length === 0 ? (
                <div className="bg-[#20202e] border border-[#2c2c42] rounded-xl p-4 flex flex-col gap-2.5">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#b6c2d0]">Source</span>
                  <div className="flex flex-col gap-1.5 py-1">
                    <p className="text-xs text-[#b6c2d0]">No playlists imported yet.</p>
                    <p className="text-[11px] text-[#a3b0c2]">
                      Import a Spotify playlist or load an Apple Music library to filter your generator source.
                    </p>
                    {hasSpotifyCredentials && (
                      <button
                        type="button"
                        onClick={() => openSpotifyImports()}
                        className="mt-1 self-start px-2.5 py-1 rounded-md text-xs text-[#7c3aed] border border-[#7c3aed33] bg-[#7c3aed0d] hover:bg-[#7c3aed1a] transition-colors cursor-pointer"
                      >
                        Open Spotify →
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-[#20202e] border border-[#2c2c42] rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-widest font-semibold text-[#b6c2d0] whitespace-nowrap">
                      Source
                    </span>
                    <InfoMark text="Choose which tracks to generate from — your full library or a specific imported playlist. The generator only considers tracks in the selected source." />
                    <div className="flex gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          setPlaylistFilterIds([]);
                          setSourceDropdownOpen(false);
                        }}
                        className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border"
                        style={{
                          backgroundColor: playlistFilterIds.length === 0 ? "#7c3aed" : "transparent",
                          color: playlistFilterIds.length === 0 ? "#fff" : "#8394a8",
                          borderColor: playlistFilterIds.length === 0 ? "#7c3aed" : "#363650",
                        }}
                      >
                        Full Library
                      </button>
                      <div className="relative" ref={sourceDropdownRef}>
                        <button
                          type="button"
                          onClick={() => setSourceDropdownOpen((v) => !v)}
                          className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border truncate max-w-[200px] flex items-center gap-1"
                          style={{
                            backgroundColor: playlistFilterIds.length > 0 ? "#7c3aed" : "transparent",
                            color: playlistFilterIds.length > 0 ? "#fff" : "#8394a8",
                            borderColor: playlistFilterIds.length > 0 ? "#7c3aed" : "#363650",
                          }}
                        >
                          <span className="truncate max-w-[160px]">
                            {playlistFilterIds.length === 0
                              ? "From Playlist"
                              : playlistFilterIds.length === 1
                              ? (playlistFilterIds[0] === "__selection__"
                                  ? `Selection (${librarySelection?.size ?? 0})`
                                  : playlistFilterIds[0].startsWith("pl:")
                                  ? playlistLib.playlists.find(p => p.id === playlistFilterIds[0].slice(3))?.name ?? "Playlist"
                                  : playlistFilterIds[0].startsWith("apple:")
                                  ? playlistFilterIds[0].slice(6)
                                  : importHistory.find((e) => e.id === playlistFilterIds[0])?.name ?? "Playlist")
                              : `${playlistFilterIds.length} playlists`}
                          </span>
                          <svg className="w-3 h-3 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {sourceDropdownOpen && (
                          <div className="absolute left-0 top-full mt-1 z-30 bg-[#20202e] border border-[#363650] rounded-lg shadow-xl py-1 min-w-[220px] max-h-60 overflow-y-auto">
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2 text-xs text-[#b6c2d0] hover:bg-[#2c2c42] transition-colors cursor-pointer"
                              onClick={() => { setPlaylistFilterIds([]); setSourceDropdownOpen(false); }}
                            >
                              — Full Library (no filter) —
                            </button>
                            {[...playlistLib.playlists].sort((a, b) => a.name.localeCompare(b.name)).map((pl) => {
                              const id = `pl:${pl.id}`;
                              const isSelected = playlistFilterIds.includes(id);
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-[#2c2c42] transition-colors flex items-center gap-2 cursor-pointer"
                                  style={{ color: isSelected ? "#a78bfa" : "#e2e8f0", backgroundColor: isSelected ? "#2c263c" : undefined }}
                                  onClick={() => setPlaylistFilterIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                                >
                                  <span className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${isSelected ? "bg-[#7c3aed] border-[#7c3aed]" : "border-[#46465e]"}`}>
                                    {isSelected && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                  </span>
                                  <span className="text-[#7c3aed] shrink-0" aria-hidden>♫</span>
                                  <span className="truncate flex-1">{pl.name}</span>
                                  <span className="shrink-0 text-[10px] text-[#b6c2d0] whitespace-nowrap">{playlistCounts.get(pl.id) ?? 0} tracks</span>
                                </button>
                              );
                            })}
                            {Object.entries(applePlaylistFiles).map(([name, files]) => {
                              const id = `apple:${name}`;
                              const inLib = files.filter(f => library.some(s => s.file === f || s.filePath === f)).length;
                              const isSelected = playlistFilterIds.includes(id);
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-[#2c2c42] transition-colors flex items-center gap-2 cursor-pointer"
                                  style={{ color: isSelected ? "#a78bfa" : "#e2e8f0", backgroundColor: isSelected ? "#2c263c" : undefined }}
                                  onClick={() => setPlaylistFilterIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                                >
                                  <span className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${isSelected ? "bg-[#7c3aed] border-[#7c3aed]" : "border-[#46465e]"}`}>
                                    {isSelected && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                  </span>
                                  <span className="truncate flex-1">{name}</span>
                                  <span className="shrink-0 text-[10px] text-[#b6c2d0] whitespace-nowrap">{inLib} tracks</span>
                                </button>
                              );
                            })}
                            {importHistory.map((entry) => {
                              const inLib = entry.tracks.filter((t) => t.inLibrary).length;
                              const isSelected = playlistFilterIds.includes(entry.id);
                              return (
                                <button
                                  key={entry.id}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-[#2c2c42] transition-colors flex items-center gap-2 cursor-pointer"
                                  style={{ color: isSelected ? "#a78bfa" : "#e2e8f0", backgroundColor: isSelected ? "#2c263c" : undefined }}
                                  onClick={() => setPlaylistFilterIds(prev => prev.includes(entry.id) ? prev.filter(x => x !== entry.id) : [...prev, entry.id])}
                                >
                                  <span className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${isSelected ? "bg-[#7c3aed] border-[#7c3aed]" : "border-[#46465e]"}`}>
                                    {isSelected && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                  </span>
                                  <span className="truncate flex-1">{entry.name}</span>
                                  <span className="shrink-0 text-[10px] text-[#b6c2d0] whitespace-nowrap">{inLib}/{entry.tracks.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {discogsCollection && (
                    <div className="flex flex-col gap-2 pt-1 border-t border-[#2c2c42]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase tracking-widest font-semibold text-[#b6c2d0] whitespace-nowrap">Media</span>
                        <div className="flex gap-1.5">
                          {(['library', 'crates-first', 'crates'] as DiscogsMode[]).map(mode => {
                            const labels: Record<DiscogsMode, string> = { library: 'Digital', 'crates-first': 'Mixed', crates: 'Vinyl' };
                            const active = discogsMode === mode;
                            return (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => setDiscogsMode(mode)}
                                title={{ library: 'Digital library only', 'crates-first': 'Vinyl + digital — vinyl scores higher', crates: 'Vinyl only' }[mode]}
                                className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border"
                                style={{
                                  backgroundColor: active ? '#7c3aed' : 'transparent',
                                  color: active ? '#fff' : '#8394a8',
                                  borderColor: active ? '#7c3aed' : '#363650',
                                }}
                              >
                                {labels[mode]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {(discogsMode === 'crates-first' || discogsMode === 'crates') && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-widest font-semibold text-[#b6c2d0] whitespace-nowrap">Turntables</span>
                          <div className="flex rounded overflow-hidden border border-[#363650] text-[10px] font-medium">
                            {([0, 1, 2] as const).map(n => {
                              const vinylCount = djSystem.channels.filter(k => k === 'vinyl').length;
                              const active = vinylCount === n;
                              return (
                                <button key={n} type="button"
                                  onClick={() => {
                                    const chCount = djSystem.channels.length;
                                    const next: ChannelKind[] = Array(chCount).fill('digital' as ChannelKind);
                                    for (let i = 0; i < Math.min(n, chCount); i++) next[i] = 'vinyl';
                                    handleSetDjSystem({ channels: next });
                                  }}
                                  className="px-2.5 py-1 transition-colors cursor-pointer"
                                  style={{ backgroundColor: active ? '#7c3aed' : 'transparent', color: active ? '#fff' : '#8394a8' }}
                                >
                                  {n}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {discogsMode === 'crates' && discogsDaysSince !== null && (
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] text-[#b6c2d0]">
                            <span className="text-[#ccd6e2] font-medium">{discogsCollection.totalReleases}</span> vinyl
                            {discogsDaysSince >= 30 && <span className="text-[#f59e0b] ml-2">{discogsDaysSince}d since sync ⚠</span>}
                          </p>
                          <button
                            type="button"
                            title="Re-sync Discogs collection"
                            onClick={() => void syncDiscogsCollection()}
                            disabled={discogsSyncStatus.phase === 'syncing'}
                            className="text-[10px] text-[#b6c2d0] hover:text-[#a78bfa] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                            aria-label="Re-sync Discogs collection"
                          >
                            {discogsSyncStatus.phase === 'syncing' ? '…' : '↺'}
                          </button>
                        </div>
                      )}
                      {discogsMode === 'crates-first' && (
                        <p className="text-[11px] text-[#b6c2d0]">
                          <span className="text-[#ccd6e2] font-medium">{discogsCollection.totalReleases}</span> vinyl · <span className="text-[#ccd6e2] font-medium">{library.length}</span> digital
                        </p>
                      )}
                    </div>
                  )}
                  {playlistFilterIds.length > 0 && playlistFilterFiles && (
                    <p className="text-[11px] text-[#b6c2d0]">
                      <span className="text-[#ccd6e2] font-medium">{playlistFilterFiles.size}</span> tracks in playlist
                    </p>
                  )}
                </div>
              )}

              {/* Card 3: Genre */}
              {genreGroups.length > 0 && (
                <div className="bg-[#20202e] border border-[#2c2c42] rounded-xl p-4">
                  <GenrePicker
                    labels={genreGroups}
                    selected={prefs.genres}
                    countFor={genreCountFor}
                    onToggle={selectGenre}
                    onClear={() => selectGenre("Any")}
                  />
                </div>
              )}

              {/* Card 3: Duration + BPM Range */}
              <div className="bg-[#20202e] border border-[#2c2c42] rounded-xl p-4 flex flex-col gap-4">
                {/* Duration */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] uppercase tracking-widest font-semibold text-[#b6c2d0] whitespace-nowrap">Duration</span>
                    <InfoMark text="Target set length. Tracks are added until this duration is reached. The estimate on the right is based on average track length in your current filtered library." />
                    {filteredTrackCount > 0 && (
                      <span className="text-[10px] text-[#b6c2d0]">≈ {filteredTrackCount} tracks</span>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setPrefs((p) => ({ ...p, setDuration: null }))}
                      disabled={minViablePill !== null && playlistFilterIds.length === 0}
                      title={playlistFilterIds.length > 0 ? "Include all tracks from selected playlists" : undefined}
                      className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: prefs.setDuration === null ? "#7c3aed" : "transparent",
                        color: prefs.setDuration === null ? "#fff" : "#8394a8",
                        borderColor: prefs.setDuration === null ? "#7c3aed" : "#363650",
                      }}
                    >
                      {playlistFilterIds.length > 0 ? "Max" : "Any"}
                    </button>
                    {SET_DURATIONS.map((min) => {
                      const active = prefs.setDuration === min;
                      const lockedByPlaylist = minViablePill !== null && min !== minViablePill;
                      const title = lockedByPlaylist
                        ? min < (minViablePill ?? 0)
                          ? `Playlist is ~${Math.ceil(playlistTotalMinutes)}m — too short`
                          : `Use ${minViablePill}m to match the playlist length`
                        : undefined;
                      return (
                        <button
                          key={min}
                          type="button"
                          onClick={() => { if (!lockedByPlaylist) setPrefs((p) => ({ ...p, setDuration: min })); }}
                          disabled={lockedByPlaylist}
                          title={title}
                          className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border disabled:opacity-30 disabled:cursor-not-allowed"
                          style={{
                            backgroundColor: active ? "#7c3aed" : "transparent",
                            color: active ? "#fff" : "#8394a8",
                            borderColor: active ? "#7c3aed" : "#363650",
                          }}
                        >
                          {min}m
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* BPM Range */}
                <div className="border-t border-[#2c2c42] pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-widest font-semibold text-[#b6c2d0]">BPM Range</span>
                      <InfoMark text="Hard filter — only tracks within this tempo range are considered. Leave both fields empty to include all tempos." />
                    </div>
                    {(prefs.bpmMin != null || prefs.bpmMax != null) && (
                      <button type="button" onClick={() => setPrefs(p => ({ ...p, bpmMin: undefined, bpmMax: undefined }))} className="text-[10px] text-[#b6c2d0] hover:text-[#ccd5df] transition-colors">
                        clear
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min={40} max={250} placeholder="Min"
                      value={prefs.bpmMin ?? ""}
                      onChange={e => { const v = e.target.value === "" ? undefined : Number(e.target.value); setPrefs(p => ({ ...p, bpmMin: v })); }}
                      className="w-full rounded px-2 py-1.5 text-xs text-[#e2e8f0] bg-[#1c1c2e] border border-[#363650] focus:outline-none focus:border-[#7c3aed] text-center"
                    />
                    <span className="text-[#b6c2d0] text-xs flex-shrink-0">–</span>
                    <input
                      type="number" min={40} max={250} placeholder="Max"
                      value={prefs.bpmMax ?? ""}
                      onChange={e => { const v = e.target.value === "" ? undefined : Number(e.target.value); setPrefs(p => ({ ...p, bpmMax: v })); }}
                      className="w-full rounded px-2 py-1.5 text-xs text-[#e2e8f0] bg-[#1c1c2e] border border-[#363650] focus:outline-none focus:border-[#7c3aed] text-center"
                    />
                  </div>
                </div>
              </div>
              {/* Card 2: Filters (only when tag data exists) */}
              {availableTags.vibeTags.length +
                availableTags.moodTags.length +
                availableTags.venueTags.length +
                availableTags.timeOfNightTags.length +
                availableTags.vocalTypes.length +
                availableGenres.length >
                0 &&
                (() => {
                  const commentFilterActive = !!(prefs.commentFilter && prefs.commentFilter.text.trim() !== '');
                  const activeFilterCount =
                    prefs.tagFilters.vibeTags.length +
                    prefs.tagFilters.moodTags.length +
                    prefs.tagFilters.vocalTypes.length +
                    prefs.tagFilters.venueTags.length +
                    prefs.tagFilters.timeOfNightTags.length +
                    (commentFilterActive ? 1 : 0);
                  const activeList = [
                    ...prefs.tagFilters.vibeTags,
                    ...prefs.tagFilters.moodTags,
                    ...prefs.tagFilters.vocalTypes,
                    ...prefs.tagFilters.venueTags,
                    ...prefs.tagFilters.timeOfNightTags,
                    ...(commentFilterActive ? [`comment ${prefs.commentFilter!.mode} "${prefs.commentFilter!.text.trim()}"`] : []),
                  ];
                  return (
                    <div className="bg-[#20202e] border border-[#2c2c42] rounded-xl overflow-hidden">
                      {/* Toggle header */}
                      <button
                        type="button"
                        onClick={() => setFiltersOpen((o) => !o)}
                        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#1c1c2e] transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-widest text-[#b6c2d0]">
                            Filters
                          </span>
                          {activeFilterCount > 0 && (
                            <span className="text-[10px] font-medium bg-[#7c3aed33] text-[#a78bfa] border border-[#7c3aed66] px-1.5 py-0.5 rounded-full tabular-nums">
                              {activeFilterCount}
                            </span>
                          )}
                          {activeFilterCount > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPrefs(p => ({
                                  ...p,
                                  tagFilters: { vibeTags: [], moodTags: [], vocalTypes: [], venueTags: [], timeOfNightTags: [] },
                                  dateFilter: { field: 'dateAdded', preset: 'all' },
                                }));
                              }}
                              className="text-[10px] text-[#b6c2d0] hover:text-[#ccd6e2] transition-colors"
                            >
                              clear all
                            </button>
                          )}
                        </div>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`text-[#b6c2d0] transition-transform duration-150 ${filtersOpen ? "rotate-180" : ""}`}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>

                      {/* Active filter summary — always visible when filters active */}
                      {activeFilterCount > 0 && (
                        <div className="px-5 pb-3 border-t border-[#2c2c42] pt-3">
                          <div className="flex items-center gap-2 text-[11px] bg-[#1c1c2e] border border-[#363650] rounded-md px-3 py-1.5">
                            <span className="text-[#b6c2d0] flex-shrink-0">
                              {activeFilterCount} active:
                            </span>
                            <span className="text-[#ccd6e2] truncate">
                              {activeList.join(" · ")}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                selectGenre("Any");
                                setPrefs(p => ({ ...p, commentFilter: undefined }));
                              }}
                              className="ml-auto text-[#b6c2d0] hover:text-[#ef4444] transition-colors cursor-pointer flex-shrink-0"
                              title="Clear all filters"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Expanded filter pills */}
                      {filtersOpen && (
                        <div
                          className={`px-4 pb-4 flex flex-col gap-4 ${activeFilterCount === 0 ? "border-t border-[#2c2c42] pt-4" : "pt-2"}`}
                        >
                          <div>
                            {/* Field selector toggle */}
                            <div className="flex items-center gap-1 mb-2">
                              <span className="text-[10px] uppercase tracking-widest font-semibold text-[#b6c2d0]">
                                Date
                              </span>
                              {prefs.dateFilter && prefs.dateFilter.preset !== "all" && (
                                <button
                                  type="button"
                                  onClick={() => setPrefs(p => ({ ...p, dateFilter: { field: 'dateAdded', preset: 'all' } }))}
                                  className="w-3.5 h-3.5 rounded-full border border-[#8394a8] text-[#b6c2d0] hover:border-[#ef4444] hover:text-[#ef4444] transition-colors flex items-center justify-center flex-shrink-0 cursor-pointer"
                                  title="Clear date filter"
                                  style={{ fontSize: 9, lineHeight: 1 }}
                                >
                                  ×
                                </button>
                              )}
                              <div className="ml-2 flex rounded overflow-hidden border border-[#5a24a8]">
                                {(["dateAdded", "releaseYear"] as const).map(
                                  (f) => {
                                    const active =
                                      (prefs.dateFilter?.field ??
                                        "dateAdded") === f;
                                    return (
                                      <button
                                        key={f}
                                        type="button"
                                        onClick={() =>
                                          setPrefs((p) => ({
                                            ...p,
                                            dateFilter: {
                                              ...(p.dateFilter ?? {
                                                preset: "all",
                                              }),
                                              field: f,
                                            },
                                          }))
                                        }
                                        className="px-2 py-0.5 text-[10px] font-medium transition-all cursor-pointer"
                                        style={{
                                          backgroundColor: active
                                            ? "#7c3aed"
                                            : "transparent",
                                          color: active ? "#fff" : "#a78bfa",
                                        }}
                                      >
                                        {f === "dateAdded"
                                          ? "Date Added"
                                          : "Release Year"}
                                      </button>
                                    );
                                  },
                                )}
                              </div>
                            </div>
                            {/* Preset pills */}
                            <div className="flex flex-wrap gap-1.5">
                              {(
                                [
                                  "all",
                                  "thisYear",
                                  "lastYear",
                                  "range",
                                ] as const
                              ).map((opt) => {
                                const label =
                                  opt === "all"
                                    ? "All"
                                    : opt === "thisYear"
                                      ? "This Year"
                                      : opt === "lastYear"
                                        ? "Last Year"
                                        : "Range";
                                const active =
                                  (prefs.dateFilter?.preset ?? "all") === opt;
                                return (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => {
                                      if (opt !== "range")
                                        setDateCalendar(null);
                                      setPrefs((p) => ({
                                        ...p,
                                        dateFilter: {
                                          ...(p.dateFilter ?? {
                                            field: "dateAdded",
                                          }),
                                          preset: opt,
                                        },
                                      }));
                                    }}
                                    className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border"
                                    style={{
                                      backgroundColor: active
                                        ? "#7c3aed"
                                        : "transparent",
                                      color: active ? "#fff" : "#a78bfa",
                                      borderColor: active
                                        ? "#7c3aed"
                                        : "#5a24a8",
                                    }}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                            {/* Calendar date range — shown only when preset = range */}
                            {(prefs.dateFilter?.preset ?? "all") ===
                              "range" && (
                              <div className="mt-2 space-y-1">
                                {/* From */}
                                <div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDateCalendar((c) =>
                                        c === "from" ? null : "from",
                                      )
                                    }
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition-all cursor-pointer w-full"
                                    style={{
                                      backgroundColor:
                                        dateCalendar === "from"
                                          ? "#2c2c42"
                                          : "transparent",
                                      borderColor: "#5a24a8",
                                      color: "#a78bfa",
                                    }}
                                  >
                                    <span className="text-[#b6c2d0]">From</span>
                                    <span>
                                      {prefs.dateFilter?.rangeFrom ?? "Ever"}
                                    </span>
                                  </button>
                                  {dateCalendar === "from" && (
                                    <CalendarPicker
                                      value={prefs.dateFilter?.rangeFrom}
                                      clearLabel="Ever (no start limit)"
                                      onConfirm={(date) => {
                                        setPrefs((p) => ({
                                          ...p,
                                          dateFilter: {
                                            ...(p.dateFilter ?? {
                                              field: "dateAdded",
                                              preset: "range",
                                            }),
                                            rangeFrom: date,
                                          },
                                        }));
                                        setDateCalendar(null);
                                      }}
                                    />
                                  )}
                                </div>
                                {/* To */}
                                <div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDateCalendar((c) =>
                                        c === "to" ? null : "to",
                                      )
                                    }
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition-all cursor-pointer w-full"
                                    style={{
                                      backgroundColor:
                                        dateCalendar === "to"
                                          ? "#2c2c42"
                                          : "transparent",
                                      borderColor: "#5a24a8",
                                      color: "#a78bfa",
                                    }}
                                  >
                                    <span className="text-[#b6c2d0]">To</span>
                                    <span>
                                      {prefs.dateFilter?.rangeTo ?? "Now"}
                                    </span>
                                  </button>
                                  {dateCalendar === "to" && (
                                    <CalendarPicker
                                      value={prefs.dateFilter?.rangeTo}
                                      clearLabel="Now (today)"
                                      onConfirm={(date) => {
                                        setPrefs((p) => ({
                                          ...p,
                                          dateFilter: {
                                            ...(p.dateFilter ?? {
                                              field: "dateAdded",
                                              preset: "range",
                                            }),
                                            rangeTo: date,
                                          },
                                        }));
                                        setDateCalendar(null);
                                      }}
                                    />
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                          {/* Comment filter */}
                          <div>
                            <div className="flex items-center gap-1 mb-2">
                              <span className="text-[10px] uppercase tracking-widest font-semibold text-[#b6c2d0]">
                                Comment
                              </span>
                              {commentFilterActive && (
                                <button
                                  type="button"
                                  onClick={() => setPrefs(p => ({ ...p, commentFilter: undefined }))}
                                  className="w-3.5 h-3.5 rounded-full border border-[#8394a8] text-[#b6c2d0] hover:border-[#ef4444] hover:text-[#ef4444] transition-colors flex items-center justify-center flex-shrink-0 cursor-pointer"
                                  title="Clear comment filter"
                                  style={{ fontSize: 9, lineHeight: 1 }}
                                >
                                  ×
                                </button>
                              )}
                            </div>
                            <div className="flex gap-2 items-center">
                              <div className="flex rounded-md border border-[#363650] overflow-hidden text-[10px] flex-shrink-0">
                                {(['includes', 'excludes'] as const).map(mode => (
                                  <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setPrefs(p => ({
                                      ...p,
                                      commentFilter: { text: p.commentFilter?.text ?? '', mode },
                                    }))}
                                    className="px-2 py-1 transition-colors cursor-pointer"
                                    style={{
                                      backgroundColor: (prefs.commentFilter?.mode ?? 'includes') === mode ? '#7c3aed' : 'transparent',
                                      color: (prefs.commentFilter?.mode ?? 'includes') === mode ? '#fff' : '#8394a8',
                                    }}
                                  >
                                    {mode}
                                  </button>
                                ))}
                              </div>
                              <input
                                type="text"
                                placeholder="filter text…"
                                value={prefs.commentFilter?.text ?? ''}
                                onChange={e => {
                                  const text = e.target.value;
                                  setPrefs(p => ({
                                    ...p,
                                    commentFilter: { text, mode: p.commentFilter?.mode ?? 'includes' },
                                  }));
                                }}
                                className="flex-1 bg-[#1c1c2e] border border-[#363650] rounded-md px-2 py-1 text-[11px] text-[#e2e8f0] placeholder-[#6b7a94] outline-none focus:border-[#7c3aed] transition-colors"
                              />
                            </div>
                          </div>

                          {availableGenres.length > 0 && (
                            <div>
                              <div className="flex items-center gap-1.5 mb-2">
                                <span className="text-[10px] uppercase tracking-widest font-semibold text-[#b6c2d0]">
                                  User Genre
                                </span>
                                {prefs.genres.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => selectGenre("Any")}
                                    className="w-3.5 h-3.5 rounded-full border border-[#8394a8] text-[#b6c2d0] hover:border-[#ef4444] hover:text-[#ef4444] transition-colors flex items-center justify-center flex-shrink-0 cursor-pointer"
                                    title="Clear genre filter"
                                    style={{ fontSize: 9, lineHeight: 1 }}
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                                {availableGenres.map((genre) => {
                                  const umbrellaActive = prefs.genres.some(
                                    g => g.startsWith("~") && genreMatchesUmbrella(genre, g)
                                  );
                                  const active = prefs.genres.includes(genre) || umbrellaActive;
                                  return (
                                    <button
                                      key={genre}
                                      type="button"
                                      onClick={() => selectGenre(genre)}
                                      className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border"
                                      style={{
                                        backgroundColor: umbrellaActive
                                          ? "#0c3a45"
                                          : active
                                            ? "#164e63"
                                            : "transparent",
                                        color: umbrellaActive
                                          ? "#67e8f9"
                                          : active
                                            ? "#e2e8f0"
                                            : "#22d3ee",
                                        borderColor: umbrellaActive
                                          ? "#0e7490"
                                          : active
                                            ? "#06b6d4"
                                            : "#164e63",
                                      }}
                                    >
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
                            const selectedTags = prefs.tagFilters[
                              key
                            ] as string[];
                            return (
                              <div key={key}>
                                <div className="flex items-center gap-1.5 mb-2">
                                  <span className="text-[10px] uppercase tracking-widest font-semibold text-[#b6c2d0]">
                                    {label}
                                  </span>
                                  {selectedTags.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setPrefs(p => ({ ...p, tagFilters: { ...p.tagFilters, [key]: [] } }))}
                                      className="w-3.5 h-3.5 rounded-full border border-[#8394a8] text-[#b6c2d0] hover:border-[#ef4444] hover:text-[#ef4444] transition-colors flex items-center justify-center flex-shrink-0 cursor-pointer"
                                      title={`Clear ${label.toLowerCase()} filter`}
                                      style={{ fontSize: 9, lineHeight: 1 }}
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {tags.map((tag) => {
                                    const active = selectedTags.includes(tag);
                                    return (
                                      <button
                                        key={tag}
                                        type="button"
                                        onClick={() => {
                                          const current = prefs.tagFilters[
                                            key
                                          ] as string[];
                                          const next = current.includes(tag)
                                            ? current.filter((t) => t !== tag)
                                            : [...current, tag];
                                          setPrefs((p) => ({
                                            ...p,
                                            tagFilters: {
                                              ...p.tagFilters,
                                              [key]: next,
                                            },
                                          }));
                                        }}
                                        className="px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border"
                                        style={{
                                          backgroundColor: active
                                            ? color.activeBg
                                            : "transparent",
                                          color: active
                                            ? "#fff"
                                            : color.inactiveText,
                                          borderColor: active
                                            ? color.activeBorder
                                            : color.inactiveBorder,
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

              {/* Card 5: Style / scoring presets — always visible */}
              {(() => {
                const PRESETS: { name: string; desc: string; weights: { harmonicWeight: number; energyWeight: number; bpmWeight: number; transitionWeight: number } }[] = [
                  { name: 'Balanced',    desc: 'Works for most sets',         weights: { harmonicWeight: 0.45, energyWeight: 0.25, bpmWeight: 0.22, transitionWeight: 0.08 } },
                  { name: 'Club',        desc: 'Techno / house / trance',     weights: { harmonicWeight: 0.55, energyWeight: 0.20, bpmWeight: 0.20, transitionWeight: 0.05 } },
                  { name: 'Festival',    desc: 'Big room — energy arc first', weights: { harmonicWeight: 0.20, energyWeight: 0.55, bpmWeight: 0.20, transitionWeight: 0.05 } },
                  { name: 'Open Format', desc: 'Bar / mixed genre / wedding', weights: { harmonicWeight: 0.20, energyWeight: 0.30, bpmWeight: 0.20, transitionWeight: 0.30 } },
                ];
                const activePreset = PRESETS.find(p =>
                  scoringWeights &&
                  p.weights.harmonicWeight === scoringWeights.harmonicWeight &&
                  p.weights.energyWeight === scoringWeights.energyWeight &&
                  p.weights.bpmWeight === scoringWeights.bpmWeight &&
                  p.weights.transitionWeight === scoringWeights.transitionWeight
                ) ?? PRESETS[0];
                return (
                  <div className="bg-[#20202e] border border-[#2c2c42] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[10px] uppercase tracking-widest font-semibold text-[#b6c2d0]">Style</span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {PRESETS.map((preset, i) => {
                        const isActive = preset.name === activePreset.name;
                        const isLast = i === PRESETS.length - 1;
                        return (
                          <div key={preset.name} className="relative group">
                            <button
                              type="button"
                              onClick={() => setScoringWeights(preset.name === 'Balanced' ? undefined : preset.weights)}
                              title={preset.desc}
                              className={`text-[10px] px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
                                isActive
                                  ? 'bg-[#7c3aed]/20 border-[#7c3aed]/60 text-[#a78bfa]'
                                  : 'bg-[#1c1c2e] border-[#2c2c42] text-[#b6c2d0] hover:border-[#424f63] hover:text-[#ccd5df]'
                              }`}
                            >
                              {preset.name}
                            </button>
                            <div className={`absolute bottom-full mb-2 w-40 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 ${isLast ? 'right-0' : 'left-0'}`}>
                              <div className="bg-[#26263c] border border-[#3a3a56] rounded-lg p-2.5 shadow-xl">
                                <p className="text-[10px] font-semibold text-[#c4b5fd] mb-0.5">{preset.name}</p>
                                <p className="text-[10px] text-[#ccd5df]">{preset.desc}</p>
                              </div>
                              <div className={`w-2 h-2 bg-[#26263c] border-r border-b border-[#3a3a56] rotate-45 -mt-1 ${isLast ? 'mr-3 ml-auto' : 'ml-3'}`} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Card 6: Generate CTA — always at the bottom of the sidebar */}
              {(() => {
                const FALLBACK_DURATION = 210;
                const rawPlaylistSec = generatedSet.reduce((s, t) => s + (t.duration ?? FALLBACK_DURATION), 0);
                const transitions = Math.max(0, generatedSet.length - 1);
                const estSetSec = rawPlaylistSec - MIX_OVERLAP_SEC * transitions;
                const fmtMin = (s: number) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
                return (
                  <div className="bg-[#20202e] border border-[#2c2c42] rounded-xl p-4 flex flex-col gap-3">
                    <div className="relative group">
                      <button
                        onClick={() => {
                          if (library.length === 0 || isGenerating) return;
                          setIsGenerating(true);
                          setHasAttemptedGenerate(true);
                          setTimeout(() => { handleGenerate(); setIsGenerating(false); }, 0);
                        }}
                        disabled={
                          isInitializing || library.length === 0 || isGenerating ||
                          (prefs.genres.length === 0 && playlistFilterIds.length === 0) ||
                          (playlistFilterIds.length > 0 && playlistFilterFiles === undefined)
                        }
                        aria-label="Generate set"
                        className="w-full flex items-center justify-center gap-2.5 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg cursor-pointer transition-all duration-200"
                        style={{
                          background: isGenerating ? "linear-gradient(135deg, #6d28d9, #5b21b6)" : "linear-gradient(135deg, #7c3aed, #6d28d9)",
                          padding: "12px 16px",
                          fontSize: "0.95rem",
                          fontWeight: 700,
                          boxShadow: isGenerating ? "none" : undefined,
                        }}
                        onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.background = "linear-gradient(135deg, #8b5cf6, #7c3aed)"; e.currentTarget.style.boxShadow = "0 0 20px rgba(124,58,237,0.4)"; } }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = isGenerating ? "linear-gradient(135deg, #6d28d9, #5b21b6)" : "linear-gradient(135deg, #7c3aed, #6d28d9)"; e.currentTarget.style.boxShadow = ""; }}
                      >
                        {isGenerating ? (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="animate-pulse"><polygon points="5,3 19,12 5,21" /></svg>
                            <span className="animate-pulse">Generating…</span>
                          </>
                        ) : (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                            Generate
                          </>
                        )}
                      </button>
                      {prefs.genres.length === 0 && playlistFilterIds.length === 0 && tipConfig.help && (
                        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-md bg-[#2c2c42] border border-[#363650] px-2.5 py-2 text-[11px] text-[#ccd6e2] leading-snug opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 text-center">
                          Pick a genre first to generate a set
                        </div>
                      )}
                      {playlistFilterIds.length > 0 && playlistFilterFiles === undefined && (
                        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-md bg-[#2c2c42] border border-[#363650] px-2.5 py-2 text-[11px] text-[#ccd6e2] leading-snug opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 text-center">
                          None of these playlist tracks are in your library
                        </div>
                      )}
                    </div>
                    {generatedSet.length > 0 && (
                      <div className="relative group">
                        <button
                          onClick={handleAppendTracks}
                          disabled={isInitializing || library.length === 0 || !canAppendTracks || (prefs.genres.length === 0 && playlistFilterIds.length === 0) || (playlistFilterIds.length > 0 && playlistFilterFiles === undefined)}
                          className="w-full flex items-center justify-center gap-2 bg-[#2c2c42] hover:bg-[#363650] border border-[#363650] hover:border-[#7c3aed] disabled:opacity-40 disabled:cursor-not-allowed text-[#ccd6e2] hover:text-[#a78bfa] text-sm font-medium py-2 rounded-md transition-colors cursor-pointer"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                          Append tracks
                        </button>
                        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-md bg-[#2c2c42] border border-[#363650] px-2.5 py-2 text-[11px] text-[#ccd6e2] leading-snug opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 text-center">
                          Add more tracks to the end of the current set — your locks and reorders stay untouched
                        </div>
                      </div>
                    )}
                    {generatedSet.length >= 2 && (
                      <div className="flex items-center gap-3 text-[10px] text-[#b6c2d0] border-t border-[#2c2c42] pt-2">
                        <span title="Sum of all track durations">Playlist: <span className="text-[#b6c2d0] font-semibold">{fmtMin(rawPlaylistSec)}</span></span>
                        <span className="text-[#2c2c42]">·</span>
                        <span title="Estimated actual set length accounting for 2-min crossfades">Est. set: <span className="text-[#ccd6e2] font-semibold">{fmtMin(estSetSec)}</span></span>
                        <span className="text-[#2c2c42]">·</span>
                        <span className="text-[#b6c2d0]">{generatedSet.length} tracks</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* AI live suggestion engine */}
              {openAiSession && openAiFeatures.enhancedAnalysis && library.length > 0 && (
                <div className="bg-[#20202e] border border-[#2c2c42] rounded-xl p-4 flex flex-col gap-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[#a78bfa] flex items-center gap-1.5">
                    <span>✦</span> Track finder
                  </h3>
                  <form
                    onSubmit={(e) => { e.preventDefault(); void handleAiSuggest(aiSuggestQuery); }}
                    className="flex gap-2"
                  >
                    <input
                      value={aiSuggestQuery}
                      onChange={e => setAiSuggestQuery(e.target.value)}
                      placeholder="e.g. something dark and driving for 2am"
                      className="flex-1 bg-[#26263c] border border-[#363650] rounded-md px-3 py-1.5 text-xs text-[#e2e8f0] placeholder:text-[#8d9aab] focus:outline-none focus:border-[#7c3aed]"
                      aria-label="Track search query"
                    />
                    <button
                      type="submit"
                      disabled={aiSuggestLoading || !aiSuggestQuery.trim()}
                      className="px-3 py-1.5 rounded-md bg-[#7c3aed] text-white text-xs font-medium hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer flex items-center gap-1"
                    >
                      {aiSuggestLoading
                        ? <span className="w-3 h-3 rounded-full border border-white/30 border-t-white animate-spin" />
                        : '→'}
                    </button>
                  </form>
                  {aiSuggestResults.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {aiSuggestResults.map(s => (
                        <div key={s.file} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-[#26263c] hover:bg-[#2c2c42] transition-colors group">
                          <div className="min-w-0">
                            <p className="text-xs text-[#e2e8f0] truncate">{s.artist} — {s.title}</p>
                            <p className="text-[10px] text-[#a3b0c2]">{Math.round(s.bpm)} BPM · {s.camelot ?? '—'} · {s.genres?.[0] ?? '—'}</p>
                          </div>
                          <div className="text-[10px] text-[#a78bfa] tabular-nums shrink-0">
                            {((s.energy ?? 0) * 100).toFixed(0)}%
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* ── RIGHT: Generated Set ── */}
            <div className="flex-1 min-w-0 flex flex-col gap-4 min-h-0 overflow-hidden">
              {/* Energy Curve — pinned, does not scroll */}
              <div className="bg-[#20202e] border border-[#2c2c42] rounded-xl p-5 flex-shrink-0">
                <div className="flex items-center gap-2 mb-4">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-[#b6c2d0]">
                    Energy Curve
                  </h2>
                  <InfoMark text="Draw the energy arc for your set. Each point sets the target energy level at that position — 0 is low/mellow, 1 is peak intensity. The generator picks tracks that match the curve as closely as possible." />
                </div>
                <EnergyCurveEditor
                  points={curve}
                  onChange={handleCurveChange}
                  setTracks={generatedSet.length > 0 ? generatedSet : undefined}
                  libraryEnergyRange={libraryEnergyRange}
                  tipConfig={tipConfig}
                />
              </div>
              <div className="bg-[#20202e] border border-[#2c2c42] rounded-xl p-5 flex flex-col flex-1 min-h-0 overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-[#b6c2d0]">
                    Generated Set
                  </h2>
                  {bulkOpError && (
                    <span className="flex items-center gap-1 text-xs text-[#ef4444]">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      {bulkOpError}
                    </span>
                  )}
                  {setScore !== null && (() => {
                    const scoreColor = setScore.total >= SCORE_THRESHOLDS.good
                      ? '#22c55e' : setScore.total >= SCORE_THRESHOLDS.fair
                      ? '#f59e0b' : '#ef4444';
                    const tooltip = `Harmonic: ${Math.round((1 - setScore.harmonicRate) * 100)}%  ·  Energy fit: ${Math.round((1 - setScore.avgEnergyError) * 100)}%  ·  BPM flow: ${Math.round(setScore.bpmSmoothness * 100)}%`;
                    return (
                      <div
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-[#1c1c2e] cursor-default"
                        style={{ borderColor: `${scoreColor}44` }}
                        title={tooltip}
                      >
                        <span className="text-[10px] text-[#b6c2d0] font-medium uppercase tracking-wider">Score</span>
                        <span className="text-xl font-bold tabular-nums leading-none" style={{ color: scoreColor }}>{setScore.total}</span>
                        <span className="text-xs text-[#b6c2d0] font-medium">/ 100</span>
                      </div>
                    );
                  })()}
                </div>
                <SetTracklist
                  tracks={generatedSet}
                  prefs={prefs}
                  curve={curve}
                  libraryLoaded={library.length > 0}
                  energyCheckThreshold={energyCheckThreshold}
                  showRekordboxExport={hasRekordboxFolder}
                  tipConfig={tipConfig}
                  previewFile={previewFile}
                  previewPlaying={previewPlaying}
                  onPreview={(filePath, seekTo) => {
                    const audio = audioRef.current;
                    if (!audio) return;
                    const url = `/api/audio-stream?path=${encodeURIComponent(filePath)}`;
                    if (previewFile === filePath && seekTo === undefined) {
                      if (audio.paused) { void audio.play(); setPreviewPlaying(true); }
                      else { audio.pause(); setPreviewPlaying(false); }
                    } else {
                      audio.src = url;
                      audio.currentTime = seekTo ?? 0;
                      setPreviewFile(filePath);
                      setPreviewPlaying(true);
                      void audio.play();
                    }
                  }}
                  onSwapTrack={handleSwapTrack}
                  onToggleLock={handleToggleLock}
                  onSetAllLocked={(locked) => setGeneratedSet(prev => prev.map(t => ({ ...t, locked })))}
                  onRemoveTrack={handleRemoveTrack}
                  onReorderTrack={handleReorderTrack}
                  onUpdateTrack={handleUpdateTrack}
                  onExport={handleExportM3U}
                  onSaveAsPlaylist={generatedSet.length > 0 ? () => {
                    const name = `Set ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
                    // Vinyl-only records aren't library tracks, so they can't go in a playlist
                    const id = newPlaylistFrom(name, generatedSet.map(t => t.file).filter(f => songsByFile.has(f)), { kind: "set", ref: "generator" });
                    setActiveTab("Library");
                    setPlaylistToRename(id);
                  } : undefined}
                  onSendToRekordbox={hasRekordboxFolder ? async () => {
                    try {
                      const { generateRekordboxXml } = await import('./lib/rekordboxExport');
                      const xml = generateRekordboxXml(generatedSet);
                      const res = await apiFetch('/api/send-to-rekordbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xml }) });
                      if (!res.ok) return null;
                      return await res.json() as { isFirstTime: boolean };
                    } catch { return null; }
                  } : undefined}
                  onExportSpotify={
                    hasSpotifyCredentials
                      ? () => {
                          void handleExportSpotify();
                        }
                      : undefined
                  }
                  isElectron={navigator.userAgent.toLowerCase().includes("electron")}
                  isMacOS={isMacOS}
                  hasAttemptedGenerate={hasAttemptedGenerate}
                  hasAi={!!(openAiSession && openAiFeatures.enhancedAnalysis)}
                  onBulkReanalyze={async (indices, bpmHint) => {
                    let failCount = 0;
                    for (let n = 0; n < indices.length; n++) {
                      const t = generatedSet[indices[n]];
                      if (!t || t.vinylOnly) continue;
                      try {
                        const body: Record<string, unknown> = { filePath: t.file };
                        if (bpmHint) { body.bpmMin = bpmHint.min; body.bpmMax = bpmHint.max; }
                        const res = await apiFetch('/api/reanalyze-track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                        const d = await res.json() as { ok?: boolean; bpm?: number; key?: string; camelot?: string; energy?: number };
                        if (d.ok) handleUpdateTrack(indices[n], { bpm: d.bpm, key: d.key, camelot: d.camelot, energy: d.energy });
                        else failCount++;
                      } catch { failCount++; }
                    }
                    if (failCount > 0) {
                      setBulkOpError(`${failCount} track${failCount === 1 ? '' : 's'} failed to re-analyze`);
                      setTimeout(() => setBulkOpError(null), 5000);
                    }
                  }}
                  onBulkPatchBpm={async (indices, multiplier) => {
                    let failCount = 0;
                    for (const idx of indices) {
                      const t = generatedSet[idx];
                      if (!t || !(t.bpm > 0)) continue;
                      const newBpm = Math.round(t.bpm * multiplier * 10) / 10;
                      try {
                        await apiFetch('/api/track-meta', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: t.file, patch: { bpm: newBpm } }) });
                        handleUpdateTrack(idx, { bpm: newBpm });
                      } catch { failCount++; }
                    }
                    if (failCount > 0) {
                      setBulkOpError(`${failCount} track${failCount === 1 ? '' : 's'} failed to update`);
                      setTimeout(() => setBulkOpError(null), 5000);
                    }
                  }}
                />

                {generatedSet.length > 0 && (
                  <div className="mt-3">
                    <SuggestionsStrip
                      suggestions={setSuggestions}
                      setDuration={prefs.setDuration}
                      actualDurationSec={generatedSet.reduce((s, t) => s + (t.duration ?? 210), 0)}
                      onAdd={(track) => insertSuggestion(track)}
                      onExtend={(extra) => setPrefs(p => ({ ...p, setDuration: (p.setDuration ?? 0) + extra }))}
                    />
                  </div>
                )}

                {generatedSet.length >= 2 && (
                  <div className="mt-4 rounded-xl border border-[#2c2c42] bg-[#20202e] overflow-hidden">
                    <button
                      onClick={() => setEnergyCheckOpen(o => !o)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#1c1c2e] transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        {energyIssues.length > 0 ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/>
                          </svg>
                        )}
                        <span className="text-xs font-semibold text-[#e2e8f0]">Energy Check</span>
                        {energyIssues.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f59e0b]/10 border border-[#f59e0b]/30 text-[#f59e0b] font-bold">{energyIssues.length}</span>
                        )}
                      </div>
                      <span className="text-[10px] text-[#b6c2d0]">{energyCheckOpen ? "▲" : "▼"}</span>
                    </button>
                    {energyCheckOpen && (
                      <div className="border-t border-[#2c2c42]">
                        {energyIssues.length === 0 ? (
                          <div className="flex items-center gap-2 px-4 py-3.5">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            <span className="text-xs text-[#b6c2d0]">Energy curve followed — all tracks are within range.</span>
                          </div>
                        ) : (
                          <div className="divide-y divide-[#2c2c42]">
                            {energyIssues.map((track) => {
                              const actual = Math.round(track.energy * 100);
                              const target = Math.round(track.targetEnergy * 100);
                              const tooLow = track.energy < track.targetEnergy;
                              return (
                                <div key={track.slot} className="px-4 py-3 flex items-center gap-3">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-[#e2e8f0] truncate">{track.artist} — {track.title}</p>
                                    <div className="flex items-center gap-2 mt-1.5">
                                      {/* Mini energy bar */}
                                      <div className="relative rounded-full bg-[#2c2c42]" style={{ width: 64, height: 4 }}>
                                        <div
                                          className="absolute inset-y-0 left-0 rounded-full"
                                          style={{ width: `${track.energy * 100}%`, backgroundColor: tooLow ? '#f59e0b' : '#ef4444' }}
                                        />
                                        <div
                                          className="absolute inset-y-0 w-0.5 bg-white/60 rounded-full"
                                          style={{ left: `${track.targetEnergy * 100}%` }}
                                        />
                                      </div>
                                      <span className="text-[10px] text-[#b6c2d0] tabular-nums">
                                        {actual}% <span className="text-[#b6c2d0]">→</span> {target}%
                                        <span className={`ml-1 font-semibold ${tooLow ? 'text-[#f59e0b]' : 'text-[#ef4444]'}`}>
                                          {tooLow ? '↓ too low' : '↑ too high'}
                                        </span>
                                      </span>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleSwapTrack(track.slot)}
                                    className="shrink-0 px-2.5 py-1 text-[10px] font-medium rounded border border-[#363650] text-[#b6c2d0] hover:border-[#7c3aed] hover:text-[#a78bfa] transition-colors cursor-pointer"
                                  >
                                    Swap
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {crateGapsEligible && !crateGapsRequested && (
                  <div className="mt-4">
                    <button
                      onClick={() => { setCrateGapsRequested(true); setCrateGapsOpen(true); }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-[#7c3aed]/30 text-[#a78bfa] text-xs hover:border-[#7c3aed]/60 hover:bg-[#7c3aed]/5 transition-colors cursor-pointer"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      Analyse gaps
                    </button>
                  </div>
                )}

                {crateGaps.length > 0 && (
                  <div className="mt-4 rounded-xl border border-[#2c2c42] bg-[#20202e] overflow-hidden">
                    <button
                      onClick={() => setCrateGapsOpen(o => !o)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#1c1c2e] transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <span className="text-xs font-semibold text-[#e2e8f0]">Crate Suggestions</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#7c3aed]/10 border border-[#7c3aed]/30 text-[#a78bfa] font-bold">{crateGaps.length}</span>
                      </div>
                      <span className="text-[10px] text-[#b6c2d0]">{crateGapsOpen ? "▲" : "▼"}</span>
                    </button>
                    {crateGapsOpen && (
                      <div className="border-t border-[#2c2c42] divide-y divide-[#2c2c42]">
                        {crateGaps.map((gap, idx) => (
                          <div key={idx} className="px-4 py-3 flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] text-[#b6c2d0] tabular-nums">
                                Slot {Math.round(gap.setPosition * (generatedSet.length - 1)) + 1} of {generatedSet.length}
                              </span>
                              <div className="flex items-center gap-1">
                                {gap.camelotNeeded.slice(0, 4).map(k => (
                                  <span key={k} className="text-[10px] px-1 py-0.5 rounded bg-[#2c2c42] text-[#ccd6e2] font-mono">{k}</span>
                                ))}
                                <span className="text-[10px] text-[#b6c2d0] ml-1">{gap.bpmRange.min}–{gap.bpmRange.max} BPM</span>
                              </div>
                            </div>
                            <p className="text-xs text-[#a78bfa] font-mono select-all">{gap.suggestedSearch}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              </div>
            </div>
          </div>
        </main>
      )}

      {activeTab === "Library" && (
        <main className="flex-1 min-h-0 overflow-hidden flex">
          <LibrarySidebar
            playlists={playlistsApi}
            view={libraryView}
            onSelectView={setLibraryView}
            libraryCount={library.length}
            playlistCounts={playlistCounts}
            appleSources={appleSources}
            spotifySources={spotifySources}
            setSources={setSources}
            renameRequest={playlistToRename}
            onDropTracks={addToPlaylist}
            highlightIds={highlightPlaylistIds}
            onSaveAsPlaylist={(src) => {
              const resolved = resolveLibraryView(src.view);
              if (!resolved) return;
              const source = src.view.kind === "apple" ? { kind: "apple-music" as const, ref: src.view.name }
                : src.view.kind === "spotify" ? { kind: "spotify" as const, ref: src.view.id }
                : src.view.kind === "set" ? { kind: "set" as const, ref: src.view.id }
                : undefined;
              newPlaylistFrom(src.label, resolved.songs.map(s => s.file), source);
            }}
            onImportApple={() => void openPlaylistPicker()}
            onImportSpotify={() => openSpotifyImports()}
            onExportPlaylist={(p, format) => exportPlaylistFile(p.name, resolvePlaylist(p, songsByFile).songs, format)}
            onPushToAppleMusic={navigator.userAgent.toLowerCase().includes("electron") && isMacOS
              ? (ids, title) => setMusicExport({ ids, title })
              : undefined}
            onEditSmart={(playlist, folderId) => setSmartEditor({ playlist, folderId })}
            onGenerateSet={generateFromView}
            onFreezeSmart={(p) => playlistsApi.freezeSmartPlaylist(p.id, playlistLib.playlists.find(x => x.id === p.id)?.tracks ?? [])}
          />
          {playlistsApi.notice && (
            <UndoToast
              key={playlistsApi.notice.nonce}
              notice={playlistsApi.notice}
              onUndo={playlistsApi.undo}
              onDismiss={playlistsApi.dismissNotice}
            />
          )}
          {smartEditor && (
            <SmartPlaylistEditor
              initial={smartEditor.playlist?.smart ? { name: smartEditor.playlist.name, smart: smartEditor.playlist.smart } : undefined}
              playlists={playlistLib.playlists.filter(p => p.id !== smartEditor.playlist?.id)}
              countMatches={countSmartMatches}
              onSave={(name, criteria) => {
                const editing = smartEditor.playlist;
                if (editing) {
                  playlistsApi.setSmartCriteria(editing.id, criteria);
                  if (name !== editing.name) playlistsApi.renamePlaylist(editing.id, name);
                  setLibraryView({ kind: "playlist", id: editing.id });
                } else {
                  const id = createPl(name, { smart: criteria, folderId: smartEditor.folderId });
                  setLibraryView({ kind: "playlist", id });
                }
                setSmartEditor(null);
              }}
              onClose={() => setSmartEditor(null)}
            />
          )}
          {musicExport && (
            <AppleMusicExportDialog
              title={musicExport.title}
              prepare={prepareMusicExport}
              playlistNames={playlistNames}
              onDone={playlistsApi.applyAppleMusicResult}
              onClose={() => setMusicExport(null)}
            />
          )}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {libraryView.kind === "imports" ? (
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6" aria-label="Spotify imports">
            <div className="max-w-3xl mx-auto w-full">
              {/* Import input */}
              <div className="mb-6 rounded-xl border border-[#2c2c42] bg-[#20202e] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <SpotifyIcon size={16} className="text-[#1db954] shrink-0" />
                  <h2 className="text-sm font-semibold text-[#e2e8f0]">
                    Import Spotify Playlist
                  </h2>
                  <span className="text-[10px] font-semibold bg-[#7c3aed22] text-[#a78bfa] border border-[#7c3aed44] px-1.5 py-0.5 rounded uppercase tracking-wide">
                    Pro
                  </span>
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
                    className="flex-1 bg-[#1c1c2e] border border-[#363650] rounded-lg px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#b6c2d0] focus:outline-none focus:border-[#7c3aed] transition-colors"
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
                    className="px-4 py-2 text-sm font-medium border border-[#363650] text-[#ccd6e2] rounded-lg hover:text-[#e2e8f0] hover:border-[#7c3aed] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {loadingSpotifyPlaylists ? "Loading…" : "Browse my playlists"}
                  </button>
                </div>
                {importStatus?.phase === "loading" && (
                  <p className="mt-2 text-xs text-[#ccd6e2]">
                    {importStatus.total > 0
                      ? `Loading tracks… ${importStatus.loaded} / ${importStatus.total}`
                      : "Connecting to Spotify…"}
                  </p>
                )}
                {importStatus?.phase === "error" && (
                  <p className="mt-2 text-xs text-red-400">
                    {importStatus.message}{" "}
                    <span className="text-[#ccd6e2]">
                      For Spotify integration support, contact us at{" "}
                      <a
                        href="mailto:obo_odedr@hotmail.com"
                        className="text-[#a78bfa] hover:underline"
                      >
                        obo_odedr@hotmail.com
                      </a>
                      .
                    </span>
                  </p>
                )}
              </div>

              {/* Spotify import history (filter out old local- Apple Music entries) */}
              {(() => {
                const spotifyImports = importHistory.filter(e => !e.playlistId.startsWith("local-"));
                return spotifyImports.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[#b6c2d0] gap-3">
                  <span className="text-4xl">🎵</span>
                  <p className="text-sm">
                    No playlists imported yet. Paste a Spotify playlist URL above.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {spotifyImports.map((entry) => {
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
                      (t) => t.inLibrary && t.matchConfidence === "partial",
                    ).length;
                    const missingCount = entry.tracks.filter(
                      (t) => !t.inLibrary && !t.unavailable && t.spotifyId,
                    ).length;

                    return (
                      <div
                        key={entry.id}
                        className="rounded-xl border border-[#2c2c42] bg-[#20202e] overflow-hidden"
                      >
                        <div className="flex items-center">
                          <button
                            onClick={() =>
                              setExpandedImportId(isExpanded ? null : entry.id)
                            }
                            className="flex-1 min-w-0 flex items-center gap-3 px-5 py-4 text-left hover:bg-[#1c1c2e] transition-colors cursor-pointer"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-[#e2e8f0] truncate">
                                {entry.name}
                              </div>
                              <div className="text-xs text-[#b6c2d0] mt-0.5">
                                {label}
                              </div>
                            </div>
                            <div className="shrink-0 flex items-center gap-3">
                              <span className="text-xs text-[#ccd6e2]">
                                <span className="text-[#7c3aed] font-medium">
                                  {inLibraryCount}
                                </span>
                                <span className="text-[#b6c2d0]">
                                  {" "}
                                  / {entry.tracks.length} in library
                                </span>
                                {fuzzyCount > 0 && (
                                  <span
                                    className="ml-1.5 text-yellow-500/80"
                                    title={`${fuzzyCount} track${fuzzyCount > 1 ? "s" : ""} matched by title/artist (not exact)`}
                                  >
                                    ~{fuzzyCount}
                                  </span>
                                )}
                              </span>
                              <span className="text-[#b6c2d0] text-xs">
                                {isExpanded ? "▲" : "▼"}
                              </span>
                            </div>
                          </button>
                          <button
                            onClick={() => handleLoadImportToSet(entry)}
                            disabled={inLibraryCount === 0}
                            aria-label="Generate a set from matched tracks"
                            title={
                              inLibraryCount === 0
                                ? "No matched tracks to generate from"
                                : `Generate a set from ${inLibraryCount} matched track${inLibraryCount !== 1 ? "s" : ""}`
                            }
                            className="shrink-0 px-3 py-4 text-xs font-medium transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed text-[#7c3aed] hover:text-[#a78bfa] disabled:hover:text-[#b6c2d0]"
                          >
                            + Set
                          </button>
                          <button
                            onClick={() => void handleGenerateFromSpotify(entry)}
                            disabled={entry.tracks.filter(t => !t.unavailable).length === 0 || spotifyGeneratingId === entry.id}
                            aria-label="Generate a set from full Spotify playlist (includes unmatched tracks)"
                            title={spotifyGeneratingId === entry.id ? 'Fetching audio features…' : `Generate from full playlist via Spotify (${entry.tracks.filter(t => !t.unavailable).length} tracks)`}
                            className="shrink-0 px-3 py-4 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-[#1db954] hover:text-[#4ade80] disabled:hover:text-[#1db954]"
                          >
                            {spotifyGeneratingId === entry.id ? '…' : '⚡ Spotify'}
                          </button>
                          {hasSpotifyCredentials && missingCount > 0 && (
                            <button
                              onClick={() => void handleExportMissingToSpotify(entry)}
                              disabled={missingExportId === entry.id}
                              aria-label={`Create a private Spotify playlist of the ${missingCount} track${missingCount !== 1 ? 's' : ''} you don't have`}
                              title={missingExportId === entry.id ? 'Creating playlist…' : `Create a private Spotify playlist of the ${missingCount} track${missingCount !== 1 ? 's' : ''} you don't have`}
                              className="shrink-0 px-3 py-4 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-[#b6c2d0] hover:text-[#1db954] flex items-center gap-1.5"
                            >
                              {missingExportId === entry.id ? '…' : (
                                <>
                                  <SpotifyIcon size={13} className="text-[#1db954]" />
                                  Create non-have
                                  <span className="text-[10px] text-[#9aa8ba] tabular-nums">{missingCount}</span>
                                </>
                              )}
                            </button>
                          )}
                          <a
                            href={`https://open.spotify.com/playlist/${entry.playlistId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open on Spotify"
                            title="Open on Spotify"
                            className="shrink-0 px-2 py-4 flex items-center text-[#b6c2d0] hover:text-[#1db954] transition-colors"
                          >
                            <SpotifyIcon size={14} />
                          </a>
                          <button
                            onClick={() => void handleExportImportM3U(entry)}
                            disabled={inLibraryCount === 0}
                            aria-label="Export as M3U"
                            title="Export matched tracks as M3U"
                            className="shrink-0 px-2 py-4 flex items-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed text-[#b6c2d0] hover:text-[#a78bfa] disabled:hover:text-[#b6c2d0]"
                          >
                            <M3UIcon size={14} className="opacity-70" />
                          </button>
                          <button
                            onClick={() => void reloadEntry(entry)}
                            aria-label="Reload from Spotify"
                            title="Reload from Spotify"
                            className="shrink-0 px-2 py-4 text-[#b6c2d0] hover:text-[#7c3aed] transition-colors cursor-pointer"
                          >
                            ↻
                          </button>
                          <button
                            onClick={() => {
                              setImportHistory((prev) =>
                                prev.filter((e) => e.id !== entry.id),
                              );
                              if (expandedImportId === entry.id)
                                setExpandedImportId(null);
                            }}
                            aria-label="Remove playlist"
                            className="shrink-0 px-4 py-4 text-[#b6c2d0] hover:text-red-400 transition-colors cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>

                        {missingExportResult?.entryId === entry.id && (
                          <div className="px-5 py-2 text-xs flex items-center gap-2 bg-[#1a2e1e] text-green-400 border-t border-[#2c2c42]">
                            <span>✓ Playlist created with {missingExportResult.count} track{missingExportResult.count !== 1 ? 's' : ''}.</span>
                            <a href={missingExportResult.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-green-300">Open on Spotify</a>
                            {missingExportResult.isPublic !== false && (
                              <span className="text-[#f59e0b]">Spotify lists it as public — open it → ••• → Make private.</span>
                            )}
                          </div>
                        )}
                        {missingExportError?.entryId === entry.id && (
                          <div className="px-5 py-2 text-xs text-red-400 bg-red-950/20 border-t border-[#2c2c42]">
                            {missingExportError.message}
                          </div>
                        )}

                        {isExpanded && (
                          <div className="border-t border-[#2c2c42]">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr className="bg-[#1c1c2e]">
                                  <th className="py-2 pl-5 pr-2 text-left text-[10px] font-semibold text-[#b6c2d0] uppercase tracking-wider w-10">
                                    #
                                  </th>
                                  <th className="py-2 px-2 text-left text-[10px] font-semibold text-[#b6c2d0] uppercase tracking-wider">
                                    Track
                                  </th>
                                  <th className="py-2 px-2 pr-5 text-left text-[10px] font-semibold text-[#b6c2d0] uppercase tracking-wider w-8"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {entry.tracks.map((track, idx) => (
                                  <tr
                                    key={`${track.spotifyId}-${idx}`}
                                    className={`group border-t border-[#2c2c42] ${
                                      track.unavailable
                                        ? "opacity-40"
                                        : !track.inLibrary
                                          ? "bg-red-950/20 hover:bg-red-950/30"
                                          : track.matchConfidence === "partial"
                                            ? "bg-yellow-950/20 hover:bg-yellow-950/30"
                                            : "hover:bg-[#1c1c2e]"
                                    }`}
                                  >
                                    <td className="py-2.5 pl-5 pr-2 w-10">
                                      <span
                                        className={`group-hover:hidden text-xs tabular-nums ${!track.inLibrary ? "text-red-500/60" : track.matchConfidence === "partial" ? "text-yellow-500/60" : "text-[#b6c2d0]"}`}
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
                                        className={`text-sm ${track.unavailable ? "text-[#b6c2d0] italic" : !track.inLibrary ? "text-red-400" : track.matchConfidence === "partial" ? "text-yellow-300/90" : "text-[#22c55e]/90"}`}
                                      >
                                        {track.title}
                                      </div>
                                      {track.artist && (
                                        <div
                                          className={`text-[11px] ${!track.inLibrary ? "text-red-500/70" : track.matchConfidence === "partial" ? "text-yellow-500/70" : "text-[#22c55e]/50"}`}
                                        >
                                          {track.artist}
                                        </div>
                                      )}
                                      {track.matchConfidence === "partial" && (() => {
                                        const pKey = `${entry.id}-${track.spotifyId}-${idx}-partial`;
                                        const guessed = findPartialMatchSong(track.spotifyId, track.title, track.artist, library);
                                        return (
                                          <div className="relative inline-block mt-0.5" onMouseLeave={() => setPartialHoverKey(null)}>
                                            <button
                                              type="button"
                                              onMouseEnter={() => setPartialHoverKey(pKey)}
                                              className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-yellow-500/60 text-yellow-500/80 text-[9px] font-bold hover:border-yellow-400 hover:text-yellow-300 transition-colors cursor-default"
                                              title="Uncertain match — hover to see guessed track"
                                            >
                                              ?
                                            </button>
                                            {partialHoverKey === pKey && guessed && (
                                              <div className="absolute left-5 top-0 z-50 w-56 bg-[#26263c] border border-yellow-500/30 rounded-lg shadow-xl p-3 text-[11px]">
                                                <div className="text-yellow-400/70 uppercase tracking-widest text-[9px] font-semibold mb-1.5">Guessed match</div>
                                                <div className="text-[#e2e8f0] font-medium leading-snug truncate">{guessed.title}</div>
                                                <div className="text-[#ccd6e2] truncate mb-2">{guessed.artist}</div>
                                                <button
                                                  type="button"
                                                  onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    setImportHistory(prev => prev.map(e2 =>
                                                      e2.id !== entry.id ? e2 : {
                                                        ...e2,
                                                        tracks: e2.tracks.map((t, i) =>
                                                          i !== idx ? t : { ...t, matchConfidence: 'fuzzy' as const, manualMatchFile: guessed.file }
                                                        ),
                                                      }
                                                    ));
                                                    setPartialHoverKey(null);
                                                  }}
                                                  className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/40 rounded text-yellow-300 transition-colors cursor-pointer w-full"
                                                >
                                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                                  Approve this match
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })()}
                                    </td>
                                    <td className="py-2.5 px-2 pr-5">
                                      {(track.inLibrary &&
                                        track.matchConfidence !== "partial") ||
                                      track.unavailable
                                        ? null
                                        : (() => {
                                            const key = `${entry.id}-${track.spotifyId}-${idx}`;
                                            const primaryArtist = track.artist
                                              ? track.artist
                                                  .split(/\s*[,&]\s*/)[0]
                                                  .trim()
                                              : "";
                                            const normalizedTitle =
                                              track.title.replace(/\s+-\s+/g, " ");
                                            const baseTitle =
                                              track.title
                                                .replace(
                                                  /\s+-\s+.*?(remix|mix|edit|dub|instrumental|rework|bootleg|flip|version|vip)\s*$/i,
                                                  "",
                                                )
                                                .replace(
                                                  /\s+\(.*?(remix|mix|edit|dub|instrumental|rework|bootleg|flip|version|vip)\s*\)\s*$/i,
                                                  "",
                                                )
                                                .trim() || normalizedTitle;
                                            const qFull = encodeURIComponent(
                                              [primaryArtist, normalizedTitle]
                                                .filter(Boolean)
                                                .join(" "),
                                            );
                                            const qTitle =
                                              encodeURIComponent(baseTitle);
                                            const isSearchOpen =
                                              manualMatchKey === key;
                                            const searchResults =
                                              isSearchOpen &&
                                              manualMatchQuery.trim()
                                                ? library
                                                    .filter((s) => {
                                                      const q =
                                                        manualMatchQuery.toLowerCase();
                                                      return (
                                                        s.title
                                                          .toLowerCase()
                                                          .includes(q) ||
                                                        (s.artist ?? "")
                                                          .toLowerCase()
                                                          .includes(q)
                                                      );
                                                    })
                                                    .slice(0, 8)
                                                : [];
                                            return (
                                              <div className="flex items-center gap-1.5">
                                                {/* Store links button */}
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
                                                    className="text-[#b6c2d0] hover:text-[#7c3aed] transition-colors cursor-pointer"
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
                                                      <circle
                                                        cx="8"
                                                        cy="21"
                                                        r="1"
                                                        fill="currentColor"
                                                        stroke="none"
                                                      />
                                                      <circle
                                                        cx="19"
                                                        cy="21"
                                                        r="1"
                                                        fill="currentColor"
                                                        stroke="none"
                                                      />
                                                      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
                                                      <path
                                                        d="M11 16v-5l5-1.3v5"
                                                        strokeWidth="1.5"
                                                      />
                                                      <circle
                                                        cx="11"
                                                        cy="16"
                                                        r="1.1"
                                                        fill="currentColor"
                                                        stroke="none"
                                                      />
                                                      <circle
                                                        cx="16"
                                                        cy="14.7"
                                                        r="1.1"
                                                        fill="currentColor"
                                                        stroke="none"
                                                      />
                                                    </svg>
                                                  </button>
                                                  {openStoreLinkKey === key && (
                                                    <div className="absolute right-0 bottom-full mb-1 z-10 min-w-[160px] rounded-md border border-[#363650] bg-[#20202e] shadow-lg overflow-hidden">
                                                      <div className="px-4 py-2 text-[10px] text-[#b6c2d0] uppercase tracking-wider border-b border-[#2c2c42]">
                                                        Find on…
                                                      </div>
                                                      <a
                                                        href={`https://www.beatport.com/search/tracks?q=${qFull}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={() =>
                                                          setOpenStoreLinkKey(null)
                                                        }
                                                        className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-[#ccd6e2] hover:bg-[#26263c] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                                                      >
                                                        <img
                                                          src="https://www.google.com/s2/favicons?domain=beatport.com&sz=16"
                                                          width="14"
                                                          height="14"
                                                          className="rounded-sm flex-shrink-0"
                                                          alt=""
                                                        />
                                                        Beatport
                                                      </a>
                                                      <a
                                                        href={`https://bandcamp.com/search?q=${qTitle}&item_type=t`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={() =>
                                                          setOpenStoreLinkKey(null)
                                                        }
                                                        className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-[#ccd6e2] hover:bg-[#26263c] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#2c2c42]"
                                                      >
                                                        <img
                                                          src="https://www.google.com/s2/favicons?domain=bandcamp.com&sz=16"
                                                          width="14"
                                                          height="14"
                                                          className="rounded-sm flex-shrink-0"
                                                          alt=""
                                                        />
                                                        Bandcamp
                                                      </a>
                                                      <a
                                                        href={`https://www.traxsource.com/search?term=${qFull}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={() =>
                                                          setOpenStoreLinkKey(null)
                                                        }
                                                        className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-[#ccd6e2] hover:bg-[#26263c] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#2c2c42]"
                                                      >
                                                        <img
                                                          src="https://www.google.com/s2/favicons?domain=traxsource.com&sz=16"
                                                          width="14"
                                                          height="14"
                                                          className="rounded-sm flex-shrink-0"
                                                          alt=""
                                                        />
                                                        Traxsource
                                                      </a>
                                                    </div>
                                                  )}
                                                </div>
                                                {/* Manual library search button */}
                                                <div
                                                  ref={
                                                    isSearchOpen
                                                      ? manualSearchRef
                                                      : null
                                                  }
                                                  className="relative inline-block"
                                                >
                                                  <button
                                                    onClick={() => {
                                                      if (isSearchOpen) {
                                                        setManualMatchKey(null);
                                                        setManualMatchQuery("");
                                                      } else {
                                                        setManualMatchKey(key);
                                                        setManualMatchQuery("");
                                                        setOpenStoreLinkKey(null);
                                                      }
                                                    }}
                                                    className={`transition-colors cursor-pointer ${isSearchOpen ? "text-[#7c3aed]" : "text-[#b6c2d0] hover:text-[#7c3aed]"}`}
                                                    title="Search in library"
                                                    aria-label="Search in library"
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
                                                      <circle
                                                        cx="11"
                                                        cy="11"
                                                        r="8"
                                                      />
                                                      <line
                                                        x1="21"
                                                        y1="21"
                                                        x2="16.65"
                                                        y2="16.65"
                                                      />
                                                    </svg>
                                                  </button>
                                                  {isSearchOpen && (
                                                    <div className="absolute right-0 bottom-full mb-1 z-20 w-64 rounded-md border border-[#363650] bg-[#20202e] shadow-xl overflow-hidden">
                                                      <input
                                                        autoFocus
                                                        type="text"
                                                        value={manualMatchQuery}
                                                        onChange={(e) =>
                                                          setManualMatchQuery(
                                                            e.target.value,
                                                          )
                                                        }
                                                        onKeyDown={(e) => {
                                                          if (e.key === "Escape") {
                                                            setManualMatchKey(null);
                                                            setManualMatchQuery("");
                                                          }
                                                        }}
                                                        placeholder="Search library…"
                                                        className="w-full bg-transparent px-3 py-2 text-xs text-[#e2e8f0] placeholder-[#b6c2d0] focus:outline-none border-b border-[#2c2c42]"
                                                      />
                                                      {searchResults.length > 0 ? (
                                                        <div className="max-h-48 overflow-y-auto">
                                                          {searchResults.map(
                                                            (song) => (
                                                              <button
                                                                key={song.file}
                                                                onClick={() => {
                                                                  setImportHistory(
                                                                    (prev) =>
                                                                      prev.map(
                                                                        (e) =>
                                                                          e.id ===
                                                                          entry.id
                                                                            ? {
                                                                                ...e,
                                                                                tracks:
                                                                                  e.tracks.map(
                                                                                    (
                                                                                      t,
                                                                                      i,
                                                                                    ) =>
                                                                                      i ===
                                                                                      idx
                                                                                        ? {
                                                                                            ...t,
                                                                                            inLibrary: true,
                                                                                            matchConfidence:
                                                                                              "exact" as const,
                                                                                            manualMatchFile:
                                                                                              song.file,
                                                                                          }
                                                                                        : t,
                                                                                  ),
                                                                              }
                                                                            : e,
                                                                      ),
                                                                  );
                                                                  setManualMatchKey(
                                                                    null,
                                                                  );
                                                                  setManualMatchQuery(
                                                                    "",
                                                                  );
                                                                }}
                                                                className="w-full text-left px-3 py-2 text-xs hover:bg-[#26263c] transition-colors border-t border-[#2c2c42] first:border-t-0 cursor-pointer"
                                                              >
                                                                <div className="text-[#e2e8f0] truncate">
                                                                  {song.title}
                                                                </div>
                                                                <div className="text-[#b6c2d0] truncate">
                                                                  {song.artist}
                                                                </div>
                                                              </button>
                                                            ),
                                                          )}
                                                        </div>
                                                      ) : manualMatchQuery.trim() ? (
                                                        <div className="px-3 py-2.5 text-xs text-[#b6c2d0]">
                                                          No results
                                                        </div>
                                                      ) : (
                                                        <div className="px-3 py-2.5 text-xs text-[#b6c2d0]">
                                                          Type to search your
                                                          library…
                                                        </div>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                                {/* Copy Spotify link button — red tracks only */}
                                                {!track.inLibrary && track.spotifyId && (
                                                  <button
                                                    onClick={() => {
                                                      void navigator.clipboard.writeText(
                                                        `https://open.spotify.com/track/${track.spotifyId}`
                                                      ).then(() => {
                                                        setCopiedLinkKey(key);
                                                        setTimeout(() => setCopiedLinkKey(k => k === key ? null : k), 1500);
                                                      });
                                                    }}
                                                    className="text-[#b6c2d0] hover:text-[#1db954] transition-colors cursor-pointer flex-shrink-0"
                                                    title="Copy Spotify link"
                                                    aria-label="Copy Spotify link"
                                                  >
                                                    {copiedLinkKey === key ? (
                                                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1db954" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="20 6 9 17 4 12"/>
                                                      </svg>
                                                    ) : (
                                                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                                      </svg>
                                                    )}
                                                  </button>
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
              );
              })()}
            </div>
            </div>
          ) : (
            <LibraryTab
              isInitializing={isInitializing}
              library={library}
              viewKey={libraryViewData.key}
              viewTitle={libraryViewData.title}
              viewSongs={libraryViewData.songs}
              ordered={libraryView.kind !== "all"}
              missingCount={libraryViewData.missing}
              onReorder={activePlaylistId && !activeIsSmart ? (files, before) => {
                const pl = playlistLib.playlists.find(p => p.id === activePlaylistId);
                if (!pl) return;
                playlistsApi.moveTracks(activePlaylistId, files, before ? pl.tracks.indexOf(before) : pl.tracks.length);
              } : undefined}
              onRemoveFromView={activePlaylistId && !activeIsSmart ? (files) => playlistsApi.removeTracks(activePlaylistId, files) : undefined}
              onSaveOrder={activePlaylistId && !activeIsSmart ? (files) => playlistsApi.setPlaylistOrder(activePlaylistId, files) : undefined}
              playlistLibrary={playlistLib}
              lastPlaylist={lastPlaylist}
              onAddToPlaylist={addToPlaylist}
              containingSources={containingSources}
              onShowIn={showIn}
              reveal={reveal}
              playlistNamesFor={playlistNamesFor}
              onSelectionChange={setSelectedLibraryFiles}
              onPlay={player.playTracks}
              onPlayNext={player.playNext}
              onPlayLater={player.playLater}
              nowPlayingFile={player.currentSong?.file ?? null}
              onGenerateSet={libraryView.kind === "playlist" || libraryView.kind === "apple" || libraryView.kind === "spotify"
                ? () => generateFromView(libraryView) : undefined}
              onEditRules={activeIsSmart ? () => {
                const p = playlistLib.playlists.find(x => x.id === activePlaylistId);
                if (p) setSmartEditor({ playlist: p });
              } : undefined}
              onNewPlaylistFromSelection={newPlaylistFromFiles}
              onUpdateTrack={updateTrack}
              onReanalyzed={updateTrack}
              onRemoveTracks={removeTracks}
              onSendToGenerator={sendToGenerator}
            />
          )}
          </div>
        </main>
      )}

      {activeTab === "History" && (
        <main className="px-2 py-6 flex-1 overflow-y-auto">
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
            startSpotifyExport={
              hasSpotifyCredentials ? startSpotifyExport : undefined
            }
            handleRenameEntry={handleRenameEntry}
            handleRateEntry={handleRateEntry}
            handleNoteEntry={handleNoteEntry}
            onLoadEntry={handleLoadHistoryEntry}
          />
        </main>
      )}

      {activeTab === "Crates" && (
        <main className="flex-1 overflow-hidden">
          <CratesTab
            collection={discogsCollection}
            onSync={() => void syncDiscogsCollection()}
            syncPhase={discogsSyncStatus.phase}
            syncMessage={discogsSyncStatus.phase === 'error' ? (discogsSyncStatus as { phase: 'error'; message: string }).message : undefined}
            hasOAuth={hasDiscogsOAuth}
            hasSpotify={hasSpotifyCredentials}
            library={library}
            manualData={cratesManualData}
            onManualDataChange={setCratesManualData}
            vinylStore={vinylStore}
            setVinylStore={setVinylStore}
            rejectedMatches={cratesRejected}
            onRejectedChange={setCratesRejected}
          />
        </main>
      )}

      {spotifyPlaylistPicker && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => { setSpotifyPlaylistPicker(null); setSpotifyPickerSearch(""); }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[#363650] bg-[#20202e] flex flex-col max-h-[70vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2c2c42] shrink-0">
              <h3 className="text-sm font-semibold text-[#e2e8f0]">
                Your Spotify Playlists
              </h3>
              <button
                className="text-xs text-[#ccd6e2] hover:text-[#e2e8f0] cursor-pointer"
                onClick={() => { setSpotifyPlaylistPicker(null); setSpotifyPickerSearch(""); }}
              >
                Close
              </button>
            </div>
            <div className="px-3 py-2 border-b border-[#2c2c42] shrink-0">
              <input
                autoFocus
                type="text"
                value={spotifyPickerSearch}
                onChange={(e) => setSpotifyPickerSearch(e.target.value)}
                placeholder="Search playlists…"
                className="w-full bg-[#26263c] border border-[#363650] rounded-lg px-3 py-1.5 text-sm text-[#e2e8f0] placeholder-[#9aa8ba] focus:outline-none focus:border-[#7c3aed] transition-colors"
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {(() => {
                const q = spotifyPickerSearch.trim().toLowerCase();
                const filtered = q
                  ? spotifyPlaylistPicker.filter((pl) => pl.name.toLowerCase().includes(q))
                  : spotifyPlaylistPicker;
                if (filtered.length === 0) return (
                  <p className="text-sm text-[#ccd6e2] px-4 py-6 text-center">
                    {q ? "No playlists match your search." : "No playlists found."}
                  </p>
                );
                return filtered.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={() => {
                      setSpotifyPlaylistPicker(null);
                      setSpotifyPickerSearch("");
                      void runImport(
                        `https://open.spotify.com/playlist/${pl.id}`,
                        library,
                      );
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 border-b border-[#2c2c42] hover:bg-[#26263c] transition-colors cursor-pointer text-left"
                  >
                    {pl.imageUrl ? (
                      <img
                        src={pl.imageUrl}
                        alt=""
                        className="w-9 h-9 rounded object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded bg-[#363650] shrink-0 flex items-center justify-center text-[#b6c2d0] text-xs">
                        ♪
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[#e2e8f0] truncate">
                        {pl.name}
                      </div>
                      <div className="text-[11px] text-[#b6c2d0]">
                        {pl.trackCount} tracks
                      </div>
                    </div>
                  </button>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {playlistPicker && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => {
            setPlaylistPicker(null);
            setPlaylistSearch("");
            setSelectedPlaylists([]);
            setPlaylistBpmHints(new Map());
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[#363650] bg-[#20202e] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#e2e8f0]">
                Select Playlists{" "}
                <span className="text-[11px] font-normal text-[#b6c2d0]">
                  (up to {MAX_APPLE_PLAYLISTS})
                </span>
              </h3>
              <button
                className="text-xs text-[#ccd6e2] hover:text-[#e2e8f0] cursor-pointer"
                onClick={() => {
                  setPlaylistPicker(null);
                  setPlaylistSearch("");
                  setSelectedPlaylists([]);
                  setPlaylistBpmHints(new Map());
                }}
              >
                Close
              </button>
            </div>
            {playlistPicker.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSelectedPlaylists([]);
                  setPlaylistSearch("");
                  runAppleMusicAnalysis(ALL_APPLE_MUSIC);
                }}
                disabled={analysisQueue.some((item) => item.playlistName === ALL_APPLE_MUSIC)}
                className="w-full mb-3 flex items-center gap-3 rounded-lg border border-[#7c3aed]/50 bg-[#7c3aed]/10 px-3 py-2.5 text-left hover:bg-[#7c3aed]/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-[#e2e8f0] flex-shrink-0" aria-hidden>
                  <path d="M17.057 12.781c.032 2.588 2.254 3.462 2.287 3.477-.023.074-.351 1.204-1.151 2.371-.691 1.012-1.411 2.018-2.54 2.038-1.111.02-1.469-.658-2.738-.658-1.27 0-1.666.638-2.718.678-1.091.039-1.911-1.077-2.606-2.079-1.42-2.05-2.505-5.787-1.045-8.311.725-1.254 2.015-2.049 3.411-2.069 1.054-.02 2.049.71 2.693.71.643 0 1.839-.889 3.102-.759.53.021 2.017.213 2.971 1.611-.077.047-1.771 1.033-1.666 3.071zM14.7 5.124c.574-.694.962-1.66.856-2.624-.828.033-1.83.552-2.424 1.246-.532.616-.998 1.6-.873 2.544.923.072 1.866-.469 2.441-1.166z"/>
                </svg>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-[#e2e8f0]">Import entire Apple Music library</span>
                  <span className="block text-[11px] text-[#b6c2d0]">All local tracks + all {playlistPicker.length} playlists. Already-analysed tracks are skipped.</span>
                </span>
              </button>
            )}
            {playlistPicker.length > 0 && (
              <input
                type="text"
                placeholder="Search playlists…"
                value={playlistSearch}
                onChange={(e) => setPlaylistSearch(e.target.value)}
                autoFocus
                className="w-full mb-3 px-3 py-2 text-sm rounded-md border border-[#363650] bg-[#1c1c2e] text-[#e2e8f0] placeholder-[#b6c2d0] focus:outline-none focus:border-[#7c3aed] transition-colors"
              />
            )}
            {playlistPicker.length === 0 ? (
              <p className="text-sm text-[#ccd6e2] py-4">
                No playlists found in Apple Music.
              </p>
            ) : (
              (() => {
                const filtered = playlistPicker.filter((p) =>
                  p.name.toLowerCase().includes(playlistSearch.toLowerCase()),
                );
                return filtered.length === 0 ? (
                  <p className="text-sm text-[#ccd6e2] py-4 text-center">
                    No playlists match "{playlistSearch}".
                  </p>
                ) : (
                  <div className="flex flex-col gap-1 max-h-[55vh] overflow-y-auto">
                    {filtered.map((playlist) => {
                      const imported = analyzedApplePlaylists.has(playlist.name);
                      const selected = selectedPlaylists.includes(playlist.name);
                      const atLimit = selectedPlaylists.length >= MAX_APPLE_PLAYLISTS;
                      const disabled = !selected && atLimit;
                      const hint = playlistBpmHints.get(playlist.name);
                      return (
                        <div key={playlist.name} className="flex flex-col gap-1.5">
                          <div className="flex items-stretch gap-1.5">
                          <button
                            disabled={disabled}
                            onClick={() => {
                              setSelectedPlaylists((prev) =>
                                prev.includes(playlist.name)
                                  ? prev.filter((n) => n !== playlist.name)
                                  : prev.length < MAX_APPLE_PLAYLISTS
                                    ? [...prev, playlist.name]
                                    : prev,
                              );
                            }}
                            className="w-full text-left rounded-md border px-3 py-2.5 transition-colors disabled:cursor-not-allowed"
                            style={{
                              cursor: "pointer",
                              opacity: !selected && atLimit ? 0.4 : 1,
                              borderColor: selected ? "#7c3aed" : "#363650",
                              backgroundColor: selected ? "#1a0d2e" : "#1c1c2e",
                            }}
                          >
                            <div className="flex items-center gap-2">
                              {/* Checkbox */}
                              <span
                                className="w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0"
                                style={{
                                  borderColor: selected ? "#7c3aed" : imported ? "#424f63" : "#363650",
                                  backgroundColor: selected ? "#7c3aed" : imported ? "#262f3e" : "transparent",
                                }}
                              >
                                {(selected || imported) && (
                                  <svg
                                    className="w-2.5 h-2.5"
                                    style={{ color: selected ? "#fff" : "#8292a4" }}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={3}
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                  </svg>
                                )}
                              </span>
                              <span className="text-sm flex-1 min-w-0 truncate" style={{ color: imported ? "#8292a4" : "#e2e8f0" }}>
                                {playlist.name}
                              </span>
                              <span className="text-[11px] flex-shrink-0" style={{ color: imported ? "#58656e" : "#8394a8" }}>
                                {`${playlist.count} track${playlist.count === 1 ? "" : "s"}`}{imported ? (selected ? " · re-sync" : " · in library") : ""}
                              </span>
                            </div>
                          </button>
                          {imported && (() => {
                            const syncing = analysisQueue.some((item) => item.playlistName === playlist.name);
                            return (
                              <button
                                type="button"
                                title={`Re-sync "${playlist.name}"`}
                                aria-label={`Re-sync ${playlist.name}`}
                                disabled={syncing}
                                onClick={() => runAppleMusicAnalysis(playlist.name, undefined, { keepPickerOpen: true })}
                                className="flex-shrink-0 w-9 rounded-md border border-[#363650] bg-[#1c1c2e] text-sm text-[#b6c2d0] hover:text-[#a78bfa] hover:border-[#7c3aed] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                              >
                                {syncing ? "…" : "↺"}
                              </button>
                            );
                          })()}
                          </div>

                          {/* BPM hint dropdown — only for non-imported, selected playlists */}
                          {selected && !imported && (
                            <select
                              value={hint ? `${hint.min}-${hint.max}` : ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setPlaylistBpmHints(prev => {
                                  const next = new Map(prev);
                                  if (!val) { next.delete(playlist.name); }
                                  else {
                                    const [min, max] = val.split("-").map(Number);
                                    next.set(playlist.name, { min, max });
                                  }
                                  return next;
                                });
                              }}
                              className="w-full rounded px-2 py-1 text-xs bg-[#1c1c2e] border border-[#363650] text-[#ccd6e2] focus:outline-none focus:border-[#7c3aed]"
                            >
                              <option value="">BPM range: Auto-detect</option>
                              {GENRE_BPM_RANGES.map(({ keywords, range }) => {
                                const label = keywords[0].replace(/\b\w/g, c => c.toUpperCase());
                                return (
                                  <option key={`${range.min}-${range.max}`} value={`${range.min}-${range.max}`}>
                                    {label} ({range.min}–{range.max} BPM)
                                  </option>
                                );
                              })}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}
            {playlistPicker.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[#363650] flex items-center justify-between gap-2">
                <span className="text-[11px] text-[#b6c2d0]">
                  {selectedPlaylists.length}/{MAX_APPLE_PLAYLISTS} selected
                </span>
                <button
                  disabled={selectedPlaylists.length === 0}
                  onClick={() => {
                    const toAnalyze = [...selectedPlaylists];
                    const hintsSnapshot = new Map(playlistBpmHints);
                    setSelectedPlaylists([]);
                    setPlaylistSearch("");
                    setPlaylistBpmHints(new Map());
                    for (const name of toAnalyze) {
                      runAppleMusicAnalysis(name, hintsSnapshot.get(name));
                    }
                  }}
                  className="text-xs font-medium px-3 py-1.5 rounded-md bg-[#7c3aed] text-white hover:bg-[#9333ea] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {selectedPlaylists.length > 0 && selectedPlaylists.every((n) => analyzedApplePlaylists.has(n)) ? "Re-sync" : "Analyze"}{" "}
                  {selectedPlaylists.length > 0
                    ? `${selectedPlaylists.length} playlist${selectedPlaylists.length === 1 ? "" : "s"}`
                    : ""}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {swapModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setSwapModal(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[#363650] bg-[#20202e] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[#b6c2d0]">
                Best replacements
              </h3>
              <button
                className="text-xs text-[#b6c2d0] hover:text-[#e2e8f0] cursor-pointer transition-colors"
                onClick={() => setSwapModal(null)}
              >
                ✕
              </button>
            </div>

            {swapModal.suggestions.length === 0 ? (
              <p className="text-sm text-[#b6c2d0] py-4 text-center">
                No other tracks in your library fit this slot well enough.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-[#2c2c42]">
                {swapModal.suggestions.map(({ song, breakdown }) => {
                  const color = camelotColor(song.camelot);
                  const eDeltaSign = breakdown.energyDelta >= 0 ? "+" : "";
                  const harmonicOk =
                    (breakdown.harmonicPrev ?? 1) >= 0.75 &&
                    (breakdown.harmonicNext ?? 1) >= 0.75;
                  const bpmOk =
                    Math.abs(breakdown.bpmDeltaPrev ?? 0) <= 8 &&
                    Math.abs(breakdown.bpmDeltaNext ?? 0) <= 8;
                  return (
                    <button
                      key={song.file}
                      onClick={() => applySwapSuggestion(song)}
                      className="w-full text-left px-2 py-3 hover:bg-[#1c1c2e] transition-colors cursor-pointer group rounded-lg"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[#e2e8f0] truncate group-hover:text-white">
                            {song.title}
                          </div>
                          <div className="text-xs text-[#b6c2d0] truncate mt-0.5">
                            {song.artist}
                          </div>
                        </div>
                        {/* Key badge */}
                        {song.camelot && (
                          <span
                            className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold mt-0.5"
                            style={{
                              backgroundColor: color + "26",
                              color,
                              border: `1px solid ${color}44`,
                            }}
                          >
                            {song.camelot}
                          </span>
                        )}
                      </div>
                      {/* Stats row */}
                      <div className="flex items-center gap-3 mt-1.5">
                        <span
                          className="text-[10px] tabular-nums"
                          style={{ color: bpmOk ? "#8394a8" : "#f59e0b" }}
                        >
                          {song.bpm > 0 ? `${Math.round(song.bpm)} BPM` : "—"}
                        </span>
                        <span
                          className="text-[10px] tabular-nums"
                          style={{
                            color:
                              Math.abs(breakdown.energyDelta) <= 0.2
                                ? "#8394a8"
                                : "#f59e0b",
                          }}
                        >
                          E {eDeltaSign}
                          {(breakdown.energyDelta * 100).toFixed(0)}%
                        </span>
                        {/* Signal dots */}
                        <div className="flex items-center gap-1 ml-auto">
                          <span
                            title="Harmonic fit"
                            style={{
                              color: harmonicOk ? "#22c55e" : "#f59e0b",
                              fontSize: 8,
                            }}
                          >
                            ♪
                          </span>
                          {breakdown.venueFit && (
                            <span
                              title="Venue fit"
                              style={{ color: "#22c55e", fontSize: 8 }}
                            >
                              ✦
                            </span>
                          )}
                          {breakdown.tagOverlap && (
                            <span
                              title="Shared vibe tags"
                              style={{ color: "#a855f7", fontSize: 8 }}
                            >
                              ●
                            </span>
                          )}
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
            className={`w-full rounded-xl border border-[#363650] bg-[#20202e] p-6 ${spotifyExportStatus.phase === "review" ? "max-w-lg" : "max-w-sm"}`}
            onClick={(e) => e.stopPropagation()}
          >
            {spotifyExportStatus.phase === "searching" && (
              <>
                <h3 className="text-sm font-semibold text-[#e2e8f0] mb-4">
                  Searching Spotify…
                </h3>
                <div className="flex flex-col gap-3">
                  <div className="w-full h-1.5 rounded-full bg-[#262f3e] overflow-hidden">
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
                  <span className="text-xs text-[#ccd6e2] tabular-nums">
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
                  <span className="text-xs text-[#b6c2d0]">
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
                        className={`grid grid-cols-[20px_1fr_1fr_24px] gap-2 items-start py-1.5 border-b border-[#2c2c42] last:border-0 ${excluded ? "opacity-40" : ""}`}
                      >
                        <span className="text-[11px] text-[#b6c2d0] tabular-nums pt-0.5">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs text-[#e2e8f0] truncate">
                            {track.title}
                          </div>
                          <div className="text-[11px] text-[#b6c2d0] truncate">
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
                              <div className="text-[11px] text-[#b6c2d0] truncate">
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
                          className="mt-0.5 text-[#b6c2d0] hover:text-[#e2e8f0] transition-colors cursor-pointer text-xs leading-none"
                        >
                          {excluded ? "↩" : "✕"}
                        </button>
                      </div>
                    ),
                  )}
                </div>
                <p role="note" className="mb-3 text-xs text-[#f59e0b] bg-[#f59e0b0d] border border-[#f59e0b33] rounded-md px-3 py-2">
                  ⚠ Spotify makes playlists created by apps public. Afterwards, open it in Spotify → ••• → Make private.
                </p>
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
                    className="px-4 py-2 rounded-md border border-[#363650] text-sm text-[#ccd6e2] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {spotifyExportStatus.phase === "creating" && (
              <p className="text-sm text-[#ccd6e2]">Creating playlist…</p>
            )}

            {spotifyExportStatus.phase === "done" && (
              <>
                <h3 className="text-sm font-semibold text-[#e2e8f0] mb-3">
                  Playlist created
                </h3>
                <p className="text-sm text-[#ccd6e2] mb-4">
                  {spotifyExportStatus.matched} of {spotifyExportStatus.total}{" "}
                  tracks added.
                </p>
                {spotifyExportStatus.isPublic !== false && (
                  <p role="note" className="mb-4 text-xs text-[#f59e0b] bg-[#f59e0b0d] border border-[#f59e0b33] rounded-md px-3 py-2">
                    Spotify lists this playlist as public. To hide it, open it in Spotify → ••• → Make private.
                  </p>
                )}
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
                    className="px-4 py-2 rounded-md border border-[#363650] text-sm text-[#ccd6e2] hover:text-[#e2e8f0] transition-colors cursor-pointer"
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
                <p className="text-sm text-[#ccd6e2] mb-4">
                  {spotifyExportStatus.message}
                </p>
                <button
                  onClick={() => setSpotifyExportStatus(null)}
                  className="px-4 py-2 rounded-md border border-[#363650] text-sm text-[#ccd6e2] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === "Gig Finder" && (
        <main className="flex-1 overflow-hidden">
          <GigFinderTab />
        </main>
      )}

      </div>{/* end tab content wrapper */}

      <SettingsModal
        open={settingsOpen}
        onClose={() => { setSettingsOpen(false); setSettingsScrollTo(undefined) }}
        scrollToSection={settingsScrollTo}
        onSaved={(folderChanged) => {
          loadSettings();
          if (folderChanged) {
            setLibrary([]);
            setGeneratedSet([]);
          }
        }}
        onDatabaseCleared={() => {
          setAnalyzedApplePlaylists(new Set());
          setApplePlaylistFiles({});
          setLibrary([]);
          setGeneratedSet([]);
          setImportHistory([]);
          setPlaylistFilterIds([]);
          setHistory([]);
          localStorage.removeItem("djfriend-history");
          apiFetch('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' }).catch(() => {});
        }}
        onSyncDiscogs={() => void syncDiscogsCollection()}
        discogsCollection={discogsCollection}
        discogsSyncPhase={discogsSyncStatus.phase}
        discogsSyncMessage={discogsSyncStatus.phase === 'error' ? discogsSyncStatus.message : undefined}
        openAiSession={openAiSession}
        openAiFeatures={openAiFeatures}
        onOpenAiFeaturesChange={(features) => {
          if (features === null) {
            clearOpenAiSession();
            setOpenAiSession(null);
            setOpenAiFeatures({ enhancedAnalysis: false, vinylAnalysis: false });
            localStorage.removeItem('djfriend-openai-features');
          } else {
            setOpenAiSession(getStoredSession());
            setOpenAiFeatures(features);
            localStorage.setItem('djfriend-openai-features', JSON.stringify(features));
          }
        }}
      />

      {/* ── AI Set Planner slide-in panel ── */}

      {/* ── Onboarding ── */}
      {library.length === 0 && !onboardingDismissed && !isInitializing && (
        <OnboardingModal
          isElectron={navigator.userAgent.toLowerCase().includes("electron")}
          isMacOS={isMacOS}
          hasSpotifyCredentials={hasSpotifyCredentials}
          onScanAppleMusic={() => void openPlaylistPicker()}
          onImportM3U={() => fileInputRef.current?.click()}
          onImportRekordbox={() => rbFileInputRef.current?.click()}
          onUploadFolder={() => uploadFolderInputRef.current?.click()}
          onOpenSettings={() => setSettingsOpen(true)}
          onDismiss={() => {
            setOnboardingDismissed(true);
            localStorage.setItem("djfriend-onboarding-dismissed", "true");
          }}
        />
      )}

      {!previewTrack && (
        <NowPlayingBar player={player} songsByFile={songsByFile}
          onTrackContextMenu={(e, song) => { e.preventDefault(); setPlayerMenu({ x: e.clientX, y: e.clientY, song }); }} />
      )}
      {playerMenu && (
        <TrackContextMenu
          menu={playerMenu}
          onClose={() => setPlayerMenu(null)}
          onPlay={s => player.playTracks([s.file], 0)}
          onPlayNext={player.playNext}
          onPlayLater={player.playLater}
          onGetInfo={setPlayerInfoSong}
          onReanalyze={s => { void reanalyzeTrack(s).then(d => { if (d) updateTrack(s.file, d); }); }}
          onExportM3U={exportTrackM3U}
          onSendToGenerator={sendToGenerator}
          onDelete={s => { void removeTracksFromLibrary([s.file], songsByFile).then(ok => { if (ok) removeTracks([s.file]); }); }}
          playlistLibrary={playlistLib}
          lastPlaylist={lastPlaylist}
          onAddToPlaylist={addToPlaylist}
          onNewPlaylist={newPlaylistFromFiles}
          containingSources={containingSources}
          onShowIn={showIn}
        />
      )}
      {playerInfoSong && (
        <TrackInfoModal key={playerInfoSong.file} song={playerInfoSong} library={library}
          onClose={() => setPlayerInfoSong(null)}
          onSave={async (file, patch) => { await patchTrackMeta(file, patch); updateTrack(file, patch); }}
          onNavigate={setPlayerInfoSong} />
      )}

      {previewTrack && (
        <PlayerBar
          track={previewTrack}
          audioRef={audioRef}
          playing={previewPlaying}
          onToggle={() => {
            const audio = audioRef.current;
            if (!audio) return;
            if (audio.paused) { void audio.play(); setPreviewPlaying(true); }
            else { audio.pause(); setPreviewPlaying(false); }
          }}
          onClose={() => {
            const audio = audioRef.current;
            if (audio) { audio.pause(); audio.src = ""; }
            setPreviewFile(null);
            setPreviewPlaying(false);
          }}
        />
      )}
    </div>
  );
}
