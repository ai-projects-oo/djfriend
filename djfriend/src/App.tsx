import { useState, useCallback, useEffect, useRef } from 'react';
import type { Song, SetTrack, DJPreferences, CurvePoint } from './types';
import { generateSet } from './lib/setGenerator';
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
  if (!Array.isArray(raw)) return null;
  const valid = raw.filter(isValidSong);
  return valid.length > 0 ? valid : null;
}

export default function App() {
  const [library, setLibrary] = useState<Song[]>([]);
  const [libraryName, setLibraryName] = useState<string>('');
  const [prefs, setPrefs] = useState<DJPreferences>(DEFAULT_PREFS);
  const [curve, setCurve] = useState<CurvePoint[]>(DEFAULT_CURVE);
  const [generatedSet, setGeneratedSet] = useState<SetTrack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoRegen, setAutoRegen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleFileLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as unknown;
        const songs = parseSongs(parsed);
        if (!songs) {
          setError('Invalid JSON — expected an array of song objects.');
          return;
        }
        setLibrary(songs);
        setLibraryName(file.name);
        setError(null);
        setGeneratedSet([]);
      } catch {
        setError('Could not parse JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
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

  const fileInputRef = useRef<HTMLInputElement>(null);

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
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileLoad}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 text-sm rounded-md border border-[#2a2a3a] bg-[#12121a] text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer"
            >
              Load results.json
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
              onClick={() => fileInputRef.current?.click()}
              className="text-[#7c3aed] hover:underline cursor-pointer bg-transparent border-none p-0"
            >
              Load results.json
            </button>{' '}
            to get started, or add a{' '}
            <code className="text-[#e2e8f0]">results.json</code> to the{' '}
            <code className="text-[#e2e8f0]">public/</code> folder for auto-load.
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
          <SetTracklist tracks={generatedSet} prefs={prefs} />
        </div>
      </main>
    </div>
  );
}
