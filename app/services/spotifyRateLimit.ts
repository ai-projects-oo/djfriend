// Non-negotiable: Spotify Web API calls are spaced at least 200ms apart (same rule as the server's
// limiter in src/api.ts). Every client-side Spotify request goes through spotifyRateLimited().

const SPOTIFY_MIN_GAP_MS = 200;
let queue: Promise<void> = Promise.resolve();
let lastCall = 0;

export function spotifyRateLimited(url: string, init: RequestInit = {}): Promise<Response> {
  const turn = queue.then(async () => {
    const wait = lastCall + SPOTIFY_MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastCall = Date.now();
  });
  queue = turn.catch(() => {});
  return turn.then(() => fetch(url, init));
}
