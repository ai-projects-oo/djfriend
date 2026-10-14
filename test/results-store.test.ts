import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadResults, saveResults, flushResults, forgetResults } from '../src/results-store'

interface Entry { bpm: number; title?: string }

let dir: string
let file: string

const readDisk = (): Record<string, Entry> => JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, Entry>

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'results-store-'))
  file = path.join(dir, 'results.json')
  fs.writeFileSync(file, JSON.stringify({ a: { bpm: 120 } }, null, 2), 'utf-8')
})

afterEach(() => {
  forgetResults(file)
  vi.useRealTimers()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('results-store', () => {
  it('parses once and serves the cached object on repeat loads', () => {
    const spy = vi.spyOn(fs, 'readFileSync')
    const first = loadResults<Entry>(file)
    const second = loadResults<Entry>(file)
    expect(second).toBe(first)
    expect(spy.mock.calls.filter(c => c[0] === file)).toHaveLength(1)
    spy.mockRestore()
  })

  it('throws for a missing file, like JSON.parse(readFileSync())', () => {
    expect(() => loadResults(path.join(dir, 'nope.json'))).toThrow()
  })

  it('re-parses when the file was changed on disk by someone else', () => {
    loadResults<Entry>(file)
    fs.writeFileSync(file, JSON.stringify({ b: { bpm: 90 } }), 'utf-8')
    const future = new Date(Date.now() + 10_000)
    fs.utimesSync(file, future, future)
    expect(Object.keys(loadResults<Entry>(file))).toEqual(['b'])
  })

  it('writes immediately by default, as compact JSON', () => {
    saveResults<Entry>(file, { a: { bpm: 128 } })
    const raw = fs.readFileSync(file, 'utf-8')
    expect(raw).toBe('{"a":{"bpm":128}}')
    expect(fs.existsSync(`${file}.tmp`)).toBe(false)
  })

  it('batches deferred writes into a single flush', () => {
    vi.useFakeTimers()
    const data = loadResults<Entry>(file)
    const writeSpy = vi.spyOn(fs, 'writeFileSync')
    for (let i = 0; i < 50; i++) {
      data.a.bpm = 100 + i
      saveResults(file, data, { defer: true })
    }
    expect(writeSpy).not.toHaveBeenCalled()
    expect(readDisk().a.bpm).toBe(120)
    // Pending changes are visible to readers before they hit disk
    expect(loadResults<Entry>(file).a.bpm).toBe(149)

    vi.advanceTimersByTime(5000)
    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(readDisk().a.bpm).toBe(149)
    writeSpy.mockRestore()
  })

  it('flushResults() writes pending changes right away (e.g. before streaming the file)', () => {
    const data = loadResults<Entry>(file)
    data.a.title = 'Edited'
    saveResults(file, data, { defer: true })
    flushResults(file)
    expect(readDisk().a.title).toBe('Edited')
  })

  it('flushResults() with no path flushes every pending file', () => {
    const other = path.join(dir, 'other.json')
    saveResults<Entry>(file, { a: { bpm: 1 } }, { defer: true })
    saveResults<Entry>(other, { z: { bpm: 2 } }, { defer: true })
    flushResults()
    expect(readDisk().a.bpm).toBe(1)
    expect((JSON.parse(fs.readFileSync(other, 'utf-8')) as Record<string, Entry>).z.bpm).toBe(2)
    forgetResults(other)
  })

  it('does not re-read its own write as an external change', () => {
    saveResults<Entry>(file, { a: { bpm: 130 } })
    const spy = vi.spyOn(fs, 'readFileSync')
    loadResults<Entry>(file)
    expect(spy.mock.calls.filter(c => c[0] === file)).toHaveLength(0)
    spy.mockRestore()
  })

  it('forgetResults() drops a pending write (file was deleted)', () => {
    vi.useFakeTimers()
    saveResults<Entry>(file, { a: { bpm: 140 } }, { defer: true })
    forgetResults(file)
    fs.unlinkSync(file)
    vi.advanceTimersByTime(5000)
    expect(fs.existsSync(file)).toBe(false)
  })
})
