// In-memory cache for results files (results.json / djfriend-results-v3.json).
//
// The Apple Music results file can be hundreds of MB. Parsing and rewriting it on every
// per-track patch blocks the Electron main process (and with it the whole UI), so all
// reads and writes go through here:
//   - loadResults()  parses once, then serves the cached object (re-parsed if the file
//                    changed on disk, e.g. written by the CLI)
//   - saveResults()  updates the cache; `defer` batches writes into one flush per window
//   - flushResults() writes pending changes (call before streaming a file to a client)
// Writes are compact JSON via temp file + rename, so a crash never leaves a half-written file.

import fs from 'fs'
import path from 'path'

const FLUSH_DELAY_MS = 5000
const EVICT_AFTER_MS = 60_000

interface Entry {
  data: Record<string, unknown>
  mtimeMs: number | null
  dirty: boolean
  flushTimer: NodeJS.Timeout | null
  evictTimer: NodeJS.Timeout | null
}

const cache = new Map<string, Entry>()

function mtimeOf(filePath: string): number | null {
  try { return fs.statSync(filePath).mtimeMs } catch { return null }
}

// Drop clean entries after a quiet period so the parsed library doesn't stay resident forever
function touch(filePath: string, entry: Entry): void {
  if (entry.evictTimer) clearTimeout(entry.evictTimer)
  entry.evictTimer = setTimeout(() => {
    if (!entry.dirty && cache.get(filePath) === entry) cache.delete(filePath)
  }, EVICT_AFTER_MS)
  entry.evictTimer.unref?.()
}

/** Returns the parsed results object (shared — mutate then saveResults). Throws if missing or invalid, like JSON.parse(readFileSync()). */
export function loadResults<T>(filePath: string): Record<string, T> {
  const cached = cache.get(filePath)
  if (cached && (cached.dirty || mtimeOf(filePath) === cached.mtimeMs)) {
    touch(filePath, cached)
    return cached.data as Record<string, T>
  }
  const mtimeMs = mtimeOf(filePath)
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>
  const entry: Entry = { data, mtimeMs, dirty: false, flushTimer: null, evictTimer: null }
  cache.set(filePath, entry)
  touch(filePath, entry)
  return data as Record<string, T>
}

/** Stores `data` as the file's contents. Writes immediately, or within FLUSH_DELAY_MS when `defer` is set. */
export function saveResults<T>(filePath: string, data: Record<string, T>, opts: { defer?: boolean } = {}): void {
  const prev = cache.get(filePath)
  if (prev?.flushTimer) clearTimeout(prev.flushTimer)
  if (prev?.evictTimer) clearTimeout(prev.evictTimer)
  const entry: Entry = { data, mtimeMs: prev?.mtimeMs ?? null, dirty: true, flushTimer: null, evictTimer: null }
  cache.set(filePath, entry)
  touch(filePath, entry)
  if (!opts.defer) { flushResults(filePath); return }
  entry.flushTimer = setTimeout(() => flushResults(filePath), FLUSH_DELAY_MS)
}

/** Writes pending changes for one file, or for all files when no path is given. */
export function flushResults(filePath?: string): void {
  const targets = filePath ? [filePath] : [...cache.keys()]
  for (const p of targets) {
    const entry = cache.get(p)
    if (!entry?.dirty) continue
    if (entry.flushTimer) { clearTimeout(entry.flushTimer); entry.flushTimer = null }
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true })
      const tmp = `${p}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(entry.data), 'utf-8')
      fs.renameSync(tmp, p)
      entry.mtimeMs = mtimeOf(p)
      entry.dirty = false
    } catch (err) {
      console.error(`[results-store] failed to write ${p}:`, err instanceof Error ? err.message : err)
    }
  }
}

/** Drops any cached/pending state for a file (call after deleting it). */
export function forgetResults(filePath: string): void {
  const entry = cache.get(filePath)
  if (entry?.flushTimer) clearTimeout(entry.flushTimer)
  if (entry?.evictTimer) clearTimeout(entry.evictTimer)
  cache.delete(filePath)
}

// Never lose a deferred write on shutdown
process.on('exit', () => flushResults())
