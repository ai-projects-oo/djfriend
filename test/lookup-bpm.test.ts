import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock axios before importing the module under test
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

import axios from 'axios'
import { getAudioFeatures } from '../src/spotify'

const mockedGet = vi.mocked(axios.get)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getAudioFeatures — BPM lookup', () => {
  it('returns correct BPM from Spotify audio features', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { tempo: 122.5, key: 7, mode: 0, energy: 0.73 },
    })

    const result = await getAudioFeatures('spotify-id-123', 'fake-token')

    expect(result).not.toBeNull()
    expect(result!.bpm).toBe(123) // Math.round(122.5)
    expect(result!.key).toBe(7)
    expect(result!.mode).toBe(0)
    expect(result!.energy).toBeCloseTo(0.73)
  })

  it('rounds tempo to nearest integer', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { tempo: 61.4, key: 0, mode: 1, energy: 0.5 },
    })

    const result = await getAudioFeatures('id', 'token')
    expect(result!.bpm).toBe(61)
  })

  it('returns null when tempo is missing from response', async () => {
    mockedGet.mockResolvedValueOnce({ data: { key: 5, mode: 1, energy: 0.6 } })

    const result = await getAudioFeatures('id', 'token')
    expect(result).toBeNull()
  })

  it('returns null when data is null', async () => {
    mockedGet.mockResolvedValueOnce({ data: null })

    const result = await getAudioFeatures('id', 'token')
    expect(result).toBeNull()
  })

  it('returns null when the Spotify request throws', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network error'))

    const result = await getAudioFeatures('id', 'token')
    expect(result).toBeNull()
  })

  it('returns null for a 404 (track not found on Spotify)', async () => {
    mockedGet.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { response: { status: 404 } }))

    const result = await getAudioFeatures('nonexistent-id', 'token')
    expect(result).toBeNull()
  })

  it('calls the correct Spotify endpoint with the track ID', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { tempo: 128, key: 2, mode: 1, energy: 0.9 },
    })

    await getAudioFeatures('abc123', 'my-token')

    expect(mockedGet).toHaveBeenCalledWith(
      'https://api.spotify.com/v1/audio-features/abc123',
      { headers: { Authorization: 'Bearer my-token' } }
    )
  })

  it('half-tempo track (61 BPM) detected — caller should double to get true tempo', async () => {
    // Spotify returns the actual tempo, not half. If local analysis detects 61
    // but Spotify says 122, the fetch corrects it.
    mockedGet.mockResolvedValueOnce({
      data: { tempo: 122.0, key: 7, mode: 1, energy: 0.72 },
    })

    const result = await getAudioFeatures('dusty-memories-id', 'token')
    expect(result!.bpm).toBe(122)
    // This confirms Spotify disagrees with the half-tempo local detection
    expect(result!.bpm).toBeGreaterThan(100)
  })
})
