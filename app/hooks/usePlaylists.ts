import { useCallback, useEffect, useRef, useState } from "react";
import type { AppleMusicExportResult, Playlist, PlaylistLibrary, SmartCriteria } from "../types";
import * as P from "../lib/playlists";
import { applyAppleMusicResult } from "../lib/appleMusicExport";
import { fetchPlaylistLibrary, savePlaylistLibrary } from "../services/playlistsApi";

const SAVE_DELAY_MS = 400;
const UNDO_LIMIT = 30;

const newId = () => crypto.randomUUID();

/** Shown after an edit, with Undo when the edit can be undone. */
export interface PlaylistNotice { text: string; canUndo: boolean; nonce: number }

type Describe = string | ((before: PlaylistLibrary, after: PlaylistLibrary) => { text: string; changed: boolean } | null);

/** DJFriend-owned playlists: loaded from the server once, saved shortly after each change, with undo. */
export function usePlaylists() {
  const [lib, setLib] = useState<PlaylistLibrary>(P.EMPTY_PLAYLIST_LIBRARY);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<PlaylistNotice | null>(null);
  const [undoDepth, setUndoDepth] = useState(0);
  const latest = useRef(lib);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStack = useRef<PlaylistLibrary[]>([]);
  const loadedRef = useRef(false);

  // Edits and saves are only allowed after a successful load — otherwise the first save would
  // overwrite the playlists on disk with an empty (or partial) library.
  useEffect(() => {
    let alive = true;
    fetchPlaylistLibrary()
      .then(l => {
        if (!alive) return;
        latest.current = l;
        loadedRef.current = true;
        setLib(l);
        setLoaded(true);
      })
      .catch(err => {
        if (alive) setSaveError(`${err instanceof Error ? err.message : "Couldn't load playlists"} — restart DJFriend before editing playlists.`);
      });
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
    if (!loaded || !dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [lib, loaded, flush]);
  useEffect(() => {
    window.addEventListener("beforeunload", flush);
    return () => { window.removeEventListener("beforeunload", flush); flush(); };
  }, [flush]);

  /**
   * Applies an edit. Undoable edits push the previous library on the undo stack; `describe`
   * produces the notice shown afterwards (a fixed text, or one computed from before/after).
   */
  const update = useCallback((fn: (l: PlaylistLibrary) => PlaylistLibrary, opts: { undoable?: boolean; describe?: Describe } = {}) => {
    if (!loadedRef.current) {
      setNotice({ text: "Playlists are still loading — try again in a moment", canUndo: false, nonce: Date.now() });
      return;
    }
    const before = latest.current;
    const after = fn(before);
    if (after === before) {
      // Nothing changed (e.g. tracks already in the playlist) — still say so, but nothing to save or undo
      const d = typeof opts.describe === "function" ? opts.describe(before, after) : null;
      if (d) setNotice({ text: d.text, canUndo: false, nonce: Date.now() });
      return;
    }
    latest.current = after;
    dirty.current = true;
    setLib(after);
    const d = typeof opts.describe === "function" ? opts.describe(before, after) : opts.describe ? { text: opts.describe, changed: true } : null;
    if (opts.undoable && d?.changed !== false) {
      undoStack.current = [...undoStack.current.slice(-(UNDO_LIMIT - 1)), before];
      setUndoDepth(undoStack.current.length);
    }
    if (d) setNotice({ text: d.text, canUndo: !!opts.undoable && d.changed, nonce: Date.now() });
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.at(-1);
    if (!prev) return;
    undoStack.current = undoStack.current.slice(0, -1);
    setUndoDepth(undoStack.current.length);
    latest.current = prev;
    dirty.current = true;
    setLib(prev);
    setNotice({ text: "Undone", canUndo: false, nonce: Date.now() });
  }, []);

  const name = (l: PlaylistLibrary, id: string) => l.playlists.find(p => p.id === id)?.name ?? "playlist";
  const plural = (n: number) => `${n} track${n === 1 ? "" : "s"}`;

  /** Creates a playlist (smart when `opts.smart` is set) and returns its id. */
  const createPlaylist = useCallback((playlistName: string, opts: { folderId?: string; tracks?: string[]; source?: Playlist["source"]; smart?: SmartCriteria } = {}): string => {
    const id = newId();
    update(l => P.createPlaylist(l, { id, name: playlistName, now: Date.now(), ...opts }), { undoable: true });
    return id;
  }, [update]);

  const createFolder = useCallback((folderName: string, parentId?: string): string => {
    const id = newId();
    update(l => P.createFolder(l, { id, name: folderName, parentId }), { undoable: true });
    return id;
  }, [update]);

  return {
    library: lib,
    loaded,
    saveError,
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    undo,
    canUndo: undoDepth > 0,
    createPlaylist,
    createFolder,
    renamePlaylist: useCallback((id: string, n: string) => update(l => P.renamePlaylist(l, id, n, Date.now()), { undoable: true }), [update]),
    deletePlaylist: useCallback((id: string) => update(l => P.deletePlaylist(l, id), { undoable: true, describe: b => ({ text: `Deleted “${name(b, id)}”`, changed: true }) }), [update]),
    duplicatePlaylist: useCallback((id: string) => update(l => P.duplicatePlaylist(l, id, newId(), Date.now()), { undoable: true, describe: b => ({ text: `Duplicated “${name(b, id)}”`, changed: true }) }), [update]),
    addTracks: useCallback((id: string, files: string[], index?: number) =>
      update(l => P.addTracks(l, id, files, Date.now(), index), { undoable: true, describe: (b, a) => P.describeAdd(b, a, id, new Set(files).size) }), [update]),
    removeTracks: useCallback((id: string, files: string[]) =>
      update(l => P.removeTracks(l, id, files, Date.now()), { undoable: true, describe: (b, a) => {
        const n = (b.playlists.find(p => p.id === id)?.tracks.length ?? 0) - (a.playlists.find(p => p.id === id)?.tracks.length ?? 0);
        return { text: `Removed ${plural(n)} from “${name(a, id)}”`, changed: n > 0 };
      } }), [update]),
    moveTracks: useCallback((id: string, files: string[], toIndex: number) => update(l => P.moveTracks(l, id, files, toIndex, Date.now()), { undoable: true }), [update]),
    setPlaylistOrder: useCallback((id: string, files: string[]) =>
      update(l => P.setPlaylistOrder(l, id, files, Date.now()), { undoable: true, describe: a => ({ text: `Saved the new order of “${name(a, id)}”`, changed: true }) }), [update]),
    movePlaylistToFolder: useCallback((id: string, folderId: string | undefined) => update(l => P.movePlaylistToFolder(l, id, folderId, Date.now()), { undoable: true }), [update]),
    renameFolder: useCallback((id: string, n: string) => update(l => P.renameFolder(l, id, n), { undoable: true }), [update]),
    deleteFolder: useCallback((id: string) => update(l => P.deleteFolder(l, id), { undoable: true, describe: b => ({
      text: `Deleted folder “${b.folders.find(f => f.id === id)?.name ?? "folder"}” — its playlists were kept`, changed: true,
    }) }), [update]),
    toggleFolder: useCallback((id: string) => update(l => P.toggleFolder(l, id)), [update]),
    expandToPlaylist: useCallback((id: string) => update(l => P.expandToPlaylist(l, id)), [update]),
    /** Applies changes that arrived from a paired device (not undoable, no notice). */
    applyRemote: useCallback((fn: (l: PlaylistLibrary) => PlaylistLibrary) => update(fn), [update]),
    moveFolder: useCallback((id: string, parentId: string | undefined) => update(l => P.moveFolder(l, id, parentId), { undoable: true }), [update]),
    applyAppleMusicResult: useCallback((result: AppleMusicExportResult) => {
      // Keep the new Music.app links in undo snapshots too — undoing an earlier edit must not
      // forget them, or the next push would duplicate playlists in Music
      undoStack.current = undoStack.current.map(l => applyAppleMusicResult(l, result));
      update(l => applyAppleMusicResult(l, result));
    }, [update]),
    setSmartCriteria: useCallback((id: string, smart: SmartCriteria) => update(l => P.setSmartCriteria(l, id, smart, Date.now()), { undoable: true }), [update]),
    freezeSmartPlaylist: useCallback((id: string, files: string[]) =>
      update(l => P.freezeSmartPlaylist(l, id, files, Date.now()), { undoable: true, describe: a => ({ text: `“${name(a, id)}” is now a regular playlist`, changed: true }) }), [update]),
  };
}

export type PlaylistsApi = ReturnType<typeof usePlaylists>;
