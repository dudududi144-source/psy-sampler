// Voice pool + variance rules tests.

import { describe, it, expect, beforeEach } from 'bun:test'
import { VoicePool, type Voice } from '../../src/psy-foundation-shim'
import { DEFAULT_VARIANCE_RULES } from '../../src/psy-sampler'

class TestVoice implements Voice {
  active = false
  noteOnCalls = 0
  panicCalls = 0
  noteOffCalls = 0
  noteOn(_note: number, _velocity: number): void {
    this.noteOnCalls++
    this.active = true
  }
  noteOff(): void {
    this.noteOffCalls++
    this.active = false
  }
  panic(): void {
    this.panicCalls++
    this.active = false
  }
}

describe('VoicePool<TestVoice>', () => {
  let pool: VoicePool<TestVoice>

  beforeEach(() => {
    pool = new VoicePool(() => new TestVoice(), 8)
  })

  it('preallocates voices', () => {
    expect(pool.size).toBe(8)
    expect(pool.all.length).toBe(8)
  })

  it('allocate() returns inactive voice first', () => {
    const v = pool.allocate()
    expect(v).toBeDefined()
    expect(v.active).toBe(false)
  })

  it('activeCount tracks active voices', () => {
    expect(pool.activeCount).toBe(0)
    pool.allocate().active = true
    pool.allocate().active = true
    expect(pool.activeCount).toBe(2)
  })

  it('steals oldest when all active', () => {
    // Allocate all voices (uses the free-list).
    for (let i = 0; i < 8; i++) {
      pool.allocate().active = true
    }
    expect(pool.activeCount).toBe(8)
    const stolen = pool.allocate()
    expect(stolen.panicCalls).toBe(1)
    expect(stolen.active).toBe(false)
  })

  it('never creates more voices than maxVoices', () => {
    const allocations: TestVoice[] = []
    for (let i = 0; i < 100; i++) {
      const v = pool.allocate()
      v.active = true
      allocations.push(v)
    }
    const uniqueVoices = new Set(allocations)
    expect(uniqueVoices.size).toBeLessThanOrEqual(8)
    expect(pool.size).toBe(8)
  })

  it('panic() force-stops all voices', () => {
    for (const v of pool.all) v.active = true
    pool.panic()
    expect(pool.activeCount).toBe(0)
    for (const v of pool.all) expect(v.panicCalls).toBe(1)
  })

  it('allOff() calls noteOff on every voice', () => {
    for (const v of pool.all) v.active = true
    pool.allOff()
    for (const v of pool.all) {
      expect(v.noteOffCalls).toBe(1)
      expect(v.active).toBe(false)
    }
  })

  it('round-robin: allocate returns different voices when inactive', () => {
    const a = pool.allocate()
    const b = pool.allocate()
    expect(a).not.toBe(b)
  })
})

describe('DEFAULT_VARIANCE_RULES', () => {
  it('kick: 4 variants, ±0.3% pitch, mono (panVar=0)', () => {
    const r = DEFAULT_VARIANCE_RULES.kick
    expect(r.variants).toBe(4)
    expect(r.pitchVar).toBe(0.003)
    expect(r.panVar).toBe(0)
  })

  it('hat-open: 8 variants, wider pitch + pan', () => {
    const r = DEFAULT_VARIANCE_RULES['hat-open']
    expect(r.variants).toBe(8)
    expect(r.pitchVar).toBe(0.0175)
    expect(r.panVar).toBe(0.14)
  })

  it('clap: 4 variants, mono', () => {
    const r = DEFAULT_VARIANCE_RULES.clap
    expect(r.variants).toBe(4)
    expect(r.panVar).toBe(0)
  })

  it('kick pitch variance ≤ 0.5% (phase-safe rule)', () => {
    // The rule's pitchVar is the half-amplitude; max deviation = pitchVar.
    // 0.003 = 0.3% < 0.5% — phase-safe.
    expect(DEFAULT_VARIANCE_RULES.kick.pitchVar).toBeLessThanOrEqual(0.005)
  })

  it('all categories have at least 2 variants', () => {
    for (const [cat, rule] of Object.entries(DEFAULT_VARIANCE_RULES)) {
      expect(rule.variants).toBeGreaterThanOrEqual(2)
    }
  })
})
