// What the Library sidebar can show in the track table, plus the drag-and-drop payload types
// shared by the table and the sidebar.

// Library rows carry track keys; sidebar items carry a playlist or folder id.
export const DRAG_TRACKS   = "application/x-djfriend-tracks";
export const DRAG_PLAYLIST = "application/x-djfriend-playlist";
export const DRAG_FOLDER   = "application/x-djfriend-folder";

export type LibraryView =
  | { kind: "all" }
  | { kind: "playlist"; id: string }
  | { kind: "apple"; name: string }
  | { kind: "spotify"; id: string }
  | { kind: "set"; id: string }
  | { kind: "imports" };          // Spotify import page (paste a link / browse, match details)

export interface SourceItem { view: LibraryView; label: string; count: number }

/** A playlist a track is in, outside DJFriend's own playlists (e.g. an Apple Music import). */
export interface ContainingSource { group: string; label: string; view: LibraryView }

export function sameView(a: LibraryView, b: LibraryView): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "all":
    case "imports": return true;
    case "apple": return a.name === (b as typeof a).name;
    default:      return a.id === (b as { id: string }).id;
  }
}
