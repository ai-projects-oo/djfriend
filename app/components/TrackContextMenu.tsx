import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PlaylistLibrary, Song } from "../types";
import type { ContainingSource, LibraryView } from "../lib/libraryView";
import { buildPlaylistTree, filterPlaylistTree, type PlaylistTree } from "../lib/playlists";

export interface TrackMenuState { x: number; y: number; song: Song }

const menuItemClass = "w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer rounded text-[#ccd6e2] hover:bg-[#2c2c42] hover:text-[#e2e8f0]";
const panelClass = "fixed z-[101] bg-[#20202e] border border-[#363650] rounded-xl shadow-2xl py-1 min-w-[220px] max-w-[320px] max-h-[60vh] overflow-y-auto";
const MARGIN = 8;

/** Keeps a fixed-position panel inside the window: flips to the other side, then shifts up/left. */
function useClampedPosition(ref: React.RefObject<HTMLDivElement | null>, anchor: { top: number; left: number; flipLeft?: number }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = anchor.left;
    if (left + width > window.innerWidth - MARGIN) left = anchor.flipLeft != null ? anchor.flipLeft - width : window.innerWidth - MARGIN - width;
    const top = Math.min(anchor.top, window.innerHeight - MARGIN - height);
    setPos({ top: Math.max(MARGIN, top), left: Math.max(MARGIN, left) });
  }, [ref, anchor.top, anchor.left, anchor.flipLeft]);
  return pos;
}

/** Menu item that opens a flyout beside it (hover, click, → / Enter). Nests to any depth. */
function Submenu({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number; flipLeft: number }>({ top: 0, left: 0, flipLeft: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pos = useClampedPosition(panelRef, anchor);

  const show = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.top - 4, left: r.right + 2, flipLeft: r.left - 2 });
    setOpen(true);
  };
  const schedule = (fn: () => void, ms: number) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(fn, ms); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <div onMouseEnter={() => schedule(show, 120)} onMouseLeave={() => schedule(() => setOpen(false), 200)}>
      <button ref={btnRef} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={e => { if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); show(); } if (e.key === "ArrowLeft") setOpen(false); }}
        className={`${menuItemClass} flex items-center justify-between gap-4 ${open ? "bg-[#2c2c42] text-[#e2e8f0]" : ""}`}>
        <span className="truncate">{icon}{label}</span><span aria-hidden className="text-[#9aa8ba]">›</span>
      </button>
      {open && (
        <div ref={panelRef} role="menu" aria-label={label} className={panelClass}
          style={pos ? { top: pos.top, left: pos.left } : { top: anchor.top, left: anchor.left, visibility: "hidden" }}>
          {children}
        </div>
      )}
    </div>
  );
}

const playlistIcon = <span aria-hidden className="text-[#7c3aed]">♫ </span>;
const folderIcon = <span aria-hidden>📁 </span>;

/** A playlist tree as nested menus: folders open their own flyout, playlists are clickable rows. */
function PlaylistTreeMenu({ tree, onPick }: { tree: PlaylistTree; onPick: (id: string) => void }) {
  return (
    <>
      {tree.folders.map(f => (
        <Submenu key={`f-${f.folder.id}`} label={f.folder.name} icon={folderIcon}>
          <PlaylistTreeMenu tree={f} onPick={onPick} />
        </Submenu>
      ))}
      {tree.playlists.map(p => (
        <button key={`p-${p.id}`} type="button" role="menuitem" onClick={() => onPick(p.id)} className={`${menuItemClass} truncate`}>
          {playlistIcon}{p.name}
        </button>
      ))}
    </>
  );
}

export interface TrackContextMenuProps {
  menu: TrackMenuState;
  /** Files selected alongside the clicked track; actions apply to all of them when the track is part of it. */
  selection?: Set<string>;
  onClose: () => void;
  onPlay: (s: Song) => void;
  onPlayNext?: (files: string[]) => void;
  onPlayLater?: (files: string[]) => void;
  onGetInfo: (s: Song) => void;
  onReanalyze: (s: Song) => void;
  onExportM3U: (s: Song) => void;
  onSendToGenerator?: (files: string[]) => void;
  onDelete: (s: Song) => void;
  playlistLibrary?: PlaylistLibrary;
  lastPlaylist?: { id: string; name: string };
  onAddToPlaylist?: (playlistId: string, files: string[]) => void;
  onNewPlaylist?: (files: string[]) => void;
  onRemoveFromView?: (files: string[]) => void;
  containingSources?: (song: Song) => ContainingSource[];
  onShowIn?: (view: LibraryView, file: string) => void;
}

/** Right-click menu for a track — shared by the library table and the player. */
export default function TrackContextMenu({
  menu, selection, onClose, onPlay, onPlayNext, onPlayLater, onGetInfo, onReanalyze, onExportM3U, onSendToGenerator, onDelete,
  playlistLibrary, lastPlaylist, onAddToPlaylist, onNewPlaylist, onRemoveFromView, containingSources, onShowIn,
}: TrackContextMenuProps) {
  const sel = selection ?? new Set<string>();
  const targets = sel.has(menu.song.file) && sel.size > 1 ? [...sel] : [menu.song.file];
  const n = targets.length > 1 ? ` ${targets.length} tracks` : "";
  const ref = useRef<HTMLDivElement>(null);
  const pos = useClampedPosition(ref, { top: menu.y, left: menu.x });

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [onClose]);

  const pick = (fn: () => void) => () => { fn(); onClose(); };
  const item = (label: string, onClick: () => void, danger = false) => (
    <button type="button" role="menuitem" onClick={pick(onClick)}
      className={danger ? "w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer rounded text-[#ef4444]/80 hover:bg-[#ef4444]/10 hover:text-[#ef4444]" : menuItemClass}>
      {label}
    </button>
  );
  const sep = () => <div className="my-1 border-t border-[#2c2c42]" />;

  const tree = useMemo(() => (playlistLibrary ? buildPlaylistTree(playlistLibrary) : null), [playlistLibrary]);
  // Smart playlists get their tracks from rules, so they can't be added to
  const addTree = useMemo(() => (tree ? filterPlaylistTree(tree, p => !p.smart) : null), [tree]);
  const inTree = useMemo(() => (tree ? filterPlaylistTree(tree, p => !p.smart && p.tracks.includes(menu.song.file)) : null), [tree, menu.song.file]);
  const hasIn = !!inTree && (inTree.folders.length > 0 || inTree.playlists.length > 0);
  const others = useMemo(() => containingSources?.(menu.song) ?? [], [containingSources, menu.song]);
  const otherGroups = [...new Set(others.map(o => o.group))];
  const hasAdd = !!addTree && (addTree.folders.length > 0 || addTree.playlists.length > 0);

  return (
    <div ref={ref} role="menu" aria-label={`${menu.song.title} actions`}
      className="fixed z-[100] bg-[#20202e] border border-[#363650] rounded-xl shadow-2xl py-1 min-w-[200px]"
      style={pos ? { top: pos.top, left: pos.left } : { top: menu.y, left: menu.x, visibility: "hidden" }}>
      {onAddToPlaylist && lastPlaylist && item(`Add${n} to Last Playlist, ${lastPlaylist.name}`, () => onAddToPlaylist(lastPlaylist.id, targets))}
      {(onAddToPlaylist || onNewPlaylist) && (
        <Submenu label={`Add${n} to Playlist`}>
          {onNewPlaylist && <button type="button" role="menuitem" className={menuItemClass} onClick={pick(() => onNewPlaylist(targets))}>New Playlist</button>}
          {onAddToPlaylist && addTree && hasAdd && (
            <>
              {onNewPlaylist && sep()}
              <PlaylistTreeMenu tree={addTree} onPick={id => { onAddToPlaylist(id, targets); onClose(); }} />
            </>
          )}
        </Submenu>
      )}
      {onRemoveFromView && item(`Remove${n} from Playlist`, () => onRemoveFromView(targets))}
      {(onAddToPlaylist || onNewPlaylist || onRemoveFromView) && sep()}
      {item("Play", () => onPlay(menu.song))}
      {onPlayNext && item(`Play${n} Next`, () => onPlayNext(targets))}
      {onPlayLater && item(`Play${n} Later`, () => onPlayLater(targets))}
      {item("Get Info", () => onGetInfo(menu.song))}
      {onShowIn && (hasIn || others.length > 0 ? (
        <Submenu label="Show in Playlist">
          {inTree && hasIn && <PlaylistTreeMenu tree={inTree} onPick={id => { onShowIn({ kind: "playlist", id }, menu.song.file); onClose(); }} />}
          {otherGroups.map(group => (
            <div key={group}>
              {(hasIn || group !== otherGroups[0]) && sep()}
              <div className="px-3 pt-1 pb-0.5 text-[9px] uppercase tracking-widest font-semibold text-[#8d9aab]">{group}</div>
              {others.filter(o => o.group === group).map(o => (
                <button key={`${group}-${o.label}`} type="button" role="menuitem" className={`${menuItemClass} truncate`}
                  onClick={pick(() => onShowIn(o.view, menu.song.file))}>
                  {o.label}
                </button>
              ))}
            </div>
          ))}
        </Submenu>
      ) : (
        <div role="menuitem" aria-disabled="true" className="px-3 py-1.5 text-xs text-[#8090a6] cursor-default select-none">Show in Playlist — not in any playlist</div>
      ))}
      {sep()}
      {item("Re-analyze Audio", () => onReanalyze(menu.song))}
      {item("Export as M3U", () => onExportM3U(menu.song))}
      {onSendToGenerator && (sel.has(menu.song.file) && sel.size > 1
        ? item(`Send ${sel.size} selected to Set Generator`, () => onSendToGenerator([...sel]))
        : item("Send to Set Generator", () => onSendToGenerator([menu.song.file])))}
      {sep()}
      {item("Delete from Library", () => onDelete(menu.song), true)}
    </div>
  );
}
