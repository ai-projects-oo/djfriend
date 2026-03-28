import { useState, useCallback, useEffect, useRef } from "react";
import type { Song } from "../types";
import { parseSongs } from "../lib/genreUtils";

interface UseLibraryOptions {
  onNewAnalysis?: () => void;
}

type AnalysisEvent =
  | { type: 'start'; total: number }
  | { type: 'progress'; completed: number; total: number }
  | { type: 'folder_done'; folder: string }
  | { type: 'done'; songs: unknown; libraryName: string; resultsJson: Record<string, unknown> }
  | { type: 'error'; message: string };

async function streamAnalysis(
  response: Response,
  onEvent: (event: AnalysisEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error('No response body.');
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
      onEvent(JSON.parse(line) as AnalysisEvent);
    }
  }
}

export function useLibrary({ onNewAnalysis }: UseLibraryOptions = {}) {
  // Use a ref so callbacks in useCallback closures always see the latest value
  const onNewAnalysisRef = useRef(onNewAnalysis);
  useEffect(() => { onNewAnalysisRef.current = onNewAnalysis; }, [onNewAnalysis]);
  const [library, setLibrary] = useState<Song[]>([]);
  const [libraryName, setLibraryName] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{
    completed: number;
    total: number;
  }>({ completed: 0, total: 0 });
  const [folderPath, setFolderPath] = useState('');
  const [playlistPicker, setPlaylistPicker] = useState<Array<{
    name: string;
    count: number;
  }> | null>(null);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [analyzedApplePlaylists, setAnalyzedApplePlaylists] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("djfriend-analyzed-apple-playlists");
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const [error, setError] = useState<string | null>(null);

  // Persist analyzedApplePlaylists to localStorage
  useEffect(() => {
    localStorage.setItem("djfriend-analyzed-apple-playlists", JSON.stringify([...analyzedApplePlaylists]));
  }, [analyzedApplePlaylists]);

  // Auto-load saved library on mount: try folder results first, then Apple Music results
  useEffect(() => {
    fetch("/results.json")
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json() as Promise<unknown>;
      })
      .then((data) => {
        const songs = parseSongs(data);
        if (songs && songs.length > 0) {
          setLibrary(songs);
          setLibraryName("results.json (auto-loaded)");
          setError(null);
          return;
        }
        throw new Error("empty");
      })
      .catch(() => {
        // Fall back to Apple Music results
        fetch("/api/apple-library")
          .then((r) => {
            if (!r.ok) throw new Error("not found");
            return r.json() as Promise<unknown>;
          })
          .then((data) => {
            if (!data) return;
            const songs = parseSongs(data);
            if (songs && songs.length > 0) {
              setLibrary(songs);
              setLibraryName("Apple Music library (auto-loaded)");
              setError(null);
            }
          })
          .catch(() => {});
      });
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
    onNewAnalysisRef.current?.();

    try {
      const response = await fetch("/api/analyze-apple-music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistName }),
      });

      if (!response.ok) throw new Error("Could not start Apple Music analysis.");

      await streamAnalysis(response, (event) => {
        if (event.type === 'start') { setAnalysisProgress({ completed: 0, total: event.total }); return; }
        if (event.type === 'progress') { setAnalysisProgress({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'error') { setError(event.message); return; }
        if (event.type === 'done') {
          const songs = parseSongs(event.songs);
          if (!songs) { setError('Analysis completed but returned invalid song data.'); return; }
          setLibrary(songs);
          setLibraryName(`${event.libraryName} (analyzed)`);
          setAnalyzedApplePlaylists(prev => new Set([...prev, playlistName]));
          setError(null);
        }
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Folder analysis failed.";
      setError(message);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const runRekordboxImport = useCallback(async (tracks: Array<{ path: string; title: string; artist: string; bpm: number; tonality: string; duration: number }>) => {
    if (tracks.length === 0) return;
    setIsAnalyzing(true);
    setAnalysisProgress({ completed: 0, total: 0 });
    setError(null);
    onNewAnalysisRef.current?.();
    try {
      const response = await fetch('/api/import-rekordbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks }),
      });
      if (!response.ok) throw new Error('Could not start Rekordbox import.');
      await streamAnalysis(response, (event) => {
        if (event.type === 'start') { setAnalysisProgress({ completed: 0, total: event.total }); return; }
        if (event.type === 'progress') { setAnalysisProgress({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'error') { setError(event.message); return; }
        if (event.type === 'done') {
          const songs = parseSongs(event.songs);
          if (!songs) { setError('Import completed but returned invalid data.'); return; }
          setLibrary(songs);
          setLibraryName('Rekordbox collection (imported)');
          setError(null);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rekordbox import failed.');
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const runPathListAnalysis = useCallback(async (paths: string[], label: string) => {
    if (paths.length === 0) return;
    setIsAnalyzing(true);
    setAnalysisProgress({ completed: 0, total: 0 });
    setError(null);
    onNewAnalysisRef.current?.();
    try {
      const response = await fetch('/api/analyze-paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, label }),
      });
      if (!response.ok) throw new Error('Could not start analysis.');
      await streamAnalysis(response, (event) => {
        if (event.type === 'start') { setAnalysisProgress({ completed: 0, total: event.total }); return; }
        if (event.type === 'progress') { setAnalysisProgress({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'error') { setError(event.message); return; }
        if (event.type === 'done') {
          const songs = parseSongs(event.songs);
          if (!songs) { setError('Analysis completed but returned invalid song data.'); return; }
          setLibrary(songs);
          setLibraryName(`${event.libraryName} (analyzed)`);
          setError(null);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const runFolderAnalysis = useCallback(async (path: string) => {
    if (!path.trim()) return;
    setIsAnalyzing(true);
    setAnalysisProgress({ completed: 0, total: 0 });
    setError(null);
    onNewAnalysisRef.current?.();
    try {
      const response = await fetch('/api/analyze-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: path.trim() }),
      });
      if (!response.ok) throw new Error('Could not start folder analysis.');

      await streamAnalysis(response, (event) => {
        if (event.type === 'start') { setAnalysisProgress({ completed: 0, total: event.total }); return; }
        if (event.type === 'progress') { setAnalysisProgress({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'error') { setError(event.message); return; }
        if (event.type === 'done') {
          const songs = parseSongs(event.songs);
          if (!songs) { setError('Analysis completed but returned invalid song data.'); return; }
          setLibrary(songs);
          setLibraryName(`${event.libraryName} (analyzed)`);
          setError(null);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Folder analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  return {
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
    setError,
    openPlaylistPicker,
    runAppleMusicAnalysis,
    runFolderAnalysis,
    runPathListAnalysis,
    runRekordboxImport,
  };
}
