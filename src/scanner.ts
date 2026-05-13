import fs from 'fs';
import path from 'path';
import * as mm from 'music-metadata';
import type { ScannedTrack } from './types';
import { parseFilename } from './parse-filename.js';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.aac', '.m4a', '.wav', '.ogg', '.opus']);

export async function scanFolder(folderPath: string): Promise<ScannedTrack[]> {
  const entries = fs.readdirSync(folderPath);
  const audioFiles = entries.filter(f => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()));

  const tracks: ScannedTrack[] = [];

  for (const file of audioFiles) {
    const filePath = path.join(folderPath, file);
    let artist: string | null = null;
    let title = '';
    let duration: number | null = null;
    let localGenres: string[] = [];

    try {
      const meta = await mm.parseFile(filePath, { duration: true });
      artist = meta.common.artist ?? null;
      title = meta.common.title ?? '';
      duration = meta.format.duration ?? null;
      localGenres = meta.common.genre ?? [];
    } catch {
      // ignore metadata parse errors, fall through to filename parsing
    }

    // Fall back to filename parsing if tags are missing
    if (!title) {
      const parsed = parseFilename(file);
      artist = artist ?? parsed.artist;
      title = parsed.title;
    }

    const stat = fs.statSync(filePath);
    const MIN_TS = 946684800; // 2000-01-01 — guards against HFS+ sentinel (Jan 24, 1984)
    const birth = Math.floor(stat.birthtimeMs / 1000);
    const mtime = Math.floor(stat.mtimeMs / 1000);
    const dateAdded = birth >= MIN_TS ? birth : mtime >= MIN_TS ? mtime : undefined;
    tracks.push({ file, filePath, artist, title, duration, localGenres, ...(dateAdded != null ? { dateAdded } : {}) });
  }

  return tracks;
}
