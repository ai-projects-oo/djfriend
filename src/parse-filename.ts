import path from 'path'

export function parseFilename(filename: string): { artist: string | null; title: string } {
  const name = path.basename(filename, path.extname(filename))
  const dashIndex = name.indexOf(' - ')
  if (dashIndex !== -1) {
    return {
      artist: name.slice(0, dashIndex).trim(),
      title: name.slice(dashIndex + 3).trim(),
    }
  }
  return { artist: null, title: name.trim() }
}
