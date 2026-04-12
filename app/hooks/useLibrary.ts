import { useState, useCallback, useEffect, useRef } from "react";
import type { Song } from "../types";
import { parseSongs } from "../lib/genreUtils";
import { apiFetch } from "../lib/apiFetch";

interface UseLibraryOptions {
  onNewAnalysis?: () => void;
}

type AnalysisEvent =
  | { type: 'start'; total: number }
  | { type: 'progress'; completed: number; total: number }
  | { type: 'folder_done'; folder: string }
  | { type: 'enriching'; message: string }
  | { type: 'enrich_progress'; completed: number; total: number }
  | { type: 'done'; songs: unknown; libraryName: string; resultsJson: Record<string, unknown> }
  | { type: 'error'; message: string };

async function streamAnalysis(
  response: Response,
  onEvent: (event: AnalysisEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.body) throw new Error('No response body.');
  const reader = response.body.getReader();
  signal?.addEventListener('abort', () => { void reader.cancel(); });
  const decoder = new TextDecoder();
  let buffer = '';
  try {
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
  } finally {
    reader.releaseLock();
  }
}

export interface QueueItem {
  playlistName: string;
  status: 'queued' | 'analyzing';
  completed: number;
  total: number;
}

export function useLibrary({ onNewAnalysis }: UseLibraryOptions = {}) {
  const onNewAnalysisRef = useRef(onNewAnalysis);
  useEffect(() => { onNewAnalysisRef.current = onNewAnalysis; }, [onNewAnalysis]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isAnalyzingRef = useRef(false);
  const currentPlaylistRef = useRef<string | null>(null);
  const analysisQueueRef = useRef<QueueItem[]>([]);
  const runAppleMusicInternalRef = useRef<(name: string) => Promise<void>>(null!);

  const [library, setLibrary] = useState<Song[]>([]);
  const [libraryName, setLibraryName] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisQueue, setAnalysisQueueState] = useState<QueueItem[]>([]);
  const [enrichmentStatus, setEnrichmentStatus] = useState<{ completed: number; total: number } | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<{ completed: number; total: number }>({ completed: 0, total: 0 });
  const [folderPath, setFolderPath] = useState('');
  const [playlistPicker, setPlaylistPicker] = useState<Array<{ name: string; count: number }> | null>(null);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [analyzedApplePlaylists, setAnalyzedApplePlaylists] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("djfriend-analyzed-apple-playlists");
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("djfriend-analyzed-apple-playlists", JSON.stringify([...analyzedApplePlaylists]));
  }, [analyzedApplePlaylists]);

  // Auto-load saved library on mount
  useEffect(() => {
    apiFetch("/results.json")
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
        apiFetch("/api/apple-library")
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
      const res = await apiFetch("/api/apple-music-playlists");
      if (!res.ok) throw new Error("Could not load playlists.");
      const data = (await res.json()) as Array<{ name: string; count: number }>;
      setPlaylistPicker(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load playlists.");
    } finally {
      setLoadingPlaylists(false);
    }
  }, []);

  // Internal: actually runs one playlist analysis. Called by drain loop.
  const runAppleMusicInternal = useCallback(async (playlistName: string) => {
    currentPlaylistRef.current = playlistName;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Mark as analyzing
    const markAnalyzing = (prev: QueueItem[]) =>
      prev.map(item => item.playlistName === playlistName ? { ...item, status: 'analyzing' as const } : item);
    analysisQueueRef.current = markAnalyzing(analysisQueueRef.current);
    setAnalysisQueueState(prev => markAnalyzing(prev));

    try {
      const response = await apiFetch("/api/analyze-apple-music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistName }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error("Could not start Apple Music analysis.");

      await streamAnalysis(response, (event) => {
        if (event.type === 'start') {
          const update = (prev: QueueItem[]) =>
            prev.map(item => item.playlistName === playlistName ? { ...item, total: event.total, completed: 0 } : item);
          analysisQueueRef.current = update(analysisQueueRef.current);
          setAnalysisQueueState(prev => update(prev));
          return;
        }
        if (event.type === 'progress') {
          const update = (prev: QueueItem[]) =>
            prev.map(item => item.playlistName === playlistName ? { ...item, completed: event.completed, total: event.total } : item);
          analysisQueueRef.current = update(analysisQueueRef.current);
          setAnalysisQueueState(prev => update(prev));
          return;
        }
        if (event.type === 'enriching') { setEnrichmentStatus({ completed: 0, total: 0 }); return; }
        if (event.type === 'enrich_progress') { setEnrichmentStatus({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'error') { setError(event.message); return; }
        if (event.type === 'done') {
          const songs = parseSongs(event.songs);
          if (!songs) { setError('Analysis completed but returned invalid song data.'); return; }
          setLibrary(songs);
          setLibraryName(`${event.libraryName} (analyzed)`);
          setAnalyzedApplePlaylists(prev => new Set([...prev, playlistName]));
          setError(null);
        }
      }, controller.signal);
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : "Apple Music analysis failed.");
      }
      // On abort: already-analyzed tracks remain in results.json on the server.
      // We don't update library state — user sees what was loaded before.
    } finally {
      setEnrichmentStatus(null);
      abortControllerRef.current = null;
      currentPlaylistRef.current = null;

      // Remove this item from queue
      analysisQueueRef.current = analysisQueueRef.current.filter(item => item.playlistName !== playlistName);
      setAnalysisQueueState([...analysisQueueRef.current]);

      // Drain: start next queued item
      const next = analysisQueueRef.current.find(item => item.status === 'queued');
      if (next) {
        void runAppleMusicInternalRef.current(next.playlistName);
      } else {
        isAnalyzingRef.current = false;
        setIsAnalyzing(false);
      }
    }
  }, []);

  // Keep ref up to date so drain loop always calls the latest closure
  runAppleMusicInternalRef.current = runAppleMusicInternal;

  // Public: enqueue a playlist for analysis (max 3)
  const runAppleMusicAnalysis = useCallback((playlistName: string) => {
    if (analysisQueueRef.current.some(item => item.playlistName === playlistName)) return;
    if (analysisQueueRef.current.length >= 3) return;

    const newItem: QueueItem = { playlistName, status: 'queued', completed: 0, total: 0 };
    analysisQueueRef.current = [...analysisQueueRef.current, newItem];
    setAnalysisQueueState([...analysisQueueRef.current]);

    setPlaylistPicker(null);
    setError(null);
    onNewAnalysisRef.current?.();

    if (!isAnalyzingRef.current) {
      isAnalyzingRef.current = true;
      setIsAnalyzing(true);
      void runAppleMusicInternalRef.current(playlistName);
    }
  }, []);

  // Cancel a specific playlist: abort if active, remove if queued.
  // Already-analyzed tracks stay in results.json.
  const cancelQueueItem = useCallback((playlistName: string) => {
    if (currentPlaylistRef.current === playlistName) {
      // Active: abort — the finally block will remove it and drain next
      abortControllerRef.current?.abort();
    } else {
      // Queued: just remove without stopping anything
      analysisQueueRef.current = analysisQueueRef.current.filter(item => item.playlistName !== playlistName);
      setAnalysisQueueState([...analysisQueueRef.current]);
    }
  }, []);

  const cancelAnalysis = useCallback(() => {
    // Clear entire queue then abort active
    analysisQueueRef.current = [];
    setAnalysisQueueState([]);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const runRekordboxImport = useCallback(async (tracks: Array<{ path: string; title: string; artist: string; bpm: number; tonality: string; duration: number }>) => {
    if (tracks.length === 0) return;
    setIsAnalyzing(true);
    setAnalysisProgress({ completed: 0, total: 0 });
    setError(null);
    onNewAnalysisRef.current?.();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const response = await apiFetch('/api/import-rekordbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Could not start Rekordbox import.');
      await streamAnalysis(response, (event) => {
        if (event.type === 'start') { setAnalysisProgress({ completed: 0, total: event.total }); return; }
        if (event.type === 'progress') { setAnalysisProgress({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'enriching') { setEnrichmentStatus({ completed: 0, total: 0 }); return; }
        if (event.type === 'enrich_progress') { setEnrichmentStatus({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'error') { setError(event.message); return; }
        if (event.type === 'done') {
          const songs = parseSongs(event.songs);
          if (!songs) { setError('Import completed but returned invalid data.'); return; }
          setLibrary(songs);
          setLibraryName('Rekordbox collection (imported)');
          setError(null);
        }
      }, controller.signal);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Rekordbox import failed.');
    } finally {
      setEnrichmentStatus(null);
      abortControllerRef.current = null;
      setIsAnalyzing(false);
    }
  }, []);

  const runPathListAnalysis = useCallback(async (paths: string[], label: string) => {
    if (paths.length === 0) return;
    setIsAnalyzing(true);
    setAnalysisProgress({ completed: 0, total: 0 });
    setError(null);
    onNewAnalysisRef.current?.();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const response = await apiFetch('/api/analyze-paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, label }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Could not start analysis.');
      await streamAnalysis(response, (event) => {
        if (event.type === 'start') { setAnalysisProgress({ completed: 0, total: event.total }); return; }
        if (event.type === 'progress') { setAnalysisProgress({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'enriching') { setEnrichmentStatus({ completed: 0, total: 0 }); return; }
        if (event.type === 'enrich_progress') { setEnrichmentStatus({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'error') { setError(event.message); return; }
        if (event.type === 'done') {
          const songs = parseSongs(event.songs);
          if (!songs) { setError('Analysis completed but returned invalid song data.'); return; }
          setLibrary(songs);
          setLibraryName(`${event.libraryName} (analyzed)`);
          setError(null);
        }
      }, controller.signal);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setEnrichmentStatus(null);
      abortControllerRef.current = null;
      setIsAnalyzing(false);
    }
  }, []);

  const runFolderAnalysis = useCallback(async (path: string) => {
    if (!path.trim()) return;
    setIsAnalyzing(true);
    setAnalysisProgress({ completed: 0, total: 0 });
    setError(null);
    onNewAnalysisRef.current?.();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const response = await apiFetch('/api/analyze-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: path.trim() }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Could not start folder analysis.');
      await streamAnalysis(response, (event) => {
        if (event.type === 'start') { setAnalysisProgress({ completed: 0, total: event.total }); return; }
        if (event.type === 'progress') { setAnalysisProgress({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'enriching') { setEnrichmentStatus({ completed: 0, total: 0 }); return; }
        if (event.type === 'enrich_progress') { setEnrichmentStatus({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'error') { setError(event.message); return; }
        if (event.type === 'done') {
          const songs = parseSongs(event.songs);
          if (!songs) { setError('Analysis completed but returned invalid song data.'); return; }
          setLibrary(songs);
          setLibraryName(`${event.libraryName} (analyzed)`);
          setError(null);
        }
      }, controller.signal);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Folder analysis failed.');
    } finally {
      setEnrichmentStatus(null);
      abortControllerRef.current = null;
      setIsAnalyzing(false);
    }
  }, []);

  const runUploadAnalysis = useCallback(async (files: FileList) => {
    if (files.length === 0) return;
    setIsAnalyzing(true);
    setAnalysisProgress({ completed: 0, total: 0 });
    setError(null);
    onNewAnalysisRef.current?.();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) {
        const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        formData.append('files', file, relPath);
      }
      const response = await apiFetch('/api/analyze-upload', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Could not start upload analysis.');
      await streamAnalysis(response, (event) => {
        if (event.type === 'start') { setAnalysisProgress({ completed: 0, total: event.total }); return; }
        if (event.type === 'progress') { setAnalysisProgress({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'enriching') { setEnrichmentStatus({ completed: 0, total: 0 }); return; }
        if (event.type === 'enrich_progress') { setEnrichmentStatus({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'error') { setError(event.message); return; }
        if (event.type === 'done') {
          const songs = parseSongs(event.songs);
          if (!songs) { setError('Analysis completed but returned invalid data.'); return; }
          setLibrary(songs);
          setLibraryName(`${event.libraryName} (uploaded)`);
          setError(null);
        }
      }, controller.signal);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Upload analysis failed.');
    } finally {
      setEnrichmentStatus(null);
      abortControllerRef.current = null;
      setIsAnalyzing(false);
    }
  }, []);

  const runM3uWebImport = useCallback(async (tracks: Array<{ artist: string; title: string }>, label: string) => {
    if (tracks.length === 0) return;
    setIsAnalyzing(true);
    setAnalysisProgress({ completed: 0, total: 0 });
    setError(null);
    onNewAnalysisRef.current?.();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const response = await apiFetch('/api/import-m3u-web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks, label }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Could not start import.');
      await streamAnalysis(response, (event) => {
        if (event.type === 'start') { setAnalysisProgress({ completed: 0, total: event.total }); return; }
        if (event.type === 'progress') { setAnalysisProgress({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'enriching') { setEnrichmentStatus({ completed: 0, total: 0 }); return; }
        if (event.type === 'enrich_progress') { setEnrichmentStatus({ completed: event.completed, total: event.total }); return; }
        if (event.type === 'error') { setError(event.message); return; }
        if (event.type === 'done') {
          const songs = parseSongs(event.songs);
          if (!songs || songs.length === 0) { setError('No tracks could be matched on Spotify. Check that Spotify credentials are configured in Settings.'); return; }
          setLibrary(songs);
          setLibraryName(`${event.libraryName} (imported)`);
          setError(null);
        }
      }, controller.signal);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'M3U import failed.');
    } finally {
      setEnrichmentStatus(null);
      abortControllerRef.current = null;
      setIsAnalyzing(false);
    }
  }, []);

  return {
    library,
    setLibrary,
    libraryName,
    isAnalyzing,
    analysisProgress,
    enrichmentStatus,
    analysisQueue,
    folderPath,
    setFolderPath,
    playlistPicker,
    setPlaylistPicker,
    loadingPlaylists,
    analyzedApplePlaylists,
    setAnalyzedApplePlaylists,
    error,
    openPlaylistPicker,
    cancelAnalysis,
    cancelQueueItem,
    runAppleMusicAnalysis,
    runFolderAnalysis,
    runPathListAnalysis,
    runRekordboxImport,
    runUploadAnalysis,
    runM3uWebImport,
  };
}
