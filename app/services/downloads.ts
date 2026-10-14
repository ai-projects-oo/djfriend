import type { SetTrack, Song } from '../types';
import { generateM3U } from '../lib/m3uExport';
import { generateRekordboxXml } from '../lib/rekordboxExport';

function triggerDownload(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadM3U(tracks: SetTrack[], filename = 'djfriend-set.m3u'): void {
  triggerDownload(generateM3U(tracks), filename, 'audio/x-mpegurl');
}

export function downloadRekordboxXml(
  tracks: Song[],
  playlistName = 'DJFriend Set',
  filename = 'djfriend-set.xml',
): void {
  triggerDownload(generateRekordboxXml(tracks, playlistName), filename, 'application/xml');
}

export function downloadLibraryRekordboxXml(library: Song[]): void {
  const today = new Date().toISOString().slice(0, 10);
  triggerDownload(generateRekordboxXml(library, 'DJFriend Library'), `djfriend-library-${today}.xml`, 'application/xml');
}
