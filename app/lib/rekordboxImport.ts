/** Shared Rekordbox XML parsing — extracted for testability. */

export interface RBTrack {
  path: string;
  title: string;
  artist: string;
  bpm: number;
  tonality: string;
  duration: number;
}

export interface RBPlaylist {
  name: string;
  path: string[]; // breadcrumb of folder names leading to this playlist
  trackKeys: number[];
}

/**
 * Convert a Rekordbox Location URI to an absolute filesystem path.
 *
 * Rekordbox emits several variants depending on OS and version:
 *   macOS:   file://localhost/Users/dj/Music/track.mp3
 *   Windows: file://localhost/C:/Users/dj/Music/track.mp3
 *   Windows: file:///C:/Users/dj/Music/track.mp3
 *   Both:    percent-encoded spaces/special chars
 *   Rare:    drive colon encoded as %3A (e.g. "C%3A/")
 */
export function parseRekordboxLocation(loc: string): string {
  let p = loc
    .replace(/^file:\/\/localhost/i, "")
    .replace(/^file:\/\//i, "");

  // Decode percent-encoded characters — but decode %3A only if it looks like a drive colon
  // to avoid mangling %3A in filenames. Do a full decode first, then re-examine.
  try {
    p = decodeURIComponent(p);
  } catch {
    // If full decode fails (malformed), decode only safe characters
    p = p.replace(/%20/g, " ").replace(/%27/g, "'").replace(/%28/g, "(").replace(/%29/g, ")");
  }

  // Windows: strip leading "/" before drive letter e.g. "/C:/..." → "C:/..."
  // Also handles rare lowercase drive letters.
  if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1);

  // Normalise Windows backslashes to forward slashes for consistency
  p = p.replace(/\\/g, "/");

  return p;
}

/**
 * Parse a Rekordbox XML string.
 * Returns the flat track list and the nested playlist structure.
 */
export function parseRekordboxXml(xml: string): {
  tracks: RBTrack[];
  playlists: RBPlaylist[];
  trackById: Map<number, RBTrack>;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");

  // ── Collection (all tracks) ────────────────────────────────────────────────
  const trackById = new Map<number, RBTrack>();
  const tracks: RBTrack[] = [];

  for (const el of Array.from(doc.querySelectorAll("COLLECTION > TRACK"))) {
    const loc = el.getAttribute("Location") ?? "";
    if (!loc) continue;
    const filePath = parseRekordboxLocation(loc);
    if (!filePath) continue;

    const id = parseInt(el.getAttribute("TrackID") ?? "0", 10);
    const bpm = parseFloat(el.getAttribute("AverageBpm") ?? "0");
    const track: RBTrack = {
      path: filePath,
      title: el.getAttribute("Name") ?? "",
      artist: el.getAttribute("Artist") ?? "",
      bpm,
      tonality: el.getAttribute("Tonality") ?? "",
      duration: parseFloat(el.getAttribute("TotalTime") ?? "0"),
    };
    tracks.push(track);
    if (id > 0) trackById.set(id, track);
  }

  // ── Playlists (folder-aware) ───────────────────────────────────────────────
  const playlists: RBPlaylist[] = [];

  function walkNode(node: Element, folderPath: string[]): void {
    const type = node.getAttribute("Type");
    const name = node.getAttribute("Name") ?? "";

    if (type === "0") {
      // Folder — recurse into children
      const children = Array.from(node.children).filter(
        (c) => c.tagName === "NODE",
      );
      for (const child of children) walkNode(child, [...folderPath, name]);
    } else if (type === "1") {
      // Playlist — collect track keys
      const keys = Array.from(node.querySelectorAll("TRACK[Key]")).map((t) =>
        parseInt(t.getAttribute("Key") ?? "0", 10),
      );
      playlists.push({ name, path: folderPath, trackKeys: keys });
    }
  }

  const rootNode = doc.querySelector("PLAYLISTS > NODE[Type='0']");
  if (rootNode) {
    const children = Array.from(rootNode.children).filter(
      (c) => c.tagName === "NODE",
    );
    for (const child of children) walkNode(child, []);
  }

  return { tracks, playlists, trackById };
}
