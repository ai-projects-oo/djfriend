import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'
import { toBase64Url, fromBase64Url, newPairing, parsePairing, encryptJson, decryptJson } from '../app/lib/sync/crypto'
import { compareHlc, tickHlc, receiveHlc } from '../app/lib/sync/hlc'
import { emptySyncState, recordLocalChanges, mergeRemote, stableStringify, liveData } from '../app/lib/sync/merge'
import { trackItems, playlistItems, applyPlaylistRecords, applyVinylRecords, applySetRecords, setItems } from '../app/lib/sync/records'
import type { HistoryEntry, PlaylistLibrary, Song, SyncRecord } from '../app/types'

const rnd = (n: number) => new Uint8Array(randomBytes(n))
const song = (file: string, title: string): Song => ({ file, filePath: `/m/${file}`, artist: 'A', title, bpm: 124, key: 'A Minor', camelot: '8A', energy: 0.6, genres: ['House'] })

describe('sync crypto', () => {
  it('base64url round-trips all lengths', () => {
    for (let n = 0; n < 40; n++) { const b = rnd(n); expect([...fromBase64Url(toBase64Url(b))]).toEqual([...b]) }
    expect(toBase64Url(new Uint8Array([251, 255]))).not.toMatch(/[+/=]/)
  })
  it('pairing has a 128-bit id and 256-bit key and survives the QR round trip', () => {
    const p = newPairing(rnd, 'https://relay.example/')
    expect(fromBase64Url(p.syncId)).toHaveLength(16)
    expect(fromBase64Url(p.key)).toHaveLength(32)
    expect(p.relay).toBe('https://relay.example')
    expect(parsePairing(JSON.stringify(p))).toEqual(p)
  })
  it('rejects things that are not pairing codes', () => {
    expect(parsePairing('hello')).toBeNull()
    expect(parsePairing(JSON.stringify({ v: 1, syncId: 'x', key: 'y', relay: 'https://a' }))).toBeNull()
    expect(parsePairing(JSON.stringify({ ...newPairing(rnd, 'https://a'), relay: 'javascript:alert(1)' }))).toBeNull()
  })
  it('encrypts and decrypts JSON; ciphertext reveals nothing readable', () => {
    const p = newPairing(rnd, 'https://a')
    const env = encryptJson(p, { title: 'Secret Track Title' }, rnd)
    expect(env.c).not.toContain('Secret')
    expect(decryptJson(p, env)).toEqual({ title: 'Secret Track Title' })
  })
  it('fails with the wrong key, a different sync id, or tampered data', () => {
    const p = newPairing(rnd, 'https://a'), q = newPairing(rnd, 'https://a')
    const env = encryptJson(p, [1, 2, 3], rnd)
    expect(() => decryptJson({ ...p, key: q.key }, env)).toThrow()
    expect(() => decryptJson({ ...p, syncId: q.syncId }, env)).toThrow()
    const bytes = fromBase64Url(env.c); bytes[0] ^= 1
    expect(() => decryptJson(p, { ...env, c: toBase64Url(bytes) })).toThrow()
  })
  it('uses a fresh nonce every time', () => {
    const p = newPairing(rnd, 'https://a')
    expect(encryptJson(p, 1, rnd).n).not.toBe(encryptJson(p, 1, rnd).n)
  })
})

describe('hybrid logical clock', () => {
  it('ticks monotonically even if the wall clock goes backwards', () => {
    const a = tickHlc(null, 1000, 'd1'), b = tickHlc(a, 900, 'd1'), c = tickHlc(b, 900, 'd1')
    expect(compareHlc(a, b)).toBeLessThan(0)
    expect(compareHlc(b, c)).toBeLessThan(0)
  })
  it('after receiving a remote time, local edits sort after it', () => {
    const remote = { t: 5000, c: 3, d: 'phone' }
    const local = receiveHlc({ t: 1000, c: 0, d: 'mac' }, remote, 1200, 'mac')
    expect(compareHlc(tickHlc(local, 1200, 'mac'), remote)).toBeGreaterThan(0)
  })
  it('device id breaks exact ties deterministically', () => {
    expect(compareHlc({ t: 1, c: 0, d: 'a' }, { t: 1, c: 0, d: 'b' })).toBeLessThan(0)
  })
})

describe('record store & merge', () => {
  it('stableStringify ignores key order', () => {
    expect(stableStringify({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(stableStringify({ a: [{ x: 1, y: 2 }], b: 1 }))
  })
  it('records only new or changed items, and tombstones removed ones', () => {
    let s = emptySyncState('mac')
    const items = trackItems([song('a', 'Alpha'), song('b', 'Bravo')])
    let r = recordLocalChanges(s, items, ['track'], 1000); s = r.state
    expect(r.outgoing).toHaveLength(2)
    r = recordLocalChanges(s, items, ['track'], 2000); s = r.state
    expect(r.outgoing).toHaveLength(0)
    r = recordLocalChanges(s, trackItems([{ ...song('a', 'Alpha'), bpm: 125 }]), ['track'], 3000); s = r.state
    expect(r.outgoing.map(o => [o.id, !!o.deleted])).toEqual([['a', false], ['b', true]])
    expect(liveData(s, 'track').map(x => x.id)).toEqual(['a'])
  })
  it('only touches the types in scope', () => {
    let s = emptySyncState('mac')
    s = recordLocalChanges(s, trackItems([song('a', 'A')]), ['track'], 1).state
    const r = recordLocalChanges(s, [], ['playlist'], 2)
    expect(r.outgoing).toEqual([])
  })
  it('newer remote record wins; older one is ignored', () => {
    let mac = emptySyncState('mac')
    mac = recordLocalChanges(mac, [{ type: 'playlist', id: 'p1', data: { name: 'Mac' } }], ['playlist'], 1000).state
    const older: SyncRecord = { type: 'playlist', id: 'p1', hlc: { t: 500, c: 0, d: 'phone' }, data: { name: 'Old' } }
    const newer: SyncRecord = { type: 'playlist', id: 'p1', hlc: { t: 2000, c: 0, d: 'phone' }, data: { name: 'Phone' } }
    let m = mergeRemote(mac, [older], 1500); expect(m.applied).toEqual([])
    m = mergeRemote(m.state, [newer], 2500); expect(m.applied).toEqual([newer])
    // After merging, an unchanged local value is not re-sent as a change
    const again = recordLocalChanges(m.state, [{ type: 'playlist', id: 'p1', data: { name: 'Phone' } }], ['playlist'], 3000)
    expect(again.outgoing).toEqual([])
  })
  it('concurrent edits to different records are both kept', () => {
    let mac = emptySyncState('mac'), phone = emptySyncState('phone')
    const a = recordLocalChanges(mac, [{ type: 'playlist', id: 'p1', data: { n: 1 } }], ['playlist'], 1000)
    const b = recordLocalChanges(phone, [{ type: 'playlist', id: 'p2', data: { n: 2 } }], ['playlist'], 1000)
    mac = mergeRemote(a.state, b.outgoing, 1100).state
    phone = mergeRemote(b.state, a.outgoing, 1100).state
    expect(liveData(mac, 'playlist').map(x => x.id).sort()).toEqual(['p1', 'p2'])
    expect(liveData(phone, 'playlist').map(x => x.id).sort()).toEqual(['p1', 'p2'])
  })
  it('a deletion beats an older edit, and both devices converge', () => {
    let mac = emptySyncState('mac'), phone = emptySyncState('phone')
    const created = recordLocalChanges(mac, [{ type: 'set', id: 's', data: { x: 1 } }], ['set'], 1000)
    mac = created.state; phone = mergeRemote(phone, created.outgoing, 1000).state
    const edit = recordLocalChanges(phone, [{ type: 'set', id: 's', data: { x: 2 } }], ['set'], 2000)
    const del = recordLocalChanges(mac, [], ['set'], 3000)
    mac = mergeRemote(del.state, edit.outgoing, 3100).state
    phone = mergeRemote(edit.state, del.outgoing, 3100).state
    expect(liveData(mac, 'set')).toEqual([])
    expect(liveData(phone, 'set')).toEqual([])
  })
})

describe('applying synced records to app state', () => {
  const lib: PlaylistLibrary = { schemaVersion: 1, playlists: [{ id: 'p1', name: 'Warmup', tracks: ['a'], createdAt: 0, updatedAt: 0 }], folders: [] }
  it('playlists: add, update and delete', () => {
    const out = applyPlaylistRecords(lib, [
      { type: 'playlist', id: 'p1', hlc: { t: 1, c: 0, d: 'p' }, data: { ...lib.playlists[0], name: 'Warm-up' } },
      { type: 'playlist', id: 'p2', hlc: { t: 1, c: 0, d: 'p' }, data: { id: 'p2', name: 'New', tracks: [], createdAt: 1, updatedAt: 1 } },
      { type: 'folder', id: 'f1', hlc: { t: 1, c: 0, d: 'p' }, data: { id: 'f1', name: 'Gigs' } },
    ])
    expect(out.playlists.map(p => p.name)).toEqual(['Warm-up', 'New'])
    expect(out.folders.map(f => f.name)).toEqual(['Gigs'])
    expect(applyPlaylistRecords(out, [{ type: 'playlist', id: 'p2', hlc: { t: 2, c: 0, d: 'p' }, deleted: true }]).playlists.map(p => p.id)).toEqual(['p1'])
    expect(applyPlaylistRecords(lib, [])).toBe(lib)
  })
  it('vinyl: a key detected on the phone lands in the store', () => {
    const out = applyVinylRecords({}, [{ type: 'vinylTrack', id: '123', hlc: { t: 1, c: 0, d: 'p' }, data: { tracks: [{ id: 't', position: 'A1', camelot: '8A', detectedFields: ['camelot'] }] } }])
    expect(out[123].tracks[0].camelot).toBe('8A')
  })
  it('sets: phone-created live log becomes a History entry; edits keep the full desktop data', () => {
    const songs = new Map([['a', song('a', 'Alpha')]])
    const base = { prefs: {} as HistoryEntry['prefs'], curve: [] }
    const created = applySetRecords([], [{ type: 'set', id: 'live1', hlc: { t: 1, c: 0, d: 'p' }, data: { name: 'Friday', timestamp: 10, tracks: [{ file: 'a', artist: 'A', title: 'Alpha', bpm: 124, camelot: '8A', energy: 0.6 }] } }], songs, base)
    expect(created[0]).toMatchObject({ id: 'live1', name: 'Friday', tracks: [{ file: 'a', slot: 0, filePath: '/m/a' }] })
    const renamed = applySetRecords(created, [{ type: 'set', id: 'live1', hlc: { t: 2, c: 0, d: 'p' }, data: { ...setItems(created)[0].data as object, name: 'Friday night', rating: 5 } }], songs, base)
    expect(renamed[0]).toMatchObject({ name: 'Friday night', rating: 5, tracks: [{ filePath: '/m/a' }] })
  })
  it('track records carry no file paths or waveforms', () => {
    const [it] = trackItems([{ ...song('a', 'Alpha'), waveform: [1, 2, 3] }])
    expect(JSON.stringify(it.data)).not.toContain('/m/a')
    expect(JSON.stringify(it.data)).not.toContain('waveform')
  })
  it('playlistItems covers playlists and folders', () => {
    expect(playlistItems({ ...lib, folders: [{ id: 'f', name: 'F' }] }).map(i => i.type)).toEqual(['playlist', 'folder'])
  })
})
