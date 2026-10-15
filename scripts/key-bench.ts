// Key-detection evaluation: compares detected keys with key tags already in your files (ID3 TKEY etc.).
// Measurement only — nothing is fitted to these tags. Run: npx tsx scripts/key-bench.ts <count> <folder...>
import fs from 'fs'; import path from 'path'; import os from 'os';
import { analyzeAudio } from '../src/analyzer-core';
import { toCamelot } from '../src/camelot';
import * as mm from 'music-metadata';

const N = Number(process.argv[2] ?? 150);
const roots = process.argv.slice(3);
const exts = /\.(mp3|m4a|aiff?|wav|flac)$/i;
function walk(d: string, out: string[]) { let es: fs.Dirent[] = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (exts.test(e.name)) out.push(p); } }
const files: string[] = []; for (const r of roots) walk(r.replace(/^~/, os.homedir()), files);
// deterministic shuffle
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
for (let i = files.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [files[i], files[j]] = [files[j], files[i]]; }

const NOTES: Record<string, number> = { C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11 };
function tagToCamelot(k: string): string | null {
  k = k.trim().replace('♯', '#').replace('♭', 'b');
  const cm = k.match(/^(\d{1,2})\s*([AB])$/i); if (cm) return `${+cm[1]}${cm[2].toUpperCase()}`;
  const m = k.match(/^([A-Ga-g])([#b]?)\s*(m|min|minor|maj|major)?$/i); if (!m) return null;
  const pc = NOTES[(m[1] + m[2]).toUpperCase()]; if (pc == null) return null;
  const minor = !!m[3] && /^m(in(or)?)?$/i.test(m[3]);
  return toCamelot(pc, minor ? 0 : 1)?.camelot ?? null;
}
function relation(a: string, b: string): string {
  if (a === b) return 'exact';
  const na = parseInt(a), nb = parseInt(b), la = a.slice(-1), lb = b.slice(-1);
  const d = ((na - nb) % 12 + 12) % 12;
  if (la === lb && (d === 1 || d === 11)) return 'fifth';
  if (na === nb) return 'relative';
  if (la !== lb && (d === 3 || d === 9)) return 'parallel';
  return 'other';
}
const stored: Record<string, { camelot?: string; keyVersion?: number }> | null = process.env.KEY_BENCH_STORED
  ? Object.fromEntries(Object.values(JSON.parse(fs.readFileSync(process.env.KEY_BENCH_STORED, 'utf-8')) as { filePath: string; camelot?: string; keyVersion?: number }[]).map(s => [s.filePath, s]))
  : null;
(async () => {
  const counts: Record<string, number> = { exact: 0, fifth: 0, relative: 0, parallel: 0, other: 0 };
  let done = 0, ms = 0;
  for (const f of files) {
    if (done >= N) break;
    let tag: string | undefined;
    try { const md = await mm.parseFile(f, { skipCovers: true, duration: false }); tag = md.common.key ?? undefined; } catch { continue; }
    const truth = tag ? tagToCamelot(tag) : null; if (!truth) continue;
    let got: string | undefined;
    if (process.env.KEY_BENCH_SUBSET && stored && (!stored[f]?.camelot || stored[f].keyVersion)) continue;
    if (stored && !process.env.KEY_BENCH_SUBSET) { const e = stored[f]; if (!e?.camelot || e.keyVersion) continue; got = e.camelot; }   // stored keys from the previous algorithm
    else { const t = Date.now(); const r = await analyzeAudio(f); ms += Date.now() - t; got = r ? toCamelot(r.pitchClass, r.mode)?.camelot : undefined; }
    if (!got) continue;
    const rel = relation(got, truth); counts[rel]++; done++;
    if (done % 25 === 0) console.log(`${done}/${N}`, JSON.stringify(counts));
  }
  const score = (counts.exact + 0.5 * counts.fifth + 0.3 * counts.relative + 0.2 * counts.parallel) / Math.max(1, done);
  console.log('RESULT', done, JSON.stringify(counts), 'exact%', (100 * counts.exact / done).toFixed(1), 'weighted', (100 * score).toFixed(1), 'avg ms', Math.round(ms / done));
})();
