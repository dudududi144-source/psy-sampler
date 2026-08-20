// BPM detection tests — verify estimateBpmFromOnsets picks the correct
// tempo for various loop types.
//
// The previous algorithm had an off-by-2 bug: a 120 BPM 4-on-the-floor
// loop with hits every 0.25s was reported as 60 BPM (16th notes)
// instead of 120 BPM (8th notes). This test suite locks in the fix:
// the algorithm now considers all three note-value interpretations and
// picks the one in the 70-180 BPM musical range.

import { describe, test, expect } from 'bun:test'
import { estimateBpmFromOnsets, type Onset } from '@/psy-sampler/slicer'

/** Helper: build evenly-spaced onsets at the given interval. */
function makeOnsets(interval: number, count: number): Onset[] {
  const out: Onset[] = []
  for (let i = 0; i < count; i++) {
    out.push({ time: i * interval, frame: i, strength: 1 })
  }
  return out
}

describe('estimateBpmFromOnsets', () => {
  test('returns 0 BPM for fewer than 4 onsets', () => {
    const result = estimateBpmFromOnsets([
      { time: 0, frame: 0, strength: 1 },
      { time: 0.5, frame: 1, strength: 1 },
      { time: 1.0, frame: 2, strength: 1 },
    ])
    expect(result.bpm).toBe(0)
    expect(result.confidence).toBe(0)
  })

  test('returns 0 BPM for median interval of 0 (degenerate)', () => {
    const result = estimateBpmFromOnsets([
      { time: 0, frame: 0, strength: 1 },
      { time: 0, frame: 1, strength: 1 },
      { time: 0, frame: 2, strength: 1 },
      { time: 0, frame: 3, strength: 1 },
    ])
    expect(result.bpm).toBe(0)
  })

  test('120 BPM 4-on-the-floor loop (8th notes) → reports ~120 BPM, not 60', () => {
    // 4-on-the-floor: 8 hits in 2s = 0.25s intervals = 8th notes at 120 BPM
    // (or 16th notes at 60 BPM — the bug).
    const onsets = makeOnsets(0.25, 8)
    const result = estimateBpmFromOnsets(onsets)
    // Should be in 70-180 BPM range (120 ± tolerance for median jitter).
    expect(result.bpm).toBeGreaterThan(100)
    expect(result.bpm).toBeLessThan(140)
    expect(result.noteValue).toBe('8th')
  })

  test('140 BPM psytrance loop (16th notes) → reports ~140 BPM', () => {
    // 140 BPM, 16th notes: interval = 60 / (140 * 4) = 0.107s
    const onsets = makeOnsets(60 / (140 * 4), 16)
    const result = estimateBpmFromOnsets(onsets)
    expect(result.bpm).toBeGreaterThan(125)
    expect(result.bpm).toBeLessThan(155)
    expect(result.noteValue).toBe('16th')
  })

  test('90 BPM hip-hop loop (4th notes) → reports ~90 BPM', () => {
    // 90 BPM, 4th notes: interval = 60 / 90 = 0.667s
    const onsets = makeOnsets(60 / 90, 8)
    const result = estimateBpmFromOnsets(onsets)
    expect(result.bpm).toBeGreaterThan(80)
    expect(result.bpm).toBeLessThan(100)
    expect(result.noteValue).toBe('4th')
  })

  test('high confidence for evenly-spaced onsets', () => {
    const onsets = makeOnsets(0.25, 8) // perfectly uniform
    const result = estimateBpmFromOnsets(onsets)
    expect(result.confidence).toBeGreaterThan(0.8)
  })

  test('low confidence for irregular spacing', () => {
    const onsets: Onset[] = [
      { time: 0, frame: 0, strength: 1 },
      { time: 0.1, frame: 1, strength: 1 },
      { time: 0.5, frame: 2, strength: 1 },
      { time: 1.5, frame: 3, strength: 1 },
      { time: 1.6, frame: 4, strength: 1 },
    ]
    const result = estimateBpmFromOnsets(onsets)
    // Irregular spacing → low confidence.
    expect(result.confidence).toBeLessThan(0.5)
  })

  test('snaps to integer BPM when confidence is high', () => {
    // 8 onsets every 0.5s = 8th notes at 60 BPM OR 4th notes at 120 BPM.
    // Should pick 120 BPM (in 70-180 range) and snap to integer.
    const onsets = makeOnsets(0.5, 8)
    const result = estimateBpmFromOnsets(onsets)
    expect(Number.isInteger(result.bpm)).toBe(true)
    expect(result.bpm).toBeGreaterThanOrEqual(110)
    expect(result.bpm).toBeLessThanOrEqual(130)
  })
})
