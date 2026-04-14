import type { SetTrack } from '../types';

declare const __SONGS_FOLDER__: string;

// Camelot → Rekordbox Tonality (musical key name)
const CAMELOT_TO_TONALITY: Record<string, string> = {
  '8B': 'Cmaj',  '3B': 'Dbmaj', '10B': 'Dmaj',  '5B': 'Ebmaj',
  '12B': 'Emaj', '7B': 'Fmaj',  '2B': 'Gbmaj',  '9B': 'Gmaj',
  '4B': 'Abmaj', '11B': 'Amaj', '6B': 'Bbmaj',  '1B': 'Bmaj',
  '5A': 'Cmin',  '12A': 'Dbmin','7A': 'Dmin',   '2A': 'Ebmin',
  '9A': 'Emin',  '4A': 'Fmin',  '11A': 'Gbmin', '6A': 'Gmin',
  '1A': 'Abmin', '8A': 'Amin',  '3A': 'Bbmin',  '10A': 'Bmin',
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);
}

function resolveTrackPath(track: SetTrack, songsFolder: string): string {
  const src = (track.filePath ?? track.file).trim();
  if (!src) return src;
  if (isAbsolutePath(src)) return src;
  if (songsFolder) return `${songsFolder.replace(/[\\/]$/, '')}/${src}`;
  return src;
}

/**
 * Convert an absolute file path to a Rekordbox-compatible Location URI.
 * Format: file://localhost/path/to/track.mp3 (spaces and special chars percent-encoded)
 */
function toLocation(absolutePath: string): string {
  // Normalise Windows backslashes
  const forward = absolutePath.replace(/\\/g, '/');
  // Encode each path segment individually (preserve slashes)
  const encoded = forward
    .split('/')
    .map(seg => encodeURIComponent(seg).replace(/%2F/gi, '/'))
    .join('/');
  // macOS/Linux: /Users/... → file://localhost/Users/...
  // Windows:     C:/...    → file://localhost/C:/...
  return `file://localhost${encoded.startsWith('/') ? '' : '/'}${encoded}`;
}

function isoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function generateRekordboxXml(tracks: SetTrack[], playlistName = 'DJFriend Set'): string {
  const songsFolder = __SONGS_FOLDER__;
  const today = new Date().toISOString().slice(0, 10);

  const trackNodes = tracks.map((t, i) => {
    const id       = i + 1;
    const path     = resolveTrackPath(t, songsFolder);
    const location = toLocation(path);
    const bpm      = t.bpm > 0 ? t.bpm.toFixed(2) : '0.00';
    const duration = t.duration != null ? Math.round(t.duration) : 0;
    const tonality = CAMELOT_TO_TONALITY[t.camelot] ?? '';
    const added    = t.dateAdded ? isoDate(t.dateAdded) : today;

    return [
      `    <TRACK`,
      `      TrackID="${id}"`,
      `      Name="${escapeXml(t.title)}"`,
      `      Artist="${escapeXml(t.artist)}"`,
      `      Album=""`,
      `      Genre="${escapeXml(t.genres?.[0] ?? '')}"`,
      `      Kind="MP3 File"`,
      `      TotalTime="${duration}"`,
      `      AverageBpm="${bpm}"`,
      `      DateAdded="${added}"`,
      `      Tonality="${tonality}"`,
      `      Location="${location}"`,
      `    />`,
    ].join('\n');
  });

  const trackKeys = tracks.map((_, i) => `        <TRACK Key="${i + 1}"/>`).join('\n');

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<DJ_PLAYLISTS Version="1.0.0">`,
    `  <PRODUCT Name="rekordbox" Version="6.0.0" Company="AlphaTheta"/>`,
    `  <COLLECTION Entries="${tracks.length}">`,
    ...trackNodes,
    `  </COLLECTION>`,
    `  <PLAYLISTS>`,
    `    <NODE Type="0" Name="ROOT" Count="1">`,
    `      <NODE Name="${escapeXml(playlistName)}" Type="1" KeyType="0" Entries="${tracks.length}">`,
    trackKeys,
    `      </NODE>`,
    `    </NODE>`,
    `  </PLAYLISTS>`,
    `</DJ_PLAYLISTS>`,
  ].join('\n');
}

export function downloadRekordboxXml(
  tracks: SetTrack[],
  playlistName = 'DJFriend Set',
  filename = 'djfriend-set.xml',
): void {
  const content = generateRekordboxXml(tracks, playlistName);
  const blob = new Blob([content], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
