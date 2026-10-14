import { useState, useCallback, useEffect, useRef } from "react";
import type { Song } from "../types";
import { parseSongs } from "../lib/genreUtils";
import { apiFetch } from "../services/apiFetch";
import { STATUS_FADE_MS } from "../components/LoaderStatus";

interface UseLibraryOptions {
  onNewAnalysis?: () => void;
}

type AnalysisEvent =
  | { type: 'start'; total: number }
  | { type: 'progress'; completed: number; total: number }
  | { type: 'folder_done'; folder: string }
  | { type: 'enriching'; message: string }
  | { type: 'enrich_progress'; completed: number; total: number }
  | { type: 'done'; songs: unknown; libraryName: string; resultsJson: Record<string, unknown>; playlistFiles?: string[] }
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
  bpmHint?: { min: number; max: number };
}

export function useLibrary({ onNewAnalysis }: UseLibraryOptions = {}) {
  const onNewAnalysisRef = useRef(onNewAnalysis);
  useEffect(() => { onNewAnalysisRef.current = onNewAnalysis; }, [onNewAnalysis]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isAnalyzingRef = useRef(false);
  const currentPlaylistRef = useRef<string | null>(null);
  const analysisQueueRef = useRef<QueueItem[]>([]);
  const runAppleMusicInternalRef = useRef<(name: string, bpmHint?: { min: number; max: number }) => Promise<void>>(null!);

  const [library, setLibrary] = useState<Song[]>([]);
  const [libraryName, setLibraryName] = useState<string>("");
  const [isInitializing, setIsInitializing] = useState(true); // true until the startup fetch resolves
  const [initStatus, setInitStatus] = useState<{ label: string; detail?: string }>({ label: "Starting up…" });
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
  // Map of Apple Music playlist name → file paths (tracks in that playlist)
  const [applePlaylistFiles, setApplePlaylistFiles] = useState<Record<string, string[]>>(() => {
    try {
      const raw = localStorage.getItem("djfriend-apple-playlist-files");
      return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    } catch { return {}; }
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("djfriend-analyzed-apple-playlists", JSON.stringify([...analyzedApplePlaylists]));
  }, [analyzedApplePlaylists]);
  useEffect(() => {
    localStorage.setItem("djfriend-apple-playlist-files", JSON.stringify(applePlaylistFiles));
  }, [applePlaylistFiles]);

  // Background patches (backfill, tag re-derive, waveform upgrade) are queued and applied to the
  // library at most once per PATCH_FLUSH_MS — each setLibrary re-renders the whole app.
  const PATCH_FLUSH_MS = 1000;
  const pendingPatchesRef = useRef<Map<string, Partial<Song>>>(new Map());
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueSongPatch = useCallback((key: string, patch: Partial<Song>) => {
    const pending = pendingPatchesRef.current;
    pending.set(key, { ...pending.get(key), ...patch });
    if (patchTimerRef.current) return;
    patchTimerRef.current = setTimeout(() => {
      patchTimerRef.current = null;
      const batch = pendingPatchesRef.current;
      pendingPatchesRef.current = new Map();
      setLibrary(prev => prev.map(s => {
        const p = batch.get(s.filePath ?? s.file);
        return p ? { ...s, ...p } : s;
      }));
    }, PATCH_FLUSH_MS);
  }, []);
  useEffect(() => () => { if (patchTimerRef.current) clearTimeout(patchTimerRef.current); }, []);

  // After library loads, stream missing comment/year from ID3 tags and merge into state
  const runBackfill = useCallback((loaded: Song[]) => {
    if (loaded.length === 0) return;
    const MIN_TS = 946684800; // 2000-01-01
    const hasMissing = loaded.some(s => !s.comment || s.year == null || s.dateAdded == null || s.dateAdded < MIN_TS);
    if (!hasMissing) return;
    apiFetch("/api/backfill-meta")
      .then(r => {
        if (!r.ok || !r.body) return;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        const pump = (): Promise<void> => reader.read().then(({ done, value }) => {
          if (done) return;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          const patches: Array<{ filePath: string; comment?: string; year?: number; duration?: number; dateAdded?: number }> = [];
          for (const line of lines) {
            if (!line.trim()) continue;
            try { patches.push(JSON.parse(line) as { filePath: string; comment?: string; year?: number; duration?: number; dateAdded?: number }); } catch { /* skip */ }
          }
          for (const p of patches) {
            queueSongPatch(p.filePath, { ...(p.comment ? { comment: p.comment } : {}), ...(p.year != null ? { year: p.year } : {}), ...(p.duration != null ? { duration: p.duration } : {}), ...(p.dateAdded != null ? { dateAdded: p.dateAdded } : {}) });
          }
          return pump();
        });
        return pump();
      })
      .catch(() => {});
  }, [queueSongPatch]);

  // Silently re-analyze tracks that have low-resolution waveforms (< 1000 pts = old 400-pt data)
  const runWaveformUpgrade = useCallback((loaded: Song[]) => {
    const stale = loaded.filter(s => s.filePath && (!s.waveform || s.waveform.length < 1000));
    if (stale.length === 0) return;
    const CONCURRENCY = 3;
    let idx = 0;
    const next = async (): Promise<void> => {
      if (idx >= stale.length) return;
      const song = stale[idx++];
      try {
        const res = await apiFetch('/api/reanalyze-track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: song.filePath }) });
        if (!res.ok) return next();
        const d = await res.json() as { ok?: boolean; waveform?: number[]; frequencyWaveform?: { bass: number[]; mid: number[]; high: number[] }; vocalTimeline?: number[] };
        if (d.ok && (d.waveform || d.frequencyWaveform)) {
          queueSongPatch(song.filePath ?? song.file, { ...(d.waveform ? { waveform: d.waveform } : {}), ...(d.frequencyWaveform ? { frequencyWaveform: d.frequencyWaveform } : {}), ...(d.vocalTimeline ? { vocalTimeline: d.vocalTimeline } : {}) });
        }
      } catch { /* non-fatal */ }
      return next();
    };
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, stale.length) }, next));
  }, [queueSongPatch]);

  // Re-derive semantic tags using current rule set — streams patches for in-memory update
  const runRederive = useCallback(() => {
    apiFetch("/api/rederive-tags", { method: "POST" })
      .then(r => {
        if (!r.ok || !r.body) return;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        const pump = (): Promise<void> => reader.read().then(({ done, value }) => {
          if (done) return;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          const patches: Array<{ filePath: string; semanticTags: Song["semanticTags"] }> = [];
          for (const line of lines) {
            if (!line.trim()) continue;
            try { patches.push(JSON.parse(line) as { filePath: string; semanticTags: Song["semanticTags"] }); } catch { /* skip */ }
          }
          for (const p of patches) {
            if (p.semanticTags !== undefined) queueSongPatch(p.filePath, { semanticTags: p.semanticTags });
          }
          return pump();
        });
        return pump();
      })
      .catch(() => {});
  }, [queueSongPatch]);

  // Auto-load saved library on mount
  useEffect(() => {
    const MB = 1024 * 1024;
    // Let the overlay paint (and finish its fade) before a step that blocks the UI thread
    const settle = () => new Promise<void>(r => setTimeout(r, STATUS_FADE_MS * 2));

    // Streams a results file, reporting download progress, then parses it
    const loadResults = async (url: string, label: string): Promise<Song[] | null> => {
      setInitStatus({ label: `Looking for ${label}…` });
      const r = await apiFetch(url);
      if (!r.ok || !r.body) return null;
      const total = Number(r.headers.get("Content-Length")) || 0;
      const reader = r.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      let lastMb = -1;
      setInitStatus({ label: `Loading ${label}` });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        const mb = Math.floor(received / MB);
        if (mb !== lastMb) {
          lastMb = mb;
          setInitStatus({ label: `Loading ${label}`, detail: total ? `${mb} of ${Math.ceil(total / MB)} MB` : `${mb} MB` });
        }
      }
      setInitStatus({ label: `Reading ${Math.max(1, Math.round(received / MB))} MB of track data…` });
      await settle();
      const text = new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
      const data = JSON.parse(text) as unknown;
      if (!data) return null;
      const songs = parseSongs(data);
      if (!songs || songs.length === 0) return null;
      setInitStatus({ label: `Preparing ${songs.length.toLocaleString()} tracks…` });
      await settle();
      return songs;
    };

    const load = async () => {
      const sources: Array<[string, string, string]> = [
        ["/results.json", "saved library", "results.json (auto-loaded)"],
        ["/api/apple-library", "Apple Music library", "Apple Music library (auto-loaded)"],
      ];
      for (const [url, label, name] of sources) {
        try {
          const songs = await loadResults(url, label);
          if (!songs) continue;
          setLibrary(songs);
          setLibraryName(name);
          setError(null);
          runBackfill(songs);
          runRederive();
          runWaveformUpgrade(songs);
          return;
        } catch { /* try next source */ }
      }
    };
    void load().finally(() => setIsInitializing(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  const runAppleMusicInternal = useCallback(async (playlistName: string, bpmHint?: { min: number; max: number }) => {
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
        body: JSON.stringify({ playlistName, bpmHint }),
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
          // Store which files belong to this playlist (from server response)
          if (event.playlistFiles && Array.isArray(event.playlistFiles)) {
            setApplePlaylistFiles(prev => ({ ...prev, [playlistName]: event.playlistFiles as string[] }));
          }
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
        void runAppleMusicInternalRef.current(next.playlistName, next.bpmHint);
      } else {
        isAnalyzingRef.current = false;
        setIsAnalyzing(false);
      }
    }
  }, []);

  // Keep ref up to date so drain loop always calls the latest closure
  useEffect(() => {
    runAppleMusicInternalRef.current = runAppleMusicInternal;
  }, [runAppleMusicInternal]);

  // Public: enqueue a playlist for analysis. `keepPickerOpen` is used by the per-row re-sync button.
  const runAppleMusicAnalysis = useCallback((playlistName: string, bpmHint?: { min: number; max: number }, opts?: { keepPickerOpen?: boolean }) => {
    if (analysisQueueRef.current.some(item => item.playlistName === playlistName)) return;

    const newItem: QueueItem = { playlistName, status: 'queued', completed: 0, total: 0, bpmHint };
    analysisQueueRef.current = [...analysisQueueRef.current, newItem];
    setAnalysisQueueState([...analysisQueueRef.current]);

    if (!opts?.keepPickerOpen) setPlaylistPicker(null);
    setError(null);
    onNewAnalysisRef.current?.();

    if (!isAnalyzingRef.current) {
      isAnalyzingRef.current = true;
      setIsAnalyzing(true);
      void runAppleMusicInternalRef.current(playlistName, bpmHint);
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
    if (tracks.length === 0) { setError('No valid tracks found in the Rekordbox XML. The file may be empty or use an unsupported format.'); return; }
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
          if (!songs || songs.length === 0) { setError('No tracks could be matched. Make sure Spotify is connected in Settings.'); return; }
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
    isInitializing,
    initStatus,
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
    applePlaylistFiles,
    setApplePlaylistFiles,
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
