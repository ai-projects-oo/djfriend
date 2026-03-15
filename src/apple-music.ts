import { execSync } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ScannedTrack } from './types';

function findLibraryPath(): string {
  const candidates = [
    path.join(os.homedir(), 'Music/Music/Music Library.xml'),
    path.join(os.homedir(), 'Music/iTunes/iTunes Music Library.xml'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    'Apple Music library XML not found.\n' +
    'Enable it in Music app: Settings → Advanced → "Share Music Library XML with other applications"'
  );
}

function parseLibrary(libraryPath: string): Record<string, unknown> {
  const json = execSync(`plutil -convert json -o - "${libraryPath}"`, {
    maxBuffer: 200 * 1024 * 1024,
  });
  return JSON.parse(json.toString());
}

interface ApplePlaylist {
  name: string;
  trackIds: number[];
}

function getPlaylists(library: Record<string, unknown>): ApplePlaylist[] {
  const raw = (library['Playlists'] as Record<string, unknown>[]) ?? [];
  return raw
    .filter(p =>
      Array.isArray(p['Playlist Items']) &&
      !p['Master'] &&
      !p['Distinguished Kind'] &&
      !p['Folder']
    )
    .map(p => ({
      name: p['Name'] as string,
      trackIds: (p['Playlist Items'] as Record<string, unknown>[]).map(
        item => item['Track ID'] as number
      ),
    }));
}

function promptSelection(playlists: ApplePlaylist[]): Promise<ApplePlaylist> {
  console.log('\nAvailable playlists:\n');
  playlists.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.name} (${p.trackIds.length} track${p.trackIds.length === 1 ? '' : 's'})`);
  });
  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.question('Choose a playlist (number): ', answer => {
      rl.close();
      const idx = parseInt(answer.trim(), 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= playlists.length) {
        reject(new Error(`Invalid selection: "${answer}"`));
      } else {
        resolve(playlists[idx]);
      }
    });
  });
}

export async function getTracksFromPlaylist(): Promise<{ tracks: ScannedTrack[]; playlistName: string }> {
  const libraryPath = findLibraryPath();
  console.log('Reading Apple Music library...');
  const library = parseLibrary(libraryPath);

  const playlists = getPlaylists(library);
  if (playlists.length === 0) {
    throw new Error('No user playlists found in Apple Music library.');
  }

  const selected = await promptSelection(playlists);
  const rawTracks = (library['Tracks'] as Record<string, Record<string, unknown>>) ?? {};

  const tracks: ScannedTrack[] = [];
  for (const id of selected.trackIds) {
    const t = rawTracks[String(id)];
    if (!t?.Location) continue;

    // Location is a file:// URL with percent-encoded characters
    const filePath = decodeURIComponent(new URL(t.Location as string).pathname);
    if (!fs.existsSync(filePath)) continue;

    tracks.push({
      file: path.basename(filePath),
      filePath,
      artist: (t.Artist as string) ?? null,
      title: (t.Name as string) ?? path.basename(filePath, path.extname(filePath)),
      duration: typeof t['Total Time'] === 'number' ? (t['Total Time'] as number) / 1000 : null,
      localGenres: typeof t['Genre'] === 'string' ? [(t['Genre'] as string)] : [],
    });
  }

  return { tracks, playlistName: selected.name };
}
