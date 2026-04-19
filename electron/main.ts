import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { createServer } from 'http'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = 8888
let mainWindow: BrowserWindow | null = null

async function startServer() {
  // Dynamic imports so Electron loads them from inside the ASAR
  const connect = (await import('connect')).default
  const serveStatic = (await import('serve-static')).default
  const { setupMiddlewares } = await import('../src/api.js')

  const app = connect()

  // Serve the built React frontend
  const distPath = path.join(__dirname, '..', 'dist')
  app.use(serveStatic(distPath) as Parameters<typeof app.use>[0])

  // All API routes
  setupMiddlewares(app)

  // SPA fallback: serve index.html for any unmatched route
  app.use((_req, res) => {
    const indexPath = path.join(distPath, 'index.html')
    res.setHeader('Content-Type', 'text/html')
    fs.createReadStream(indexPath).pipe(res)
  })

  return new Promise<void>((resolve, reject) => {
    createServer(app).listen(PORT, '127.0.0.1', () => resolve()).on('error', reject)
  })
}

ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return null
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  } catch (err) {
    console.error('select-folder dialog error:', err)
    return null
  }
})

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js')
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'DJFriend',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  })

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  try {
    await startServer()
    createWindow()
  } catch (err) {
    console.error('Failed to start server:', err)
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
