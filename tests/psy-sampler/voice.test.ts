// Voice pool + round-robin tests.

import { describe, it, expect, beforeEach } from 'bun:test'
import { VoicePool, Rng, type Voice } from '../../src/psy-foundation-shim'
import { RoundRobinBank, DEFAULT_VARIANCE_RULES } from '../../src/psy-sampler/round-robin'

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

  it('activateCount tracks active voices', () => {
    expect(pool.activeCount).toBe(0)
    pool.allocate().active = true
    pool.allocate().active = true
    expect(pool.activeCount).toBe(2)
  })

  it('steals oldest when all active', () => {
    // Mark all 8 voices active.
    for (const v of pool.all) v.active = true
    expect(pool.activeCount).toBe(8)
    const stolen = pool.allocate()
    // The stolen voice should have had panic() called (by the pool's stealing logic).
    expect(stolen.panicCalls).toBe(1)
    expect(stolen.active).toBe(false)
  })

  it('never creates more voices than maxVoices', () => {
    const allocations = []
    for (let i = 0; i < 100; i++) {
      const v = pool.allocate()
      v.active = true // force stealing on subsequent allocates
      allocations.push(v)
    }
    // All returned voices must be from the original 8.
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

describe('RoundRobinBank', () => {
  it('phrase-locked: within a phrase, variant does not change', () => {
    // Real usage: phrasePosition goes 0,1,2,...,7. The variant set at 0
    // should persist for 1-7 (no rotation mid-phrase).
    const bank = new RoundRobinBank()
    const r0 = bank.next('kick', 0) // phrase boundary — variant advances
    const r1 = bank.next('kick', 1) // mid-phrase — variant stays
    const r2 = bank.next('kick', 2)
    const r3 = bank.next('kick', 3)
    const r4 = bank.next('kick', 4)
    const r5 = bank.next('kick', 5)
    const r6 = bank.next('kick', 6)
    const r7 = bank.next('kick', 7)
    expect(r1.variant).toBe(r0.variant)
    expect(r2.variant).toBe(r0.variant)
    expect(r3.variant).toBe(r0.variant)
    expect(r4.variant).toBe(r0.variant)
    expect(r5.variant).toBe(r0.variant)
    expect(r6.variant).toBe(r0.variant)
    expect(r7.variant).toBe(r0.variant)
  })

  it('rotates variant on phrase boundary (phrasePosition 0)', () => {
    const bank = new RoundRobinBank()
    const r1 = bank.next('kick', 0) // phrase 0, variant advances
    bank.next('kick', 1) // same phrase
    bank.next('kick', 2)
    bank.next('kick', 3)
    bank.next('kick', 4)
    bank.next('kick', 5)
    bank.next('kick', 6)
    bank.next('kick', 7)
    const r2 = bank.next('kick', 0) // new phrase, variant advances again
    expect(r1.variant).not.toBe(r2.variant)
  })

  it('kick pitch variance within ±0.5%', () => {
    const bank = new RoundRobinBank()
    for (let i = 0; i < 32; i++) {
      const r = bank.next('kick', 0)
      expect(Math.abs(r.pitch - 1.0)).toBeLessThanOrEqual(0.005)
    }
  })

  it('reset() clears all counters', () => {
    const bank = new RoundRobinBank()
    bank.next('kick', 0)
    bank.next('kick', 0)
    bank.reset()
    const r = bank.next('kick', 0)
    // After reset, the first call should return variant based on fresh counter.
    expect(r.variant).toBe(1) // first call advances counter from 0 to 1
  })

  it('default variance rules have correct variant counts', () => {
    expect(DEFAULT_VARIANCE_RULES.kick.variants).toBe(4)
    expect(DEFAULT_VARIANCE_RULES['hat-open'].variants).toBe(8)
    expect(DEFAULT_VARIANCE_RULES.clap.variants).toBe(4)
  })

  it('kick pan is always 0 (mono)', () => {
    const bank = new RoundRobinBank()
    // Simulate a real phrase: positions 0-7.
    for (let pos = 0; pos < 8; pos++) {
      const r = bank.next('kick', pos)
      expect(r.pan).toBe(0)
    }
    // Next phrase.
    for (let pos = 0; pos < 8; pos++) {
      const r = bank.next('kick', pos)
      expect(r.pan).toBe(0)
    }
  })

  it('hat has non-zero pan variance', () => {
    const bank = new RoundRobinBank()
    let sawNonZeroPan = false
    for (let i = 0; i < 16; i++) {
      const r = bank.next('hat-closed', 0)
      if (r.pan !== 0) sawNonZeroPan = true
    }
    expect(sawNonZeroPan).toBe(true)
  })
})
