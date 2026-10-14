import { useCallback, useEffect, useRef, useState } from "react";
import type { AppleMusicExportResult, Playlist, PlaylistLibrary } from "../types";
import * as P from "../lib/playlists";
import { applyAppleMusicResult } from "../lib/appleMusicExport";
import { fetchPlaylistLibrary, savePlaylistLibrary } from "../services/playlistsApi";

const SAVE_DELAY_MS = 400;

const newId = () => crypto.randomUUID();

/** DJFriend-owned playlists: loaded from the server once, saved shortly after each change. */
export function usePlaylists() {
  const [lib, setLib] = useState<PlaylistLibrary>(P.EMPTY_PLAYLIST_LIBRARY);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const latest = useRef(lib);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPlaylistLibrary()
      .then(l => { if (alive) setLib(l); })
      .catch(() => { /* start empty — first save creates the file */ })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!dirty.current) return;
    dirty.current = false;
    savePlaylistLibrary(latest.current)
      .then(() => setSaveError(null))
      .catch(err => setSaveError(err instanceof Error ? err.message : "Saving playlists failed"));
  }, []);

  // Save after edits settle, and before the window closes
  useEffect(() => {
    latest.current = lib;
    if (!loaded || !dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [lib, loaded, flush]);
  useEffect(() => {
    window.addEventListener("beforeunload", flush);
    return () => { window.removeEventListener("beforeunload", flush); flush(); };
  }, [flush]);

  const update = useCallback((fn: (l: PlaylistLibrary) => PlaylistLibrary) => {
    setLib(prev => {
      const next = fn(prev);
      if (next !== prev) dirty.current = true;
      return next;
    });
  }, []);

  /** Creates a playlist and returns its id. */
  const createPlaylist = useCallback((name: string, opts: { folderId?: string; tracks?: string[]; source?: Playlist["source"] } = {}): string => {
    const id = newId();
    update(l => P.createPlaylist(l, { id, name, now: Date.now(), ...opts }));
    return id;
  }, [update]);

  const createFolder = useCallback((name: string, parentId?: string): string => {
    const id = newId();
    update(l => P.createFolder(l, { id, name, parentId }));
    return id;
  }, [update]);

  return {
    library: lib,
    loaded,
    saveError,
    createPlaylist,
    createFolder,
    renamePlaylist:   useCallback((id: string, name: string) => update(l => P.renamePlaylist(l, id, name, Date.now())), [update]),
    deletePlaylist:   useCallback((id: string) => update(l => P.deletePlaylist(l, id)), [update]),
    duplicatePlaylist: useCallback((id: string) => update(l => P.duplicatePlaylist(l, id, newId(), Date.now())), [update]),
    addTracks:        useCallback((id: string, files: string[], index?: number) => update(l => P.addTracks(l, id, files, Date.now(), index)), [update]),
    removeTracks:     useCallback((id: string, files: string[]) => update(l => P.removeTracks(l, id, files, Date.now())), [update]),
    moveTracks:       useCallback((id: string, files: string[], toIndex: number) => update(l => P.moveTracks(l, id, files, toIndex, Date.now())), [update]),
    movePlaylistToFolder: useCallback((id: string, folderId: string | undefined) => update(l => P.movePlaylistToFolder(l, id, folderId, Date.now())), [update]),
    renameFolder:     useCallback((id: string, name: string) => update(l => P.renameFolder(l, id, name)), [update]),
    deleteFolder:     useCallback((id: string) => update(l => P.deleteFolder(l, id)), [update]),
    toggleFolder:     useCallback((id: string) => update(l => P.toggleFolder(l, id)), [update]),
    moveFolder:       useCallback((id: string, parentId: string | undefined) => update(l => P.moveFolder(l, id, parentId)), [update]),
    applyAppleMusicResult: useCallback((result: AppleMusicExportResult) => update(l => applyAppleMusicResult(l, result)), [update]),
  };
}

export type PlaylistsApi = ReturnType<typeof usePlaylists>;
