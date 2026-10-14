import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Non-negotiable #5: app/lib/ is pure logic. Storage, network and DOM access belong in app/services/.
const LIB_DIR = path.join(__dirname, '..', 'app', 'lib')
const FORBIDDEN: Array<[string, RegExp]> = [
  ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['fetch', /(^|[^.\w])fetch\(/m],
  ['apiFetch', /\bapiFetch\b/],
  ['document', /\bdocument\./],
  ['window', /\bwindow\./],
  ['IPC', /\bipcRenderer\b|window\.electron/],
]

// Strip comments so docs like "no localStorage access" don't trip the check
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('app/lib purity', () => {
  const files = fs.readdirSync(LIB_DIR).filter(f => /\.tsx?$/.test(f))

  it.each(files)('%s has no side-effecting APIs', (file) => {
    const src = stripComments(fs.readFileSync(path.join(LIB_DIR, file), 'utf-8'))
    const hits = FORBIDDEN.filter(([, re]) => re.test(src)).map(([name]) => name)
    expect(hits).toEqual([])
  })
})
