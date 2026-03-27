import { useState, useCallback, useEffect, useRef } from "react";
import type {
  Song,
  SetTrack,
  DJPreferences,
  CurvePoint,
  HistoryEntry,
  ImportEntry,
  ImportTrack,
  TagFilters,
} from "./types";
import { generateSet } from "./lib/setGenerator";
import { camelotHarmonyScore, isHarmonicWarning } from "./lib/camelot";
import { buildSvgPath } from "./lib/curveInterpolation";
import EnergyCurveEditor, {
  DEFAULT_CURVE,
} from "./components/EnergyCurveEditor";
import PreferencesForm from "./components/PreferencesForm";
import SetTracklist from "./components/SetTracklist";
import SettingsModal from "./components/SettingsModal";
import { downloadM3U, generateM3U } from "./lib/m3uExport";
import {
  getStoredToken,
  storeToken,
  storePendingExport,
  getPendingExport,
  clearPendingExport,
  redirectToSpotifyLogin,
  exchangeCodeForToken,
  searchTracksOnSpotify,
  createPlaylistFromMatches,
} from "./lib/spotifyExport";
import type { SpotifyMatchResult } from "./lib/spotifyExport";
import {
  storePendingImport,
  getPendingImport,
  clearPendingImport,
  parsePlaylistId,
  fetchPlaylistTracks,
  fetchUserPlaylists,
  matchInLibrary,
} from "./lib/spotifyImport";
import type { SpotifyUserPlaylist } from "./lib/spotifyImport";

type SpotifyExportStatus =
  | { phase: "searching"; completed: number; total: number }
  | { phase: "review"; matches: SpotifyMatchResult[]; playlistName: string }
  | { phase: "creating" }
  | { phase: "done"; playlistUrl: string; matched: number; total: number }
  | { phase: "error"; message: string };

type ImportStatus =
  | { phase: "loading"; loaded: number; total: number }
  | { phase: "error"; message: string };

const TAG_GROUPS: { key: keyof TagFilters; label: string; color: { border: string; text: string; activeBg: string } }[] = [
  { key: 'vibeTags',        label: 'Vibe',                color: { border: '#7c3aed66', text: '#a78bfa', activeBg: '#7c3aed33' } },
  { key: 'moodTags',        label: 'Mood',                color: { border: '#1d4ed866', text: '#60a5fa', activeBg: '#1d4ed833' } },
  { key: 'venueTags',       label: 'Venue',               color: { border: '#06522066', text: '#34d399', activeBg: '#06522033' } },
  { key: 'timeOfNightTags', label: 'Time',                color: { border: '#92400e66', text: '#fbbf24', activeBg: '#92400e33' } },
  { key: 'vocalTypes',      label: 'Vocal/Instrumental',  color: { border: '#4a044e66', text: '#e879f9', activeBg: '#4a044e33' } },
];

const DEFAULT_PREFS: DJPreferences = {
  setDuration: 60,
  venueType: "Club",
  setPhase: "Peak time",
  genre: "Any",
  tagFilters: { vibeTags: [], moodTags: [], vocalTypes: [], venueTags: [], timeOfNightTags: [] },
};

function isValidSong(obj: unknown): obj is Song {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o["file"] === "string" &&
    typeof o["artist"] === "string" &&
    typeof o["title"] === "string" &&
    typeof o["bpm"] === "number" &&
    typeof o["key"] === "string" &&
    typeof o["camelot"] === "string" &&
    typeof o["energy"] === "number" &&
    Array.isArray(o["genres"])
  );
}

function parseSongs(raw: unknown): Song[] | null {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null
      ? Object.values(raw as Record<string, unknown>)
      : null;
  if (!source) return null;
  const valid = source.filter(isValidSong);
  return valid.length > 0 ? valid : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function matchesGenrePref(song: Song, genre: string): boolean {
  if (genre === "Any") return true;
  const needle = genre.toLowerCase();
  return song.genres.some((g) => {
    const gl = g.toLowerCase();
    return gl.includes(needle) || needle.includes(gl);
  });
}

export default function App() {
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
  const [library, setLibrary] = useState<Song[]>([]);
  const [libraryName, setLibraryName] = useState<string>("");
  const [prefs, setPrefs] = useState<DJPreferences>(DEFAULT_PREFS);
  const [curve, setCurve] = useState<CurvePoint[]>(DEFAULT_CURVE);
  const [generatedSet, setGeneratedSet] = useState<SetTrack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoRegen, setAutoRegen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{
    completed: number;
    total: number;
  }>({
    completed: 0,
    total: 0,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [swapModal, setSwapModal] = useState<{
    index: number;
    suggestions: Array<{ song: Song; score: number }>;
  } | null>(null);
  const [swapVisibleCount, setSwapVisibleCount] = useState(5);
  const [playlistPicker, setPlaylistPicker] = useState<Array<{
    name: string;
    count: number;
  }> | null>(null);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [spotifyExportStatus, setSpotifyExportStatus] =
    useState<SpotifyExportStatus | null>(null);
  const [openHistoryExportId, setOpenHistoryExportId] = useState<string | null>(
    null,
  );
  const historyExportRef = useRef<HTMLDivElement | null>(null);
  const [importHistory, setImportHistory] = useState<ImportEntry[]>(() => {
    try {
      const raw = localStorage.getItem("djfriend-imports");
      return raw ? (JSON.parse(raw) as ImportEntry[]) : [];
    } catch {
      return [];
    }
  });
  const [expandedImportId, setExpandedImportId] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [pendingImportUrl, setPendingImportUrl] = useState<string | null>(null);
  const [spotifyPlaylistPicker, setSpotifyPlaylistPicker] = useState<
    SpotifyUserPlaylist[] | null
  >(null);
  const [loadingSpotifyPlaylists, setLoadingSpotifyPlaylists] = useState(false);
  const [openStoreLinkKey, setOpenStoreLinkKey] = useState<string | null>(null);
  const storeLinkRef = useRef<HTMLDivElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [folderPath, setFolderPath] = useState('');
  const [playlistsFolder, setPlaylistsFolder] = useState('');
  const [m3uSavedPath, setM3uSavedPath] = useState<string | null>(null);

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

  useEffect(() => {
    localStorage.setItem("djfriend-history", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem("djfriend-imports", JSON.stringify(importHistory));
  }, [importHistory]);

  // Auto-run import after OAuth redirect, once library is ready
  useEffect(() => {
    if (!pendingImportUrl) return;
    if (library.length === 0) return; // wait for library to load
    const url = pendingImportUrl;
    setPendingImportUrl(null);
    void runImport(url, library);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingImportUrl, library]);

  useEffect(() => {
    if (!openStoreLinkKey) return;
    const handler = (e: MouseEvent) => {
      if (
        storeLinkRef.current &&
        !storeLinkRef.current.contains(e.target as Node)
      ) {
        setOpenStoreLinkKey(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openStoreLinkKey]);

  // Auto-load /public/result.json on mount
  useEffect(() => {
    fetch("/results.json")
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json() as Promise<unknown>;
      })
      .then((data) => {
        const songs = parseSongs(data);
        if (songs) {
          setLibrary(songs);
          setLibraryName("results.json (auto-loaded)");
          setError(null);
        }
      })
      .catch(() => {
        // Silently ignore — user can load manually
      });
  }, []);

  const loadSettings = useCallback(() => {
    fetch('/api/settings')
      .then(r => r.json() as Promise<{ musicFolder?: string; playlistsFolder?: string }>)
      .then(d => {
        if (d.musicFolder) setFolderPath(prev => prev || d.musicFolder!)
        if (d.playlistsFolder !== undefined) setPlaylistsFolder(d.playlistsFolder)
      })
      .catch(() => {})
  }, []);

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

  const openPlaylistPicker = useCallback(async () => {
    setLoadingPlaylists(true);
    setError(null);
    try {
      const res = await fetch("/api/apple-music-playlists");
      if (!res.ok) throw new Error("Could not load playlists.");
      const data = (await res.json()) as Array<{ name: string; count: number }>;
      setPlaylistPicker(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load playlists.",
      );
    } finally {
      setLoadingPlaylists(false);
    }
  }, []);

  const runAppleMusicAnalysis = useCallback(async (playlistName: string) => {
    setPlaylistPicker(null);
    setIsAnalyzing(true);
    setAnalysisProgress({ completed: 0, total: 0 });
    setError(null);
    setGeneratedSet([]);

    try {
      const response = await fetch("/api/analyze-apple-music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistName }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Could not start folder analysis.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as
            | { type: "start"; total: number }
            | { type: "progress"; completed: number; total: number }
            | { type: "folder_done"; folder: string }
            | {
                type: "done";
                songs: unknown;
                libraryName: string;
                resultsJson: Record<string, unknown>;
              }
            | { type: "error"; message: string };

          if (event.type === "start") {
            setAnalysisProgress({ completed: 0, total: event.total });
            continue;
          }

          if (event.type === "progress") {
            setAnalysisProgress({
              completed: event.completed,
              total: event.total,
            });
            continue;
          }

          if (event.type === "error") {
            setError(event.message);
            continue;
          }

          if (event.type === "done") {
            const songs = parseSongs(event.songs);
            if (!songs) {
              setError("Analysis completed but returned invalid song data.");
              continue;
            }
            setLibrary(songs);
            setLibraryName(`${event.libraryName} (analyzed)`);
            setError(null);
            // downloadResultsJson(event.libraryName, event.resultsJson);
          }
        }
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Folder analysis failed.";
      setError(message);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const runFolderAnalysis = useCallback(async (path: string) => {
    if (!path.trim()) return;
    setIsAnalyzing(true);
    setAnalysisProgress({ completed: 0, total: 0 });
    setError(null);
    setGeneratedSet([]);
    try {
      const response = await fetch('/api/analyze-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: path.trim() }),
      });
      if (!response.ok || !response.body) throw new Error('Could not start folder analysis.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as
            | { type: 'start'; total: number }
            | { type: 'progress'; completed: number; total: number }
            | { type: 'folder_done'; folder: string }
            | { type: 'done'; songs: unknown; libraryName: string; resultsJson: Record<string, unknown> }
            | { type: 'error'; message: string };
          if (event.type === 'start') { setAnalysisProgress({ completed: 0, total: event.total }); continue; }
          if (event.type === 'progress') { setAnalysisProgress({ completed: event.completed, total: event.total }); continue; }
          if (event.type === 'error') { setError(event.message); continue; }
          if (event.type === 'done') {
            const songs = parseSongs(event.songs);
            if (!songs) { setError('Analysis completed but returned invalid song data.'); continue; }
            setLibrary(songs);
            setLibraryName(`${event.libraryName} (analyzed)`);
            setError(null);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Folder analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const runGenerate = useCallback(
    (songs: Song[], p: DJPreferences, c: CurvePoint[]) => {
      if (songs.length === 0) return;
      const set = generateSet(songs, p, c);
      setGeneratedSet(set);
    },
    [],
  );

  const handleGenerate = useCallback(() => {
    runGenerate(library, prefs, curve);
    setAutoRegen(true);
  }, [library, prefs, curve, runGenerate]);

  const handleCurveChange = useCallback(
    (newCurve: CurvePoint[]) => {
      setCurve(newCurve);
      if (!autoRegen || library.length === 0) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        runGenerate(library, prefs, newCurve);
      }, 150);
    },
    [autoRegen, library, prefs, runGenerate],
  );

  const buildSwapSuggestions = useCallback(
    (index: number): Array<{ song: Song; score: number }> => {
      if (index < 0 || index >= generatedSet.length) return [];
      const currentSet = generatedSet;
      const current = currentSet[index];
      const usedFiles = new Set(
        currentSet.filter((_, i) => i !== index).map((track) => track.file),
      );
      const previousTrack = index > 0 ? currentSet[index - 1] : null;
      const nextTrack =
        index < currentSet.length - 1 ? currentSet[index + 1] : null;

      const candidates = library.filter(
        (song) =>
          !usedFiles.has(song.file) &&
          song.file !== current.file &&
          matchesGenrePref(song, prefs.genre),
      );

      const scored = candidates.map((candidate) => {
        const energyDiff = Math.abs(candidate.energy - current.targetEnergy);
        const fromPrevHarmony = previousTrack
          ? camelotHarmonyScore(previousTrack.camelot, candidate.camelot)
          : 1;
        const toNextHarmony = nextTrack
          ? camelotHarmonyScore(candidate.camelot, nextTrack.camelot)
          : 1;
        const fromPrevBpmDiff = previousTrack
          ? Math.abs(candidate.bpm - previousTrack.bpm)
          : 0;
        const toNextBpmDiff = nextTrack
          ? Math.abs(candidate.bpm - nextTrack.bpm)
          : 0;
        const fromPrevBpm = previousTrack
          ? 1 - clamp(fromPrevBpmDiff / 20, 0, 1)
          : 1;
        const toNextBpm = nextTrack ? 1 - clamp(toNextBpmDiff / 20, 0, 1) : 1;
        const energyScore = 1 - energyDiff;
        const baseScore =
          energyScore * 0.45 +
          fromPrevHarmony * 0.2 +
          toNextHarmony * 0.2 +
          fromPrevBpm * 0.075 +
          toNextBpm * 0.075;
        const strictFit =
          energyDiff <= 0.24 &&
          fromPrevHarmony > 0 &&
          toNextHarmony > 0 &&
          fromPrevBpmDiff <= 12 &&
          toNextBpmDiff <= 12;
        const relaxedFit =
          energyDiff <= 0.35 &&
          fromPrevHarmony > 0 &&
          toNextHarmony > 0 &&
          fromPrevBpmDiff <= 20 &&
          toNextBpmDiff <= 20;
        return {
          candidate,
          strictFit,
          relaxedFit,
          score: baseScore + (strictFit ? 0.05 : 0),
        };
      });

      const strict = scored.filter((s) => s.strictFit);
      const relaxed = scored.filter((s) => !s.strictFit && s.relaxedFit);
      const ranked = [...strict, ...relaxed].sort((a, b) => b.score - a.score);
      return ranked.map((r) => ({ song: r.candidate, score: r.score }));
    },
    [generatedSet, library, prefs.genre],
  );

  const handleSwapTrack = useCallback(
    (index: number) => {
      const suggestions = buildSwapSuggestions(index);
      setSwapVisibleCount(5);
      setSwapModal({ index, suggestions });
    },
    [buildSwapSuggestions],
  );

  const applySwapSuggestion = useCallback(
    (song: Song) => {
      setGeneratedSet((prev) => {
        if (!swapModal) return prev;
        const index = swapModal.index;
        if (index < 0 || index >= prev.length) return prev;
        const previousTrack = index > 0 ? prev[index - 1] : null;
        const next = [...prev];
        next[index] = {
          ...song,
          slot: prev[index].slot,
          targetEnergy: prev[index].targetEnergy,
          harmonicWarning: previousTrack
            ? isHarmonicWarning(previousTrack.camelot, song.camelot)
            : false,
        };
        if (index + 1 < next.length) {
          const after = next[index + 1];
          next[index + 1] = {
            ...after,
            harmonicWarning: isHarmonicWarning(
              next[index].camelot,
              after.camelot,
            ),
          };
        }
        return next;
      });
      setSwapModal(null);
      setSwapVisibleCount(5);
    },
    [swapModal],
  );

  const exportM3UToServer = useCallback(async (tracks: SetTrack[], filename: string) => {
    const content = generateM3U(tracks);
    try {
      const r = await fetch('/api/export-m3u', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, filename }),
      });
      const data = await r.json() as { ok?: boolean; path?: string; error?: string };
      if (data.ok && data.path) {
        setM3uSavedPath(data.path);
        setTimeout(() => setM3uSavedPath(null), 4000);
        return true;
      }
    } catch { /* fall through */ }
    return false;
  }, []);

  const handleExportM3U = useCallback(async () => {
    if (generatedSet.length === 0) return;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const name = `djfriend-set-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const entry: HistoryEntry = {
      id: Date.now().toString(),
      name,
      timestamp: Date.now(),
      tracks: [...generatedSet],
      prefs: { ...prefs },
      curve: curve.map((p) => ({ ...p })),
    };
    setHistory((prev) => [entry, ...prev]);
    if (playlistsFolder) {
      const saved = await exportM3UToServer(generatedSet, `${name}.m3u`);
      if (!saved) downloadM3U(generatedSet, `${name}.m3u`);
    } else {
      downloadM3U(generatedSet, `${name}.m3u`);
    }
  }, [generatedSet, prefs, curve, playlistsFolder, exportM3UToServer]);

  const handleRenameEntry = useCallback((id: string, newName: string) => {
    setHistory((prev) =>
      prev.map((e) => (e.id === id ? { ...e, name: newName } : e)),
    );
  }, []);

  const runImport = useCallback(async (url: string, lib: Song[]) => {
    const playlistId = parsePlaylistId(url);
    if (!playlistId) {
      setImportStatus({
        phase: "error",
        message: "Invalid Spotify playlist URL or ID.",
      });
      return;
    }

    const token = getStoredToken();
    if (!token) {
      storePendingImport(url);
      await redirectToSpotifyLogin();
      return;
    }

    setImportStatus({ phase: "loading", loaded: 0, total: 0 });
    try {
      const { playlistName, tracks } = await fetchPlaylistTracks(
        playlistId,
        token,
        (loaded, total) => setImportStatus({ phase: "loading", loaded, total }),
      );

      const importTracks: ImportTrack[] = tracks.map((t) => ({
        ...t,
        inLibrary:
          !t.unavailable && matchInLibrary(t.spotifyId, t.title, t.artist, lib),
      }));

      const entry: ImportEntry = {
        id: Date.now().toString(),
        name: playlistName,
        timestamp: Date.now(),
        playlistId,
        tracks: importTracks,
      };

      setImportHistory((prev) => [entry, ...prev]);
      setImportUrl("");
      setImportStatus(null);
      setExpandedImportId(entry.id);
    } catch (err) {
      setImportStatus({
        phase: "error",
        message: err instanceof Error ? err.message : "Import failed.",
      });
    }
  }, []);

  const handleImport = useCallback(() => {
    void runImport(importUrl, library);
  }, [runImport, importUrl, library]);

  const handleBrowseSpotifyPlaylists = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      storePendingImport("__browse__");
      await redirectToSpotifyLogin();
      return;
    }
    setLoadingSpotifyPlaylists(true);
    try {
      const playlists = await fetchUserPlaylists(token);
      setSpotifyPlaylistPicker(playlists);
    } catch (err) {
      setImportStatus({
        phase: "error",
        message:
          err instanceof Error ? err.message : "Failed to load playlists.",
      });
    } finally {
      setLoadingSpotifyPlaylists(false);
    }
  }, []);

  const startSpotifyExport = useCallback(
    async (tracks: SetTrack[], playlistName: string) => {
      const token = getStoredToken();
      if (!token) {
        storePendingExport(tracks, playlistName);
        try {
          await redirectToSpotifyLogin();
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not start Spotify login.",
          );
        }
        return;
      }
      setSpotifyExportStatus({
        phase: "searching",
        completed: 0,
        total: tracks.length,
      });
      try {
        const matches = await searchTracksOnSpotify(
          tracks,
          token,
          (completed, total) =>
            setSpotifyExportStatus({ phase: "searching", completed, total }),
        );
        setSpotifyExportStatus({ phase: "review", matches, playlistName });
      } catch (err) {
        setSpotifyExportStatus({
          phase: "error",
          message: err instanceof Error ? err.message : "Export failed.",
        });
      }
    },
    [],
  );

  const handleExportSpotify = useCallback(async () => {
    if (generatedSet.length === 0) return;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const name = `DJFriend Set ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    await startSpotifyExport(generatedSet, name);
  }, [generatedSet, startSpotifyExport]);

  const handleToggleSpotifyMatch = useCallback((index: number) => {
    setSpotifyExportStatus((prev) => {
      if (!prev || prev.phase !== "review") return prev;
      const matches = [...prev.matches];
      matches[index] = {
        ...matches[index],
        excluded: !matches[index].excluded,
      };
      return { ...prev, matches };
    });
  }, []);

  const handleConfirmSpotifyExport = useCallback(
    async (matches: SpotifyMatchResult[], playlistName: string) => {
      const token = getStoredToken();
      if (!token) {
        setSpotifyExportStatus({
          phase: "error",
          message: "Spotify session expired. Please try again.",
        });
        return;
      }
      setSpotifyExportStatus({ phase: "creating" });
      try {
        const result = await createPlaylistFromMatches(
          matches,
          playlistName,
          token,
        );

        // Save to history — all non-excluded tracks (found or not), using original local SetTrack data
        const includedTracks = matches
          .filter((m) => !m.excluded)
          .map((m) => m.track);
        const entry: HistoryEntry = {
          id: Date.now().toString(),
          name: playlistName,
          timestamp: Date.now(),
          tracks: includedTracks,
          prefs: { ...prefs },
          curve: curve.map((p) => ({ ...p })),
        };
        setHistory((prev) => [entry, ...prev]);

        setSpotifyExportStatus({ phase: "done", ...result });
      } catch (err) {
        setSpotifyExportStatus({
          phase: "error",
          message: err instanceof Error ? err.message : "Export failed.",
        });
      }
    },
    [prefs, curve],
  );

  const handleRemoveTrack = useCallback((index: number) => {
    setGeneratedSet((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.filter((_, i) => i !== index);
      const resequenced = next.map((track, i) => ({
        ...track,
        slot: i,
        harmonicWarning:
          i > 0 ? isHarmonicWarning(next[i - 1].camelot, track.camelot) : false,
      }));
      return resequenced;
    });
  }, []);

  const handleUpdateTrack = useCallback((index: number, tags: { title?: string; artist?: string; genre?: string; bpm?: number }) => {
    const patch = {
      ...(tags.title !== undefined ? { title: tags.title } : {}),
      ...(tags.artist !== undefined ? { artist: tags.artist } : {}),
      ...(tags.genre !== undefined ? {
        genres: tags.genre ? tags.genre.split(',').map(g => g.trim()).filter(Boolean) : [],
        genresFromSpotify: false,
      } : {}),
      ...(tags.bpm !== undefined ? { bpm: tags.bpm } : {}),
    };
    setGeneratedSet(prev => {
      if (index < 0 || index >= prev.length) return prev;
      return prev.map((t, i) => i === index ? { ...t, ...patch } : t);
    });
    const fileKey = generatedSet[index]?.file;
    if (fileKey) {
      setLibrary(prev => prev.map(s => s.file === fileKey ? { ...s, ...patch } : s));
    }
  }, [generatedSet]);

  const progressPercent =
    analysisProgress.total > 0
      ? Math.min(
          100,
          Math.round(
            (analysisProgress.completed / analysisProgress.total) * 100,
          ),
        )
      : 0;
  const availableGenres = Array.from(
    new Set(library.flatMap((song) => song.genres).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));

  const availableTags = (() => {
    const vibe = new Set<string>(), mood = new Set<string>(), vocal = new Set<string>();
    const venue = new Set<string>(), time = new Set<string>();
    for (const s of library) {
      if (!s.semanticTags) continue;
      s.semanticTags.vibeTags.forEach(t => vibe.add(t));
      s.semanticTags.moodTags.forEach(t => mood.add(t));
      vocal.add(s.semanticTags.vocalType);
      s.semanticTags.venueTags.forEach(t => venue.add(t));
      s.semanticTags.timeOfNightTags.forEach(t => time.add(t));
    }
    return {
      vibeTags: [...vibe].sort(),
      moodTags: [...mood].sort(),
      vocalTypes: [...vocal].sort(),
      venueTags: [...venue].sort(),
      timeOfNightTags: [...time].sort(),
    };
  })();

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#e2e8f0]">
      {/* Header */}
      <header className="border-b border-[#1e1e2e] bg-[#0a0a0f] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🎧</span>
            <span className="font-bold text-lg tracking-tight text-[#e2e8f0]">
              DJFriend
            </span>
            {libraryName && (
              <span className="hidden sm:inline text-xs text-[#475569] bg-[#12121a] border border-[#2a2a3a] px-2 py-0.5 rounded">
                {libraryName} · {library.length} tracks
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
            <button
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              className="p-1.5 text-[#475569] hover:text-[#94a3b8] transition-colors cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            <button
              onClick={openPlaylistPicker}
              disabled={isAnalyzing || loadingPlaylists}
              className="px-3 py-1.5 text-sm rounded-md border border-[#2a2a3a] bg-[#12121a] text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAnalyzing
                ? "Analyzing…"
                : loadingPlaylists
                  ? "Loading…"
                  : "Analyze Apple Music"}
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1">
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
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
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
            {/* Preferences panel */}
            <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-[#475569] mb-4">
                Set Preferences
              </h2>
              <PreferencesForm
                prefs={prefs}
                availableGenres={availableGenres}
                onChange={setPrefs}
                onGenerate={handleGenerate}
                disabled={library.length === 0}
              />
            </div>

            {/* Energy Curve panel */}
            <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-[#475569]">
                  Energy Curve
                </h2>
                {autoRegen && (
                  <span className="text-[10px] text-[#475569] bg-[#0d0d14] border border-[#1e1e2e] px-2 py-0.5 rounded">
                    Live — drag to regenerate
                  </span>
                )}
              </div>
              <EnergyCurveEditor points={curve} onChange={handleCurveChange} />

              {/* AI Tag Filters */}
              {(availableTags.vibeTags.length + availableTags.moodTags.length + availableTags.venueTags.length + availableTags.timeOfNightTags.length + availableTags.vocalTypes.length) > 0 && (
                <div className="mt-4 pt-4 border-t border-[#1e1e2e] flex flex-col gap-3">
                  {TAG_GROUPS.map(({ key, label, color }) => {
                    const tags = availableTags[key] as string[];
                    if (tags.length === 0) return null;
                    const selectedTags = prefs.tagFilters[key] as string[];
                    return (
                      <div key={key}>
                        <span className="text-[9px] uppercase tracking-widest text-[#334155] block mb-1.5">{label}</span>
                        <div className="flex flex-wrap gap-1">
                          {tags.map(tag => {
                            const active = selectedTags.includes(tag);
                            return (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => {
                                  const current = prefs.tagFilters[key] as string[];
                                  const next = current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag];
                                  setPrefs(p => ({ ...p, tagFilters: { ...p.tagFilters, [key]: next } }));
                                }}
                                className="px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors cursor-pointer"
                                style={{
                                  backgroundColor: active ? color.activeBg : 'transparent',
                                  color: color.text,
                                  border: `1px solid ${active ? color.border : '#2a2a3a'}`,
                                  opacity: active ? 1 : 0.6,
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
                  {(prefs.tagFilters.vibeTags.length + prefs.tagFilters.moodTags.length + prefs.tagFilters.vocalTypes.length + prefs.tagFilters.venueTags.length + prefs.tagFilters.timeOfNightTags.length) > 0 && (
                    <button
                      type="button"
                      onClick={() => setPrefs(p => ({ ...p, tagFilters: { vibeTags: [], moodTags: [], vocalTypes: [], venueTags: [], timeOfNightTags: [] } }))}
                      className="text-[10px] text-[#475569] hover:text-[#94a3b8] transition-colors text-left cursor-pointer"
                    >
                      Clear all tags
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Generated Set panel */}
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[#475569] mb-4">
              Generated Set
            </h2>
            <SetTracklist
              tracks={generatedSet}
              prefs={prefs}
              onSwapTrack={handleSwapTrack}
              onRemoveTrack={handleRemoveTrack}
              onUpdateTrack={handleUpdateTrack}
              onExport={handleExportM3U}
              onExportSpotify={() => {
                void handleExportSpotify();
              }}
            />
          </div>
        </main>
      )}

      {activeTab === "History" && (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-[#475569] gap-3">
              <span className="text-4xl">📋</span>
              <p className="text-sm">
                No playlists exported yet. Generate a set and click Export as
                M3U.
              </p>
            </div>
          ) : (
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

                const prefTags = [
                  `${entry.prefs.setDuration} min`,
                  entry.prefs.venueType,
                  entry.prefs.setPhase,
                  ...(entry.prefs.genre !== "Any" ? [entry.prefs.genre] : []),
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
                      <div className="w-44 shrink-0 rounded-md overflow-hidden border border-[#1e1e2e] bg-[#0d0d14]">
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
                          <div className="absolute right-0 bottom-full mb-1 z-10 min-w-[160px] rounded-md border border-[#2a2a3a] bg-[#12121a] shadow-lg overflow-hidden">
                            <button
                              onClick={() => {
                                if (playlistsFolder) {
                                  void exportM3UToServer(entry.tracks, `${entry.name}.m3u`).then(saved => {
                                    if (!saved) downloadM3U(entry.tracks, `${entry.name}.m3u`);
                                  });
                                } else {
                                  downloadM3U(entry.tracks, `${entry.name}.m3u`);
                                }
                                setOpenHistoryExportId(null);
                              }}
                              className="w-full text-left px-4 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer"
                            >
                              Export as M3U
                            </button>
                            <button
                              onClick={() => {
                                void startSpotifyExport(
                                  entry.tracks,
                                  entry.name,
                                );
                                setOpenHistoryExportId(null);
                              }}
                              className="w-full text-left px-4 py-2.5 text-xs text-[#94a3b8] hover:bg-[#1a1a2e] hover:text-[#e2e8f0] transition-colors cursor-pointer border-t border-[#1e1e2e]"
                            >
                              Export to Spotify
                            </button>
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
                                <td className="py-2.5 px-2 text-sm text-[#94a3b8]">
                                  {track.camelot}
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
          )}
        </main>
      )}

      {activeTab === "Import" && (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {/* Import input */}
          <div className="mb-6 rounded-xl border border-[#1e1e2e] bg-[#12121a] p-5">
            <h2 className="text-sm font-semibold text-[#e2e8f0] mb-3">
              Import Spotify Playlist
            </h2>
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
                                          void fetch("/api/play-in-music", {
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
                {playlistPicker.map((playlist) => (
                  <button
                    key={playlist.name}
                    onClick={() => runAppleMusicAnalysis(playlist.name)}
                    className="w-full text-left rounded-md border border-[#2a2a3a] bg-[#0d0d14] px-3 py-2.5 hover:border-[#7c3aed] transition-colors cursor-pointer"
                  >
                    <div className="text-sm text-[#e2e8f0]">
                      {playlist.name}
                    </div>
                    <div className="text-[11px] text-[#475569] mt-0.5">
                      {playlist.count} track{playlist.count === 1 ? "" : "s"}
                    </div>
                  </button>
                ))}
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
                          {Math.round(song.energy * 100)}% energy • relevance{" "}
                          {Math.round(score * 100)}%
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
        onSaved={() => { loadSettings() }}
      />

      {m3uSavedPath && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-[#1a1a2e] border border-[#7c3aed] text-[#e2e8f0] text-xs rounded-lg px-4 py-2.5 shadow-lg max-w-sm truncate">
          Saved to {m3uSavedPath}
        </div>
      )}
    </div>
  );
}
