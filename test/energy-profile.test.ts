import { describe, it, expect } from 'vitest'
import { computeEnergyProfile } from '../src/analyzer-core.js'

function makeSilence(seconds: number, sampleRate = 44100): Float32Array {
  return new Float32Array(Math.round(seconds * sampleRate))
}

function makeTone(seconds: number, sampleRate = 44100, amplitude = 0.5): Float32Array {
  const buf = new Float32Array(Math.round(seconds * sampleRate))
  for (let i = 0; i < buf.length; i++) buf[i] = amplitude * Math.sin(i * 0.1)
  return buf
}

describe('computeEnergyProfile', () => {
  it('returns all zeros for silence', () => {
    const p = computeEnergyProfile(makeSilence(60), 44100)
    expect(p.intro).toBe(0)
    expect(p.outro).toBe(0)
    expect(p.body).toBe(0)
    expect(p.peak).toBe(0)
    expect(p.variance).toBe(0)
    expect(p.dropStrength).toBeGreaterThanOrEqual(0)
  })

  it('intro/outro/body/peak are all within 0–1', () => {
    const p = computeEnergyProfile(makeTone(180), 44100)
    expect(p.intro).toBeGreaterThanOrEqual(0)
    expect(p.intro).toBeLessThanOrEqual(1)
    expect(p.outro).toBeGreaterThanOrEqual(0)
    expect(p.outro).toBeLessThanOrEqual(1)
    expect(p.body).toBeGreaterThanOrEqual(0)
    expect(p.body).toBeLessThanOrEqual(1)
    expect(p.peak).toBeGreaterThanOrEqual(0)
    expect(p.peak).toBeLessThanOrEqual(1)
  })

  it('peak >= intro, body, and outro for a uniform tone', () => {
    const p = computeEnergyProfile(makeTone(180), 44100)
    expect(p.peak).toBeGreaterThanOrEqual(p.intro - 0.01)
    expect(p.peak).toBeGreaterThanOrEqual(p.body - 0.01)
    expect(p.peak).toBeGreaterThanOrEqual(p.outro - 0.01)
  })

  it('detects a louder outro when signal amplitude rises at the end', () => {
    const sampleRate = 44100
    const totalSamples = 180 * sampleRate
    const buf = new Float32Array(totalSamples)
    // First half quiet, second half loud
    for (let i = 0; i < totalSamples; i++) {
      const amp = i < totalSamples / 2 ? 0.1 : 0.8
      buf[i] = amp * Math.sin(i * 0.1)
    }
    const p = computeEnergyProfile(buf, sampleRate)
    expect(p.outro).toBeGreaterThan(p.intro)
  })

  it('handles short tracks (< 10 s) without throwing', () => {
    expect(() => computeEnergyProfile(makeTone(5), 44100)).not.toThrow()
    const p = computeEnergyProfile(makeTone(5), 44100)
    expect(p.intro).toBeGreaterThanOrEqual(0)
  })

  it('variance is 0 for a perfectly uniform signal', () => {
    const p = computeEnergyProfile(makeTone(180, 44100, 0.3), 44100)
    expect(p.variance).toBeCloseTo(0, 2)
  })
})
