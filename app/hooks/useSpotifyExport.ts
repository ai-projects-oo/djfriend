import { useState, useCallback } from "react";
import { apiFetch } from "../lib/apiFetch";
import type { SetTrack, HistoryEntry, DJPreferences, CurvePoint } from "../types";
import { generateM3U, downloadM3U } from "../lib/m3uExport";
import {
  getStoredToken,
  storePendingExport,
  redirectToSpotifyLogin,
  searchTracksOnSpotify,
  createPlaylistFromMatches,
} from "../lib/spotifyExport";
import type { SpotifyMatchResult } from "../lib/spotifyExport";

type SpotifyExportStatus =
  | { phase: "searching"; completed: number; total: number }
  | { phase: "review"; matches: SpotifyMatchResult[]; playlistName: string }
  | { phase: "creating" }
  | { phase: "done"; playlistUrl: string; matched: number; total: number }
  | { phase: "error"; message: string };

interface UseSpotifyExportParams {
  generatedSet: SetTrack[];
  prefs: DJPreferences;
  curve: CurvePoint[];
  playlistsFolder: string;
  setHistory: React.Dispatch<React.SetStateAction<HistoryEntry[]>>;
}

export function useSpotifyExport({
  generatedSet,
  prefs,
  curve,
  playlistsFolder,
  setHistory,
}: UseSpotifyExportParams) {
  const [spotifyExportStatus, setSpotifyExportStatus] =
    useState<SpotifyExportStatus | null>(null);
  const [m3uSavedPath, setM3uSavedPath] = useState<string | null>(null);

  const exportM3UToServer = useCallback(async (tracks: SetTrack[], filename: string) => {
    const content = generateM3U(tracks);
    try {
      const r = await apiFetch('/api/export-m3u', {
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
  }, [generatedSet, prefs, curve, playlistsFolder, exportM3UToServer, setHistory]);

  const startSpotifyExport = useCallback(
    async (tracks: SetTrack[], playlistName: string) => {
      const token = getStoredToken();
      if (!token) {
        storePendingExport(tracks, playlistName);
        try {
          await redirectToSpotifyLogin();
        } catch (err) {
          setSpotifyExportStatus({
            phase: "error",
            message: err instanceof Error
              ? err.message
              : "Could not start Spotify login.",
          });
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
    [prefs, curve, setHistory],
  );

  const handleRenameEntry = useCallback((id: string, newName: string) => {
    setHistory((prev) =>
      prev.map((e) => (e.id === id ? { ...e, name: newName } : e)),
    );
  }, [setHistory]);

  return {
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
  };
}

export type { SpotifyExportStatus };
