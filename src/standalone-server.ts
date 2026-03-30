import http from 'http'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import connect from 'connect'
import serveStatic from 'serve-static'
import { setupMiddlewares } from './api.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.PORT ?? '3000', 10)

async function startServer() {
  const app = connect()
  const distPath = path.join(__dirname, '..', 'dist')

  app.use(serveStatic(distPath) as Parameters<typeof app.use>[0])
  setupMiddlewares(app)

  // SPA fallback
  app.use((_req, res) => {
    const indexPath = path.join(distPath, 'index.html')
    res.setHeader('Content-Type', 'text/html')
    fs.createReadStream(indexPath).pipe(res as unknown as NodeJS.WritableStream)
  })

  return new Promise<void>((resolve, reject) => {
    http.createServer(app).listen(PORT, '0.0.0.0', () => {
      console.log(`DJFriend server running on port ${PORT}`)
      resolve()
    }).on('error', reject)
  })
}

startServer().catch(err => {
  console.error('Server failed to start:', err)
  process.exit(1)
})
