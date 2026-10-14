import type { PlaylistLibrary } from '../types';
import { apiFetch } from './apiFetch';
import { parsePlaylistLibrary, EMPTY_PLAYLIST_LIBRARY } from '../lib/playlists';

export async function fetchPlaylistLibrary(): Promise<PlaylistLibrary> {
  const res = await apiFetch('/api/playlists');
  if (!res.ok) return EMPTY_PLAYLIST_LIBRARY;
  return parsePlaylistLibrary(await res.json());
}

export async function savePlaylistLibrary(lib: PlaylistLibrary): Promise<void> {
  const res = await apiFetch('/api/playlists', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lib),
  });
  if (!res.ok) throw new Error(`Saving playlists failed (${res.status})`);
}
