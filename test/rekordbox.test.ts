// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { parseRekordboxLocation, parseRekordboxXml } from '../app/lib/rekordboxImport'

// ─── parseRekordboxLocation ───────────────────────────────────────────────────

describe('parseRekordboxLocation', () => {
  it('handles macOS localhost path', () => {
    expect(parseRekordboxLocation('file://localhost/Users/dj/Music/track.mp3'))
      .toBe('/Users/dj/Music/track.mp3')
  })

  it('handles macOS path with spaces (percent-encoded)', () => {
    expect(parseRekordboxLocation('file://localhost/Users/dj/My%20Music/my%20track.mp3'))
      .toBe('/Users/dj/My Music/my track.mp3')
  })

  it('handles macOS path with special characters', () => {
    expect(parseRekordboxLocation("file://localhost/Users/dj/Music/Bicep%20-%20Glue%20(Bicep%27s%20Re-Edit).mp3"))
      .toBe("/Users/dj/Music/Bicep - Glue (Bicep's Re-Edit).mp3")
  })

  it('handles Windows localhost path (file://localhost/C:/...)', () => {
    expect(parseRekordboxLocation('file://localhost/C:/Users/dj/Music/track.mp3'))
      .toBe('C:/Users/dj/Music/track.mp3')
  })

  it('handles Windows triple-slash path (file:///C:/...)', () => {
    expect(parseRekordboxLocation('file:///C:/Users/dj/Music/track.mp3'))
      .toBe('C:/Users/dj/Music/track.mp3')
  })

  it('handles Windows lowercase drive letter', () => {
    expect(parseRekordboxLocation('file://localhost/c:/Users/dj/Music/track.mp3'))
      .toBe('c:/Users/dj/Music/track.mp3')
  })

  it('handles Windows path with spaces', () => {
    expect(parseRekordboxLocation('file://localhost/C:/Users/DJ%20User/My%20Music/track.mp3'))
      .toBe('C:/Users/DJ User/My Music/track.mp3')
  })

  it('normalises Windows backslashes to forward slashes', () => {
    // Some older Rekordbox versions emit backslashes inside the Location URI
    const p = parseRekordboxLocation('file://localhost/C:\\Users\\dj\\Music\\track.mp3')
    expect(p).toBe('C:/Users/dj/Music/track.mp3')
  })

  it('handles path with parentheses and single quotes', () => {
    expect(parseRekordboxLocation('file://localhost/Users/dj/Music/track%20(original%20mix).mp3'))
      .toBe('/Users/dj/Music/track (original mix).mp3')
  })

  it('handles Windows path with non-ASCII characters', () => {
    expect(parseRekordboxLocation('file://localhost/C:/Users/dj/M%C3%BAsica/pista.mp3'))
      .toBe('C:/Users/dj/Música/pista.mp3')
  })

  it('returns empty string for empty input', () => {
    expect(parseRekordboxLocation('')).toBe('')
  })
})

// ─── parseRekordboxXml ────────────────────────────────────────────────────────

const MINIMAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="6.0.0" Company="AlphaTheta"/>
  <COLLECTION Entries="3">
    <TRACK TrackID="1" Name="Track A" Artist="Artist 1" AverageBpm="128.00" TotalTime="360" Tonality="8B" Location="file://localhost/Users/dj/Music/track_a.mp3"/>
    <TRACK TrackID="2" Name="Track B" Artist="Artist 2" AverageBpm="132.00" TotalTime="420" Tonality="5A" Location="file://localhost/C:/Users/dj/Music/track_b.mp3"/>
    <TRACK TrackID="3" Name="Unanalyzed" Artist="Artist 3" AverageBpm="0.00" TotalTime="300" Tonality="" Location="file://localhost/Users/dj/Music/unanalyzed.mp3"/>
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="2">
      <NODE Type="0" Name="Tech House" Count="2">
        <NODE Type="1" Name="Warm Up" Entries="1">
          <TRACK Key="1"/>
        </NODE>
        <NODE Type="1" Name="Peak Time" Entries="1">
          <TRACK Key="2"/>
        </NODE>
      </NODE>
      <NODE Type="1" Name="Favourites" Entries="2">
        <TRACK Key="1"/>
        <TRACK Key="3"/>
      </NODE>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>`

describe('parseRekordboxXml', () => {
  it('parses all collection tracks', () => {
    const { tracks } = parseRekordboxXml(MINIMAL_XML)
    expect(tracks).toHaveLength(3)
  })

  it('parses macOS track path correctly', () => {
    const { tracks } = parseRekordboxXml(MINIMAL_XML)
    expect(tracks[0].path).toBe('/Users/dj/Music/track_a.mp3')
  })

  it('parses Windows track path correctly (strips leading slash)', () => {
    const { tracks } = parseRekordboxXml(MINIMAL_XML)
    expect(tracks[1].path).toBe('C:/Users/dj/Music/track_b.mp3')
  })

  it('includes tracks with bpm=0 (unanalyzed in Rekordbox)', () => {
    const { tracks } = parseRekordboxXml(MINIMAL_XML)
    const unanalyzed = tracks.find(t => t.bpm === 0)
    expect(unanalyzed).toBeDefined()
    expect(unanalyzed?.title).toBe('Unanalyzed')
  })

  it('parses BPM and duration', () => {
    const { tracks } = parseRekordboxXml(MINIMAL_XML)
    expect(tracks[0].bpm).toBe(128)
    expect(tracks[0].duration).toBe(360)
  })

  it('parses tonality', () => {
    const { tracks } = parseRekordboxXml(MINIMAL_XML)
    expect(tracks[0].tonality).toBe('8B')
    expect(tracks[1].tonality).toBe('5A')
  })

  it('builds trackById map', () => {
    const { trackById } = parseRekordboxXml(MINIMAL_XML)
    expect(trackById.get(1)?.title).toBe('Track A')
    expect(trackById.get(2)?.title).toBe('Track B')
  })

  it('parses nested folder → playlist structure', () => {
    const { playlists } = parseRekordboxXml(MINIMAL_XML)
    expect(playlists).toHaveLength(3)
  })

  it('playlist inside folder has correct breadcrumb path', () => {
    const { playlists } = parseRekordboxXml(MINIMAL_XML)
    const warmUp = playlists.find(p => p.name === 'Warm Up')
    expect(warmUp).toBeDefined()
    expect(warmUp?.path).toEqual(['Tech House'])
    expect(warmUp?.trackKeys).toEqual([1])
  })

  it('top-level playlist has empty breadcrumb path', () => {
    const { playlists } = parseRekordboxXml(MINIMAL_XML)
    const favourites = playlists.find(p => p.name === 'Favourites')
    expect(favourites).toBeDefined()
    expect(favourites?.path).toEqual([])
    expect(favourites?.trackKeys).toEqual([1, 3])
  })

  it('can resolve playlist tracks via trackById', () => {
    const { playlists, trackById } = parseRekordboxXml(MINIMAL_XML)
    const favourites = playlists.find(p => p.name === 'Favourites')!
    const resolved = favourites.trackKeys.map(k => trackById.get(k)).filter(Boolean)
    expect(resolved).toHaveLength(2)
    expect(resolved[0]?.title).toBe('Track A')
    expect(resolved[1]?.title).toBe('Unanalyzed')
  })

  it('handles XML with no playlists section', () => {
    const xmlNoPlaylists = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS>
  <COLLECTION Entries="1">
    <TRACK TrackID="1" Name="T" Artist="A" AverageBpm="128.00" TotalTime="300" Tonality="8B" Location="file://localhost/Users/dj/track.mp3"/>
  </COLLECTION>
</DJ_PLAYLISTS>`
    const { tracks, playlists } = parseRekordboxXml(xmlNoPlaylists)
    expect(tracks).toHaveLength(1)
    expect(playlists).toHaveLength(0)
  })

  it('handles Windows paths inside XML (file:///C:/...)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS>
  <COLLECTION Entries="1">
    <TRACK TrackID="1" Name="Win Track" Artist="A" AverageBpm="130.00" TotalTime="300" Tonality="5A" Location="file:///C:/Users/DJ%20User/Music/track%20(remix).mp3"/>
  </COLLECTION>
  <PLAYLISTS><NODE Type="0" Name="ROOT" Count="0"/></PLAYLISTS>
</DJ_PLAYLISTS>`
    const { tracks } = parseRekordboxXml(xml)
    expect(tracks[0].path).toBe('C:/Users/DJ User/Music/track (remix).mp3')
  })
})
