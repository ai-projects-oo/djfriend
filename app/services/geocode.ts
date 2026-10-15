// Reverse geocoding via OpenStreetMap Nominatim.
// Usage policy (operations.osmfoundation.org/policies/nominatim): max 1 request/second,
// identify the application, attribute OSM. Requests here are user-initiated (map click/drag) only.

const MIN_INTERVAL_MS = 1100;
let lastRequest = 0;
let chain: Promise<unknown> = Promise.resolve();

export interface ReverseGeocode { city?: string; town?: string; village?: string; country?: string }

/** Throttled to one request per ~1.1 s; concurrent calls queue behind each other. */
export function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocode | undefined> {
  const run = async () => {
    const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequest = Date.now();
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=en`,
      { headers: { 'User-Agent': 'DJFriend/1.0' } },
    );
    if (!resp.ok) throw new Error(`Nominatim ${resp.status}`);
    const data = await resp.json() as { address?: ReverseGeocode };
    return data.address;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}
