import { useState, useCallback, useRef, useMemo } from "react";
import type { Song, SetTrack, DJPreferences, CurvePoint } from "../types";
import { DEFAULT_PREFS, matchesGenrePref, genreMatchesUmbrella, TAG_GROUPS, BEATPORT_UMBRELLAS } from "../lib/genreUtils";
import { clamp } from "../lib/genreUtils";
import { DEFAULT_CURVE } from "../components/EnergyCurveEditor";
import { generateSet, getAffinityKey, genreAffinityBonus, semanticAffinityBonus } from "../lib/setGenerator";
import { isHarmonicWarning, camelotHarmonyScore } from "../lib/camelot";

export interface SwapBreakdown {
  harmonicPrev: number | null;   // 0–1 camelot harmony score with previous track
  harmonicNext: number | null;   // 0–1 camelot harmony score with next track
  energyDelta: number;           // signed: candidate.energy – targetEnergy
  bpmDeltaPrev: number | null;   // signed BPM delta from previous track
  bpmDeltaNext: number | null;   // signed BPM delta from next track
  tagOverlap: boolean;           // candidate shares vibe/mood tags with neighbors
  venueFit: boolean;             // genre fits current venue/phase affinity
  hasSemanticTags: boolean;      // whether candidate has AI tags at all
}

export function useSetGenerator(library: Song[], setLibrary: React.Dispatch<React.SetStateAction<Song[]>>, playlistFilterFiles?: Set<string>) {
  const [prefs, setPrefs] = useState<DJPreferences>(DEFAULT_PREFS);
  const [curve, setCurve] = useState<CurvePoint[]>(DEFAULT_CURVE);
  const [generatedSet, setGeneratedSet] = useState<SetTrack[]>([]);
  const [anchored, setAnchored] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [swapModal, setSwapModal] = useState<{
    index: number;
    suggestions: Array<{ song: Song; breakdown: SwapBreakdown }>;
  } | null>(null);

  // Computed values derived from library — all memoized so they only recompute when library changes
  const availableGenres = useMemo(
    () => Array.from(new Set(library.flatMap((song) => song.genres).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [library],
  );

  // Genre groups: Beatport umbrella genres that have at least one matching song in the library
  const genreGroups = useMemo(
    () => BEATPORT_UMBRELLAS.filter(u => library.some(s => matchesGenrePref(s, `~${u.label}`))).map(u => u.label),
    [library],
  );

  const availableTags = useMemo(() => {
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

    // Cross-category dedup: if a tag leaks into multiple categories, keep it
    // only in the highest-priority one (vibe > mood > venue > time).
    const seen = new Set<string>();
    const dedup = (set: Set<string>) => [...set].filter(t => { if (seen.has(t)) return false; seen.add(t); return true; }).sort();
    const vibeArr  = dedup(vibe);
    const moodArr  = dedup(mood);
    const venueArr = dedup(venue);
    const timeArr  = dedup(time);
    const vocalArr = [...vocal].sort();

    // Parallel tag merging: within each category, if two tags ALWAYS co-occur
    // across every song that has either of them, merge them into "a / b".
    function mergeParallel(tags: string[], getTags: (s: Song) => string[]): string[] {
      if (tags.length < 2) return tags;
      const enriched = library.filter(s => s.semanticTags);
      const filesFor = (tag: string) => new Set(enriched.filter(s => getTags(s).includes(tag)).map(s => s.file));
      const fileSets = new Map(tags.map(t => [t, filesFor(t)]));
      const skip = new Set<string>();
      const result: string[] = [];
      for (let i = 0; i < tags.length; i++) {
        const a = tags[i];
        if (skip.has(a)) continue;
        const fa = fileSets.get(a)!;
        if (fa.size === 0) { result.push(a); continue; }
        let merged = false;
        for (let j = i + 1; j < tags.length; j++) {
          const b = tags[j];
          if (skip.has(b)) continue;
          const fb = fileSets.get(b)!;
          if (fb.size === 0) continue;
          const aAlwaysB = [...fa].every(f => fb.has(f));
          const bAlwaysA = [...fb].every(f => fa.has(f));
          if (aAlwaysB && bAlwaysA) {
            result.push(`${a} / ${b}`);
            skip.add(a); skip.add(b);
            merged = true; break;
          }
        }
        if (!merged) result.push(a);
      }
      return result.sort();
    }

    return {
      vibeTags:        mergeParallel(vibeArr,  s => s.semanticTags?.vibeTags ?? []),
      moodTags:        mergeParallel(moodArr,  s => s.semanticTags?.moodTags ?? []),
      vocalTypes:      vocalArr,
      venueTags:       mergeParallel(venueArr, s => s.semanticTags?.venueTags ?? []),
      timeOfNightTags: mergeParallel(timeArr,  s => s.semanticTags?.timeOfNightTags ?? []),
    };
  }, [library]);

  const GAP_SECONDS = 10;
  const FALLBACK_DURATION = 210;

  // How many tracks fit in the current set duration given the filtered pool
  const filteredTrackCount = useMemo(() => {
    const filtered = library.filter(s => matchesGenrePref(s, prefs.genre));
    const pool = filtered.length > 0 ? filtered : library;
    if (pool.length === 0) return 0;
    const avgDur = pool.reduce((sum, s) => sum + (s.duration ?? FALLBACK_DURATION), 0) / pool.length;
    return Math.max(1, Math.floor((prefs.setDuration * 60) / (avgDur + GAP_SECONDS)));
  }, [library, prefs.genre, prefs.setDuration]);

  // "Generate new" is enabled when the filtered pool has more tracks than fit in one set
  const canGenerateNew = library.length > 0 &&
    library.filter(s => matchesGenrePref(s, prefs.genre)).length > filteredTrackCount;

  const runGenerate = useCallback(
    (songs: Song[], p: DJPreferences, c: CurvePoint[], extraOpts?: { jitter?: number; excludeFiles?: Set<string> }) => {
      if (songs.length === 0) return;
      setGeneratedSet(generateSet(songs, p, c, { ...extraOpts, playlistFilterFiles }));
    },
    [playlistFilterFiles],
  );

  const handleGenerate = useCallback(() => {
    if (anchored) return;
    runGenerate(library, prefs, curve);

  }, [anchored, library, prefs, curve, runGenerate]);

  const handleRegenerate = useCallback(() => {
    if (anchored || library.length === 0) return;
    setGeneratedSet(generateSet(library, prefs, curve, { jitter: 0.4, playlistFilterFiles }));

  }, [anchored, library, prefs, curve, playlistFilterFiles]);

  const handleGenerateNew = useCallback(() => {
    if (anchored || library.length === 0) return;
    const excludeFiles = new Set(generatedSet.map(t => t.file));
    setGeneratedSet(generateSet(library, prefs, curve, { excludeFiles, jitter: 0.15, playlistFilterFiles }));

  }, [anchored, library, prefs, curve, generatedSet, playlistFilterFiles]);

  const selectGenre = useCallback((genre: string) => {
    if (genre === 'Any') {
      setPrefs(p => ({ ...p, genre: 'Any', tagFilters: { vibeTags: [], moodTags: [], vocalTypes: [], venueTags: [], timeOfNightTags: [] } }));
      return;
    }
    // For umbrella genres, only collect tags from songs whose genres belong
    // exclusively to this umbrella (not shared with another Beatport umbrella).
    const matching = library.filter(s =>
      matchesGenrePref(s, genre) &&
      s.semanticTags &&
      (!genre.startsWith('~') || s.genres.some(g => genreMatchesUmbrella(g, genre)))
    );
    const vibe = new Set<string>(), mood = new Set<string>(), vocal = new Set<string>();
    const venue = new Set<string>(), time = new Set<string>();
    for (const s of matching) {
      const t = s.semanticTags!;
      t.vibeTags.forEach(x => vibe.add(x));
      t.moodTags.forEach(x => mood.add(x));
      vocal.add(t.vocalType);
      t.venueTags.forEach(x => venue.add(x));
      t.timeOfNightTags.forEach(x => time.add(x));
    }
    setPrefs(p => ({ ...p, genre, tagFilters: {
      vibeTags: [...vibe],
      moodTags: [...mood],
      vocalTypes: [...vocal],
      venueTags: [...venue],
      timeOfNightTags: [...time],
    }}));
  }, [library]);

  const handleCurveChange = useCallback(
    (newCurve: CurvePoint[]) => {
      setCurve(newCurve);
    },
    [],
  );

  const buildSwapSuggestions = useCallback(
    (index: number): Array<{ song: Song; breakdown: SwapBreakdown }> => {
      if (index < 0 || index >= generatedSet.length) return [];
      const current = generatedSet[index];
      const usedFiles = new Set(
        generatedSet.filter((_, i) => i !== index).map((t) => t.file),
      );
      const prevTrack = index > 0 ? generatedSet[index - 1] : null;
      const nextTrack = index < generatedSet.length - 1 ? generatedSet[index + 1] : null;
      const affinityKey = getAffinityKey(prefs.venueType, prefs.setPhase);

      const candidates = library.filter(
        (s) => !usedFiles.has(s.file) && s.file !== current.file,
      );

      const scored = candidates.map((c) => {
        // ── Harmonic ──────────────────────────────────────────────
        const hPrev = prevTrack ? camelotHarmonyScore(prevTrack.camelot, c.camelot) : null;
        const hNext = nextTrack ? camelotHarmonyScore(c.camelot, nextTrack.camelot) : null;
        const harmonicScore = ((hPrev ?? 1) + (hNext ?? 1)) / 2;

        // ── Energy ────────────────────────────────────────────────
        const eDelta = c.energy - current.targetEnergy;
        const energyScore = 1 - Math.abs(eDelta);

        // ── BPM ───────────────────────────────────────────────────
        const bDeltaPrev = prevTrack ? c.bpm - prevTrack.bpm : null;
        const bDeltaNext = nextTrack ? c.bpm - nextTrack.bpm : null;
        const bpmScore =
          ((bDeltaPrev !== null ? 1 - clamp(Math.abs(bDeltaPrev) / 20, 0, 1) : 1) +
           (bDeltaNext !== null ? 1 - clamp(Math.abs(bDeltaNext) / 20, 0, 1) : 1)) / 2;

        // ── Semantic tags ─────────────────────────────────────────
        const venueFit = affinityKey ? genreAffinityBonus(c, affinityKey) > 0 : true;
        const semBonus = semanticAffinityBonus(c, prefs.venueType, prefs.setPhase);

        // Tag overlap with neighboring tracks (vibe + mood)
        let tagOverlap = false;
        if (c.semanticTags) {
          for (const neighbor of [prevTrack, nextTrack]) {
            if (!neighbor?.semanticTags) continue;
            const sharedVibe = c.semanticTags.vibeTags.some(t => neighbor.semanticTags!.vibeTags.includes(t));
            const sharedMood = c.semanticTags.moodTags.some(t => neighbor.semanticTags!.moodTags.includes(t));
            if (sharedVibe || sharedMood) { tagOverlap = true; break; }
          }
        }
        const semanticScore = semBonus + (tagOverlap ? 0.1 : 0);

        // ── Composite score ───────────────────────────────────────
        const score =
          energyScore   * 0.35 +
          harmonicScore * 0.35 +
          bpmScore      * 0.20 +
          semanticScore * 0.10;

        const breakdown: SwapBreakdown = {
          harmonicPrev: hPrev,
          harmonicNext: hNext,
          energyDelta: eDelta,
          bpmDeltaPrev: bDeltaPrev,
          bpmDeltaNext: bDeltaNext,
          tagOverlap,
          venueFit,
          hasSemanticTags: Boolean(c.semanticTags),
        };

        return { candidate: c, score, breakdown };
      });

      // Minimum quality floor: exclude candidates that score poorly across all dimensions.
      // A score below 0.45 means the track fails most signals — not worth suggesting.
      const MIN_SCORE = 0.45;
      return scored
        .filter(s => s.score >= MIN_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(({ candidate, breakdown }) => ({ song: candidate, breakdown }));
    },
    [generatedSet, library, prefs],
  );

  const handleSwapTrack = useCallback(
    (index: number) => {
      setSwapModal({ index, suggestions: buildSwapSuggestions(index) });
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
    },
    [swapModal],
  );

  const handleLoadToSet = useCallback((songs: Song[]) => {
    if (songs.length === 0) return;
    const tracks: SetTrack[] = songs.map((song, i) => ({
      ...song,
      slot: i,
      targetEnergy: song.energy,
      harmonicWarning: i > 0 ? isHarmonicWarning(songs[i - 1].camelot, song.camelot) : false,
    }));
    setGeneratedSet(tracks);
    setAnchored(true);

  }, []);

  const handleAppendTracks = useCallback(() => {
    if (library.length === 0) return;
    const FALLBACK_DURATION = 210;
    const GAP = 10;
    const currentSeconds = generatedSet.reduce((s, t) => s + (t.duration ?? FALLBACK_DURATION) + GAP, 0);
    const budgetSeconds = prefs.setDuration * 60;
    const remainingSeconds = budgetSeconds - currentSeconds;
    if (remainingSeconds <= 0) return;
    const excludeFiles = new Set(generatedSet.map(t => t.file));
    const appended = generateSet(library, prefs, curve, {
      excludeFiles,
      jitter: 0.15,
      playlistFilterFiles,
      maxDurationSeconds: remainingSeconds,
    });
    if (appended.length === 0) return;
    setGeneratedSet(prev => {
      const combined = [...prev, ...appended];
      return combined.map((track, i) => ({
        ...track,
        slot: i,
        harmonicWarning: i > 0 ? isHarmonicWarning(combined[i - 1].camelot, track.camelot) : false,
      }));
    });
  }, [library, prefs, curve, generatedSet, playlistFilterFiles]);

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

  const handleRemoveTracks = useCallback((indices: number[]) => {
    setGeneratedSet((prev) => {
      const toRemove = new Set(indices);
      const next = prev.filter((_, i) => !toRemove.has(i));
      return next.map((track, i) => ({
        ...track,
        slot: i,
        harmonicWarning:
          i > 0 ? isHarmonicWarning(next[i - 1].camelot, track.camelot) : false,
      }));
    });
  }, []);

  const handleReorderTrack = useCallback((fromIdx: number, toIdx: number) => {
    setGeneratedSet(prev => {
      if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= prev.length || toIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next.map((track, i) => ({
        ...track,
        slot: i,
        harmonicWarning: i > 0 ? isHarmonicWarning(next[i - 1].camelot, track.camelot) : false,
      }));
    });
  }, []);

  const handleUpdateTrack = useCallback((index: number, tags: { title?: string; artist?: string; genre?: string; bpm?: number; camelot?: string; key?: string }) => {
    const patch = {
      ...(tags.title !== undefined ? { title: tags.title } : {}),
      ...(tags.artist !== undefined ? { artist: tags.artist } : {}),
      ...(tags.genre !== undefined ? {
        genres: tags.genre ? tags.genre.split(',').map(g => g.trim()).filter(Boolean) : [],
        genresFromSpotify: false,
      } : {}),
      ...(tags.bpm !== undefined ? { bpm: tags.bpm } : {}),
      ...(tags.camelot !== undefined ? { camelot: tags.camelot } : {}),
      ...(tags.key !== undefined ? { key: tags.key } : {}),
    };
    setGeneratedSet(prev => {
      if (index < 0 || index >= prev.length) return prev;
      return prev.map((t, i) => i === index ? { ...t, ...patch } : t);
    });
    const fileKey = generatedSet[index]?.file;
    if (fileKey) {
      setLibrary(prev => prev.map(s => s.file === fileKey ? { ...s, ...patch } : s));
    }
  }, [generatedSet, setLibrary]);

  return {
    prefs,
    setPrefs,
    curve,
    setCurve,
    generatedSet,
    setGeneratedSet,
    anchored,
    setAnchored,
    debounceRef,
    swapModal,
    setSwapModal,
    availableGenres,
    genreGroups,
    availableTags,
    TAG_GROUPS,
    filteredTrackCount,
    canGenerateNew,
    runGenerate,
    handleGenerate,
    handleRegenerate,
    handleGenerateNew,
    selectGenre,
    handleCurveChange,
    buildSwapSuggestions,
    handleSwapTrack,
    applySwapSuggestion,
    handleRemoveTrack,
    handleRemoveTracks,
    handleReorderTrack,
    handleUpdateTrack,
    handleLoadToSet,
    handleAppendTracks,
  };
}
