import { useEffect, useMemo, useRef, useState } from "react";
import type { Playlist, PlaylistFolder } from "../types";
import { buildPlaylistTree, isInsideFolder, playlistsInFolder, type FolderNode } from "../lib/playlists";
import type { PlaylistsApi } from "../hooks/usePlaylists";
import { DRAG_FOLDER, DRAG_PLAYLIST, DRAG_TRACKS, sameView, type LibraryView, type SourceItem } from "../lib/libraryView";

interface Props {
  playlists: PlaylistsApi;
  view: LibraryView;
  onSelectView: (v: LibraryView) => void;
  libraryCount: number;
  /** Track count per playlist id, after resolving against the library. */
  playlistCounts: Map<string, number>;
  appleSources: SourceItem[];
  spotifySources: SourceItem[];
  setSources: SourceItem[];
  onDropTracks: (playlistId: string, files: string[]) => void;
  onSaveAsPlaylist: (source: SourceItem) => void;
  onImportApple?: () => void;
  onImportSpotify?: () => void;
  onExportPlaylist?: (playlist: Playlist, format: "M3U" | "XML") => void;
  /** Id of a playlist created elsewhere that should open straight into rename. */
  renameRequest?: string;
  /** Set on macOS desktop only: push playlists (or all of them) into Music.app. */
  onPushToAppleMusic?: (playlistIds: string[] | "all", title: string) => void;
  /** Playlists containing the tracks selected in the table — marked with a dot. */
  highlightIds?: Set<string>;
}

type Renaming = { kind: "playlist" | "folder"; id: string } | null;
type Menu = { x: number; y: number; target: { kind: "playlist"; playlist: Playlist } | { kind: "folder"; folder: PlaylistFolder } | { kind: "source"; source: SourceItem } } | null;

const itemBase = "w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-colors cursor-pointer select-none";

function readDrag(e: React.DragEvent, type: string): string | null {
  return e.dataTransfer.types.includes(type) ? e.dataTransfer.getData(type) : null;
}

// ─── Inline rename input ─────────────────────────────────────────────────────

function RenameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.select(); }, []);
  return (
    <input
      ref={ref}
      autoFocus
      defaultValue={initial}
      aria-label="Name"
      onBlur={e => onCommit(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") onCancel();
      }}
      onClick={e => e.stopPropagation()}
      className="flex-1 min-w-0 bg-[#0d0d14] border border-[#7c3aed] rounded px-1.5 py-0.5 text-xs text-[#e2e8f0] outline-none"
    />
  );
}

// ─── Context menu ─────────────────────────────────────────────────────────────

function SidebarMenu({ menu, folders, onClose, children }: { menu: NonNullable<Menu>; folders: PlaylistFolder[]; onClose: () => void; children: (folders: PlaylistFolder[]) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" className="fixed z-[100] bg-[#20202e] border border-[#363650] rounded-xl shadow-2xl py-1 min-w-[180px] max-h-[70vh] overflow-y-auto" style={{ top: menu.y, left: menu.x }}>
      {children(folders)}
    </div>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${danger ? "text-[#ef4444]/80 hover:bg-[#ef4444]/10 hover:text-[#ef4444]" : "text-[#a6b5c8] hover:bg-[#2c2c42] hover:text-[#e2e8f0]"}`}>
      {label}
    </button>
  );
}
const MenuSep = () => <div className="my-1 border-t border-[#2c2c42]" />;
const MenuLabel = ({ text }: { text: string }) => <div className="px-3 pt-1 pb-0.5 text-[9px] uppercase tracking-widest font-semibold text-[#58656e]">{text}</div>;

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export default function LibrarySidebar({
  playlists, view, onSelectView, libraryCount, playlistCounts, appleSources, spotifySources, setSources,
  onDropTracks, onSaveAsPlaylist, onImportApple, onImportSpotify, onExportPlaylist, renameRequest, onPushToAppleMusic, highlightIds,
}: Props) {
  const hasHighlight = (node: FolderNode): boolean =>
    !!highlightIds && (node.playlists.some(p => highlightIds.has(p.id)) || node.folders.some(hasHighlight));
  const dot = (label: string) => (
    <span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa] flex-shrink-0" title={label} aria-label={label} />
  );
  const { library: lib } = playlists;
  const tree = useMemo(() => buildPlaylistTree(lib), [lib]);
  const [renaming, setRenaming] = useState<Renaming>(null);
  const [handledRename, setHandledRename] = useState(renameRequest);
  if (renameRequest !== handledRename) {
    setHandledRename(renameRequest);
    if (renameRequest) setRenaming({ kind: "playlist", id: renameRequest });
  }
  const [menu, setMenu] = useState<Menu>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);   // "pl:<id>" | "fd:<id>" | "root"
  const [showAllSets, setShowAllSets] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSection = (s: string) => setCollapsedSections(prev => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  const openMenu = (e: React.MouseEvent, target: NonNullable<Menu>["target"]) => {
    e.preventDefault();
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 260), target });
  };

  const newPlaylist = (folderId?: string) => {
    const id = playlists.createPlaylist("Untitled Playlist", { folderId });
    onSelectView({ kind: "playlist", id });
    setRenaming({ kind: "playlist", id });
  };
  const newFolder = (parentId?: string) => {
    const id = playlists.createFolder("New Folder", parentId);
    setRenaming({ kind: "folder", id });
  };
  const confirmDelete = (what: string) => window.confirm(`Delete ${what}? This can't be undone.`);

  // ── Drop handling ────────────────────────────────────────────────────────
  const acceptsDrop = (e: React.DragEvent, key: string, types: string[]) => {
    if (!types.some(t => e.dataTransfer.types.includes(t))) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DRAG_TRACKS) ? "copy" : "move";
    if (dropTarget !== key) setDropTarget(key);
  };
  const dropOnPlaylist = (e: React.DragEvent, p: Playlist) => {
    e.preventDefault();
    setDropTarget(null);
    const raw = readDrag(e, DRAG_TRACKS);
    if (!raw) return;
    try { onDropTracks(p.id, JSON.parse(raw) as string[]); } catch { /* bad payload */ }
  };
  const dropOnFolder = (e: React.DragEvent, folderId: string | undefined) => {
    e.preventDefault();
    setDropTarget(null);
    const pl = readDrag(e, DRAG_PLAYLIST);
    if (pl) { playlists.movePlaylistToFolder(pl, folderId); return; }
    const fd = readDrag(e, DRAG_FOLDER);
    if (fd && fd !== folderId && !(folderId && isInsideFolder(lib, folderId, fd))) playlists.moveFolder(fd, folderId);
  };

  // ── Rows ─────────────────────────────────────────────────────────────────
  const renderPlaylist = (p: Playlist, depth: number) => {
    const active = view.kind === "playlist" && view.id === p.id;
    const key = `pl:${p.id}`;
    return (
      <div
        key={p.id}
        draggable={renaming?.id !== p.id}
        onDragStart={e => { e.dataTransfer.setData(DRAG_PLAYLIST, p.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragOver={e => acceptsDrop(e, key, [DRAG_TRACKS])}
        onDragLeave={() => setDropTarget(t => (t === key ? null : t))}
        onDrop={e => dropOnPlaylist(e, p)}
        onClick={() => onSelectView({ kind: "playlist", id: p.id })}
        onDoubleClick={() => setRenaming({ kind: "playlist", id: p.id })}
        onContextMenu={e => openMenu(e, { kind: "playlist", playlist: p })}
        role="button"
        aria-label={`Playlist ${p.name}`}
        aria-current={active ? "true" : undefined}
        className={`${itemBase} ${dropTarget === key ? "bg-[#7c3aed]/30 ring-1 ring-[#7c3aed]" : active ? "bg-[#7c3aed]/15 text-white" : "text-[#a6b5c8] hover:bg-[#20202e]"}`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <span className="text-[#7c3aed] flex-shrink-0" aria-hidden>♫</span>
        {renaming?.kind === "playlist" && renaming.id === p.id ? (
          <RenameInput initial={p.name} onCancel={() => setRenaming(null)} onCommit={name => { playlists.renamePlaylist(p.id, name); setRenaming(null); }} />
        ) : (
          <span className="flex-1 min-w-0 truncate">{p.name}</span>
        )}
        {highlightIds?.has(p.id) && dot("Contains the selected track")}
        {p.appleMusicId && <span className="text-[9px] text-[#58656e] flex-shrink-0" title="Linked to Apple Music — push again to update" aria-label="Linked to Apple Music"></span>}
        <span className="text-[10px] text-[#58656e] tabular-nums flex-shrink-0">{playlistCounts.get(p.id) ?? 0}</span>
      </div>
    );
  };

  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => {
    const f = node.folder;
    const key = `fd:${f.id}`;
    return (
      <div key={f.id}>
        <div
          draggable={renaming?.id !== f.id}
          onDragStart={e => { e.dataTransfer.setData(DRAG_FOLDER, f.id); e.dataTransfer.effectAllowed = "move"; }}
          onDragOver={e => acceptsDrop(e, key, [DRAG_PLAYLIST, DRAG_FOLDER])}
          onDragLeave={() => setDropTarget(t => (t === key ? null : t))}
          onDrop={e => dropOnFolder(e, f.id)}
          onClick={() => playlists.toggleFolder(f.id)}
          onDoubleClick={() => setRenaming({ kind: "folder", id: f.id })}
          onContextMenu={e => openMenu(e, { kind: "folder", folder: f })}
          role="button"
          aria-label={`Folder ${f.name}`}
          aria-expanded={!f.collapsed}
          className={`${itemBase} ${dropTarget === key ? "bg-[#7c3aed]/30 ring-1 ring-[#7c3aed]" : "text-[#a6b5c8] hover:bg-[#20202e]"}`}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <span className="text-[9px] text-[#64748b] w-2 flex-shrink-0" aria-hidden>{f.collapsed ? "▸" : "▾"}</span>
          <span className="flex-shrink-0" aria-hidden>📁</span>
          {renaming?.kind === "folder" && renaming.id === f.id ? (
            <RenameInput initial={f.name} onCancel={() => setRenaming(null)} onCommit={name => { playlists.renameFolder(f.id, name); setRenaming(null); }} />
          ) : (
            <span className="flex-1 min-w-0 truncate font-medium">{f.name}</span>
          )}
          {f.collapsed && hasHighlight(node) && dot("A playlist inside contains the selected track")}
        </div>
        {!f.collapsed && (
          <>
            {node.folders.map(child => renderFolder(child, depth + 1))}
            {node.playlists.map(p => renderPlaylist(p, depth + 1))}
            {node.folders.length === 0 && node.playlists.length === 0 && (
              <div className="text-[10px] text-[#424f63] italic py-0.5" style={{ paddingLeft: 28 + depth * 12 }}>Empty folder</div>
            )}
          </>
        )}
      </div>
    );
  };

  const renderSource = (s: SourceItem) => {
    const active = sameView(view, s.view);
    return (
      <div
        key={`${s.view.kind}:${s.label}:${"id" in s.view ? s.view.id : ""}`}
        onClick={() => onSelectView(s.view)}
        onContextMenu={e => openMenu(e, { kind: "source", source: s })}
        role="button"
        aria-label={s.label}
        aria-current={active ? "true" : undefined}
        className={`${itemBase} ${active ? "bg-[#7c3aed]/15 text-white" : "text-[#8394a8] hover:bg-[#20202e]"}`}
      >
        <span className="flex-1 min-w-0 truncate">{s.label}</span>
        <span className="text-[10px] text-[#58656e] tabular-nums flex-shrink-0">{s.count}</span>
      </div>
    );
  };

  const sectionHeader = (id: string, label: string, actions?: React.ReactNode, dropProps?: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={`flex items-center gap-1 px-2 pt-3 pb-1 rounded-md ${dropTarget === "root" && id === "playlists" ? "bg-[#7c3aed]/20" : ""}`} {...dropProps}>
      <button type="button" onClick={() => toggleSection(id)} aria-expanded={!collapsedSections.has(id)}
        className="flex-1 flex items-center gap-1 text-left text-[10px] uppercase tracking-widest font-semibold text-[#64748b] hover:text-[#a6b5c8] cursor-pointer">
        <span className="text-[8px] w-2" aria-hidden>{collapsedSections.has(id) ? "▸" : "▾"}</span>{label}
      </button>
      {actions}
    </div>
  );

  const iconBtn = (label: string, glyph: string, onClick: () => void) => (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="w-5 h-5 flex items-center justify-center rounded text-[#64748b] hover:text-[#e2e8f0] hover:bg-[#2c2c42] text-xs cursor-pointer transition-colors">
      {glyph}
    </button>
  );

  const visibleSets = showAllSets ? setSources : setSources.slice(0, 15);

  return (
    <aside aria-label="Library sources and playlists" className="w-60 flex-shrink-0 border-r border-[#2c2c42] bg-[#16161e] overflow-y-auto px-2 pb-4">
      {/* Library */}
      {sectionHeader("library", "Library")}
      {!collapsedSections.has("library") && (
        <div
          onClick={() => onSelectView({ kind: "all" })}
          role="button"
          aria-label="All tracks"
          aria-current={view.kind === "all" ? "true" : undefined}
          className={`${itemBase} ${view.kind === "all" ? "bg-[#7c3aed]/15 text-white" : "text-[#a6b5c8] hover:bg-[#20202e]"}`}
        >
          <span aria-hidden>♪</span>
          <span className="flex-1">All Tracks</span>
          <span className="text-[10px] text-[#58656e] tabular-nums">{libraryCount}</span>
        </div>
      )}

      {/* Playlists */}
      {sectionHeader(
        "playlists",
        "Playlists",
        <>
          {iconBtn("New folder", "📁", () => newFolder())}
          {iconBtn("New playlist", "+", () => newPlaylist())}
        </>,
        {
          onDragOver: e => acceptsDrop(e, "root", [DRAG_PLAYLIST, DRAG_FOLDER]),
          onDragLeave: () => setDropTarget(t => (t === "root" ? null : t)),
          onDrop: e => dropOnFolder(e, undefined),
        },
      )}
      {!collapsedSections.has("playlists") && (
        <div className="flex flex-col">
          {tree.folders.map(n => renderFolder(n, 0))}
          {tree.playlists.map(p => renderPlaylist(p, 0))}
          {lib.playlists.length === 0 && lib.folders.length === 0 && (
            <button type="button" onClick={() => newPlaylist()}
              className="mx-2 mt-1 text-left text-[11px] text-[#64748b] hover:text-[#a78bfa] cursor-pointer">
              + Create your first playlist
            </button>
          )}
          {playlists.saveError && <p className="px-2 pt-1 text-[10px] text-[#ef4444]" role="alert">{playlists.saveError}</p>}
        </div>
      )}

      {/* Sources (read-only) */}
      {sectionHeader("apple", "Apple Music", <>
        {onPushToAppleMusic && lib.playlists.length > 0 && iconBtn("Export all playlists to Apple Music", "⇪", () => onPushToAppleMusic("all", `Export all ${lib.playlists.length} playlists to Apple Music`))}
        {onImportApple && iconBtn("Import from Apple Music", "⬇", onImportApple)}
      </>)}
      {!collapsedSections.has("apple") && (
        appleSources.length > 0
          ? appleSources.map(renderSource)
          : <p className="px-2 text-[10px] text-[#424f63]">No playlists imported</p>
      )}

      {sectionHeader("spotify", "Spotify", onImportSpotify && iconBtn("Import from Spotify", "⬇", onImportSpotify))}
      {!collapsedSections.has("spotify") && (
        spotifySources.length > 0
          ? spotifySources.map(renderSource)
          : <p className="px-2 text-[10px] text-[#424f63]">No playlists imported</p>
      )}

      {sectionHeader("sets", "Sets")}
      {!collapsedSections.has("sets") && (
        <>
          {setSources.length > 0
            ? visibleSets.map(renderSource)
            : <p className="px-2 text-[10px] text-[#424f63]">No saved sets</p>}
          {setSources.length > 15 && (
            <button type="button" onClick={() => setShowAllSets(s => !s)} className="px-2 pt-0.5 text-[10px] text-[#64748b] hover:text-[#a78bfa] cursor-pointer">
              {showAllSets ? "Show fewer" : `Show all ${setSources.length}`}
            </button>
          )}
        </>
      )}

      {menu && (
        <SidebarMenu menu={menu} folders={lib.folders} onClose={() => setMenu(null)}>
          {folders => {
            const close = (fn: () => void) => () => { fn(); setMenu(null); };
            const t = menu.target;
            if (t.kind === "playlist") {
              const p = t.playlist;
              return (
                <>
                  <MenuItem label="Rename" onClick={close(() => setRenaming({ kind: "playlist", id: p.id }))} />
                  <MenuItem label="Duplicate" onClick={close(() => playlists.duplicatePlaylist(p.id))} />
                  {onPushToAppleMusic && <MenuItem label={p.appleMusicId ? "Update in Apple Music" : "Push to Apple Music"} onClick={close(() => onPushToAppleMusic([p.id], `Push “${p.name}” to Apple Music`))} />}
                  {onExportPlaylist && <MenuItem label="Export as M3U" onClick={close(() => onExportPlaylist(p, "M3U"))} />}
                  {onExportPlaylist && <MenuItem label="Export as Rekordbox XML" onClick={close(() => onExportPlaylist(p, "XML"))} />}
                  <MenuSep />
                  <MenuLabel text="Move to" />
                  {p.folderId && <MenuItem label="Top level" onClick={close(() => playlists.movePlaylistToFolder(p.id, undefined))} />}
                  {folders.filter(f => f.id !== p.folderId).map(f => (
                    <MenuItem key={f.id} label={`📁 ${f.name}`} onClick={close(() => playlists.movePlaylistToFolder(p.id, f.id))} />
                  ))}
                  <MenuSep />
                  <MenuItem label="Delete playlist" danger onClick={close(() => {
                    if (!confirmDelete(`“${p.name}”`)) return;
                    playlists.deletePlaylist(p.id);
                    if (view.kind === "playlist" && view.id === p.id) onSelectView({ kind: "all" });
                  })} />
                </>
              );
            }
            if (t.kind === "folder") {
              const f = t.folder;
              return (
                <>
                  <MenuItem label="New playlist here" onClick={close(() => newPlaylist(f.id))} />
                  <MenuItem label="New folder here" onClick={close(() => newFolder(f.id))} />
                  <MenuItem label="Rename" onClick={close(() => setRenaming({ kind: "folder", id: f.id }))} />
                  {onPushToAppleMusic && playlistsInFolder(lib, f.id).length > 0 && (
                    <MenuItem label="Push folder to Apple Music" onClick={close(() => onPushToAppleMusic(playlistsInFolder(lib, f.id), `Push folder “${f.name}” to Apple Music`))} />
                  )}
                  <MenuSep />
                  <MenuItem label="Delete folder (keeps playlists)" danger onClick={close(() => {
                    if (confirmDelete(`folder “${f.name}”`)) playlists.deleteFolder(f.id);
                  })} />
                </>
              );
            }
            return <MenuItem label="Save as playlist" onClick={close(() => onSaveAsPlaylist(t.source))} />;
          }}
        </SidebarMenu>
      )}
    </aside>
  );
}
