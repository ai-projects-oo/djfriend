import type { SetTrack } from '../types';

declare const __SONGS_FOLDER__: string;

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);
}

export function resolveTrackPath(track: SetTrack, songsFolder: string): string {
  const sourcePath = (track.filePath ?? track.file).trim();
  if (!sourcePath) return sourcePath;
  if (isAbsolutePath(sourcePath)) return sourcePath;
  if (songsFolder) return `${songsFolder.replace(/[\\/]$/, '')}/${sourcePath}`;
  return sourcePath;
}

export function generateM3U(tracks: SetTrack[]): string {
  const lines: string[] = ['#EXTM3U'];
  const songsFolder = __SONGS_FOLDER__;

  for (const track of tracks) {
    // Vinyl-only records have no file — leave a comment so the DJ sees where to drop the record
    if (track.vinylOnly) { lines.push(`# VINYL: ${track.artist} - ${track.title}`); continue; }
    const duration = track.duration != null ? Math.max(0, Math.round(track.duration)) : 0;
    lines.push(`#EXTINF:${duration},${track.title} - ${track.artist}`);

    const resolvedPath = resolveTrackPath(track, songsFolder);
    lines.push(resolvedPath.replace(/\\/g, '/'));
  }

  return lines.join('\r\n');
}
