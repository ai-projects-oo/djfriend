import type { PlaylistLibrary } from '../types';
import { apiFetch } from './apiFetch';
import { parsePlaylistLibrary } from '../lib/playlists';

/** Throws when the library can't be read — callers must not treat that as "no playlists" (saving would wipe the file). */
export async function fetchPlaylistLibrary(): Promise<PlaylistLibrary> {
  const res = await apiFetch('/api/playlists');
  if (!res.ok) throw new Error(`Couldn't load playlists (${res.status})`);
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
