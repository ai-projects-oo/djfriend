/**
 * Quick smoke test for the Groq AI enrichment.
 * Usage:
 *   tsx src/test-groq.ts                  # reads key from settings.json
 *   GROQ_API_KEY=gsk_... tsx src/test-groq.ts  # override with env var
 */
import { enrichTrackBatch } from './ai.js'
import { readSettings } from './settings.js'

const apiKey = process.env.GROQ_API_KEY ?? readSettings().groqApiKey
if (!apiKey) {
  console.error('No Groq API key found. Add it in Settings or set GROQ_API_KEY=gsk_...')
  process.exit(1)
}
console.log('Using Groq API key from', process.env.GROQ_API_KEY ? 'env var' : 'settings.json')

const sampleTracks = [
  { file: 'test1.mp3', artist: 'Charlotte de Witte', title: 'Doppler', bpm: 140, key: 'A Minor', energy: 0.92, genres: ['techno'] },
  { file: 'test2.mp3', artist: 'Bonobo', title: 'Kong', bpm: 95, key: 'D Major', energy: 0.38, genres: ['downtempo', 'electronic'] },
]

console.log('Calling Groq API with 2 sample tracks…\n')

const tags = await enrichTrackBatch(sampleTracks, apiKey)

for (const [file, t] of tags.entries()) {
  console.log(`✓ ${file}`)
  console.log(`  vibeTags:        ${t.vibeTags.join(', ')}`)
  console.log(`  moodTags:        ${t.moodTags.join(', ')}`)
  console.log(`  vocalType:       ${t.vocalType}`)
  console.log(`  venueTags:       ${t.venueTags.join(', ')}`)
  console.log(`  timeOfNightTags: ${t.timeOfNightTags.join(', ')}`)
  console.log()
}

if (tags.size === 0) {
  console.error('No tags returned — check your API key and Groq account.')
  process.exit(1)
}

console.log('Groq integration working ✓')
