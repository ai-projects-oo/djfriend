import { useState, useCallback, useEffect, useRef } from "react";
import type { Song, ImportEntry, ImportTrack } from "../types";
import {
  getStoredToken,
  redirectToSpotifyLogin,
} from "../lib/spotifyExport";
import {
  storePendingImport,
  parsePlaylistId,
  fetchPlaylistTracks,
  fetchUserPlaylists,
  matchInLibrary,
} from "../lib/spotifyImport";
import type { SpotifyUserPlaylist } from "../lib/spotifyImport";

type ImportStatus =
  | { phase: "loading"; loaded: number; total: number }
  | { phase: "error"; message: string };

interface UseSpotifyImportParams {
  library: Song[];
  setHistory: React.Dispatch<React.SetStateAction<import("../types").HistoryEntry[]>>;
}

export function useSpotifyImport({ library }: UseSpotifyImportParams) { // setHistory unused but kept for forward-compat
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

  // Persist importHistory to localStorage
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

  // Click-outside for storeLinkRef
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

  return {
    importHistory,
    setImportHistory,
    expandedImportId,
    setExpandedImportId,
    importUrl,
    setImportUrl,
    importStatus,
    setImportStatus,
    pendingImportUrl,
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
  };
}

export type { ImportStatus };
