// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createElement as h, useState, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PlaylistLibrary, Song } from '../app/types'
import type { LibraryView } from '../app/lib/libraryView'

// ── Server stand-in for playlist storage ─────────────────────────────────────
let stored: PlaylistLibrary
const saved: PlaylistLibrary[] = []
vi.mock('../app/services/playlistsApi', () => ({
  fetchPlaylistLibrary: async () => stored,
  savePlaylistLibrary: async (lib: PlaylistLibrary) => { saved.push(lib) },
}))

// ── Music.app export stand-in ────────────────────────────────────────────────
const exportCalls: unknown[] = []
let exportBehaviour: 'ok' | 'fail' = 'ok'
vi.mock('../app/services/appleMusicExport', () => ({
  exportToAppleMusic: async (job: unknown, onProgress: (p: unknown) => void) => {
    exportCalls.push(job)
    onProgress({ phase: 'index' })
    if (exportBehaviour === 'fail') throw new Error('DJFriend isn’t allowed to control Music.')
    return { rootFolderId: 'R', folders: {}, playlists: { p1: { appleMusicId: 'M1', added: 1, skipped: [] } }, addedToLibrary: 1, tagged: 0, errors: [] }
  },
}))

const { usePlaylists } = await import('../app/hooks/usePlaylists')
const { default: AppleMusicExportDialog } = await import('../app/components/AppleMusicExportDialog')
const { buildAppleMusicJob } = await import('../app/lib/appleMusicExport')
const { default: LibrarySidebar } = await import('../app/components/LibrarySidebar')
const { default: LibraryTab } = await import('../app/components/LibraryTab')

// ── DOM helpers ──────────────────────────────────────────────────────────────
let container: HTMLDivElement
let root: Root

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver
  globalThis.fetch = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch
  window.HTMLElement.prototype.scrollTo = () => {}
})

beforeEach(() => {
  stored = {
    schemaVersion: 1,
    folders: [{ id: 'f1', name: 'Gigs' }],
    playlists: [{ id: 'p1', name: 'Warmup', tracks: ['a.mp3'], folderId: 'f1', createdAt: 0, updatedAt: 0 }],
  }
  saved.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const byLabel = (label: string) => container.querySelector(`[aria-label="${label}"]`) as HTMLElement | null
const click = (el: Element, init: MouseEventInit = {}) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })) })
const rightClick = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })) })
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init })) })
const menuItem = (text: string) => [...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent?.includes(text)) as HTMLElement | undefined

// ── Sidebar ──────────────────────────────────────────────────────────────────

function SidebarHarness() {
  const api = usePlaylists()
  const [view, setView] = useState<LibraryView>({ kind: 'all' })
  return h(LibrarySidebar, {
    playlists: api, view, onSelectView: setView, libraryCount: 3,
    playlistCounts: new Map(api.library.playlists.map(p => [p.id, p.tracks.length])),
    appleSources: [{ view: { kind: 'apple', name: 'Flying' }, label: 'Flying', count: 12 }],
    spotifySources: [], setSources: [],
    onDropTracks: () => {}, onSaveAsPlaylist: () => {},
  })
}

describe('LibrarySidebar', () => {
  it('shows stored folders, playlists and sources', async () => {
    act(() => root.render(h(SidebarHarness)))
    await flush()
    expect(byLabel('Folder Gigs')).not.toBeNull()
    expect(byLabel('Playlist Warmup')).not.toBeNull()
    expect(byLabel('Flying')?.textContent).toContain('12')
    expect(byLabel('All tracks')?.getAttribute('aria-current')).toBe('true')
  })

  it('collapses a folder on click', async () => {
    act(() => root.render(h(SidebarHarness)))
    await flush()
    click(byLabel('Folder Gigs')!)
    expect(byLabel('Folder Gigs')?.getAttribute('aria-expanded')).toBe('false')
    expect(byLabel('Playlist Warmup')).toBeNull()
  })

  it('creates a playlist, opens rename, and saves the new name', async () => {
    act(() => root.render(h(SidebarHarness)))
    await flush()
    click(byLabel('New playlist')!)
    const input = byLabel('Name') as HTMLInputElement
    expect(input).not.toBeNull()
    act(() => { input.value = 'Peak Time' })
    act(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(byLabel('Playlist Peak Time')).not.toBeNull()
    expect(byLabel('Playlist Peak Time')?.getAttribute('aria-current')).toBe('true')
    await act(async () => { await new Promise(r => setTimeout(r, 450)) })
    expect(saved.at(-1)?.playlists.map(p => p.name)).toContain('Peak Time')
  })

  it('deletes a playlist from its context menu after confirming', async () => {
    window.confirm = vi.fn(() => true)
    act(() => root.render(h(SidebarHarness)))
    await flush()
    rightClick(byLabel('Playlist Warmup')!)
    click(menuItem('Delete playlist')!)
    expect(byLabel('Playlist Warmup')).toBeNull()
  })

  it('moves a playlist to the top level from the context menu', async () => {
    act(() => root.render(h(SidebarHarness)))
    await flush()
    rightClick(byLabel('Playlist Warmup')!)
    click(menuItem('Top level')!)
    await act(async () => { await new Promise(r => setTimeout(r, 450)) })
    expect(saved.at(-1)?.playlists[0].folderId).toBeUndefined()
  })
})

// ── Library table ────────────────────────────────────────────────────────────

const song = (file: string, title: string): Song => ({ file, artist: 'Artist', title, bpm: 124, key: 'A Minor', camelot: '8A', energy: 0.6, genres: ['House'] })
const songs = [song('a.mp3', 'Alpha'), song('b.mp3', 'Bravo'), song('c.mp3', 'Charlie')]

function renderTable(props: Partial<Parameters<typeof LibraryTab>[0]> = {}) {
  const base = { library: songs, onUpdateTrack: () => {} }
  act(() => root.render(h(LibraryTab, { ...base, ...props })))
}
const rowTitles = () => [...container.querySelectorAll('tbody tr[aria-selected]')].map(r => r.textContent ?? '')
const rowFor = (title: string) => [...container.querySelectorAll('tbody tr[aria-selected]')].find(r => r.textContent?.includes(title)) as HTMLElement

describe('LibraryTab playlist view', () => {
  it('shows tracks in playlist order with a # column', () => {
    renderTable({ viewKey: 'pl:p1', viewTitle: 'Warmup', viewSongs: [songs[2], songs[0]], ordered: true })
    expect(container.querySelector('h2')?.textContent).toBe('Warmup')
    expect([...container.querySelectorAll('thead th')].some(th => th.textContent === '# ↑')).toBe(true)
    const rows = rowTitles()
    expect(rows[0]).toContain('Charlie')
    expect(rows[1]).toContain('Alpha')
    expect(rows[0].startsWith('1')).toBe(true)
  })

  it('selects with click / ⌘-click and removes the selection with Delete', () => {
    const onRemove = vi.fn()
    renderTable({ viewKey: 'pl:p1', viewSongs: songs, ordered: true, onRemoveFromView: onRemove, onReorder: () => {} })
    click(rowFor('Alpha'))
    click(rowFor('Charlie'), { metaKey: true })
    expect(rowFor('Alpha').getAttribute('aria-selected')).toBe('true')
    key(container.querySelector('[tabindex="0"]')!, 'Delete')
    expect(onRemove).toHaveBeenCalledWith(['a.mp3', 'c.mp3'])
  })

  it('⌘A selects every row', () => {
    renderTable({ viewSongs: songs, ordered: true })
    key(container.querySelector('[tabindex="0"]')!, 'a', { metaKey: true })
    expect(rowTitles().length).toBe(3)
    expect([...container.querySelectorAll('tbody tr[aria-selected="true"]')].length).toBe(3)
  })

  it('adds tracks to a playlist from the context menu', () => {
    const onAdd = vi.fn()
    renderTable({ playlists: stored.playlists, onAddToPlaylist: onAdd })
    rightClick(rowFor('Bravo'))
    click(menuItem('Warmup')!)
    expect(onAdd).toHaveBeenCalledWith('p1', ['b.mp3'])
  })

  it('creates a new playlist from the selection', () => {
    const onNew = vi.fn()
    renderTable({ onNewPlaylistFromSelection: onNew })
    click(rowFor('Alpha'))
    click(rowFor('Bravo'), { shiftKey: true })
    const btn = [...container.querySelectorAll('button')].find(b => b.textContent === 'New Playlist' && !b.disabled)!
    click(btn)
    expect(onNew).toHaveBeenCalledWith(['a.mp3', 'b.mp3'])
  })

  it('clears the selection when the view changes', () => {
    renderTable({ viewKey: 'pl:p1', viewSongs: songs, ordered: true })
    click(rowFor('Alpha'))
    expect(rowFor('Alpha').getAttribute('aria-selected')).toBe('true')
    renderTable({ viewKey: 'pl:p2', viewSongs: songs, ordered: true })
    expect(rowFor('Alpha').getAttribute('aria-selected')).toBe('false')
  })

  it('explains an empty playlist', () => {
    renderTable({ viewKey: 'pl:p9', viewTitle: 'Empty', viewSongs: [], ordered: true, onReorder: () => {} })
    expect(container.textContent).toContain('This playlist is empty')
  })
})

// ── Apple Music export ───────────────────────────────────────────────────────

describe('Apple Music export', () => {
  const lib: PlaylistLibrary = {
    schemaVersion: 1, folders: [],
    playlists: [{ id: 'p1', name: 'Warmup', tracks: ['/m/a.mp3', 'vinyl:1:x'], createdAt: 0, updatedAt: 0 }],
  }
  const byFile = new Map<string, Song>([
    ['/m/a.mp3', { ...song('/m/a.mp3', 'Alpha'), filePath: '/m/a.mp3' }],
    ['vinyl:1:x', { ...song('vinyl:1:x', 'Record'), vinylOnly: true }],
  ])

  function renderDialog(onDone = vi.fn(), onClose = vi.fn()) {
    act(() => root.render(h(AppleMusicExportDialog, {
      title: 'Push “Warmup” to Apple Music',
      prepare: opts => buildAppleMusicJob(lib, ['p1'], byFile, opts),
      playlistNames: new Map([['p1', 'Warmup']]),
      onDone, onClose,
    })))
    return { onDone, onClose }
  }
  const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text) as HTMLButtonElement

  beforeEach(() => { exportCalls.length = 0; exportBehaviour = 'ok'; localStorage.clear() })

  it('shows what will be exported and what can’t be', () => {
    renderDialog()
    expect(container.textContent).toContain('1 playlist · 1 tracks')
    click(button('1 track can’t be exported ▾'))
    expect(container.textContent).toContain('Warmup: Artist – Record (vinyl only)')
  })

  it('sends the chosen options and reports the result', async () => {
    const { onDone } = renderDialog()
    const writeBack = [...container.querySelectorAll('input[type="checkbox"]')][1] as HTMLInputElement
    click(writeBack)
    click([...container.querySelectorAll('input[type="radio"]')][1])
    await act(async () => { button('Export to Music').click(); await new Promise(r => setTimeout(r, 0)) })
    expect(exportCalls[0]).toMatchObject({ addMissing: true, writeBack: { keyField: 'comment' }, playlists: [{ id: 'p1', files: ['/m/a.mp3'] }] })
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ rootFolderId: 'R' }))
    expect(container.textContent).toContain('Exported 1 playlist with 1 tracks')
    expect(container.textContent).toContain('1 file added to your Music library')
  })

  it('shows the error and lets you try again', async () => {
    exportBehaviour = 'fail'
    const { onDone } = renderDialog()
    await act(async () => { button('Export to Music').click(); await new Promise(r => setTimeout(r, 0)) })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('allowed to control Music')
    expect(onDone).not.toHaveBeenCalled()
    click(button('Try again'))
    expect(button('Export to Music')).toBeTruthy()
  })

  it('sidebar offers Push / Export all only when export is available', async () => {
    const onPush = vi.fn()
    function Harness({ push }: { push: boolean }) {
      const api = usePlaylists()
      return h(LibrarySidebar, {
        playlists: api, view: { kind: 'all' }, onSelectView: () => {}, libraryCount: 0, playlistCounts: new Map(),
        appleSources: [], spotifySources: [], setSources: [], onDropTracks: () => {}, onSaveAsPlaylist: () => {},
        onPushToAppleMusic: push ? onPush : undefined,
      })
    }
    act(() => root.render(h(Harness, { push: false })))
    await flush()
    expect(byLabel('Export all playlists to Apple Music')).toBeNull()
    rightClick(byLabel('Playlist Warmup')!)
    expect(menuItem('Push to Apple Music')).toBeUndefined()

    act(() => root.render(h(Harness, { push: true })))
    click(byLabel('Export all playlists to Apple Music')!)
    expect(onPush).toHaveBeenCalledWith('all', 'Export all 1 playlists to Apple Music')
    rightClick(byLabel('Playlist Warmup')!)
    click(menuItem('Push to Apple Music')!)
    expect(onPush).toHaveBeenLastCalledWith(['p1'], 'Push “Warmup” to Apple Music')
  })
})
