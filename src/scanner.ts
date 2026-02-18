import fs from 'fs';
import path from 'path';
import * as mm from 'music-metadata';
import { ScannedTrack } from './types';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.aac', '.m4a', '.wav', '.ogg', '.opus']);

function parseFilename(filename: string): { artist: string | null; title: string } {
  const name = path.basename(filename, path.extname(filename));
  const dashIndex = name.indexOf(' - ');
  if (dashIndex !== -1) {
    return {
      artist: name.slice(0, dashIndex).trim(),
      title: name.slice(dashIndex + 3).trim(),
    };
  }
  return { artist: null, title: name.trim() };
}

export async function scanFolder(folderPath: string): Promise<ScannedTrack[]> {
  const entries = fs.readdirSync(folderPath);
  const audioFiles = entries.filter(f => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()));

  const tracks: ScannedTrack[] = [];

  for (const file of audioFiles) {
    const filePath = path.join(folderPath, file);
    let artist: string | null = null;
    let title = '';

    try {
      const meta = await mm.parseFile(filePath, { duration: false });
      artist = meta.common.artist ?? null;
      title = meta.common.title ?? '';
    } catch {
      // ignore metadata parse errors, fall through to filename parsing
    }

    // Fall back to filename parsing if tags are missing
    if (!title) {
      const parsed = parseFilename(file);
      artist = artist ?? parsed.artist;
      title = parsed.title;
    }

    tracks.push({ file, filePath, artist, title });
  }

  return tracks;
}
