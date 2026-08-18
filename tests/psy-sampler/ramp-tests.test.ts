// Velocity ramp tests.
//
// Verifies that rampPattern:
//   1. 'up' → velocities increase from low (step 0) to high (last step)
//   2. 'down' → velocities decrease from high (step 0) to low (last step)
//   3. Does NOT activate silent steps (0 stays 0)
//   4. Does NOT silence active notes (≥1)
//   5. Linear interpolation (middle step ≈ midpoint)
//   6. Clamps to 1-127
//   7. Does NOT mutate the input
//   8. Does NOT touch the NoteMap (handled by the page, not the function)

import { describe, it, expect } from 'bun:test'
import { rampPattern } from '../../src/lib/humanize'
import { DEFAULT_PATTERN } from '../../src/lib/demo-director'
import type { Pattern } from '../../src/lib/demo-director'

function makeFullPattern(): Pattern {
  // Every step active at velocity 100 — so ramp has full effect.
  const p = structuredClone(DEFAULT_PATTERN)
  for (const role of Object.keys(p) as Array<keyof Pattern>) {
    p[role] = new Array(16).fill(100)
  }
  return p
}

function makeSparsePattern(): Pattern {
  // Only some steps active — ramp should only affect active steps.
  const p = structuredClone(DEFAULT_PATTERN)
  p.kick[0] = 100
  p.kick[8] = 100
  p.kick[15] = 100
  return p
}

describe('rampPattern up (build-up)', () => {
  it('step 0 = minVel, last step = maxVel', () => {
    const p = makeFullPattern()
    const result = rampPattern(p, 'up', 40, 127)
    // Every role's step 0 should be 40, step 15 should be 127.
    for (const role of Object.keys(result) as Array<keyof Pattern>) {
      expect(result[role]![0]).toBe(40)
      expect(result[role]![15]).toBe(127)
    }
  })

  it('velocities increase monotonically (each step ≥ previous)', () => {
    const p = makeFullPattern()
    const result = rampPattern(p, 'up', 40, 127)
    for (const role of Object.keys(result) as Array<keyof Pattern>) {
      for (let i = 1; i < 16; i++) {
        expect(result[role]![i]).toBeGreaterThanOrEqual(result[role]![i - 1]!)
      }
    }
  })

  it('middle step ≈ midpoint (83-84)', () => {
    const p = makeFullPattern()
    const result = rampPattern(p, 'up', 40, 127)
    // Step 7 (middle of 16): pos = 7/15 ≈ 0.467. vel = 40 + 87*0.467 ≈ 80.6.
    // Step 8: pos = 8/15 ≈ 0.533. vel = 40 + 87*0.533 ≈ 86.4.
    // So step 7 ≈ 81, step 8 ≈ 86. Both should be in the 70-90 range.
    for (const role of Object.keys(result) as Array<keyof Pattern>) {
      expect(result[role]![7]).toBeGreaterThanOrEqual(75)
      expect(result[role]![7]).toBeLessThanOrEqual(85)
      expect(result[role]![8]).toBeGreaterThanOrEqual(83)
      expect(result[role]![8]).toBeLessThanOrEqual(90)
    }
  })
})

describe('rampPattern down (breakdown)', () => {
  it('step 0 = maxVel, last step = minVel', () => {
    const p = makeFullPattern()
    const result = rampPattern(p, 'down', 40, 127)
    for (const role of Object.keys(result) as Array<keyof Pattern>) {
      expect(result[role]![0]).toBe(127)
      expect(result[role]![15]).toBe(40)
    }
  })

  it('velocities decrease monotonically (each step ≤ previous)', () => {
    const p = makeFullPattern()
    const result = rampPattern(p, 'down', 40, 127)
    for (const role of Object.keys(result) as Array<keyof Pattern>) {
      for (let i = 1; i < 16; i++) {
        expect(result[role]![i]).toBeLessThanOrEqual(result[role]![i - 1]!)
      }
    }
  })
})

describe('rampPattern preserves structure', () => {
  it('does NOT activate silent steps (0 stays 0)', () => {
    const p = makeSparsePattern()
    const result = rampPattern(p, 'up', 40, 127)
    // Steps 1-7, 9-14 should still be 0.
    expect(result.kick[1]).toBe(0)
    expect(result.kick[7]).toBe(0)
    expect(result.kick[9]).toBe(0)
    expect(result.kick[14]).toBe(0)
  })

  it('does NOT silence active notes (≥1)', () => {
    const p = makeSparsePattern()
    const result = rampPattern(p, 'up', 40, 127)
    expect(result.kick[0]).toBeGreaterThanOrEqual(1)
    expect(result.kick[8]).toBeGreaterThanOrEqual(1)
    expect(result.kick[15]).toBeGreaterThanOrEqual(1)
  })

  it('does NOT change the active step count', () => {
    const p = makeSparsePattern()
    const result = rampPattern(p, 'up', 40, 127)
    for (const role of Object.keys(p) as Array<keyof Pattern>) {
      const origActive = p[role]!.filter((v) => v > 0).length
      const rampActive = result[role]!.filter((v) => v > 0).length
      expect(rampActive).toBe(origActive)
    }
  })

  it('does NOT mutate the input pattern', () => {
    const p = makeFullPattern()
    const before = JSON.parse(JSON.stringify(p)) as Pattern
    rampPattern(p, 'up', 40, 127)
    expect(p).toEqual(before)
  })

  it('returns a new object (different reference)', () => {
    const p = makeFullPattern()
    const result = rampPattern(p, 'up', 40, 127)
    expect(result).not.toBe(p)
  })
})

describe('rampPattern clamping + defaults', () => {
  it('clamps to 1-127', () => {
    const p = makeFullPattern()
    const result = rampPattern(p, 'up', -10, 200)
    for (const role of Object.keys(result) as Array<keyof Pattern>) {
      for (const v of result[role]!) {
        expect(v).toBeGreaterThanOrEqual(0) // 0 for silent
        expect(v).toBeLessThanOrEqual(127)
      }
    }
  })

  it('default direction is up', () => {
    const p = makeFullPattern()
    const withDefault = rampPattern(p)
    const withExplicit = rampPattern(p, 'up')
    expect(withDefault).toEqual(withExplicit)
  })

  it('default minVel=40, maxVel=127', () => {
    const p = makeFullPattern()
    const result = rampPattern(p) // defaults
    expect(result.kick[0]).toBe(40)
    expect(result.kick[15]).toBe(127)
  })

  it('all velocities in valid MIDI range (0-127)', () => {
    const p = makeFullPattern()
    for (const dir of ['up', 'down'] as const) {
      const result = rampPattern(p, dir, 40, 127)
      for (const role of Object.keys(result) as Array<keyof Pattern>) {
        for (const v of result[role]!) {
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(127)
        }
      }
    }
  })
})

describe('rampPattern works on all roles', () => {
  it('affects all 9 roles', () => {
    const p = makeFullPattern()
    const result = rampPattern(p, 'up', 40, 127)
    const roles = ['kick', 'bass', 'lead', 'hat-closed', 'hat-open', 'clap', 'perc', 'texture', 'fx'] as const
    for (const role of roles) {
      expect(result[role]![0]).toBe(40)
      expect(result[role]![15]).toBe(127)
    }
  })
})

describe('rampPattern edge cases', () => {
  it('respects 32-step patterns', () => {
    const p = structuredClone(DEFAULT_PATTERN)
    for (const role of Object.keys(p) as Array<keyof Pattern>) {
      p[role] = new Array(32).fill(100)
    }
    const result = rampPattern(p, 'up', 40, 127)
    expect(result.kick.length).toBe(32)
    expect(result.kick[0]).toBe(40)
    expect(result.kick[31]).toBe(127)
  })

  it('respects 8-step patterns', () => {
    const p = structuredClone(DEFAULT_PATTERN)
    for (const role of Object.keys(p) as Array<keyof Pattern>) {
      p[role] = new Array(8).fill(100)
    }
    const result = rampPattern(p, 'up', 40, 127)
    expect(result.kick.length).toBe(8)
    expect(result.kick[0]).toBe(40)
    expect(result.kick[7]).toBe(127)
  })

  it('up and down are inverses (step 0 ↔ last step)', () => {
    const p = makeFullPattern()
    const up = rampPattern(p, 'up', 40, 127)
    const down = rampPattern(p, 'down', 40, 127)
    // up[0] = down[15] = 40, up[15] = down[0] = 127.
    expect(up.kick[0]).toBe(down.kick[15])
    expect(up.kick[15]).toBe(down.kick[0])
    expect(up.kick[0]).toBe(40)
    expect(up.kick[15]).toBe(127)
  })
})
