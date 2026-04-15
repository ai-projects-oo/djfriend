// Type definitions for the Electron preload API exposed via contextBridge
interface Window {
  electronAPI?: {
    selectFolder: () => Promise<string | null>
  }
}
