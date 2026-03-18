import { describe, it, expect } from 'vitest'
import { stripMixedInKeyPrefix, stripFeatured, normalizeStr, hasWordOverlap, pickConfidentMatch } from '../src/spotify-text'
import type { SpotifyItem } from '../src/spotify-text'

describe('stripMixedInKeyPrefix', () => {
  it('strips valid MIK prefix "12A - 120 - "', () => {
    expect(stripMixedInKeyPrefix('12A - 120 - Song Title')).toBe('Song Title')
  })

  it('strips single-digit key "1B - 128 - "', () => {
    expect(stripMixedInKeyPrefix('1B - 128 - Track Name')).toBe('Track Name')
  })

  it('is case-insensitive for A/B', () => {
    expect(stripMixedInKeyPrefix('8a - 130 - Groove')).toBe('Groove')
  })

  it('returns string unchanged when no MIK prefix', () => {
    expect(stripMixedInKeyPrefix('Normal Song Title')).toBe('Normal Song Title')
  })

  it('returns string unchanged for partial prefix', () => {
    expect(stripMixedInKeyPrefix('12A - Song')).toBe('12A - Song')
  })
})

describe('stripFeatured', () => {
  it('strips "feat. Artist"', () => {
    expect(stripFeatured('Song feat. Someone')).toBe('Song')
  })

  it('strips "ft. Artist"', () => {
    expect(stripFeatured('Song ft. Someone')).toBe('Song')
  })

  it('strips "feat Artist" (no dot)', () => {
    expect(stripFeatured('Song feat Someone')).toBe('Song')
  })

  it('strips "featuring Artist"', () => {
    expect(stripFeatured('Song featuring Someone')).toBe('Song')
  })

  it('is case-insensitive', () => {
    expect(stripFeatured('Song FEAT. Someone')).toBe('Song')
  })

  it('returns string unchanged when no featured notation', () => {
    expect(stripFeatured('Just A Song')).toBe('Just A Song')
  })
})

describe('normalizeStr', () => {
  it('lowercases input', () => {
    expect(normalizeStr('HELLO WORLD')).toBe('hello world')
  })

  it('removes diacritics', () => {
    expect(normalizeStr('Café')).toBe('cafe')
    expect(normalizeStr('Über')).toBe('uber')
    expect(normalizeStr('naïve')).toBe('naive')
  })

  it('removes ampersand', () => {
    expect(normalizeStr('Tom & Jerry')).toBe('tom jerry')
  })

  it('replaces special chars with spaces', () => {
    expect(normalizeStr('hello-world')).toBe('hello world')
  })

  it('collapses multiple spaces', () => {
    expect(normalizeStr('too   many   spaces')).toBe('too many spaces')
  })

  it('trims leading/trailing whitespace', () => {
    expect(normalizeStr('  trimmed  ')).toBe('trimmed')
  })
})

describe('hasWordOverlap', () => {
  it('returns true for identical strings', () => {
    expect(hasWordOverlap('Pink Floyd', 'Pink Floyd')).toBe(true)
  })

  it('returns true when candidate contains original', () => {
    expect(hasWordOverlap('Floyd', 'Pink Floyd')).toBe(true)
  })

  it('returns true when original contains candidate', () => {
    expect(hasWordOverlap('Pink Floyd', 'Floyd')).toBe(true)
  })

  it('returns false for empty original', () => {
    expect(hasWordOverlap('', 'Pink Floyd')).toBe(false)
  })

  it('returns false for empty candidate', () => {
    expect(hasWordOverlap('Pink Floyd', '')).toBe(false)
  })

  it('returns true for 100% word overlap in different order', () => {
    expect(hasWordOverlap('blue red', 'red and blue')).toBe(true)
  })

  it('returns false when word overlap is below 60%', () => {
    expect(hasWordOverlap('apple banana cherry', 'mango grape cherry')).toBe(false)
  })

  it('ignores very short words (<=2 chars) in overlap count', () => {
    expect(hasWordOverlap('go be', 'something else entirely different')).toBe(false)
  })
})

describe('pickConfidentMatch', () => {
  function makeItem(name: string, artists: string[]): SpotifyItem {
    return { id: '1', name, artists: artists.map(n => ({ id: '1', name: n })) }
  }

  it('returns null for empty items array', () => {
    expect(pickConfidentMatch('Artist', 'Title', [])).toBeNull()
  })

  it('returns matching item when title and artist match', () => {
    const item = makeItem('Blue Monday', ['New Order'])
    expect(pickConfidentMatch('New Order', 'Blue Monday', [item])).toBe(item)
  })

  it('returns null when no item matches', () => {
    const item = makeItem('Something Else', ['Other Artist'])
    expect(pickConfidentMatch('New Order', 'Blue Monday', [item])).toBeNull()
  })

  it('returns first matching item from multiple candidates', () => {
    const wrong = makeItem('Different Song', ['New Order'])
    const right = makeItem('Blue Monday', ['New Order'])
    expect(pickConfidentMatch('New Order', 'Blue Monday', [wrong, right])).toBe(right)
  })

  it('matches despite feat. in original artist', () => {
    const item = makeItem('Track', ['Main Artist'])
    expect(pickConfidentMatch('Main Artist feat. Guest', 'Track', [item])).toBe(item)
  })
})
