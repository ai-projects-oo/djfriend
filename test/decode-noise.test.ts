import { describe, it, expect, vi } from 'vitest'

describe('mpg123 decoder noise', () => {
  it('drops per-frame "mpg123-decoder:" messages but passes other console.error output through', async () => {
    const sink = vi.fn()
    const orig = console.error
    console.error = sink                       // the analyzer wraps whatever console.error is at load time
    try {
      vi.resetModules()
      await import('../src/analyzer-core')
      console.error('mpg123-decoder: -1 MPG123_ERR')
      console.error('real problem', 42)
      expect(sink).toHaveBeenCalledTimes(1)
      expect(sink).toHaveBeenCalledWith('real problem', 42)
    } finally {
      console.error = orig
    }
  })
})
