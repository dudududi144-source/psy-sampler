// Velocity scaler tests.
//
// Verifies that scalePattern:
//   1. factor=1.0 is passthrough (same velocities, but new object)
//   2. factor=0.5 halves velocities (rounded)
//   3. factor=2.0 doubles velocities (clamped to 127)
//   4. Does NOT silence active notes (≥1)
//   5. Does NOT activate silent steps (0 stays 0)
//   6. Does NOT mutate the input pattern
//   7. Clamps to 1-127 (never 0 on active, never >127)
//   8. Works on all 9 roles
//   9. Respects 32-step patterns
//  10. Preserves active step count

import { describe, it, expect } from 'bun:test'
import { scalePattern } from '../../src/lib/humanize'
import { DEFAULT_PATTERN } from '../../src/lib/demo-director'
import type { Pattern } from '../../src/lib/demo-director'

const ROLES = [
  'kick', 'bass', 'lead', 'hat-closed', 'hat-open', 'clap', 'perc', 'texture', 'fx',
] as const

function makePattern(): Pattern {
  // Known velocities for deterministic assertions.
  const p = structuredClone(DEFAULT_PATTERN)
  p.kick[0] = 100
  p.kick[4] = 100
  p.kick[8] = 100
  p.kick[12] = 100
  p.bass[0] = 80
  p.bass[2] = 90
  p.lead[0] = 70
  p.lead[8] = 110
  return p
}

describe('scalePattern factor=1.0 (passthrough)', () => {
  it('factor=1.0 returns identical velocities', () => {
    const p = makePattern()
    const result = scalePattern(p, 1.0)
    expect(result).toEqual(p)
  })

  it('factor=1.0 returns a NEW object (not the same reference)', () => {
    const p = makePattern()
    const result = scalePattern(p, 1.0)
    expect(result).not.toBe(p)
    // And each row is a new array, too.
    expect(result.kick).not.toBe(p.kick)
  })
})

describe('scalePattern factor=0.5 (softer)', () => {
  it('halves velocities (100 → 50, 110 → 55)', () => {
    const p = makePattern()
    const result = scalePattern(p, 0.5)
    expect(result.kick[0]).toBe(50) // 100 * 0.5
    expect(result.lead[8]).toBe(55) // 110 * 0.5
    expect(result.bass[0]).toBe(40) // 80 * 0.5
    expect(result.bass[2]).toBe(45) // 90 * 0.5
  })

  it('halves do not silence: 1 * 0.5 = 0.5 → rounds to 1, clamped to ≥1', () => {
    const p = makePattern()
    p.kick[0] = 1 // minimum active
    const result = scalePattern(p, 0.5)
    // 1 * 0.5 = 0.5 → rounds to 1 (round-half-up) or 0 (round-half-even),
    // then clamped to ≥1 → must be 1.
    expect(result.kick[0]).toBeGreaterThanOrEqual(1)
  })
})

describe('scalePattern factor=2.0 (louder, clamped)', () => {
  it('doubles velocities (50 → 100, 80 → 160 → 127)', () => {
    const p = makePattern()
    p.kick[0] = 50
    p.bass[0] = 80
    const result = scalePattern(p, 2.0)
    expect(result.kick[0]).toBe(100)   // 50 * 2.0
    expect(result.bass[0]).toBe(127)   // 80 * 2.0 = 160 → clamp 127
  })

  it('already-max velocities stay at 127 (no overflow)', () => {
    const p = makePattern()
    p.kick[0] = 127
    const result = scalePattern(p, 2.0)
    expect(result.kick[0]).toBe(127)
  })

  it('large factors still clamp at 127', () => {
    const p = makePattern()
    const result = scalePattern(p, 100.0)
    // Every active velocity should be 127.
    for (const role of ROLES) {
      for (let i = 0; i < p[role]!.length; i++) {
        if (p[role]![i]! > 0) {
          expect(result[role]![i]).toBe(127)
        }
      }
    }
  })
})

describe('scalePattern preserves active structure', () => {
  it('does NOT silence active notes (≥1)', () => {
    const p = makePattern()
    const result = scalePattern(p, 0.5)
    for (const role of ROLES) {
      for (let i = 0; i < p[role]!.length; i++) {
        if (p[role]![i]! > 0) {
          expect(result[role]![i]).toBeGreaterThanOrEqual(1)
        }
      }
    }
  })

  it('does NOT activate silent steps (0 stays 0)', () => {
    const p = makePattern()
    const result = scalePattern(p, 1.5)
    for (const role of ROLES) {
      for (let i = 0; i < p[role]!.length; i++) {
        if (p[role]![i]! === 0) {
          expect(result[role]![i]).toBe(0)
        }
      }
    }
  })

  it('preserves active step count per role', () => {
    const p = makePattern()
    const result = scalePattern(p, 0.7)
    for (const role of ROLES) {
      const origActive = p[role]!.filter((v) => v > 0).length
      const scaledActive = result[role]!.filter((v) => v > 0).length
      expect(scaledActive).toBe(origActive)
    }
  })
})

describe('scalePattern clamping + mutation safety', () => {
  it('clamps to 1-127 (never 0 on active, never >127)', () => {
    const p = makePattern()
    p.kick[0] = 1   // minimum active
    p.kick[4] = 127 // maximum
    const result = scalePattern(p, 1.5)
    expect(result.kick[0]).toBeGreaterThanOrEqual(1)
    expect(result.kick[0]).toBeLessThanOrEqual(127)
    expect(result.kick[4]).toBeGreaterThanOrEqual(1)
    expect(result.kick[4]).toBeLessThanOrEqual(127)
  })

  it('does NOT mutate the input pattern', () => {
    const p = makePattern()
    const before = JSON.parse(JSON.stringify(p)) as Pattern
    scalePattern(p, 0.5)
    expect(p).toEqual(before)
  })
})

describe('scalePattern scope', () => {
  it('works on all 9 roles', () => {
    const p = structuredClone(DEFAULT_PATTERN)
    // Set every role's step 0 to a known velocity.
    for (const role of ROLES) {
      p[role]![0] = 100
    }
    const result = scalePattern(p, 0.5)
    for (const role of ROLES) {
      expect(result[role]![0]).toBe(50)
    }
  })

  it('respects 32-step patterns', () => {
    const p = structuredClone(DEFAULT_PATTERN)
    for (const role of ROLES) {
      p[role] = new Array(32).fill(0)
    }
    p.kick[0] = 100
    p.kick[16] = 100
    p.kick[31] = 100
    const result = scalePattern(p, 0.5)
    expect(result.kick.length).toBe(32)
    expect(result.kick[0]).toBe(50)
    expect(result.kick[16]).toBe(50)
    expect(result.kick[31]).toBe(50)
    // All other steps should be silent (preserved).
    expect(result.kick[1]).toBe(0)
    expect(result.kick[15]).toBe(0)
    expect(result.kick[30]).toBe(0)
  })

  it('respects 8-step patterns', () => {
    const p = structuredClone(DEFAULT_PATTERN)
    for (const role of ROLES) {
      p[role] = new Array(8).fill(80)
    }
    const result = scalePattern(p, 1.0)
    expect(result.kick.length).toBe(8)
    expect(result.kick[0]).toBe(80)
    expect(result.kick[7]).toBe(80)
  })
})

describe('scalePattern edge cases', () => {
  it('factor=1.5 makes a 100 → 150 → clamp 127', () => {
    const p = makePattern()
    p.kick[0] = 100
    const result = scalePattern(p, 1.5)
    expect(result.kick[0]).toBe(127)
  })

  it('factor=0.0 does NOT silence active notes (clamps to 1)', () => {
    // Edge: 0 * factor = 0 mathematically, but spec says "never silence active".
    const p = makePattern()
    p.kick[0] = 100
    const result = scalePattern(p, 0.0)
    expect(result.kick[0]).toBeGreaterThanOrEqual(1)
  })

  it('all velocities stay in valid MIDI range 0-127', () => {
    const p = makePattern()
    for (const factor of [0.0, 0.25, 0.5, 1.0, 1.5, 2.0, 5.0]) {
      const result = scalePattern(p, factor)
      for (const role of ROLES) {
        for (const v of result[role]!) {
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(127)
        }
      }
    }
  })

  it('factor=1.5 raises 70 → 105', () => {
    const p = makePattern()
    p.lead[0] = 70
    const result = scalePattern(p, 1.5)
    expect(result.lead[0]).toBe(105)
  })
})
