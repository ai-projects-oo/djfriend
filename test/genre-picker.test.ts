// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { groupGenresByFamily, GENRE_FAMILIES } from '../app/lib/genreUtils'
import GenrePicker from '../app/components/GenrePicker'

describe('groupGenresByFamily', () => {
  const counts = new Map([['Tech House', 400], ['House', 120], ['Deep House', 300], ['Techno', 50], ['Pop', 3], ['Weird Genre', 7]])

  it('groups present genres into families, biggest first, unknowns under Other', () => {
    const groups = groupGenresByFamily(['House', 'Tech House', 'Deep House', 'Techno', 'Pop', 'Weird Genre'], counts)
    expect(groups.map(g => g.family)).toEqual(['House', 'Techno', 'Other'])
    expect(groups[0].labels).toEqual(['Tech House', 'Deep House', 'House'])
    expect(groups[2].labels).toEqual(['Weird Genre', 'Pop'])
  })

  it('every family label is unique', () => {
    const all = GENRE_FAMILIES.flatMap(f => f.labels)
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('GenrePicker', () => {
  let container: HTMLDivElement
  let root: Root
  const counts: Record<string, number> = { '~Tech House': 400, '~Deep House': 300, '~House': 120, '~Techno': 50, '~Pop': 3 }
  const countFor = (values: string[]) => values.reduce((n, v) => n + (counts[v] ?? 0), 0)
  const labels = ['House', 'Tech House', 'Deep House', 'Techno', 'Pop']

  beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true })
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const render = (selected: string[], onToggle = vi.fn(), onClear = vi.fn()) => {
    act(() => root.render(h(GenrePicker, { labels, selected, countFor, onToggle, onClear })))
    return { onToggle, onClear }
  }
  const btn = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.startsWith(text))!
  const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

  it('opens the biggest family with counts, and dims genres too small for a set', () => {
    render([])
    expect(btn('Tech House').textContent).toBe('Tech House400')
    expect(container.textContent).toContain('House') // family
    click(container.querySelector('[aria-label="Expand Other"]')!)
    expect(btn('Pop').className).toContain('opacity-45')
  })

  it('clicking a family selects all its genres, and again deselects them', () => {
    const { onToggle } = render([])
    click([...container.querySelectorAll('button')].find(b => b.textContent === 'House' && b.title.startsWith('Select all'))!)
    expect(onToggle.mock.calls.map(c => c[0])).toEqual(['~Tech House', '~Deep House', '~House'])

    const second = render(['~Tech House', '~Deep House', '~House']).onToggle
    click([...container.querySelectorAll('button')].find(b => b.textContent === 'House' && b.title.startsWith('Deselect all'))!)
    expect(second.mock.calls.map(c => c[0])).toEqual(['~Tech House', '~Deep House', '~House'])
  })

  it('pins the current picks with a total, removable with ×', () => {
    const { onToggle } = render(['~Techno'])
    const pinned = container.querySelector('[aria-label="Selected genres"]')!
    expect(pinned.textContent).toContain('Techno')
    expect(pinned.textContent).toContain('50 tracks')
    click(container.querySelector('[aria-label="Remove Techno"]')!)
    expect(onToggle).toHaveBeenCalledWith('~Techno')
  })

  it('search shows matching genres across families', () => {
    render([])
    const input = container.querySelector('[aria-label="Find genre"]') as HTMLInputElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'tech')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const chips = [...container.querySelectorAll('button[aria-pressed]')].map(b => b.textContent)
    expect(chips).toEqual(['Tech House400', 'Techno50'])
  })
})
