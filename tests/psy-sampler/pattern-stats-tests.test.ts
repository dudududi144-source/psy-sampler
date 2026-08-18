// Pattern statistics tests.
//
// Verifies that patternStats:
//   1. Counts active notes correctly
//   2. Computes density (active/total)
//   3. Computes average velocity
//   4. Finds min/max velocity
//   5. Per-role counts are correct
//   6. Handles empty patterns (all 0)
//   7. Handles full patterns (all 127)
//   8. Does NOT mutate the input

import { describe, it, expect } from 'bun:test'
import { patternStats } from '../../src/lib/pattern-stats'
import { DEFAULT_PATTERN } from '../../src/lib/demo-director'
import type { Pattern } from '../../src/lib/demo-director'

function makeEmpty(): Pattern {
  const p = structuredClone(DEFAULT_PATTERN)
  for (const role of Object.keys(p) as Array<keyof Pattern>) {
    p[role] = new Array(16).fill(0)
  }
  return p
}

function makeFull(): Pattern {
  const p = structuredClone(DEFAULT_PATTERN)
  for (const role of Object.keys(p) as Array<keyof Pattern>) {
    p[role] = new Array(16).fill(100)
  }
  return p
}

function makeMixed(): Pattern {
  const p = makeEmpty() // start from empty, add specific notes
  p.kick[0] = 100
  p.kick[8] = 127
  p.bass[0] = 50
  p.bass[4] = 80
  p.lead[8] = 110
  return p
}

describe('patternStats active notes', () => {
  it('empty pattern has 0 active notes', () => {
    const stats = patternStats(makeEmpty())
    expect(stats.activeNotes).toBe(0)
  })

  it('full 16-step pattern has 144 active notes (9×16)', () => {
    const stats = patternStats(makeFull())
    expect(stats.activeNotes).toBe(144)
  })

  it('mixed pattern counts active notes correctly', () => {
    const stats = patternStats(makeMixed())
    // kick: 2, bass: 2, lead: 1 = 5 total.
    expect(stats.activeNotes).toBe(5)
  })

  it('per-role counts are correct', () => {
    const stats = patternStats(makeMixed())
    expect(stats.perRole.kick).toBe(2)
    expect(stats.perRole.bass).toBe(2)
    expect(stats.perRole.lead).toBe(1)
    expect(stats.perRole.clap).toBe(0)
    expect(stats.perRole.fx).toBe(0)
  })
})

describe('patternStats density', () => {
  it('empty pattern has 0% density', () => {
    const stats = patternStats(makeEmpty())
    expect(stats.density).toBe(0)
  })

  it('full pattern has 100% density', () => {
    const stats = patternStats(makeFull())
    expect(stats.density).toBe(1)
  })

  it('mixed pattern density = active/total', () => {
    const stats = patternStats(makeMixed())
    // 5 active / 144 total.
    expect(stats.density).toBeCloseTo(5 / 144, 4)
  })

  it('density is between 0 and 1', () => {
    for (const p of [makeEmpty(), makeFull(), makeMixed()]) {
      const stats = patternStats(p)
      expect(stats.density).toBeGreaterThanOrEqual(0)
      expect(stats.density).toBeLessThanOrEqual(1)
    }
  })
})

describe('patternStats velocity', () => {
  it('empty pattern has 0 avg/min/max velocity', () => {
    const stats = patternStats(makeEmpty())
    expect(stats.avgVelocity).toBe(0)
    expect(stats.minVelocity).toBe(0)
    expect(stats.maxVelocity).toBe(0)
  })

  it('full pattern (all 100) has avg=100, min=100, max=100', () => {
    const stats = patternStats(makeFull())
    expect(stats.avgVelocity).toBe(100)
    expect(stats.minVelocity).toBe(100)
    expect(stats.maxVelocity).toBe(100)
  })

  it('mixed pattern has correct avg/min/max', () => {
    const stats = patternStats(makeMixed())
    // Active velocities: 100, 127, 50, 80, 110.
    // avg = (100+127+50+80+110)/5 = 467/5 = 93.4 → rounded 93.
    // min = 50, max = 127.
    expect(stats.avgVelocity).toBe(93)
    expect(stats.minVelocity).toBe(50)
    expect(stats.maxVelocity).toBe(127)
  })

  it('avg velocity is between min and max', () => {
    const stats = patternStats(makeMixed())
    if (stats.activeNotes > 0) {
      expect(stats.avgVelocity).toBeGreaterThanOrEqual(stats.minVelocity)
      expect(stats.avgVelocity).toBeLessThanOrEqual(stats.maxVelocity)
    }
  })
})

describe('patternStats totalSteps', () => {
  it('16-step pattern has 144 total steps (9×16)', () => {
    const stats = patternStats(makeFull())
    expect(stats.totalSteps).toBe(144)
  })

  it('32-step pattern has 288 total steps (9×32)', () => {
    const p = structuredClone(DEFAULT_PATTERN)
    for (const role of Object.keys(p) as Array<keyof Pattern>) {
      p[role] = new Array(32).fill(0)
    }
    const stats = patternStats(p)
    expect(stats.totalSteps).toBe(288)
  })

  it('8-step pattern has 72 total steps (9×8)', () => {
    const p = structuredClone(DEFAULT_PATTERN)
    for (const role of Object.keys(p) as Array<keyof Pattern>) {
      p[role] = new Array(8).fill(0)
    }
    const stats = patternStats(p)
    expect(stats.totalSteps).toBe(72)
  })
})

describe('patternStats edge cases', () => {
  it('does NOT mutate the input pattern', () => {
    const p = makeMixed()
    const before = JSON.parse(JSON.stringify(p)) as Pattern
    patternStats(p)
    expect(p).toEqual(before)
  })

  it('single note at velocity 1', () => {
    const p = makeEmpty()
    p.kick[0] = 1
    const stats = patternStats(p)
    expect(stats.activeNotes).toBe(1)
    expect(stats.avgVelocity).toBe(1)
    expect(stats.minVelocity).toBe(1)
    expect(stats.maxVelocity).toBe(1)
  })

  it('single note at velocity 127', () => {
    const p = makeEmpty()
    p.lead[8] = 127
    const stats = patternStats(p)
    expect(stats.activeNotes).toBe(1)
    expect(stats.avgVelocity).toBe(127)
    expect(stats.minVelocity).toBe(127)
    expect(stats.maxVelocity).toBe(127)
  })

  it('all 9 roles are in perRole', () => {
    const stats = patternStats(makeEmpty())
    const roles = ['kick', 'bass', 'lead', 'hat-closed', 'hat-open', 'clap', 'perc', 'texture', 'fx'] as const
    for (const role of roles) {
      expect(stats.perRole[role]).toBeDefined()
    }
  })

  it('is deterministic (same input → same output)', () => {
    const p = makeMixed()
    const s1 = patternStats(p)
    const s2 = patternStats(p)
    expect(s1).toEqual(s2)
  })
})
