import { useCallback, useEffect, useRef, useState } from "react";
import type { Song } from "../types";
import * as Q from "../lib/playQueue";

const VOLUME_KEY = "djfriend:playerVolume";

/** Tracks the player can play: they need a local file (vinyl-only and streaming-only records can't). */
export function playable(song: Song | undefined): song is Song & { filePath: string } {
  return !!song?.filePath && !song.vinylOnly && !song.spotifyOnly;
}

/** App-wide music player: one audio element, a play queue, shuffle/repeat, and macOS media keys. */
export function usePlayer(songsByFile: Map<string, Song>) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueue] = useState<Q.PlayQueue>(Q.EMPTY_QUEUE);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(() => {
    try { const v = Number(localStorage.getItem(VOLUME_KEY)); return v > 0 && v <= 1 ? v : 0.9; } catch { return 0.9; }
  });
  const queueRef = useRef(queue);
  const autoplay = useRef(false);

  const currentFile = Q.current(queue);
  const currentSong = currentFile ? songsByFile.get(currentFile) ?? null : null;

  // One audio element for the whole app, created on first use
  const audio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = "auto";
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  const updateQueue = useCallback((fn: (q: Q.PlayQueue) => Q.PlayQueue, play = false) => {
    const next = fn(queueRef.current);
    if (next === queueRef.current) return;
    if (play) autoplay.current = true;
    queueRef.current = next;
    setQueue(next);
  }, []);

  // Wire audio events once
  useEffect(() => {
    const el = audio();
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setTime(el.currentTime);
    const onDur = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onWait = () => setLoading(true);
    const onReady = () => setLoading(false);
    const onEnded = () => {
      const q = queueRef.current;
      if (q.repeat === "one") { el.currentTime = 0; void el.play(); return; }
      const n = Q.next(q, { auto: true });
      if (n === q) { setPlaying(false); return; }
      autoplay.current = true;
      queueRef.current = n;
      setQueue(n);
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("durationchange", onDur);
    el.addEventListener("waiting", onWait);
    el.addEventListener("loadstart", onWait);
    el.addEventListener("canplay", onReady);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("durationchange", onDur);
      el.removeEventListener("waiting", onWait);
      el.removeEventListener("loadstart", onWait);
      el.removeEventListener("canplay", onReady);
      el.removeEventListener("ended", onEnded);
      el.pause();
    };
  }, [audio]);

  useEffect(() => { audio().volume = volume; }, [audio, volume]);

  // Load the current track when it changes
  const loadedFile = useRef<string | null>(null);
  useEffect(() => {
    const el = audio();
    if (currentFile === loadedFile.current) {
      if (autoplay.current) { autoplay.current = false; void el.play().catch(() => {}); }
      return;
    }
    loadedFile.current = currentFile;
    if (!currentSong || !playable(currentSong)) { el.removeAttribute("src"); el.load(); return; }
    el.src = `/api/audio-stream?path=${encodeURIComponent(currentSong.filePath)}`;
    if (autoplay.current) { autoplay.current = false; void el.play().catch(() => {}); }
  }, [audio, currentFile, currentSong]);

  // macOS Now Playing + media keys
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = currentSong
      ? new MediaMetadata({ title: currentSong.title, artist: currentSong.artist, album: "DJFriend" })
      : null;
  }, [currentSong]);

  const toPlayable = useCallback((files: string[]) => files.filter(f => playable(songsByFile.get(f))), [songsByFile]);

  const controls = {
    /** Replaces the queue with these tracks and starts playing at `start`. */
    playTracks: useCallback((files: string[], start = 0) => {
      const ok = toPlayable(files);
      const startFile = files[start];
      const at = Math.max(0, ok.indexOf(startFile));
      updateQueue(q => Q.playList(q, ok, at, Date.now()), true);
      // Same track as before → updateQueue sees no change; restart it
      if (queueRef.current.items[queueRef.current.index] === startFile && loadedFile.current === startFile) {
        const el = audio(); el.currentTime = 0; void el.play().catch(() => {});
      }
    }, [toPlayable, updateQueue, audio]),
    playNext: useCallback((files: string[]) => updateQueue(q => Q.playNext(q, toPlayable(files)), queueRef.current.index < 0), [toPlayable, updateQueue]),
    playLater: useCallback((files: string[]) => updateQueue(q => Q.playLater(q, toPlayable(files)), queueRef.current.index < 0), [toPlayable, updateQueue]),
    toggle: useCallback(() => {
      const el = audio();
      if (!Q.current(queueRef.current)) return;
      if (el.paused) void el.play().catch(() => {}); else el.pause();
    }, [audio]),
    pause: useCallback(() => audio().pause(), [audio]),
    next: useCallback(() => updateQueue(q => Q.next(q), true), [updateQueue]),
    prev: useCallback(() => {
      const el = audio();
      // Like most players: past 3 seconds, "previous" restarts the track
      if (el.currentTime > 3) { el.currentTime = 0; return; }
      updateQueue(q => Q.prev(q), true);
    }, [audio, updateQueue]),
    seek: useCallback((seconds: number) => { const el = audio(); if (Number.isFinite(seconds)) el.currentTime = seconds; }, [audio]),
    setVolume: useCallback((v: number) => {
      const clamped = Math.max(0, Math.min(1, v));
      setVolumeState(clamped);
      try { localStorage.setItem(VOLUME_KEY, String(clamped)); } catch { /* ignore */ }
    }, []),
    jumpTo: useCallback((index: number) => updateQueue(q => Q.jumpTo(q, index), true), [updateQueue]),
    removeAt: useCallback((index: number) => updateQueue(q => Q.removeAt(q, index)), [updateQueue]),
    move: useCallback((from: number, to: number) => updateQueue(q => Q.moveInQueue(q, from, to)), [updateQueue]),
    clearUpNext: useCallback(() => updateQueue(q => Q.clearUpNext(q)), [updateQueue]),
    toggleShuffle: useCallback(() => updateQueue(q => Q.toggleShuffle(q, Date.now())), [updateQueue]),
    cycleRepeat: useCallback(() => updateQueue(q => Q.cycleRepeat(q)), [updateQueue]),
    stop: useCallback(() => { audio().pause(); updateQueue(() => Q.EMPTY_QUEUE); }, [audio, updateQueue]),
  };

  // Media keys (play/pause, next, previous) and the macOS Now Playing widget
  const { toggle, next, prev, seek } = controls;
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", toggle);
    ms.setActionHandler("pause", toggle);
    ms.setActionHandler("nexttrack", next);
    ms.setActionHandler("previoustrack", prev);
    ms.setActionHandler("seekto", d => { if (d.seekTime != null) seek(d.seekTime); });
    return () => {
      for (const a of ["play", "pause", "nexttrack", "previoustrack", "seekto"] as const) {
        try { ms.setActionHandler(a, null); } catch { /* unsupported */ }
      }
    };
  }, [toggle, next, prev, seek]);

  return {
    queue,
    currentSong,
    playing,
    loading,
    time,
    duration,
    volume,
    hasNext: Q.hasNext(queue),
    hasPrev: Q.hasPrev(queue) || time > 3,
    ...controls,
  };
}

export type Player = ReturnType<typeof usePlayer>;
