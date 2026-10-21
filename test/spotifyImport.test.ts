// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { parsePlaylistId, matchInLibrary } from '../app/lib/spotifyImport'
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

describe('matchInLibrary artist joiners', () => {
  it('matches "Tiga, Audion" against "Tiga VS Audion"', () => {
    const lib = [{ file: 'a.mp3', artist: 'Tiga VS Audion', title: "Let's Go Dancing (Solomun Remix)" }] as unknown as Parameters<typeof matchInLibrary>[3];
    expect(matchInLibrary('x', "Let's Go Dancing - Solomun Remix", 'Tiga, Audion', lib)).toBe('fuzzy');
  });
});

describe('matchInLibrary with wrong spotify match / filename prefix', () => {
  it('matches via local title when spotifyTitle is a wrong match', () => {
    const lib = [{
      file: 'x.mp3', artist: 'Noir, Haze', title: '4A - 5 - Around (Extended Version)',
      spotifyTitle: 'Around - Solomun Vox', spotifyArtist: 'Noir',
    }] as unknown as Parameters<typeof matchInLibrary>[3];
    expect(matchInLibrary('x', 'Around - Extended Version', 'Noir, Haze', lib)).toBe('fuzzy');
  });
});
