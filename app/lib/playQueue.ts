// Play queue for the app-wide player. Pure: every function returns a new queue.
// The queue holds track keys (Song.file); `index` points at the current track (-1 = nothing).

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayQueue {
  items: string[];
  index: number;
  repeat: RepeatMode;
  shuffle: boolean;
  /** Order before shuffling, so turning shuffle off restores it. */
  unshuffled?: string[];
}

export const EMPTY_QUEUE: PlayQueue = { items: [], index: -1, repeat: 'off', shuffle: false };

export function current(q: PlayQueue): string | null {
  return q.index >= 0 && q.index < q.items.length ? q.items[q.index] : null;
}

/** Upcoming tracks after the current one. */
export function upNext(q: PlayQueue): string[] {
  return q.items.slice(q.index + 1);
}

// Seeded shuffle (mulberry32) — pure given the seed
function shuffled<T>(list: T[], seed: number): T[] {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Replaces the queue with `files`, starting at `start`. With shuffle on, the rest is shuffled after the first track. */
export function playList(q: PlayQueue, files: string[], start = 0, seed = 0): PlayQueue {
  const items = [...new Set(files)];
  if (items.length === 0) return { ...q, items: [], index: -1, unshuffled: undefined };
  const at = Math.max(0, Math.min(start, items.length - 1));
  if (!q.shuffle) return { ...q, items, index: at, unshuffled: undefined };
  const first = items[at];
  return { ...q, items: [first, ...shuffled(items.filter((_, i) => i !== at), seed)], index: 0, unshuffled: items };
}

/** Inserts tracks right after the current one ("Play Next"). Tracks already queued later are moved. */
export function playNext(q: PlayQueue, files: string[]): PlayQueue {
  const cur = current(q);
  const adding = [...new Set(files)].filter(f => f !== cur);
  if (adding.length === 0) return q;
  const set = new Set(adding);
  const before = q.items.slice(0, q.index + 1).filter(f => !set.has(f) || f === cur);
  const after = q.items.slice(q.index + 1).filter(f => !set.has(f));
  const index = cur ? before.length - 1 : -1;
  const items = [...before, ...adding, ...after];
  return { ...q, items, index: index < 0 && items.length ? 0 : index };
}

/** Appends tracks to the end ("Play Later"), skipping ones already waiting in the queue. */
export function playLater(q: PlayQueue, files: string[]): PlayQueue {
  const waiting = new Set(upNext(q));
  const adding = [...new Set(files)].filter(f => !waiting.has(f) && f !== current(q));
  if (adding.length === 0) return q;
  const items = [...q.items, ...adding];
  return { ...q, items, index: q.index < 0 ? q.items.length : q.index };
}

/** Moves to the next track. Returns the same queue at the end of the list (repeat off). */
export function next(q: PlayQueue, opts: { auto?: boolean } = {}): PlayQueue {
  if (q.items.length === 0) return q;
  if (opts.auto && q.repeat === 'one') return q;   // song ended: replay it
  if (q.index + 1 < q.items.length) return { ...q, index: q.index + 1 };
  return q.repeat === 'all' ? { ...q, index: 0 } : q;
}

export function hasNext(q: PlayQueue): boolean {
  return q.index + 1 < q.items.length || (q.repeat === 'all' && q.items.length > 0);
}

export function prev(q: PlayQueue): PlayQueue {
  if (q.items.length === 0) return q;
  if (q.index > 0) return { ...q, index: q.index - 1 };
  return q.repeat === 'all' ? { ...q, index: q.items.length - 1 } : q;
}

export function hasPrev(q: PlayQueue): boolean {
  return q.index > 0 || (q.repeat === 'all' && q.items.length > 1);
}

/** Jumps to a track already in the queue. */
export function jumpTo(q: PlayQueue, index: number): PlayQueue {
  return index >= 0 && index < q.items.length ? { ...q, index } : q;
}

/** Removes a queued track (by position). Removing the current track keeps playback at the same position. */
export function removeAt(q: PlayQueue, index: number): PlayQueue {
  if (index < 0 || index >= q.items.length) return q;
  const items = q.items.filter((_, i) => i !== index);
  let i = q.index;
  if (index < q.index) i--;
  if (i >= items.length) i = items.length - 1;
  return { ...q, items, index: items.length ? i : -1 };
}

/** Moves a queued track from one position to another, keeping the current track current. */
export function moveInQueue(q: PlayQueue, from: number, to: number): PlayQueue {
  if (from === to || from < 0 || from >= q.items.length) return q;
  const cur = current(q);
  const items = [...q.items];
  const [moved] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(to, items.length)), 0, moved);
  return { ...q, items, index: cur ? items.indexOf(cur) : q.index };
}

/** Drops everything after the current track. */
export function clearUpNext(q: PlayQueue): PlayQueue {
  return { ...q, items: q.items.slice(0, q.index + 1), unshuffled: undefined };
}

export function cycleRepeat(q: PlayQueue): PlayQueue {
  const order: RepeatMode[] = ['off', 'all', 'one'];
  return { ...q, repeat: order[(order.indexOf(q.repeat) + 1) % order.length] };
}

/** Shuffle on: shuffles the tracks after the current one. Off: restores the original order. */
export function toggleShuffle(q: PlayQueue, seed = 0): PlayQueue {
  const cur = current(q);
  if (q.shuffle) {
    const base = q.unshuffled ?? q.items;
    const kept = new Set(q.items);
    const items = base.filter(f => kept.has(f)).concat(q.items.filter(f => !base.includes(f)));
    return { ...q, shuffle: false, items, index: cur ? items.indexOf(cur) : q.index, unshuffled: undefined };
  }
  const head = q.items.slice(0, q.index + 1);
  const items = [...head, ...shuffled(q.items.slice(q.index + 1), seed)];
  return { ...q, shuffle: true, items, unshuffled: q.items };
}
