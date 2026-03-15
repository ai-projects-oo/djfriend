import { app, BrowserWindow, shell } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import http from 'http'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = 8888
let server: ChildProcess | null = null
let mainWindow: BrowserWindow | null = null

function waitForServer(maxMs = 30_000): Promise<void> {
  const deadline = Date.now() + maxMs
  return new Promise((resolve, reject) => {
    function attempt() {
      http.get(`http://127.0.0.1:${PORT}`, (res) => {
        res.resume()
        if (res.statusCode && res.statusCode < 500) resolve()
        else retry()
      }).on('error', retry)
    }
    function retry() {
      if (Date.now() > deadline) { reject(new Error('Server did not start in time')); return }
      setTimeout(attempt, 300)
    }
    attempt()
  })
}

function startServer() {
  const root = path.join(__dirname, '..')
  // Use the locally installed vite binary
  const vite = path.join(root, 'node_modules', '.bin', 'vite')
  server = spawn(vite, ['preview'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  server.stdout?.on('data', (d: Buffer) => process.stdout.write(d))
  server.stderr?.on('data', (d: Buffer) => process.stderr.write(d))
  server.on('error', (err) => console.error('[server] failed to start:', err.message))
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'DJFriend',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`)

  // Open all target="_blank" links in the default browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  startServer()
  try {
    await waitForServer()
    createWindow()
  } catch (err) {
    console.error('Could not connect to server:', err)
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  server?.kill()
})
