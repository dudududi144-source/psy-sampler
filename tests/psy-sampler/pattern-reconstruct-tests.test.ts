// Pattern reconstruct tests — verify the slice→step mapping produces
// the correct pattern for known loop types.
//
// The original roast documented an off-by-one bug: "kicks at steps 1+4
// instead of 1+5 for a 4-on-the-floor". The root cause was the BPM
// detection off-by-2 bug (returning 60 instead of 120 for a 120 BPM loop).
// After the BPM fix in 0.2.1, the secPerStep calculation is now correct
// and the placement should be exact.
//
// This test verifies the reconstruct logic directly (without React) by
// reimplementing the same algorithm and asserting against expected patterns.

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

interface Placement {
  step: number
  sliceIdx: number
}

/**
 * Reimplementation of SampleSlicer.reconstructPattern() — the same
 * algorithm, extracted for testing. This avoids React state + rendering
 * complexity and lets us test the placement logic in isolation.
 */
function reconstructFromOnsets(
  onsets: Onset[],
  roleForSlice: (sliceIdx: number, total: number) => string,
): { bpm: number; placements: Record<string, Placement[]> } {
  if (onsets.length === 0) return { bpm: 0, placements: {} }
  const bpmEstimate = estimateBpmFromOnsets(onsets)
  const bpm = bpmEstimate.bpm > 0 ? bpmEstimate.bpm : 120
  const secPerStep = 60 / (bpm * 4)
  const maxStep = 32
  const placements: Record<string, Placement[]> = {}
  onsets.forEach((onset, i) => {
    const step = Math.min(maxStep - 1, Math.max(0, Math.round(onset.time / secPerStep)))
    const role = roleForSlice(i, onsets.length)
    if (!placements[role]) placements[role] = []
    const existing = placements[role].find(p => p.step === step)
    if (existing) {
      existing.sliceIdx = i
    } else {
      placements[role].push({ step, sliceIdx: i })
    }
  })
  return { bpm, placements }
}

describe('pattern reconstruct', () => {
  test('120 BPM 4-on-the-floor → kicks at steps 0, 4, 8, 12 (16-step)', () => {
    // 120 BPM, 16th notes: 8 hits at 0, 0.25, 0.5, ..., 1.75 (8th notes)
    // With 16-step pattern at 120 BPM, secPerStep = 60 / (120*4) = 0.125s.
    // Hits at t=0.25 → step 2; t=0.5 → step 4; etc.
    // 4-on-the-floor kicks at t=0, 0.5, 1.0, 1.5 → steps 0, 4, 8, 12.
    const onsets = makeOnsets(0.25, 8)  // 8 evenly spaced at 0.25s
    // Mimic the pickDefaultRole: kick on even indices, hat on odd.
    const roleForSlice = (i: number) => i % 2 === 0 ? 'kick' : 'hat-closed'
    const { bpm, placements } = reconstructFromOnsets(onsets, roleForSlice)

    expect(bpm).toBeGreaterThanOrEqual(115)
    expect(bpm).toBeLessThanOrEqual(125)
    // Kicks at slices 0, 2, 4, 6 → times 0, 0.5, 1.0, 1.5 → steps 0, 4, 8, 12.
    const kickSteps = placements.kick?.map(p => p.step).sort((a, b) => a - b) ?? []
    expect(kickSteps).toEqual([0, 4, 8, 12])
    // Hats at slices 1, 3, 5, 7 → times 0.25, 0.75, 1.25, 1.75 → steps 2, 6, 10, 14.
    const hatSteps = placements['hat-closed']?.map(p => p.step).sort((a, b) => a - b) ?? []
    expect(hatSteps).toEqual([2, 6, 10, 14])
  })

  test('140 BPM psytrance loop (16 hits per bar) → evenly spaced 0-15', () => {
    // 140 BPM, 16th notes: 16 hits in 1 bar = 60/(140*4) = 0.107s interval
    const interval = 60 / (140 * 4)
    const onsets = makeOnsets(interval, 16)
    // All on the same role (perc).
    const roleForSlice = () => 'perc'
    const { bpm, placements } = reconstructFromOnsets(onsets, roleForSlice)

    expect(bpm).toBeGreaterThanOrEqual(135)
    expect(bpm).toBeLessThanOrEqual(145)
    const percSteps = placements.perc?.map(p => p.step).sort((a, b) => a - b) ?? []
    expect(percSteps).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  test('does not produce negative step indices', () => {
    // Edge case: slice at t=0 should map to step 0, never negative.
    const onsets: Onset[] = [
      { time: 0, frame: 0, strength: 1 },
      { time: 0.1, frame: 1, strength: 1 },
      { time: 0.2, frame: 2, strength: 1 },
      { time: 0.3, frame: 3, strength: 1 },
    ]
    const { placements } = reconstructFromOnsets(onsets, () => 'kick')
    const steps = placements.kick?.map(p => p.step) ?? []
    expect(steps.every(s => s >= 0)).toBe(true)
  })

  test('caps step at 31 (32-step pattern max)', () => {
    // Very long loop with many onsets — verify no step exceeds 31.
    const onsets = makeOnsets(0.1, 50)  // 50 onsets at 0.1s = 5s loop
    const { placements } = reconstructFromOnsets(onsets, () => 'perc')
    const steps = placements.perc?.map(p => p.step) ?? []
    expect(steps.every(s => s <= 31)).toBe(true)
  })

  test('handles overlapping slices on same step (later wins)', () => {
    // Two slices landing on the same step → only one placement.
    const onsets: Onset[] = [
      { time: 0, frame: 0, strength: 1 },
      { time: 0.01, frame: 1, strength: 1 },  // very close to first
      { time: 0.25, frame: 2, strength: 1 },
      { time: 0.5, frame: 3, strength: 1 },
    ]
    const { placements } = reconstructFromOnsets(onsets, () => 'kick')
    // Slices 0 and 1 both map to step 0 (after BPM estimate at 120).
    // Only one entry at step 0, sliceIdx = 1 (later wins).
    const step0 = placements.kick?.find(p => p.step === 0)
    expect(step0).toBeDefined()
    expect(step0?.sliceIdx).toBe(1)  // later slice wins
  })
})
