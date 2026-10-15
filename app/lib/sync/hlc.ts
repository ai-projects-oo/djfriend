// Hybrid logical clock — orders edits across devices even when their wall clocks disagree.
import type { Hlc } from '../../types';

export function compareHlc(a: Hlc, b: Hlc): number {
  return a.t - b.t || a.c - b.c || (a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
}

/** Next timestamp for a local edit. */
export function tickHlc(prev: Hlc | null, now: number, device: string): Hlc {
  if (!prev || now > prev.t) return { t: now, c: 0, d: device };
  return { t: prev.t, c: prev.c + 1, d: device };
}

/** Clock after seeing a remote timestamp, so later local edits sort after it. */
export function receiveHlc(local: Hlc | null, remote: Hlc, now: number, device: string): Hlc {
  const t = Math.max(now, remote.t, local?.t ?? 0);
  let c = 0;
  if (local && t === local.t && t === remote.t) c = Math.max(local.c, remote.c) + 1;
  else if (local && t === local.t) c = local.c + 1;
  else if (t === remote.t) c = remote.c + 1;
  return { t, c, d: device };
}
