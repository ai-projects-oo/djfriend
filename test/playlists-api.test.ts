import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import http from 'http'
import type { AddressInfo } from 'net'

// Point the server's ~/Music at a temp folder before src/api.ts computes its paths
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'djfriend-home-'))
fs.mkdirSync(path.join(tmpHome, 'Music'))
vi.mock('os', async (orig) => {
  const real = await orig<typeof import('os')>()
  return { ...real, default: { ...real, homedir: () => tmpHome }, homedir: () => tmpHome }
})

let server: http.Server
let base = ''

beforeAll(async () => {
  const connect = (await import('connect')).default
  const { setupMiddlewares, PLAYLISTS_PATH } = await import('../src/api')
  expect(PLAYLISTS_PATH.startsWith(tmpHome)).toBe(true)
  const app = connect()
  setupMiddlewares(app)
  server = http.createServer(app)
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 30_000)

afterAll(() => {
  server?.close()
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

const lib = {
  schemaVersion: 1,
  playlists: [{ id: 'p1', name: 'Warmup', tracks: ['/m/a.mp3', '/m/b.mp3'], createdAt: 1, updatedAt: 2 }],
  folders: [{ id: 'f1', name: 'Gigs' }],
}

describe('/api/playlists', () => {
  it('returns an empty library before anything is saved', async () => {
    const res = await fetch(`${base}/api/playlists`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ schemaVersion: 1, playlists: [], folders: [] })
  })

  it('saves with PUT and reads it back', async () => {
    const put = await fetch(`${base}/api/playlists`, { method: 'PUT', body: JSON.stringify(lib) })
    expect(put.status).toBe(200)
    expect(await (await fetch(`${base}/api/playlists`)).json()).toEqual(lib)
    expect(fs.existsSync(path.join(tmpHome, 'Music', 'djfriend-playlists.json'))).toBe(true)
    expect(fs.existsSync(path.join(tmpHome, 'Music', 'djfriend-playlists.json.tmp'))).toBe(false)
  })

  it('rejects malformed bodies without touching the saved file', async () => {
    for (const body of ['not json', JSON.stringify({ playlists: [] }), JSON.stringify({ schemaVersion: 2, playlists: [], folders: [] })]) {
      const res = await fetch(`${base}/api/playlists`, { method: 'PUT', body })
      expect(res.status).toBe(400)
    }
    expect(await (await fetch(`${base}/api/playlists`)).json()).toEqual(lib)
  })
})
