import { describe, it, expect } from 'vitest'
import { parseFilename } from '../src/parse-filename'

describe('parseFilename', () => {
  it('splits "Artist - Title.mp3" into artist and title', () => {
    expect(parseFilename('Pink Floyd - Time.mp3')).toEqual({ artist: 'Pink Floyd', title: 'Time' })
  })

  it('returns null artist when no " - " separator', () => {
    expect(parseFilename('Time.mp3')).toEqual({ artist: null, title: 'Time' })
  })

  it('trims whitespace from artist and title', () => {
    expect(parseFilename('  Artist  -  Title  .mp3')).toEqual({ artist: 'Artist', title: 'Title' })
  })

  it('only splits on first " - " occurrence', () => {
    expect(parseFilename('Artist - Title - Remix.mp3')).toEqual({ artist: 'Artist', title: 'Title - Remix' })
  })

  it('handles .flac extension', () => {
    expect(parseFilename('Bonobo - Kiara.flac')).toEqual({ artist: 'Bonobo', title: 'Kiara' })
  })

  it('handles filename with no extension', () => {
    expect(parseFilename('Artist - Track')).toEqual({ artist: 'Artist', title: 'Track' })
  })

  it('handles multi-word artist names', () => {
    expect(parseFilename('The Chemical Brothers - Block Rockin Beats.mp3')).toEqual({
      artist: 'The Chemical Brothers',
      title: 'Block Rockin Beats',
    })
  })

  it('handles filename with no separator and no extension', () => {
    expect(parseFilename('JustATitle')).toEqual({ artist: null, title: 'JustATitle' })
  })
})
