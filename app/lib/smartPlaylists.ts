import type { HistoryEntry, PlaylistLibrary, SmartCriteria, SmartField, SmartOp, SmartRule, Song } from '../types';
import { getCamelotCompatibility } from './camelot';

// Smart playlists: tracks are computed from rules, like Apple Music's smart playlists.
// Everything here is pure — `now` is passed in, and "random" limits use a stable seeded order.

const DAY = 86_400_000;

/** Facts about a track's use in saved sets, from History. */
export interface PlayStats { count: number; last: number }

export function playStatsByFile(history: HistoryEntry[]): Map<string, PlayStats> {
  const m = new Map<string, PlayStats>();
  for (const h of history) {
    for (const t of h.tracks) {
      const s = m.get(t.file);
      if (s) { s.count++; s.last = Math.max(s.last, h.timestamp); }
      else m.set(t.file, { count: 1, last: h.timestamp });
    }
  }
  return m;
}

// ─── Field metadata (drives the editor and evaluation) ───────────────────────

export type FieldKind = 'number' | 'text' | 'key' | 'vocal' | 'days' | 'playlist';

export const SMART_FIELDS: { field: SmartField; label: string; kind: FieldKind; unit?: string }[] = [
  { field: 'bpm',        label: 'BPM',            kind: 'number' },
  { field: 'key',        label: 'Key',            kind: 'key' },
  { field: 'energy',     label: 'Energy',         kind: 'number', unit: '0–100' },
  { field: 'genre',      label: 'Genre',          kind: 'text' },
  { field: 'vibe',       label: 'Vibe tag',       kind: 'text' },
  { field: 'mood',       label: 'Mood tag',       kind: 'text' },
  { field: 'vocal',      label: 'Vocals',         kind: 'vocal' },
  { field: 'artist',     label: 'Artist',         kind: 'text' },
  { field: 'title',      label: 'Title',          kind: 'text' },
  { field: 'comment',    label: 'Comment',        kind: 'text' },
  { field: 'year',       label: 'Year',           kind: 'number' },
  { field: 'duration',   label: 'Length',         kind: 'number', unit: 'min' },
  { field: 'dateAdded',  label: 'Date added',     kind: 'days' },
  { field: 'playlist',   label: 'Playlist',       kind: 'playlist' },
  { field: 'setCount',   label: 'Times in sets',  kind: 'number' },
  { field: 'lastPlayed', label: 'Last in a set',  kind: 'days' },
];

export const OPS_BY_KIND: Record<FieldKind, { op: SmartOp; label: string }[]> = {
  number:   [{ op: 'between', label: 'is between' }, { op: 'is', label: 'is' }, { op: 'gt', label: 'is greater than' }, { op: 'lt', label: 'is less than' }],
  text:     [{ op: 'contains', label: 'contains' }, { op: 'notContains', label: 'does not contain' }, { op: 'is', label: 'is' }, { op: 'isNot', label: 'is not' }],
  key:      [{ op: 'compatible', label: 'mixes with' }, { op: 'is', label: 'is' }, { op: 'isNot', label: 'is not' }],
  vocal:    [{ op: 'is', label: 'is' }, { op: 'isNot', label: 'is not' }],
  days:     [{ op: 'inLast', label: 'in the last (days)' }, { op: 'notInLast', label: 'not in the last (days)' }],
  playlist: [{ op: 'in', label: 'is' }, { op: 'notIn', label: 'is not' }],
};

export function fieldKind(field: SmartField): FieldKind {
  return SMART_FIELDS.find(f => f.field === field)?.kind ?? 'text';
}

/** A sensible starting rule for a field (used when the user picks a field in the editor). */
export function defaultRule(id: string, field: SmartField): SmartRule {
  const kind = fieldKind(field);
  const op = OPS_BY_KIND[kind][0].op;
  const value =
    field === 'bpm' ? '120' : field === 'energy' ? '60' : field === 'year' ? '2020' : field === 'duration' ? '5' :
    field === 'setCount' ? '0' : kind === 'key' ? '8A' : kind === 'vocal' ? 'instrumental' : kind === 'days' ? '30' : '';
  const value2 = op === 'between' ? (field === 'bpm' ? '128' : field === 'energy' ? '90' : field === 'year' ? '2026' : field === 'duration' ? '8' : '10') : undefined;
  return { id, field, op, value, ...(value2 !== undefined ? { value2 } : {}) };
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

export interface SmartContext {
  now: number;
  stats: Map<string, PlayStats>;
  /** Members of another playlist (static or smart) by id. */
  members: (playlistId: string) => Set<string>;
}

const num = (s: string | undefined): number | null => {
  if (s == null || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function numberValue(song: Song, field: SmartField, ctx: SmartContext): number | null {
  switch (field) {
    case 'bpm':      return song.bpm > 0 ? song.bpm : null;
    case 'energy':   return Math.round(song.energy * 100);
    case 'year':     return song.year ?? null;
    case 'duration': return song.duration != null ? song.duration / 60 : null;
    case 'setCount': return ctx.stats.get(song.file)?.count ?? 0;
    default:         return null;
  }
}

function textValues(song: Song, field: SmartField): string[] {
  switch (field) {
    case 'title':   return [song.title];
    case 'artist':  return [song.artist];
    case 'comment': return [song.comment ?? ''];
    case 'genre':   return song.genres;
    case 'vibe':    return song.semanticTags?.vibeTags ?? [];
    case 'mood':    return song.semanticTags?.moodTags ?? [];
    default:        return [];
  }
}

/** Whether one rule matches a song. Rules with an unusable value match nothing (and are flagged in the editor). */
export function matchesRule(song: Song, rule: SmartRule, ctx: SmartContext): boolean {
  const kind = fieldKind(rule.field);
  const op = rule.op;
  switch (kind) {
    case 'number': {
      const v = numberValue(song, rule.field, ctx);
      const a = num(rule.value), b = num(rule.value2);
      if (v == null || a == null) return false;
      if (op === 'is') return Math.round(v) === Math.round(a);
      if (op === 'gt') return v > a;
      if (op === 'lt') return v < a;
      if (op === 'between') return b != null && v >= Math.min(a, b) && v <= Math.max(a, b);
      return false;
    }
    case 'text': {
      const q = rule.value.trim().toLowerCase();
      if (!q) return false;
      const values = textValues(song, rule.field).map(v => v.toLowerCase());
      if (op === 'contains') return values.some(v => v.includes(q));
      if (op === 'notContains') return !values.some(v => v.includes(q));
      if (op === 'is') return values.some(v => v === q);
      if (op === 'isNot') return !values.some(v => v === q);
      return false;
    }
    case 'key': {
      const key = rule.value.trim().toUpperCase();
      if (!/^(1[0-2]|[1-9])[AB]$/.test(key) || !song.camelot) return false;
      const own = song.camelot.toUpperCase();
      if (op === 'is') return own === key;
      if (op === 'isNot') return own !== key;
      if (op === 'compatible') return getCamelotCompatibility(key, own) !== 'incompatible';
      return false;
    }
    case 'vocal': {
      const v = song.semanticTags?.vocalType;
      if (!v) return false;
      return op === 'is' ? v === rule.value : op === 'isNot' ? v !== rule.value : false;
    }
    case 'days': {
      const days = num(rule.value);
      if (days == null || days < 0) return false;
      const ts = rule.field === 'dateAdded'
        ? (song.dateAdded != null ? song.dateAdded * 1000 : null)
        : (ctx.stats.get(song.file)?.last ?? null);
      const recent = ts != null && ctx.now - ts <= days * DAY;
      return op === 'inLast' ? recent : op === 'notInLast' ? !recent : false;
    }
    case 'playlist': {
      if (!rule.value) return false;
      const has = ctx.members(rule.value).has(song.file);
      return op === 'in' ? has : op === 'notIn' ? !has : false;
    }
  }
}

// Stable pseudo-random order: hash of (seed, file), so "random 50" doesn't reshuffle on every render
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Applies a smart playlist's rules (and limit) to the library. */
export function evaluateSmart(criteria: SmartCriteria, songs: Song[], ctx: SmartContext, seed = ''): Song[] {
  const rules = criteria.rules;
  let out = rules.length === 0
    ? [...songs]
    : songs.filter(s => (criteria.match === 'all' ? rules.every(r => matchesRule(s, r, ctx)) : rules.some(r => matchesRule(s, r, ctx))));

  const limit = criteria.limit;
  if (limit && limit.count > 0 && out.length > limit.count) {
    const plays = (s: Song) => ctx.stats.get(s.file)?.count ?? 0;
    const cmp: Record<typeof limit.by, (a: Song, b: Song) => number> = {
      random:      (a, b) => hash(seed + a.file) - hash(seed + b.file),
      bpm:         (a, b) => a.bpm - b.bpm,
      energy:      (a, b) => b.energy - a.energy,
      dateAdded:   (a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0),
      title:       (a, b) => a.title.localeCompare(b.title),
      mostPlayed:  (a, b) => plays(b) - plays(a),
      leastPlayed: (a, b) => plays(a) - plays(b),
    };
    out = [...out].sort(cmp[limit.by]).slice(0, limit.count);
  }
  return out;
}

/**
 * Returns the library with every smart playlist's `tracks` filled in from its rules.
 * Smart playlists may reference other playlists (smart or not); reference cycles resolve to empty.
 */
export function materializeSmartPlaylists(lib: PlaylistLibrary, songs: Song[], history: HistoryEntry[], now: number): PlaylistLibrary {
  if (!lib.playlists.some(p => p.smart)) return lib;
  const stats = playStatsByFile(history);
  const byId = new Map(lib.playlists.map(p => [p.id, p]));
  const resolved = new Map<string, Set<string>>();
  const inProgress = new Set<string>();

  const members = (id: string): Set<string> => {
    const cached = resolved.get(id);
    if (cached) return cached;
    const p = byId.get(id);
    if (!p) return new Set();
    if (!p.smart) { const s = new Set(p.tracks); resolved.set(id, s); return s; }
    if (inProgress.has(id)) return new Set();   // cycle
    inProgress.add(id);
    const files = evaluateSmart(p.smart, songs, { now, stats, members }, p.id).map(s => s.file);
    inProgress.delete(id);
    const set = new Set(files);
    resolved.set(id, set);
    order.set(id, files);
    return set;
  };
  const order = new Map<string, string[]>();

  return {
    ...lib,
    playlists: lib.playlists.map(p => {
      if (!p.smart) return p;
      members(p.id);
      return { ...p, tracks: order.get(p.id) ?? [] };
    }),
  };
}

/** Rules that can't match anything as written (empty value, bad number, unknown key) — shown as warnings. */
export function invalidRules(criteria: SmartCriteria): string[] {
  return criteria.rules.filter(r => {
    const kind = fieldKind(r.field);
    if (kind === 'number') return num(r.value) == null || (r.op === 'between' && num(r.value2) == null);
    if (kind === 'key') return !/^(1[0-2]|[1-9])[AB]$/i.test(r.value.trim());
    if (kind === 'days') return num(r.value) == null || num(r.value)! < 0;
    return !r.value.trim();
  }).map(r => r.id);
}
