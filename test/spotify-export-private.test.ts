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
    if (url.endsWith('/v1/me/playlists')) {
      return Response.json({ id: 'pl1', public: opts.createReturnsPublic ?? false, external_urls: { spotify: 'https://open.spotify.com/playlist/pl1' } })
    }
    if (method === 'PUT' && url.endsWith('/v1/playlists/pl1')) {
      return opts.privateFails ? Response.json({ error: { message: 'Forbidden' } }, { status: 403 }) : new Response(null, { status: 200 })
    }
    if (url.endsWith('/v1/playlists/pl1?fields=public')) return Response.json({ public: !!opts.staysPublic })
    if (url.endsWith('/v1/playlists/pl1/items')) return Response.json({ snapshot_id: 's' })
    return new Response(null, { status: 404 })
  }) as typeof fetch
  return calls
}

afterEach(() => vi.restoreAllMocks())

describe('Spotify playlists created by DJFriend ask to be private', () => {
  it('"Don\'t have" playlist: created with public:false, then set private before tracks are added', async () => {
    const calls = mockSpotify({ createReturnsPublic: true })
    const result = await createPlaylistFromSpotifyIds(['a', 'b'], "Don't have from Mix", 'tok')

    const create = calls.find(c => c.url.endsWith('/v1/me/playlists'))
    expect(create?.method).toBe('POST')
    expect(create?.body).toMatchObject({ name: "Don't have from Mix", public: false })

    const priv = calls.findIndex(c => c.method === 'PUT' && c.url.endsWith('/v1/playlists/pl1'))
    const addTracks = calls.findIndex(c => c.url.endsWith('/v1/playlists/pl1/items'))
    expect(priv).toBeGreaterThan(-1)
    expect(calls[priv].body).toEqual({ public: false })
    expect(priv).toBeLessThan(addTracks)
    expect(result).toEqual({ playlistUrl: 'https://open.spotify.com/playlist/pl1', count: 2, isPublic: false })
  })

  it('set export playlist is made private too', async () => {
    const calls = mockSpotify()
    const match = { uri: 'spotify:track:x' } as NonNullable<SpotifyMatchResult['match']>
    await createPlaylistFromMatches([{ match, excluded: false } as SpotifyMatchResult], 'Friday set', 'tok')
    expect(calls.some(c => c.method === 'PUT' && c.url.endsWith('/v1/playlists/pl1') && (c.body as { public?: boolean }).public === false)).toBe(true)
  })

  it('when Spotify keeps it public, still adds the tracks and reports isPublic so the UI can say so', async () => {
    const calls = mockSpotify({ staysPublic: true })
    const result = await createPlaylistFromSpotifyIds(['a'], 'X', 'tok')
    expect(result.isPublic).toBe(true)
    expect(calls.some(c => c.url.endsWith('/v1/playlists/pl1/items'))).toBe(true)
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
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

  it('a failed make-private request does not lose the playlist; it is reported as public', async () => {
    mockSpotify({ privateFails: true, staysPublic: true })
    const result = await createPlaylistFromSpotifyIds(['a'], 'X', 'tok')
    expect(result.isPublic).toBe(true)
  })

  it('set export reports isPublic too', async () => {
    mockSpotify({ staysPublic: true })
    const match = { uri: 'spotify:track:x' } as NonNullable<SpotifyMatchResult['match']>
    const r = await createPlaylistFromMatches([{ match, excluded: false } as SpotifyMatchResult], 'Friday set', 'tok')
    expect(r.isPublic).toBe(true)
  })
})
