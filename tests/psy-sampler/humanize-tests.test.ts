// Velocity humanization tests.
//
// Verifies that humanizePattern:
//   1. Does not change which steps are active (0 stays 0, >0 stays >0)
//   2. Applies velocity variation within ±MAX_VARIATION * amount
//   3. Clamps to 1-127 (never 0 on active notes, never >127)
//   4. amount=0 is passthrough (no change)
//   5. amount=1 is maximum variation (±15)
//   6. Is deterministic when seeded
//   7. Does NOT mutate the input pattern
//   8. Works on all 9 roles

import { describe, it, expect } from 'bun:test'
import { humanizePattern } from '../../src/lib/humanize'
import { DEFAULT_PATTERN } from '../../src/lib/demo-director'
import type { Pattern } from '../../src/lib/demo-director'

function makePattern(): Pattern {
  // A pattern with known velocities for deterministic testing.
  const p = structuredClone(DEFAULT_PATTERN)
  p.kick[0] = 100
  p.kick[4] = 127
  p.kick[8] = 100
  p.kick[12] = 100
  p.bass[0] = 80
  p.bass[2] = 90
  p.lead[0] = 70
  p.lead[8] = 110
  return p
}

describe('humanizePattern', () => {
  it('amount=0 is passthrough (no change)', () => {
    const p = makePattern()
    const result = humanizePattern(p, 0, 42)
    expect(result).toEqual(p)
  })

  it('does not activate silent steps (0 stays 0)', () => {
    const p = makePattern()
    const result = humanizePattern(p, 1, 42)
    // Step 1 of kick is 0 in the original — should stay 0.
    expect(result.kick[1]).toBe(0)
    expect(result.kick[2]).toBe(0)
    expect(result.kick[3]).toBe(0)
  })

  it('does not silence active steps (>0 stays >0)', () => {
    const p = makePattern()
    const result = humanizePattern(p, 1, 42)
    // Every active note should remain active (≥1).
    for (const role of Object.keys(p) as Array<keyof Pattern>) {
      for (let i = 0; i < p[role]!.length; i++) {
        if (p[role]![i]! > 0) {
          expect(result[role]![i]).toBeGreaterThanOrEqual(1)
        }
      }
    }
  })

  it('variation is within ±15 at amount=1', () => {
    const p = makePattern()
    const result = humanizePattern(p, 1, 42)
    for (const role of Object.keys(p) as Array<keyof Pattern>) {
      for (let i = 0; i < p[role]!.length; i++) {
        const orig = p[role]![i]!
        const hum = result[role]![i]!
        if (orig > 0) {
          expect(Math.abs(hum - orig)).toBeLessThanOrEqual(15)
        }
      }
    }
  })

  it('variation is within ±7.5 at amount=0.5', () => {
    const p = makePattern()
    const result = humanizePattern(p, 0.5, 42)
    for (const role of Object.keys(p) as Array<keyof Pattern>) {
      for (let i = 0; i < p[role]!.length; i++) {
        const orig = p[role]![i]!
        const hum = result[role]![i]!
        if (orig > 0) {
          expect(Math.abs(hum - orig)).toBeLessThanOrEqual(8) // ±7.5 rounded
        }
      }
    }
  })

  it('clamps to 1-127 (never 0 on active, never >127)', () => {
    const p = makePattern()
    p.kick[0] = 1 // minimum active
    p.kick[4] = 127 // maximum
    const result = humanizePattern(p, 1, 42)
    expect(result.kick[0]).toBeGreaterThanOrEqual(1)
    expect(result.kick[4]).toBeLessThanOrEqual(127)
  })

  it('is deterministic when seeded (same seed → same output)', () => {
    const p = makePattern()
    const r1 = humanizePattern(p, 0.7, 123)
    const r2 = humanizePattern(p, 0.7, 123)
    expect(r1).toEqual(r2)
  })

  it('different seeds usually produce different output', () => {
    const p = makePattern()
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
    const results = seeds.map((s) => JSON.stringify(humanizePattern(p, 0.7, s)))
    expect(new Set(results).size).toBeGreaterThanOrEqual(3)
  })

  it('does NOT mutate the input pattern', () => {
    const p = makePattern()
    const before = JSON.parse(JSON.stringify(p)) as Pattern
    humanizePattern(p, 1, 42)
    expect(p).toEqual(before)
  })

  it('returns a new object (different reference)', () => {
    const p = makePattern()
    const result = humanizePattern(p, 0, 42)
    expect(result).not.toBe(p)
  })

  it('works on all 9 roles', () => {
    const p = makePattern()
    // Add a note to every role.
    const roles = ['kick', 'bass', 'lead', 'hat-closed', 'hat-open', 'clap', 'perc', 'texture', 'fx'] as const
    for (const role of roles) {
      p[role]![0] = 100
    }
    const result = humanizePattern(p, 0.5, 42)
    // Every role should have a note at step 0 (≥1).
    for (const role of roles) {
      expect(result[role]![0]).toBeGreaterThanOrEqual(1)
    }
  })

  it('amount > 1 is clamped to 1', () => {
    const p = makePattern()
    const r1 = humanizePattern(p, 1, 42)
    const r2 = humanizePattern(p, 5, 42)
    expect(r2).toEqual(r1)
  })

  it('amount < 0 is clamped to 0 (passthrough)', () => {
    const p = makePattern()
    const result = humanizePattern(p, -1, 42)
    expect(result).toEqual(p)
  })

  it('respects 32-step patterns', () => {
    const p = structuredClone(DEFAULT_PATTERN)
    for (const role of Object.keys(p) as Array<keyof Pattern>) {
      p[role] = new Array(32).fill(0)
    }
    p.kick[0] = 100
    p.kick[16] = 100
    const result = humanizePattern(p, 0.5, 42)
    expect(result.kick.length).toBe(32)
    expect(result.kick[0]).toBeGreaterThanOrEqual(1)
    expect(result.kick[16]).toBeGreaterThanOrEqual(1)
  })

  it('does not change the active step count', () => {
    const p = makePattern()
    const result = humanizePattern(p, 1, 42)
    for (const role of Object.keys(p) as Array<keyof Pattern>) {
      const origActive = p[role]!.filter((v) => v > 0).length
      const humActive = result[role]!.filter((v) => v > 0).length
      expect(humActive).toBe(origActive)
    }
  })

  it('extreme velocities survive humanization without clipping loss', () => {
    const p = structuredClone(DEFAULT_PATTERN)
    p.kick[0] = 127 // max
    p.kick[4] = 1   // min active
    p.kick[8] = 64  // mid
    const result = humanizePattern(p, 1, 42)
    // None should be clipped to 0 or >127.
    expect(result.kick[0]).toBeGreaterThanOrEqual(1)
    expect(result.kick[0]).toBeLessThanOrEqual(127)
    expect(result.kick[4]).toBeGreaterThanOrEqual(1)
    expect(result.kick[4]).toBeLessThanOrEqual(127)
    expect(result.kick[8]).toBeGreaterThanOrEqual(1)
    expect(result.kick[8]).toBeLessThanOrEqual(127)
  })
})
