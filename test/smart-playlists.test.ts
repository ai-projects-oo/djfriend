import { describe, it, expect } from 'vitest'
import {
  evaluateSmart, matchesRule, materializeSmartPlaylists, playStatsByFile, invalidRules, defaultRule, fieldKind, brokenSmartPlaylists, type SmartContext,
} from '../app/lib/smartPlaylists'
import { createPlaylist, addTracks, removeTracks, moveTracks, setSmartCriteria, freezeSmartPlaylist, duplicatePlaylist, parsePlaylistLibrary, EMPTY_PLAYLIST_LIBRARY } from '../app/lib/playlists'
import type { HistoryEntry, SmartCriteria, SmartRule, Song } from '../app/types'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 14)

const song = (file: string, over: Partial<Song> = {}): Song => ({
  file, artist: 'Artist', title: file, bpm: 124, key: 'A Minor', camelot: '8A', energy: 0.6, genres: ['Tech House'], ...over,
})

const lib: Song[] = [
  song('a', { bpm: 122, energy: 0.5, genres: ['Deep House'], camelot: '8A', semanticTags: { vibeTags: ['groovy'], moodTags: ['warm'], venueTags: [], timeOfNightTags: [], vocalType: 'instrumental' }, dateAdded: (NOW - 3 * DAY) / 1000, year: 2019, duration: 420 }),
  song('b', { bpm: 128, energy: 0.8, genres: ['Techno'], camelot: '9A', artist: 'Charlotte', semanticTags: { vibeTags: ['driving'], moodTags: ['dark'], venueTags: [], timeOfNightTags: [], vocalType: 'vocal' }, dateAdded: (NOW - 40 * DAY) / 1000, year: 2024, duration: 360 }),
  song('c', { bpm: 132, energy: 0.9, genres: ['Techno'], camelot: '3B', comment: 'peak weapon', year: 2025, duration: 300 }),
  song('d', { bpm: 0, energy: 0.2, genres: [], camelot: '', title: 'Untagged' }),
]

const history: HistoryEntry[] = [
  { id: 'h1', name: 'Fri', timestamp: NOW - 2 * DAY, tracks: [{ ...lib[1], slot: 0, targetEnergy: 0.8, harmonicWarning: false }], prefs: {} as HistoryEntry['prefs'], curve: [] },
  { id: 'h2', name: 'Sat', timestamp: NOW - 60 * DAY, tracks: [{ ...lib[1], slot: 0, targetEnergy: 0.8, harmonicWarning: false }, { ...lib[2], slot: 1, targetEnergy: 0.9, harmonicWarning: false }], prefs: {} as HistoryEntry['prefs'], curve: [] },
]

const ctx = (members: Record<string, string[]> = {}): SmartContext => ({
  now: NOW, stats: playStatsByFile(history), members: id => new Set(members[id] ?? []),
})
const rule = (field: SmartRule['field'], op: SmartRule['op'], value: string, value2?: string): SmartRule => ({ id: 'r', field, op, value, ...(value2 ? { value2 } : {}) })
const files = (c: SmartCriteria, m?: Record<string, string[]>) => evaluateSmart(c, lib, ctx(m)).map(s => s.file)

describe('rules', () => {
  it('numbers: between, is, greater/less than; unknown BPM never matches', () => {
    expect(files({ match: 'all', rules: [rule('bpm', 'between', '120', '128')] })).toEqual(['a', 'b'])
    expect(files({ match: 'all', rules: [rule('bpm', 'between', '128', '120')] })).toEqual(['a', 'b'])
    expect(files({ match: 'all', rules: [rule('energy', 'gt', '70')] })).toEqual(['b', 'c'])
    expect(files({ match: 'all', rules: [rule('year', 'lt', '2024')] })).toEqual(['a'])
    expect(files({ match: 'all', rules: [rule('duration', 'is', '6')] })).toEqual(['b'])
    expect(files({ match: 'all', rules: [rule('bpm', 'lt', '200')] })).toEqual(['a', 'b', 'c'])
  })

  it('text: contains / not contains / is, case-insensitive, across genres and tags', () => {
    expect(files({ match: 'all', rules: [rule('genre', 'contains', 'techno')] })).toEqual(['b', 'c'])
    expect(files({ match: 'all', rules: [rule('genre', 'notContains', 'techno')] })).toEqual(['a', 'd'])
    expect(files({ match: 'all', rules: [rule('genre', 'is', 'deep house')] })).toEqual(['a'])
    expect(files({ match: 'all', rules: [rule('vibe', 'contains', 'driv')] })).toEqual(['b'])
    expect(files({ match: 'all', rules: [rule('mood', 'is', 'warm')] })).toEqual(['a'])
    expect(files({ match: 'all', rules: [rule('comment', 'contains', 'peak')] })).toEqual(['c'])
    expect(files({ match: 'all', rules: [rule('artist', 'isNot', 'charlotte')] })).toEqual(['a', 'c', 'd'])
  })

  it('key: is, is not, and harmonically compatible', () => {
    expect(files({ match: 'all', rules: [rule('key', 'is', '8a')] })).toEqual(['a'])
    expect(files({ match: 'all', rules: [rule('key', 'compatible', '8A')] })).toEqual(['a', 'b'])
    expect(files({ match: 'all', rules: [rule('key', 'isNot', '8A')] })).toEqual(['b', 'c'])
  })

  it('vocals use the analysed vocal type', () => {
    expect(files({ match: 'all', rules: [rule('vocal', 'is', 'vocal')] })).toEqual(['b'])
    expect(files({ match: 'all', rules: [rule('vocal', 'isNot', 'vocal')] })).toEqual(['a'])
  })

  it('date added and last played: within / not within N days', () => {
    expect(files({ match: 'all', rules: [rule('dateAdded', 'inLast', '7')] })).toEqual(['a'])
    expect(files({ match: 'all', rules: [rule('lastPlayed', 'inLast', '7')] })).toEqual(['b'])
    expect(files({ match: 'all', rules: [rule('lastPlayed', 'notInLast', '30')] })).toEqual(['a', 'c', 'd'])
  })

  it('times in sets counts saved sets from History', () => {
    expect(files({ match: 'all', rules: [rule('setCount', 'is', '0')] })).toEqual(['a', 'd'])
    expect(files({ match: 'all', rules: [rule('setCount', 'gt', '1')] })).toEqual(['b'])
  })

  it('playlist membership', () => {
    expect(files({ match: 'all', rules: [rule('playlist', 'in', 'p1')] }, { p1: ['c', 'a'] })).toEqual(['a', 'c'])
    expect(files({ match: 'all', rules: [rule('playlist', 'notIn', 'p1')] }, { p1: ['c', 'a'] })).toEqual(['b', 'd'])
  })

  it('a rule with an unusable value matches nothing', () => {
    expect(matchesRule(lib[0], rule('bpm', 'gt', ''), ctx())).toBe(false)
    expect(matchesRule(lib[0], rule('genre', 'contains', '  '), ctx())).toBe(false)
    expect(matchesRule(lib[0], rule('key', 'is', '13A'), ctx())).toBe(false)
  })
})

describe('evaluateSmart', () => {
  it('match all vs any', () => {
    const rules = [rule('genre', 'contains', 'techno'), { ...rule('energy', 'lt', '60'), id: 'r2' }]
    expect(files({ match: 'all', rules })).toEqual([])
    expect(files({ match: 'any', rules })).toEqual(['a', 'b', 'c', 'd'])
  })

  it('no rules = whole library', () => {
    expect(files({ match: 'all', rules: [] })).toEqual(['a', 'b', 'c', 'd'])
  })

  it('limits by a chosen order', () => {
    const base = { match: 'all' as const, rules: [rule('bpm', 'gt', '100')] }
    expect(files({ ...base, limit: { count: 2, by: 'energy' } })).toEqual(['c', 'b'])
    expect(files({ ...base, limit: { count: 1, by: 'bpm' } })).toEqual(['a'])
    expect(files({ ...base, limit: { count: 1, by: 'dateAdded' } })).toEqual(['a'])
    expect(files({ ...base, limit: { count: 1, by: 'mostPlayed' } })).toEqual(['b'])
    expect(files({ ...base, limit: { count: 1, by: 'leastPlayed' } })).toEqual(['a'])
  })

  it('random limit is stable for the same playlist', () => {
    const c: SmartCriteria = { match: 'all', rules: [], limit: { count: 2, by: 'random' } }
    const first = evaluateSmart(c, lib, ctx(), 'seed').map(s => s.file)
    expect(evaluateSmart(c, lib, ctx(), 'seed').map(s => s.file)).toEqual(first)
    expect(first).toHaveLength(2)
  })
})

describe('materializeSmartPlaylists', () => {
  it('fills smart playlists, including ones that reference other playlists, and survives cycles', () => {
    let pl = createPlaylist(EMPTY_PLAYLIST_LIBRARY, { id: 'static', name: 'Static', now: 0, tracks: ['a', 'c'] })
    pl = createPlaylist(pl, { id: 'techno', name: 'Techno', now: 0, smart: { match: 'all', rules: [rule('genre', 'contains', 'techno')] } })
    pl = createPlaylist(pl, { id: 'both', name: 'Both', now: 0, smart: { match: 'all', rules: [rule('playlist', 'in', 'techno'), { ...rule('playlist', 'in', 'static'), id: 'r2' }] } })
    pl = createPlaylist(pl, { id: 'x', name: 'X', now: 0, smart: { match: 'all', rules: [rule('playlist', 'in', 'y')] } })
    pl = createPlaylist(pl, { id: 'y', name: 'Y', now: 0, smart: { match: 'all', rules: [rule('playlist', 'in', 'x')] } })
    const m = materializeSmartPlaylists(pl, lib, history, NOW)
    const tracks = (id: string) => m.playlists.find(p => p.id === id)!.tracks
    expect(tracks('static')).toEqual(['a', 'c'])
    expect(tracks('techno')).toEqual(['b', 'c'])
    expect(tracks('both')).toEqual(['c'])
    expect(tracks('x')).toEqual([])
    expect(tracks('y')).toEqual([])
  })

  it('playlists caught in a reference loop are empty whatever the evaluation order', () => {
    const build = (order: string[]) => {
      const defs: Record<string, SmartCriteria> = {
        A: { match: 'all', rules: [rule('playlist', 'in', 'B')] },
        B: { match: 'all', rules: [rule('playlist', 'notIn', 'A')] },
        C: { match: 'all', rules: [rule('playlist', 'in', 'A')] },
        D: { match: 'all', rules: [rule('genre', 'contains', 'techno')] },
      }
      let pl = EMPTY_PLAYLIST_LIBRARY
      for (const id of order) pl = createPlaylist(pl, { id, name: id, now: 0, smart: defs[id] })
      const m = materializeSmartPlaylists(pl, lib, history, NOW)
      return Object.fromEntries(m.playlists.map(p => [p.id, p.tracks]))
    }
    for (const order of [['A', 'B', 'C', 'D'], ['B', 'A', 'D', 'C'], ['C', 'D', 'B', 'A']]) {
      expect(build(order)).toEqual({ A: [], B: [], C: [], D: ['b', 'c'] })
    }
    expect(brokenSmartPlaylists(createPlaylist(EMPTY_PLAYLIST_LIBRARY, { id: 'S', name: 'S', now: 0, smart: { match: 'all', rules: [rule('playlist', 'in', 'S')] } }))).toEqual(new Set(['S']))
  })

  it('returns the same library object when there are no smart playlists', () => {
    const pl = createPlaylist(EMPTY_PLAYLIST_LIBRARY, { id: 's', name: 'S', now: 0, tracks: ['a'] })
    expect(materializeSmartPlaylists(pl, lib, history, NOW)).toBe(pl)
  })
})

describe('smart playlists in the playlist library', () => {
  const smart: SmartCriteria = { match: 'all', rules: [rule('bpm', 'gt', '125')] }
  const base = () => createPlaylist(EMPTY_PLAYLIST_LIBRARY, { id: 'p', name: 'Fast', now: 0, smart, tracks: ['ignored'] })

  it('ignores manual track edits', () => {
    const l = base()
    expect(l.playlists[0].tracks).toEqual([])
    // No change at all → same library object (nothing to save or undo)
    expect(addTracks(l, 'p', ['a'], 1)).toBe(l)
    expect(removeTracks(l, 'p', ['a'], 1)).toBe(l)
    expect(moveTracks(l, 'p', ['a'], 0, 1)).toBe(l)
  })

  it('updates rules, duplicates with rules, and freezes into a regular playlist', () => {
    const next: SmartCriteria = { match: 'any', rules: [rule('bpm', 'lt', '125')] }
    let l = setSmartCriteria(base(), 'p', next, 2)
    expect(l.playlists[0].smart).toEqual(next)
    l = duplicatePlaylist(l, 'p', 'p2', 3)
    expect(l.playlists[1].smart).toEqual(next)
    l = freezeSmartPlaylist(l, 'p', ['a', 'b', 'a'], 4)
    expect(l.playlists[0].smart).toBeUndefined()
    expect(l.playlists[0].tracks).toEqual(['a', 'b'])
  })

  it('survives a save/load round trip and drops malformed rules', () => {
    const raw = JSON.parse(JSON.stringify(base()))
    raw.playlists[0].smart.rules.push({ id: 'bad' })
    const loaded = parsePlaylistLibrary(raw)
    expect(loaded.playlists[0].smart?.rules.map(r => r.id)).toEqual(['r'])
    raw.playlists[0].smart = { match: 'nope', rules: [] }
    expect(parsePlaylistLibrary(raw).playlists[0].smart).toBeUndefined()
  })
})

describe('editor helpers', () => {
  it('flags rules that cannot match as written', () => {
    expect(invalidRules({ match: 'all', rules: [
      rule('bpm', 'between', '120'), { ...rule('genre', 'contains', ''), id: 'g' }, { ...rule('key', 'is', '8A'), id: 'k' }, { ...rule('dateAdded', 'inLast', '-1'), id: 'd' },
    ] })).toEqual(['r', 'g', 'd'])
  })
  it('default rules are valid', () => {
    for (const f of ['bpm', 'energy', 'key', 'vocal', 'dateAdded', 'setCount', 'year', 'duration'] as const) {
      expect(invalidRules({ match: 'all', rules: [defaultRule('x', f)] })).toEqual([])
    }
    expect(fieldKind('lastPlayed')).toBe('days')
  })
})
