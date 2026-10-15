// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createElement as h, useEffect, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Song } from '../app/types'
import { usePlayer, playable, type Player } from '../app/hooks/usePlayer'
import NowPlayingBar from '../app/components/NowPlayingBar'

const song = (file: string, over: Partial<Song> = {}): Song => ({
  file, filePath: `/m/${file}.mp3`, artist: 'Artist', title: `Title ${file}`, bpm: 124, key: 'A Minor', camelot: '8A', energy: 0.6, genres: [], ...over,
})
const songs = [song('a'), song('b'), song('vinyl', { filePath: undefined, vinylOnly: true }), song('c')]
const byFile = new Map(songs.map(s => [s.file, s]))

let container: HTMLDivElement
let root: Root
let player!: Player
let audioEl: HTMLMediaElement | null = null

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.fetch = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch
  // jsdom has no media playback — emulate play/pause events
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return (this as { _paused?: boolean })._paused ?? true } })
  // Remember the element the player uses, so tests can fire 'ended' on it
  const remember = (el: HTMLMediaElement) => { audioEl = el }
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement & { _paused?: boolean }) {
    remember(this)
    this._paused = false
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement & { _paused?: boolean }) { this._paused = true; this.dispatchEvent(new Event('pause')) }
  HTMLMediaElement.prototype.load = function () {}
})

function Harness({ expose }: { expose: (p: Player) => void }) {
  const p = usePlayer(byFile)
  useEffect(() => expose(p))
  return h(NowPlayingBar, { player: p, songsByFile: byFile, onTrackContextMenu: (_e: unknown, s: Song) => ctxSpy(s) })
}
const ctxSpy = vi.fn()

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(h(Harness, { expose: p => { player = p } })))
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const label = (l: string) => container.querySelector(`[aria-label="${l}"]`) as HTMLElement | null
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

describe('player', () => {
  it('is hidden until something is queued', () => {
    expect(container.querySelector('[aria-label="Player"]')).toBeNull()
  })

  it('plays a list from a chosen track, skipping tracks without a local file', () => {
    act(() => player.playTracks(['a', 'vinyl', 'b', 'c'], 2))
    expect(container.textContent).toContain('Title b')
    expect(player.queue.items).toEqual(['a', 'b', 'c'])
    expect(audioEl?.src).toContain(encodeURIComponent('/m/b.mp3'))
    expect(player.playing).toBe(true)
    expect(playable(byFile.get('vinyl'))).toBe(false)
  })

  it('Next / Previous buttons and auto-advance when a track ends', () => {
    act(() => player.playTracks(['a', 'b', 'c'], 0))
    click(label('Next')!)
    expect(player.currentSong?.file).toBe('b')
    click(label('Previous')!)
    expect(player.currentSong?.file).toBe('a')
    act(() => { audioEl!.dispatchEvent(new Event('ended')) })
    expect(player.currentSong?.file).toBe('b')
  })

  it('stops at the end of the queue, and repeat-all wraps around', () => {
    act(() => player.playTracks(['a', 'b'], 1))
    act(() => { audioEl!.dispatchEvent(new Event('ended')) })
    expect(player.currentSong?.file).toBe('b')
    expect(player.playing).toBe(false)
    click(label('Repeat: off')!)
    act(() => { audioEl!.dispatchEvent(new Event('ended')) })
    expect(player.currentSong?.file).toBe('a')
  })

  it('play/pause button toggles playback', () => {
    act(() => player.playTracks(['a'], 0))
    click(label('Pause')!)
    expect(player.playing).toBe(false)
    click(label('Play')!)
    expect(player.playing).toBe(true)
  })

  it('Play Next and Play Later show up in the queue panel', () => {
    act(() => player.playTracks(['a'], 0))
    act(() => player.playLater(['c']))
    act(() => player.playNext(['b']))
    click(label('Queue')!)
    const panel = container.querySelector('[aria-label="Play queue"]')!
    expect(panel.textContent).toContain('Up Next · 2')
    const titles = [...panel.querySelectorAll('p.text-xs')].map(p => p.textContent)
    expect(titles).toEqual(['Title a', 'Title b', 'Title c'])
    click(label('Remove Title c from queue')!)
    expect(player.queue.items).toEqual(['a', 'b'])
  })

  it('a saved volume of 0 stays muted after a restart', () => {
    act(() => player.setVolume(0))
    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(h(Harness, { expose: p => { player = p } })))
    expect(player.volume).toBe(0)
    localStorage.removeItem('djfriend:playerVolume')
  })

  it('removing the playing track keeps the music going with the next one', () => {
    act(() => player.playTracks(['a', 'b', 'c'], 0))
    act(() => player.removeAt(0))
    expect(player.currentSong?.file).toBe('b')
    expect(player.playing).toBe(true)
  })

  it('remembers the volume', () => {
    act(() => player.setVolume(0.4))
    expect(localStorage.getItem('djfriend:playerVolume')).toBe('0.4')
    expect(player.volume).toBe(0.4)
    act(() => player.playTracks(['a'], 0))
    expect(audioEl!.volume).toBe(0.4)
  })
})

describe('player — right-click and resize', () => {
  it('right-click on the player opens the track menu for the loaded track', () => {
    ctxSpy.mockClear()
    act(() => player.playTracks(['b'], 0))
    act(() => { label('Player')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    expect(ctxSpy).toHaveBeenCalledWith(expect.objectContaining({ file: 'b' }))
  })

  it('right-click inside the queue panel does not open the track menu', () => {
    ctxSpy.mockClear()
    act(() => player.playTracks(['a', 'b'], 0))
    click(label('Queue')!)
    act(() => { label('Play queue')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    expect(ctxSpy).not.toHaveBeenCalled()
  })

  it('the resize handle enlarges the player up to 3× and remembers it; double-click resets', () => {
    act(() => player.playTracks(['a'], 0))
    const handle = label('Resize player')!
    const art = () => label('Player')!.querySelector('div.rounded, img.rounded') as HTMLElement
    expect(art().style.width).toBe('40px')
    for (let i = 0; i < 20; i++) act(() => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })) })
    expect(handle.getAttribute('aria-valuenow')).toBe('3')
    expect(art().style.width).toBe('120px')
    expect(localStorage.getItem('djfriend-player-scale')).toBe('3')
    act(() => { handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    expect(handle.getAttribute('aria-valuenow')).toBe('1')
    expect(art().style.width).toBe('40px')
    localStorage.removeItem('djfriend-player-scale')
  })
})
