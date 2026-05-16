// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { parsePlaylistId, matchInLibrary, spotifyTrackToSong } from '../app/lib/spotifyImport'
import type { SpotifyImportTrack, SpotifyAudioFeatures } from '../app/lib/spotifyImport'
import type { Song } from '../app/types'

describe('parsePlaylistId', () => {
  it('extracts ID from a full Spotify playlist URL', () => {
    expect(parsePlaylistId('https://open.spotify.com/playlist/37i9dQZF1DX7KNcFbJKQVd?si=abc')).toBe('37i9dQZF1DX7KNcFbJKQVd')
  })

  it('extracts ID from URL without query params', () => {
    expect(parsePlaylistId('https://open.spotify.com/playlist/37i9dQZF1DX7KNcFbJKQVd')).toBe('37i9dQZF1DX7KNcFbJKQVd')
  })

  it('accepts a raw 22-character alphanumeric ID', () => {
    expect(parsePlaylistId('37i9dQZF1DX7KNcFbJKQVd')).toBe('37i9dQZF1DX7KNcFbJKQVd')
  })

  it('trims whitespace from raw ID', () => {
    expect(parsePlaylistId('  37i9dQZF1DX7KNcFbJKQVd  ')).toBe('37i9dQZF1DX7KNcFbJKQVd')
  })

  it('returns null for a short invalid ID', () => {
    expect(parsePlaylistId('tooshort')).toBeNull()
  })

  it('returns null for an ID that is too long', () => {
    expect(parsePlaylistId('37i9dQZF1DX7KNcFbJKQVdXXX')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parsePlaylistId('')).toBeNull()
  })

  it('returns null for a random URL with no playlist segment', () => {
    expect(parsePlaylistId('https://open.spotify.com/album/abc')).toBeNull()
  })
})

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    filePath: 'test.mp3',
    file: 'test.mp3',
    artist: 'Artist',
    title: 'Title',
    bpm: 128,
    key: 'C Major',
    camelot: '8B',
    energy: 0.7,
    genres: [],
    spotifyId: undefined,
    spotifyArtist: undefined,
    spotifyTitle: undefined,
    ...overrides,
  }
}

describe('matchInLibrary', () => {
  it('returns false for empty library', () => {
    expect(matchInLibrary('id1', 'Title', 'Artist', [])).toBe(false)
  })

  it('returns "exact" when spotifyId matches', () => {
    const lib = [makeSong({ spotifyId: 'abc123' })]
    expect(matchInLibrary('abc123', 'Anything', 'Anyone', lib)).toBe('exact')
  })

  it('returns false when spotifyId does not match and title/artist differ', () => {
    const lib = [makeSong({ spotifyId: 'abc123', title: 'Other Song', artist: 'Other Artist' })]
    expect(matchInLibrary('xyz999', 'My Song', 'My Artist', lib)).toBe(false)
  })

  it('returns a truthy match on normalized title + artist match', () => {
    const lib = [makeSong({ title: 'Blue Monday', artist: 'New Order', spotifyId: undefined })]
    expect(matchInLibrary('', 'Blue Monday', 'New Order', lib)).toBeTruthy()
  })

  it('is case-insensitive for title/artist match', () => {
    const lib = [makeSong({ title: 'Blue Monday', artist: 'New Order', spotifyId: undefined })]
    expect(matchInLibrary('', 'blue monday', 'new order', lib)).toBeTruthy()
  })

  it('returns a truthy match when artist is a substring of library artist', () => {
    const lib = [makeSong({ title: 'Track', artist: 'Artist A, Artist B', spotifyId: undefined })]
    expect(matchInLibrary('', 'Track', 'Artist A', lib)).toBeTruthy()
  })

  it('uses spotifyTitle/spotifyArtist for matching when present', () => {
    const lib = [makeSong({ title: 'Local Title', artist: 'Local Artist', spotifyTitle: 'Spotify Title', spotifyArtist: 'Spotify Artist', spotifyId: undefined })]
    expect(matchInLibrary('', 'Spotify Title', 'Spotify Artist', lib)).toBeTruthy()
  })
})

// ─── spotifyTrackToSong ───────────────────────────────────────────────────────

function makeTrack(overrides: Partial<SpotifyImportTrack> = {}): SpotifyImportTrack {
  return { spotifyId: 'abc123', title: 'Test Track', artist: 'Test Artist', ...overrides }
}

function makeFeatures(overrides: Partial<SpotifyAudioFeatures> = {}): SpotifyAudioFeatures {
  return { id: 'abc123', tempo: 128.0, energy: 0.75, key: 0, mode: 1, duration_ms: 210000, ...overrides }
}

describe('spotifyTrackToSong', () => {
  it('sets file to spotify:{id}', () => {
    const song = spotifyTrackToSong(makeTrack(), makeFeatures())
    expect(song.file).toBe('spotify:abc123')
  })

  it('sets spotifyOnly to true', () => {
    const song = spotifyTrackToSong(makeTrack(), makeFeatures())
    expect(song.spotifyOnly).toBe(true)
  })

  it('converts key=0 mode=1 (C major) to camelot 8B', () => {
    const song = spotifyTrackToSong(makeTrack(), makeFeatures({ key: 0, mode: 1 }))
    expect(song.camelot).toBe('8B')
    expect(song.key).toBe('C Major')
  })

  it('converts key=0 mode=0 (C minor) to camelot 5A', () => {
    const song = spotifyTrackToSong(makeTrack(), makeFeatures({ key: 0, mode: 0 }))
    expect(song.camelot).toBe('5A')
    expect(song.key).toBe('C Minor')
  })

  it('converts key=9 mode=1 (A major) to camelot 11B', () => {
    const song = spotifyTrackToSong(makeTrack(), makeFeatures({ key: 9, mode: 1 }))
    expect(song.camelot).toBe('11B')
    expect(song.key).toBe('A Major')
  })

  it('converts key=11 mode=1 (B major) to camelot 1B', () => {
    const song = spotifyTrackToSong(makeTrack(), makeFeatures({ key: 11, mode: 1 }))
    expect(song.camelot).toBe('1B')
  })

  it('falls back to pitch class 0 when key is -1 (unknown)', () => {
    const song = spotifyTrackToSong(makeTrack(), makeFeatures({ key: -1, mode: 1 }))
    expect(song.camelot).toBe('8B') // C major fallback
  })

  it('rounds BPM to 1 decimal place', () => {
    const song = spotifyTrackToSong(makeTrack(), makeFeatures({ tempo: 127.9876 }))
    expect(song.bpm).toBe(128.0)
  })

  it('rounds energy to 3 decimal places', () => {
    const song = spotifyTrackToSong(makeTrack(), makeFeatures({ energy: 0.749567 }))
    expect(song.bpm).toBeGreaterThan(0)
    expect(song.energy).toBe(0.75)
  })

  it('converts duration_ms to seconds', () => {
    const song = spotifyTrackToSong(makeTrack(), makeFeatures({ duration_ms: 210000 }))
    expect(song.duration).toBe(210)
  })

  it('preserves title and artist from the import track', () => {
    const song = spotifyTrackToSong(makeTrack({ title: 'My Track', artist: 'My Artist' }), makeFeatures())
    expect(song.title).toBe('My Track')
    expect(song.artist).toBe('My Artist')
  })

  it('sets spotifyId on the song', () => {
    const song = spotifyTrackToSong(makeTrack({ spotifyId: 'xyz999' }), makeFeatures({ id: 'xyz999' }))
    expect(song.spotifyId).toBe('xyz999')
  })

  it('sets genres to empty array', () => {
    const song = spotifyTrackToSong(makeTrack(), makeFeatures())
    expect(song.genres).toEqual([])
  })
})
