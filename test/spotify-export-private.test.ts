import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPlaylistFromSpotifyIds, createPlaylistFromMatches } from '../app/services/spotifyExport'
import type { SpotifyMatchResult } from '../app/services/spotifyExport'

interface Call { url: string; method: string; body?: unknown }

function mockSpotify(opts: { createReturnsPublic?: boolean; privateFails?: boolean; staysPublic?: boolean } = {}) {
  const calls: Call[] = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/v1/me')) return Response.json({ id: 'dj' })
    if (url.includes('/v1/users/dj/playlists')) {
      return Response.json({ id: 'pl1', public: opts.createReturnsPublic ?? false, external_urls: { spotify: 'https://open.spotify.com/playlist/pl1' } })
    }
    if (method === 'PUT' && url.endsWith('/v1/playlists/pl1')) {
      return opts.privateFails ? Response.json({ error: { message: 'Forbidden' } }, { status: 403 }) : new Response(null, { status: 200 })
    }
    if (url.endsWith('/v1/playlists/pl1?fields=public')) return Response.json({ public: !!opts.staysPublic })
    if (url.endsWith('/v1/playlists/pl1/tracks')) return Response.json({ snapshot_id: 's' })
    return new Response(null, { status: 404 })
  }) as typeof fetch
  return calls
}

afterEach(() => vi.restoreAllMocks())

describe('Spotify playlists created by DJFriend are private', () => {
  it('"Don\'t have" playlist: created with public:false, then set private before tracks are added', async () => {
    const calls = mockSpotify({ createReturnsPublic: true })
    const result = await createPlaylistFromSpotifyIds(['a', 'b'], "Don't have from Mix", 'tok')

    const create = calls.find(c => c.url.includes('/v1/users/dj/playlists'))
    expect(create?.method).toBe('POST')
    expect(create?.body).toMatchObject({ name: "Don't have from Mix", public: false })

    const priv = calls.findIndex(c => c.method === 'PUT' && c.url.endsWith('/v1/playlists/pl1'))
    const addTracks = calls.findIndex(c => c.url.endsWith('/v1/playlists/pl1/tracks'))
    expect(priv).toBeGreaterThan(-1)
    expect(calls[priv].body).toEqual({ public: false })
    expect(priv).toBeLessThan(addTracks)
    expect(result).toEqual({ playlistUrl: 'https://open.spotify.com/playlist/pl1', count: 2 })
  })

  it('set export playlist is made private too', async () => {
    const calls = mockSpotify()
    const match = { uri: 'spotify:track:x' } as NonNullable<SpotifyMatchResult['match']>
    await createPlaylistFromMatches([{ match, excluded: false } as SpotifyMatchResult], 'Friday set', 'tok')
    expect(calls.some(c => c.method === 'PUT' && c.url.endsWith('/v1/playlists/pl1') && (c.body as { public?: boolean }).public === false)).toBe(true)
  })

  it('checks the playlist really is private before adding tracks, and removes it if not', async () => {
    const calls = mockSpotify({ staysPublic: true })
    await expect(createPlaylistFromSpotifyIds(['a'], 'X', 'tok')).rejects.toThrow(/kept it public/)
    expect(calls.some(c => c.url.endsWith('/v1/playlists/pl1/tracks'))).toBe(false)
    expect(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/v1/playlists/pl1/followers'))).toBe(true)
  })

  it('spaces Spotify calls at least 200ms apart', async () => {
    const calls = mockSpotify()
    const times: number[] = []
    const orig = globalThis.fetch
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => { times.push(Date.now()); return orig(...args) }) as typeof fetch
    await createPlaylistFromSpotifyIds(['a'], 'X', 'tok')
    expect(calls.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(195)
  })

  it('reports an error instead of silently leaving the playlist public', async () => {
    mockSpotify({ privateFails: true })
    await expect(createPlaylistFromSpotifyIds(['a'], 'X', 'tok')).rejects.toThrow(/couldn't make the playlist private/)
  })
})
