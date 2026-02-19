import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

// ─── Read SONGS_FOLDER from the parent project's .env ────────────────────────
function readSongsFolder(): string | null {
  const envPath = path.resolve(__dirname, '../.env')
  if (!fs.existsSync(envPath)) return null
  const contents = fs.readFileSync(envPath, 'utf-8')
  for (const line of contents.split('\n')) {
    const match = line.match(/^\s*SONGS_FOLDER\s*=\s*(.+)\s*$/)
    if (match) return match[1].trim()
  }
  return null
}

const songsFolder = readSongsFolder()

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Custom plugin: serve result.json from SONGS_FOLDER in dev,
    // and copy it into dist/ during build.
    {
      name: 'songs-folder',
      configureServer(server) {
        if (!songsFolder) return
        server.middlewares.use('/results.json', (_req, res, next) => {
          const filePath = path.join(songsFolder, 'results.json')
          if (!fs.existsSync(filePath)) { next(); return }
          res.setHeader('Content-Type', 'application/json')
          fs.createReadStream(filePath).pipe(res)
        })
      },
      closeBundle() {
        if (!songsFolder) return
        const src = path.join(songsFolder, 'results.json')
        const dest = path.resolve(__dirname, 'dist/results.json')
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest)
          console.log(`[songs-folder] Copied results.json from ${src}`)
        }
      },
    },
  ],
  // Inject SONGS_FOLDER into client code so M3U export can build absolute paths
  define: {
    __SONGS_FOLDER__: JSON.stringify(songsFolder ?? ''),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
