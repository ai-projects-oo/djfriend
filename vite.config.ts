import 'dotenv/config'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import { setupMiddlewares } from './src/api'

function readEnvVar(name: string): string | null {
  const envPath = path.resolve(__dirname, '.env')
  if (!fs.existsSync(envPath)) return null
  const contents = fs.readFileSync(envPath, 'utf-8')
  for (const line of contents.split('\n')) {
    const match = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)\\s*$`))
    if (match) return match[1].trim()
  }
  return null
}

const songsFolder = readEnvVar('SONGS_FOLDER')

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'songs-folder',
      configureServer(server) { setupMiddlewares(server.middlewares as Parameters<typeof setupMiddlewares>[0], songsFolder) },
      configurePreviewServer(server) { setupMiddlewares(server.middlewares as Parameters<typeof setupMiddlewares>[0], songsFolder) },
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
  define: {
    __SONGS_FOLDER__: JSON.stringify(songsFolder ?? ''),
  },
  server: { port: 8888, host: '127.0.0.1' },
  preview: { port: 8888, host: '127.0.0.1' },
  resolve: {
    alias: { '@': path.resolve(__dirname, './app') },
  },
})
