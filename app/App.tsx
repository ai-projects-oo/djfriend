import { useState, useCallback, useEffect, useRef } from 'react';
import type { Song, SetTrack, DJPreferences, CurvePoint } from './types';
import { generateSet } from './lib/setGenerator';
import { camelotHarmonyScore, isHarmonicWarning } from './lib/camelot';
import EnergyCurveEditor, { DEFAULT_CURVE } from './components/EnergyCurveEditor';
import PreferencesForm from './components/PreferencesForm';
import SetTracklist from './components/SetTracklist';

const DEFAULT_PREFS: DJPreferences = {
  setDuration: 60,
  venueType: 'Club',
  audienceAgeRange: '25–35',
  audiencePurpose: 'Dancing',
  occasionType: 'Peak time',
};

function isValidSong(obj: unknown): obj is Song {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o['file'] === 'string' &&
    typeof o['artist'] === 'string' &&
    typeof o['title'] === 'string' &&
    typeof o['bpm'] === 'number' &&
    typeof o['key'] === 'string' &&
    typeof o['camelot'] === 'string' &&
    typeof o['energy'] === 'number' &&
    Array.isArray(o['genres'])
  );
}

function parseSongs(raw: unknown): Song[] | null {
  const source = Array.isArray(raw)
    ? raw
    : (typeof raw === 'object' && raw !== null ? Object.values(raw as Record<string, unknown>) : null);
  if (!source) return null;
  const valid = source.filter(isValidSong);
  return valid.length > 0 ? valid : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export default function App() {
  const [library, setLibrary] = useState<Song[]>([]);
  const [libraryName, setLibraryName] = useState<string>('');
  const [prefs, setPrefs] = useState<DJPreferences>(DEFAULT_PREFS);
  const [curve, setCurve] = useState<CurvePoint[]>(DEFAULT_CURVE);
  const [generatedSet, setGeneratedSet] = useState<SetTrack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoRegen, setAutoRegen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ completed: number; total: number }>({
    completed: 0,
    total: 0,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swapHistoryRef = useRef<Map<number, Set<string>>>(new Map());

  // Auto-load /public/result.json on mount
  useEffect(() => {
    fetch('/results.json')
      .then((r) => {
        if (!r.ok) throw new Error('not found');
        return r.json() as Promise<unknown>;
      })
      .then((data) => {
        const songs = parseSongs(data);
        if (songs) {
          setLibrary(songs);
          setLibraryName('results.json (auto-loaded)');
          setError(null);
        }
      })
      .catch(() => {
        // Silently ignore — user can load manually
      });
  }, []);

  const runAppleMusicAnalysis = useCallback(async () => {
    setIsAnalyzing(true);
    setAnalysisProgress({ completed: 0, total: 0 });
    setError(null);
    setGeneratedSet([]);

    try {
      const response = await fetch('/api/analyze-apple-music', {
        method: 'POST',
      });

      if (!response.ok || !response.body) {
        throw new Error('Could not start folder analysis.');
      }

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

          if (event.type === 'start') {
            setAnalysisProgress({ completed: 0, total: event.total });
            continue;
          }

          if (event.type === 'progress') {
            setAnalysisProgress({ completed: event.completed, total: event.total });
            continue;
          }

          if (event.type === 'error') {
            setError(event.message);
            continue;
          }

          if (event.type === 'done') {
            const songs = parseSongs(event.songs);
            if (!songs) {
              setError('Analysis completed but returned invalid song data.');
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
      const message = err instanceof Error ? err.message : 'Folder analysis failed.';
      setError(message);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const runGenerate = useCallback(
    (songs: Song[], p: DJPreferences, c: CurvePoint[]) => {
      if (songs.length === 0) return;
      const set = generateSet(songs, p, c);
      swapHistoryRef.current = new Map();
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

  const handleSwapTrack = useCallback(
    (index: number) => {
      setGeneratedSet((prev) => {
        if (index < 0 || index >= prev.length) return prev;
        const current = prev[index];

        const usedFiles = new Set(
          prev.filter((_, i) => i !== index).map((track) => track.file),
        );
        const candidates = library.filter((song) => !usedFiles.has(song.file) && song.file !== current.file);
        if (candidates.length === 0) return prev;

        const previousTrack = index > 0 ? prev[index - 1] : null;
        const nextTrack = index < prev.length - 1 ? prev[index + 1] : null;

        const scored = candidates.map((candidate) => {
          const energyScore = 1 - Math.abs(candidate.energy - current.targetEnergy);
          const fromPrevHarmony = previousTrack
            ? camelotHarmonyScore(previousTrack.camelot, candidate.camelot)
            : 1;
          const toNextHarmony = nextTrack
            ? camelotHarmonyScore(candidate.camelot, nextTrack.camelot)
            : 1;
          const fromPrevBpm = previousTrack
            ? 1 - clamp(Math.abs(candidate.bpm - previousTrack.bpm) / 20, 0, 1)
            : 1;
          const toNextBpm = nextTrack
            ? 1 - clamp(Math.abs(candidate.bpm - nextTrack.bpm) / 20, 0, 1)
            : 1;

          const score =
            energyScore * 0.45 +
            fromPrevHarmony * 0.2 +
            toNextHarmony * 0.2 +
            fromPrevBpm * 0.075 +
            toNextBpm * 0.075;

          return { candidate, score };
        });

        scored.sort((a, b) => b.score - a.score);

        let tried = swapHistoryRef.current.get(index);
        if (!tried) {
          tried = new Set<string>();
          swapHistoryRef.current.set(index, tried);
        }

        let bestCandidate = scored.find(({ candidate }) => !tried.has(candidate.file))?.candidate ?? null;
        if (!bestCandidate) {
          tried.clear();
          bestCandidate = scored[0]?.candidate ?? null;
        }

        if (!bestCandidate) return prev;
        tried.add(bestCandidate.file);

        const next = [...prev];
        next[index] = {
          ...bestCandidate,
          slot: current.slot,
          targetEnergy: current.targetEnergy,
          harmonicWarning: previousTrack
            ? isHarmonicWarning(previousTrack.camelot, bestCandidate.camelot)
            : false,
        };

        if (index + 1 < next.length) {
          const after = next[index + 1];
          next[index + 1] = {
            ...after,
            harmonicWarning: isHarmonicWarning(next[index].camelot, after.camelot),
          };
        }

        return next;
      });
    },
    [library],
  );

  const progressPercent =
    analysisProgress.total > 0
      ? Math.min(100, Math.round((analysisProgress.completed / analysisProgress.total) * 100))
      : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#e2e8f0]">
      {/* Header */}
      <header className="border-b border-[#1e1e2e] bg-[#0a0a0f] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🎧</span>
            <span className="font-bold text-lg tracking-tight text-[#e2e8f0]">DJFriend</span>
            {libraryName && (
              <span className="hidden sm:inline text-xs text-[#475569] bg-[#12121a] border border-[#2a2a3a] px-2 py-0.5 rounded">
                {libraryName} · {library.length} tracks
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {error && (
              <span className="text-xs text-[#ef4444] hidden sm:inline">{error}</span>
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
              onClick={runAppleMusicAnalysis}
              disabled={isAnalyzing}
              className="px-3 py-1.5 text-sm rounded-md border border-[#2a2a3a] bg-[#12121a] text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAnalyzing ? 'Analyzing…' : 'Analyze Apple Music'}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="sm:hidden px-4 pt-3">
          <p className="text-xs text-[#ef4444]">{error}</p>
        </div>
      )}

      {library.length === 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
          <div className="rounded-lg border border-[#2a2a3a] bg-[#12121a] px-5 py-4 text-sm text-[#94a3b8]">
            No library loaded. Click{' '}
            <button
              onClick={runAppleMusicAnalysis}
              className="text-[#7c3aed] hover:underline cursor-pointer bg-transparent border-none p-0"
            >
              Analyze Apple Music
            </button>{' '}
            to analyze your local Apple Music file tracks and export <code className="text-[#e2e8f0]">results.json</code>.
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Preferences panel */}
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[#475569] mb-4">
              DJ Preferences
            </h2>
            <PreferencesForm
              prefs={prefs}
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
          </div>
        </div>

        {/* Generated Set panel */}
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[#475569] mb-4">
            Generated Set
          </h2>
          <SetTracklist tracks={generatedSet} prefs={prefs} onSwapTrack={handleSwapTrack} />
        </div>
      </main>
    </div>
  );
}
