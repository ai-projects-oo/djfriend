import type { SetTrack } from '../types';

declare const __SONGS_FOLDER__: string;

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);
}

function resolveTrackPath(track: SetTrack, songsFolder: string): string {
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
    const duration = track.duration != null ? Math.max(0, Math.round(track.duration)) : 0;
    const artist = track.spotifyArtist ?? track.artist;
    const title = track.spotifyTitle ?? track.title;
    lines.push(`#EXTINF:${duration},${title} - ${artist}`);

    const resolvedPath = resolveTrackPath(track, songsFolder);
    lines.push(resolvedPath.replace(/\\/g, '/'));
  }

  return lines.join('\r\n');
}

export function downloadM3U(tracks: SetTrack[], filename = 'djfriend-set.m3u'): void {
  const content = generateM3U(tracks);
  const blob = new Blob([content], { type: 'audio/x-mpegurl' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
