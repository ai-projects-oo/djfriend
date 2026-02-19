import type { SetTrack } from '../types';

declare const __SONGS_FOLDER__: string;

export function generateM3U(tracks: SetTrack[]): string {
  const lines: string[] = ['#EXTM3U'];
  const songsFolder = __SONGS_FOLDER__;

  for (const track of tracks) {
    // -1 means unknown/streaming duration per M3U spec — Apple Music requires this, not 0
    const duration = track.duration != null ? Math.round(track.duration) : -1;
    const artist = track.spotifyArtist ?? track.artist;
    const title = track.spotifyTitle ?? track.title;
    lines.push(`#EXTINF:${duration},${artist} - ${title}`);

    // Prepend SONGS_FOLDER to get an absolute path Apple Music can resolve
    const filePath =
      songsFolder ? `${songsFolder}/${track.file}` : track.file;
    lines.push(filePath);
  }

  return lines.join('\n');
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
