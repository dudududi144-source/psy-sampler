// Velocity quantization tests.
//
// Verifies that quantizePattern:
//   1. Snaps velocities to standard tiers (3/4/5)
//   2. Does NOT silence active notes (never snaps to 0)
//   3. Does NOT activate silent steps (0 stays 0)
//   4. Does NOT mutate the input
//   5. Is deterministic (no RNG — pure snapping)
//   6. Works on all 9 roles

import { describe, it, expect } from 'bun:test'
import { quantizePattern, humanizePattern } from '../../src/lib/humanize'
import { DEFAULT_PATTERN } from '../../src/lib/demo-director'
import type { Pattern } from '../../src/lib/demo-director'

function makePattern(): Pattern {
  const p = structuredClone(DEFAULT_PATTERN)
  // Mix of velocities to test snapping.
  p.kick[0] = 100  // → 100 (normal)
  p.kick[4] = 127  // → 127 (accent)
  p.kick[8] = 50   // → 100 (nearest non-zero tier)
  p.kick[12] = 110 // → 100 or 127 (nearest)
  p.bass[0] = 80   // → 100
  p.bass[2] = 64   // → 100 (3-tier) or 64 (4-tier)
  p.lead[0] = 120  // → 127
  p.lead[8] = 30   // → 100 (3-tier, nearest non-zero)
  return p
}

describe('quantizePattern (3 tiers: off/normal/accent)', () => {
  it('snaps velocities to {0, 100, 127}', () => {
    const p = makePattern()
    const result = quantizePattern(p, 3)
    const valid = new Set([0, 100, 127])
    for (const role of Object.keys(result) as Array<keyof Pattern>) {
      for (const v of result[role]!) {
        expect(valid.has(v)).toBe(true)
      }
    }
  })

  it('does NOT silence active notes (never 0)', () => {
    const p = makePattern()
    const result = quantizePattern(p, 3)
    // Every note that was active should still be active (≥1, actually ≥100).
    for (const role of Object.keys(p) as Array<keyof Pattern>) {
      for (let i = 0; i < p[role]!.length; i++) {
        if (p[role]![i]! > 0) {
          expect(result[role]![i]).toBeGreaterThan(0)
        }
      }
    }
  })

  it('does NOT activate silent steps (0 stays 0)', () => {
    const p = makePattern()
    const result = quantizePattern(p, 3)
    for (const role of Object.keys(p) as Array<keyof Pattern>) {
      for (let i = 0; i < p[role]!.length; i++) {
        if (p[role]![i]! === 0) {
          expect(result[role]![i]).toBe(0)
        }
      }
    }
  })

  it('127 stays 127 (accent)', () => {
    const p = makePattern()
    const result = quantizePattern(p, 3)
    expect(result.kick[4]).toBe(127)
    expect(result.lead[0]).toBe(127)
  })

  it('100 stays 100 (normal)', () => {
    const p = makePattern()
    const result = quantizePattern(p, 3)
    expect(result.kick[0]).toBe(100)
  })

  it('low velocities snap to 100 (nearest non-zero tier, never 0)', () => {
    const p = makePattern()
    const result = quantizePattern(p, 3)
    // 50 and 30 are closer to 100 than to 127.
    expect(result.kick[8]).toBe(100) // 50 → 100
    expect(result.lead[8]).toBe(100) // 30 → 100
  })

  it('110 snaps to 100 (closer to 100 than 127)', () => {
    const p = makePattern()
    const result = quantizePattern(p, 3)
    // 110 is 10 away from 100, 17 away from 127.
    expect(result.kick[12]).toBe(100)
  })

  it('does NOT mutate the input pattern', () => {
    const p = makePattern()
    const before = JSON.parse(JSON.stringify(p)) as Pattern
    quantizePattern(p, 3)
    expect(p).toEqual(before)
  })

  it('returns a new object (different reference)', () => {
    const p = makePattern()
    const result = quantizePattern(p, 3)
    expect(result).not.toBe(p)
  })

  it('is deterministic (same input → same output, no RNG)', () => {
    const p = makePattern()
    const r1 = quantizePattern(p, 3)
    const r2 = quantizePattern(p, 3)
    expect(r1).toEqual(r2)
  })
})

describe('quantizePattern (4 tiers: off/soft/normal/accent)', () => {
  it('snaps to {0, 64, 100, 127}', () => {
    const p = makePattern()
    const result = quantizePattern(p, 4)
    const valid = new Set([0, 64, 100, 127])
    for (const role of Object.keys(result) as Array<keyof Pattern>) {
      for (const v of result[role]!) {
        expect(valid.has(v)).toBe(true)
      }
    }
  })

  it('64 stays 64 (soft)', () => {
    const p = makePattern()
    const result = quantizePattern(p, 4)
    expect(result.bass[2]).toBe(64)
  })

  it('50 snaps to 64 (closer to 64 than 100)', () => {
    const p = makePattern()
    const result = quantizePattern(p, 4)
    expect(result.kick[8]).toBe(64) // 50 is 14 from 64, 50 from 100
  })
})

describe('quantizePattern (5 tiers: off/very-soft/soft/normal/accent)', () => {
  it('snaps to {0, 32, 64, 96, 127}', () => {
    const p = makePattern()
    const result = quantizePattern(p, 5)
    const valid = new Set([0, 32, 64, 96, 127])
    for (const role of Object.keys(result) as Array<keyof Pattern>) {
      for (const v of result[role]!) {
        expect(valid.has(v)).toBe(true)
      }
    }
  })

  it('100 snaps to 96 (closer to 96 than 127)', () => {
    const p = makePattern()
    const result = quantizePattern(p, 5)
    expect(result.kick[0]).toBe(96) // 100 is 4 from 96, 27 from 127
  })
})

describe('quantizePattern defaults', () => {
  it('default tiers is 3', () => {
    const p = makePattern()
    const withDefault = quantizePattern(p)
    const withExplicit = quantizePattern(p, 3)
    expect(withDefault).toEqual(withExplicit)
  })

  it('invalid tiers falls back to 3', () => {
    const p = makePattern()
    const withInvalid = quantizePattern(p, 99)
    const with3 = quantizePattern(p, 3)
    expect(withInvalid).toEqual(with3)
  })
})

describe('quantizePattern edge cases', () => {
  it('works on all 9 roles', () => {
    const p = structuredClone(DEFAULT_PATTERN)
    const roles = ['kick', 'bass', 'lead', 'hat-closed', 'hat-open', 'clap', 'perc', 'texture', 'fx'] as const
    for (const role of roles) {
      p[role]![0] = 90
    }
    const result = quantizePattern(p, 3)
    for (const role of roles) {
      expect(result[role]![0]).toBeGreaterThan(0)
      expect(result[role]![0]).toBeLessThanOrEqual(127)
    }
  })

  it('respects 32-step patterns', () => {
    const p = structuredClone(DEFAULT_PATTERN)
    for (const role of Object.keys(p) as Array<keyof Pattern>) {
      p[role] = new Array(32).fill(0)
    }
    p.kick[0] = 100
    p.kick[16] = 50
    const result = quantizePattern(p, 3)
    expect(result.kick.length).toBe(32)
    expect(result.kick[0]).toBe(100)
    expect(result.kick[16]).toBe(100) // 50 snaps to 100
  })

  it('does not change the active step count', () => {
    const p = makePattern()
    const result = quantizePattern(p, 3)
    for (const role of Object.keys(p) as Array<keyof Pattern>) {
      const origActive = p[role]!.filter((v) => v > 0).length
      const quantActive = result[role]!.filter((v) => v > 0).length
      expect(quantActive).toBe(origActive)
    }
  })

  it('extreme velocities (1 and 127) survive', () => {
    const p = structuredClone(DEFAULT_PATTERN)
    p.kick[0] = 1   // minimum active — snaps to 100
    p.kick[4] = 127 // max — stays 127
    const result = quantizePattern(p, 3)
    expect(result.kick[0]).toBe(100) // 1 is closer to 100 than 127
    expect(result.kick[4]).toBe(127)
  })

  it('quantize after humanize removes variation (clean tier values)', () => {
    // Quantize after humanize should produce the standard tier values,
    // removing the random variation humanize added.
    const p = makePattern()
    const humanized = humanizePattern(p, 1, 42) // max variation
    const requantized = quantizePattern(humanized, 3)
    // All velocities should be standard tiers.
    const valid = new Set([0, 100, 127])
    for (const role of Object.keys(requantized) as Array<keyof Pattern>) {
      for (const v of requantized[role]!) {
        expect(valid.has(v)).toBe(true)
      }
    }
  })
})
