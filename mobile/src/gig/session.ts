// The gig in progress (if any): which set, when it started, what's been played. Kept in a small
// file so a gig survives the app being closed or the phone restarting.
import { File, Paths } from 'expo-file-system';

export interface GigSession { setId: string; startedAt: number; played: string[] }

const sessionFile = () => new File(Paths.document, 'gig-session.json');

export function loadGigSession(): GigSession | null {
  const f = sessionFile();
  if (!f.exists) return null;
  try { return JSON.parse(f.textSync()) as GigSession; } catch { return null; }
}

export async function saveGigSession(session: GigSession): Promise<void> {
  const f = sessionFile();
  if (!f.exists) f.create();
  await f.write(JSON.stringify(session));
}

export function endGigSession(): void {
  const f = sessionFile();
  if (f.exists) f.delete();
}

/** The set log's record id for a gig. */
export const liveLogId = (s: Pick<GigSession, 'startedAt'>) => `live-${s.startedAt}`;
