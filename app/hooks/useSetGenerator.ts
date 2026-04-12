import { useState, useCallback, useRef, useMemo } from "react";
import type { Song, SetTrack, DJPreferences, CurvePoint } from "../types";
import { DEFAULT_PREFS, matchesGenrePref, genreMatchesUmbrella, TAG_GROUPS, BEATPORT_UMBRELLAS } from "../lib/genreUtils";
import { clamp } from "../lib/genreUtils";
import { DEFAULT_CURVE } from "../components/EnergyCurveEditor";
import { generateSet } from "../lib/setGenerator";
import { isHarmonicWarning, camelotHarmonyScore } from "../lib/camelot";

export function useSetGenerator(library: Song[], setLibrary: React.Dispatch<React.SetStateAction<Song[]>>, playlistFilterFiles?: Set<string>) {
  const [prefs, setPrefs] = useState<DJPreferences>(DEFAULT_PREFS);
  const [curve, setCurve] = useState<CurvePoint[]>(DEFAULT_CURVE);
  const [generatedSet, setGeneratedSet] = useState<SetTrack[]>([]);
  const [autoRegen, setAutoRegen] = useState(false);
  const [anchored, setAnchored] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [swapModal, setSwapModal] = useState<{
    index: number;
    suggestions: Array<{ song: Song; score: number }>;
  } | null>(null);
  const [swapVisibleCount, setSwapVisibleCount] = useState(5);

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
    setAutoRegen(true);
  }, [anchored, library, prefs, curve, runGenerate]);

  const handleRegenerate = useCallback(() => {
    if (anchored || library.length === 0) return;
    setGeneratedSet(generateSet(library, prefs, curve, { jitter: 0.4, playlistFilterFiles }));
    setAutoRegen(true);
  }, [anchored, library, prefs, curve, playlistFilterFiles]);

  const handleGenerateNew = useCallback(() => {
    if (anchored || library.length === 0) return;
    const excludeFiles = new Set(generatedSet.map(t => t.file));
    setGeneratedSet(generateSet(library, prefs, curve, { excludeFiles, jitter: 0.15, playlistFilterFiles }));
    setAutoRegen(true);
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
      if (!autoRegen || anchored || library.length === 0) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        runGenerate(library, prefs, newCurve);
      }, 150);
    },
    [autoRegen, anchored, library, prefs, runGenerate],
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
    setAutoRegen(false);
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
    autoRegen,
    setAutoRegen,
    anchored,
    setAnchored,
    debounceRef,
    swapModal,
    setSwapModal,
    swapVisibleCount,
    setSwapVisibleCount,
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
    handleReorderTrack,
    handleUpdateTrack,
    handleLoadToSet,
    handleAppendTracks,
  };
}
