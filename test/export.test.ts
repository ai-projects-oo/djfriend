import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toLocation } from '../app/lib/rekordboxExport'
import { resolveTrackPath, generateM3U } from '../app/lib/m3uExport'
import { generateRekordboxXml } from '../app/lib/rekordboxExport'
import type { SetTrack } from '../app/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTrack(overrides: Partial<SetTrack> = {}): SetTrack {
  return {
    file: 'track.mp3',
    filePath: '/Users/dj/Music/track.mp3',
    title: 'Test Track',
    artist: 'Test Artist',
    bpm: 128,
    camelot: '8B',
    key: 'C Major',
    energy: 0.7,
    genres: [],
    slot: 0,
    targetEnergy: 0.7,
    harmonicWarning: false,
    duration: 360,
    ...overrides,
  }
}

// Stub __SONGS_FOLDER__ global (baked in at Vite build time, empty in Electron production)
vi.stubGlobal('__SONGS_FOLDER__', '')

// ─── toLocation ──────────────────────────────────────────────────────────────

describe('toLocation', () => {
  it('converts macOS absolute path', () => {
    expect(toLocation('/Users/dj/Music/track.mp3'))
      .toBe('file://localhost/Users/dj/Music/track.mp3')
  })

  it('converts Windows path with forward slashes', () => {
    expect(toLocation('C:/Users/dj/Music/track.mp3'))
      .toBe('file://localhost/C:/Users/dj/Music/track.mp3')
  })

  it('converts Windows path with backslashes', () => {
    expect(toLocation('C:\\Users\\dj\\Music\\track.mp3'))
      .toBe('file://localhost/C:/Users/dj/Music/track.mp3')
  })

  it('preserves drive letter colon unencoded', () => {
    const loc = toLocation('C:/Music/track.mp3')
    expect(loc).toContain('/C:/')
    expect(loc).not.toContain('%3A')
  })

  it('encodes spaces in path', () => {
    expect(toLocation('/Users/DJ User/My Music/track.mp3'))
      .toBe('file://localhost/Users/DJ%20User/My%20Music/track.mp3')
  })

  it('encodes spaces on Windows path', () => {
    expect(toLocation('C:/Users/DJ User/My Music/track.mp3'))
      .toBe('file://localhost/C:/Users/DJ%20User/My%20Music/track.mp3')
  })

  it('encodes parentheses in filename', () => {
    expect(toLocation('/Users/dj/Music/track (original mix).mp3'))
      .toBe('file://localhost/Users/dj/Music/track%20(original%20mix).mp3')
  })

  it('encodes special characters: #, &, +', () => {
    const loc = toLocation('/Users/dj/Music/DJ A&B - Track #1.mp3')
    expect(loc).toContain('%23')   // #
    expect(loc).toContain('%26')   // &
  })

  it('encodes non-ASCII characters', () => {
    const loc = toLocation('/Users/dj/Música/pista.mp3')
    expect(loc).toContain('M%C3%BAsica')
  })

  it('handles lowercase Windows drive letter', () => {
    expect(toLocation('d:/Music/track.mp3'))
      .toBe('file://localhost/d:/Music/track.mp3')
  })

  it('handles mixed slashes on Windows', () => {
    expect(toLocation('C:\\Users\\dj/Music/track.mp3'))
      .toBe('file://localhost/C:/Users/dj/Music/track.mp3')
  })
})

// ─── resolveTrackPath ─────────────────────────────────────────────────────────

describe('resolveTrackPath (m3uExport)', () => {
  it('returns absolute filePath as-is', () => {
    const t = makeTrack({ filePath: '/Users/dj/Music/track.mp3' })
    expect(resolveTrackPath(t, '')).toBe('/Users/dj/Music/track.mp3')
  })

  it('returns absolute Windows filePath as-is', () => {
    const t = makeTrack({ filePath: 'C:/Users/dj/Music/track.mp3' })
    expect(resolveTrackPath(t, '')).toBe('C:/Users/dj/Music/track.mp3')
  })

  it('joins relative filename with songsFolder', () => {
    const t = makeTrack({ filePath: undefined, file: 'track.mp3' })
    expect(resolveTrackPath(t, '/Users/dj/Music')).toBe('/Users/dj/Music/track.mp3')
  })

  it('joins relative filename with Windows songsFolder', () => {
    const t = makeTrack({ filePath: undefined, file: 'track.mp3' })
    const result = resolveTrackPath(t, 'C:\\Users\\dj\\Music')
    // Backslash trailing stripped; result joined with /
    expect(result).toBe('C:\\Users\\dj\\Music/track.mp3')
  })

  it('strips trailing slash from songsFolder before joining', () => {
    const t = makeTrack({ filePath: undefined, file: 'track.mp3' })
    expect(resolveTrackPath(t, '/Users/dj/Music/')).toBe('/Users/dj/Music/track.mp3')
  })

  it('strips trailing backslash from Windows songsFolder', () => {
    const t = makeTrack({ filePath: undefined, file: 'track.mp3' })
    const result = resolveTrackPath(t, 'C:\\Users\\dj\\Music\\')
    expect(result).toBe('C:\\Users\\dj\\Music/track.mp3')
  })
})

// ─── generateM3U ─────────────────────────────────────────────────────────────

describe('generateM3U', () => {
  beforeEach(() => { vi.stubGlobal('__SONGS_FOLDER__', '') })

  it('starts with #EXTM3U header', () => {
    expect(generateM3U([])).toMatch(/^#EXTM3U/)
  })

  it('uses CRLF line endings', () => {
    const m3u = generateM3U([makeTrack()])
    expect(m3u).toContain('\r\n')
  })

  it('includes #EXTINF line with duration and metadata', () => {
    const m3u = generateM3U([makeTrack({ duration: 240 })])
    expect(m3u).toContain('#EXTINF:240,Test Track - Test Artist')
  })

  it('normalises backslashes to forward slashes in output path', () => {
    const t = makeTrack({ filePath: 'C:\\Users\\dj\\Music\\track.mp3' })
    const m3u = generateM3U([t])
    expect(m3u).toContain('C:/Users/dj/Music/track.mp3')
    expect(m3u).not.toContain('\\')
  })

  it('preserves Windows absolute path', () => {
    const t = makeTrack({ filePath: 'C:/Users/dj/Music/track.mp3' })
    const m3u = generateM3U([t])
    expect(m3u).toContain('C:/Users/dj/Music/track.mp3')
  })

  it('preserves macOS absolute path', () => {
    const t = makeTrack({ filePath: '/Users/dj/Music/track.mp3' })
    const m3u = generateM3U([t])
    expect(m3u).toContain('/Users/dj/Music/track.mp3')
  })

  it('handles missing duration (defaults to 0)', () => {
    const t = makeTrack({ duration: undefined })
    const m3u = generateM3U([t])
    expect(m3u).toContain('#EXTINF:0,')
  })

  it('generates correct entry order: EXTINF then path', () => {
    const t = makeTrack({ filePath: '/Users/dj/Music/track.mp3', duration: 180 })
    const lines = generateM3U([t]).split('\r\n').filter(Boolean)
    expect(lines[0]).toBe('#EXTM3U')
    expect(lines[1]).toMatch(/^#EXTINF:/)
    expect(lines[2]).toBe('/Users/dj/Music/track.mp3')
  })
})

// ─── generateRekordboxXml ─────────────────────────────────────────────────────

describe('generateRekordboxXml', () => {
  beforeEach(() => { vi.stubGlobal('__SONGS_FOLDER__', '') })

  it('produces valid XML structure', () => {
    const xml = generateRekordboxXml([makeTrack()])
    expect(xml).toContain('<DJ_PLAYLISTS')
    expect(xml).toContain('<COLLECTION')
    expect(xml).toContain('<PLAYLISTS>')
    expect(xml).toContain('</DJ_PLAYLISTS>')
  })

  it('encodes macOS path to Location URI', () => {
    const t = makeTrack({ filePath: '/Users/dj/Music/track.mp3' })
    expect(generateRekordboxXml([t])).toContain('file://localhost/Users/dj/Music/track.mp3')
  })

  it('encodes Windows path to Location URI', () => {
    const t = makeTrack({ filePath: 'C:/Users/dj/Music/track.mp3' })
    expect(generateRekordboxXml([t])).toContain('file://localhost/C:/Users/dj/Music/track.mp3')
  })

  it('converts Windows backslash path to forward-slash Location URI', () => {
    const t = makeTrack({ filePath: 'C:\\Users\\dj\\Music\\track.mp3' })
    const xml = generateRekordboxXml([t])
    expect(xml).toContain('file://localhost/C:/Users/dj/Music/track.mp3')
    expect(xml).not.toContain('\\')
  })

  it('encodes spaces in Windows path', () => {
    const t = makeTrack({ filePath: 'C:/Users/DJ User/My Music/track.mp3' })
    expect(generateRekordboxXml([t])).toContain('C:/Users/DJ%20User/My%20Music/track.mp3')
  })

  it('encodes spaces in macOS path', () => {
    const t = makeTrack({ filePath: '/Users/DJ User/My Music/track.mp3' })
    expect(generateRekordboxXml([t])).toContain('/Users/DJ%20User/My%20Music/track.mp3')
  })

  it('does not encode drive letter colon', () => {
    const t = makeTrack({ filePath: 'D:/Music/track.mp3' })
    const xml = generateRekordboxXml([t])
    expect(xml).toContain('/D:/')
    expect(xml).not.toContain('%3A')
  })

  it('XML-escapes title and artist with special chars', () => {
    const t = makeTrack({ title: 'Track & Roll', artist: 'DJ <Test>' })
    const xml = generateRekordboxXml([t])
    expect(xml).toContain('Track &amp; Roll')
    expect(xml).toContain('DJ &lt;Test&gt;')
  })

  it('outputs correct BPM format', () => {
    const t = makeTrack({ bpm: 132.5 })
    expect(generateRekordboxXml([t])).toContain('AverageBpm="132.50"')
  })

  it('outputs correct Tonality from camelot key', () => {
    const t = makeTrack({ camelot: '5A' })
    expect(generateRekordboxXml([t])).toContain('Tonality="Cmin"')
  })

  it('maps playlist name into NODE element', () => {
    const xml = generateRekordboxXml([makeTrack()], 'My Set')
    expect(xml).toContain('Name="My Set"')
  })

  it('sets Entries count matching track count', () => {
    const xml = generateRekordboxXml([makeTrack(), makeTrack()], 'Set')
    expect(xml).toContain('Entries="2"')
  })
})
