// Bass pattern variation tests.
//
// Verifies that each bass pattern produces the correct rhythm (WHEN notes fire)
// and pitch (WHAT tone: root / 5th / octave):
//   root    → beats 1+3 (steps 0,8) strong root, optional walking 5th
//   walking → every beat (steps 0,4,8,12) alternating root/5th
//   octave  → every beat, root then root+12 (octave jump)
//   pedal   → every step (16ths) all root (dronal)
//   arp     → every 8th (steps 0,2,4,...) rolling root/5th/octave/5th
//
// Also verifies that different patterns produce different basslines from the
// same chord progression.

import { describe, it, expect } from 'bun:test'
import {
  BASS_LABELS,
  generateProgression,
  applyProgression,
  generateChordPattern,
  type BassPattern,
} from '../../src/lib/chord-progression'
import { DEFAULT_PATTERN } from '../../src/lib/demo-director'

const CTX = { rootPc: 9, scale: 'phrygianDominant' as const }

// ─── BASS_LABELS ──────────────────────────────────────────────────────────────

describe('BASS_LABELS', () => {
  it('has exactly 5 patterns', () => {
    expect(Object.keys(BASS_LABELS).length).toBe(5)
  })

  it('includes root, walking, octave, pedal, arp', () => {
    const keys = Object.keys(BASS_LABELS)
    expect(keys).toContain('root')
    expect(keys).toContain('walking')
    expect(keys).toContain('octave')
    expect(keys).toContain('pedal')
    expect(keys).toContain('arp')
  })

  it('all labels are non-empty and descriptive', () => {
    for (const label of Object.values(BASS_LABELS)) {
      expect(label.length).toBeGreaterThan(3)
    }
  })
})

// ─── Bass rhythm + pitch per pattern ──────────────────────────────────────────
//
// Each pattern defines BOTH rhythm (when) and pitch (what). We verify:
//   - The correct steps are active
//   - The active steps have the correct chord tone (root/5th/octave)
//   - The pattern respects chord changes

describe('Bass pattern rhythm + pitch', () => {
  const prog = generateProgression(CTX, 42)
  const chordSpan = Math.floor(16 / prog.chords.length) // 4

  function expectedBassPitch(chordIdx: number, toneIdx: number): number {
    const chord = prog.chords[chordIdx]!
    return toneIdx < 3 ? chord.tones[toneIdx]! : chord.tones[0]! + 12
  }

  it('root: notes on beats 1+3 (steps 0,8)', () => {
    const { pattern, noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root')
    expect(pattern.bass[0]).toBeGreaterThan(0)
    expect(pattern.bass[8]).toBeGreaterThan(0)
    // Steps 1,3,5,7 (off-beat) are usually silent (40% chance of 5th).
    // The root pattern prioritizes downbeats.
    expect(noteMap.bass![0]).not.toBeNull()
    expect(noteMap.bass![8]).not.toBeNull()
    // Step 0 pitch = chord 0 root.
    expect(noteMap.bass![0]).toBe(expectedBassPitch(0, 0))
  })

  it('walking: every beat (steps 0,4,8,12) alternating root/5th', () => {
    const { pattern, noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'walking')
    // All 4 beats active.
    expect(pattern.bass[0]).toBeGreaterThan(0)
    expect(pattern.bass[4]).toBeGreaterThan(0)
    expect(pattern.bass[8]).toBeGreaterThan(0)
    expect(pattern.bass[12]).toBeGreaterThan(0)
    // Beat 0 = root, beat 1 = 5th, beat 2 = root, beat 3 = 5th.
    expect(noteMap.bass![0]).toBe(expectedBassPitch(0, 0)) // root
    expect(noteMap.bass![4]).toBe(expectedBassPitch(1, 2)) // 5th of chord 1
    expect(noteMap.bass![8]).toBe(expectedBassPitch(2, 0)) // root of chord 2
    expect(noteMap.bass![12]).toBe(expectedBassPitch(3, 2)) // 5th of chord 3
  })

  it('octave: every beat, alternating root/octave', () => {
    const { pattern, noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'octave')
    expect(pattern.bass[0]).toBeGreaterThan(0)
    expect(pattern.bass[4]).toBeGreaterThan(0)
    // Beat 0 = root, beat 1 = root+12 (octave).
    expect(noteMap.bass![0]).toBe(expectedBassPitch(0, 0)) // root
    expect(noteMap.bass![4]).toBe(expectedBassPitch(1, 3)) // octave of chord 1
  })

  it('pedal: every step active, always root', () => {
    const { pattern, noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'pedal')
    // All 16 steps active (16ths).
    for (let i = 0; i < 16; i++) {
      expect(pattern.bass[i]).toBeGreaterThan(0)
      expect(noteMap.bass![i]).not.toBeNull()
    }
    // Every step is the root of its chord.
    for (let i = 0; i < 16; i++) {
      const chordIdx = Math.floor(i / chordSpan) % prog.chords.length
      expect(noteMap.bass![i]).toBe(expectedBassPitch(chordIdx, 0))
    }
  })

  it('arp: every 8th (even steps) rolling root/5th/octave/5th', () => {
    const { pattern, noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'arp')
    // Even steps active, odd steps silent.
    for (let i = 0; i < 16; i++) {
      if (i % 2 === 0) {
        expect(pattern.bass[i]).toBeGreaterThan(0)
      } else {
        expect(pattern.bass[i]).toBe(0)
      }
    }
    // Arp sequence: root(0), 5th(2), octave(3), 5th(2) — repeating.
    const arpSeq = [0, 2, 3, 2]
    for (let i = 0; i < 16; i += 2) {
      const chordIdx = Math.floor(i / chordSpan) % prog.chords.length
      const arpPos = Math.floor(i / 2)
      const toneIdx = arpSeq[arpPos % arpSeq.length]!
      expect(noteMap.bass![i]).toBe(expectedBassPitch(chordIdx, toneIdx))
    }
  })
})

// ─── Pattern differences ─────────────────────────────────────────────────────

describe('Different bass patterns produce different basslines', () => {
  it('root ≠ pedal (pedal has more notes)', () => {
    const prog = generateProgression(CTX, 42)
    const root = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root')
    const pedal = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'pedal')
    const rootCount = root.pattern.bass.filter((v) => v > 0).length
    const pedalCount = pedal.pattern.bass.filter((v) => v > 0).length
    expect(pedalCount).toBeGreaterThan(rootCount)
  })

  it('walking ≠ octave (walking uses 5th, octave uses root+12)', () => {
    const prog = generateProgression(CTX, 42)
    const walking = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'walking')
    const octave = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'octave')
    // Beat 1 (step 4): walking = 5th (toneIdx 2), octave = root+12 (toneIdx 3).
    // These are different pitches (5th ≠ octave).
    expect(walking.noteMap.bass![4]).not.toBe(octave.noteMap.bass![4])
  })

  it('pedal ≠ arp (pedal every step, arp every 8th)', () => {
    const prog = generateProgression(CTX, 42)
    const pedal = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'pedal')
    const arp = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'arp')
    // Step 1 (odd): pedal active, arp silent.
    expect(pedal.pattern.bass[1]).toBeGreaterThan(0)
    expect(arp.pattern.bass[1]).toBe(0)
  })
})

// ─── Determinism ──────────────────────────────────────────────────────────────

describe('Bass pattern determinism', () => {
  it('same pattern + seed → same bass noteMap', () => {
    const prog = generateProgression(CTX, 42)
    const r1 = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'walking')
    const r2 = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'walking')
    expect(r1.noteMap.bass).toEqual(r2.noteMap.bass)
  })

  it('pedal is fully deterministic (no rng for rhythm)', () => {
    const prog = generateProgression(CTX, 42)
    const r1 = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'pedal')
    const r2 = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'pedal')
    expect(r1.noteMap.bass).toEqual(r2.noteMap.bass)
  })
})

// ─── All patterns produce valid output ───────────────────────────────────────

describe('All 5 bass patterns produce valid output', () => {
  const patterns: BassPattern[] = ['root', 'walking', 'octave', 'pedal', 'arp']

  for (const bp of patterns) {
    it(`'${bp}' produces a non-empty bass row`, () => {
      const prog = generateProgression(CTX, 42)
      const { pattern } = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', bp)
      const activeCount = pattern.bass.filter((v) => v > 0).length
      expect(activeCount).toBeGreaterThan(0)
    })

    it(`'${bp}' bass pitches are valid MIDI (0-127)`, () => {
      const prog = generateProgression(CTX, 42)
      const { noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', bp)
      for (const pitch of noteMap.bass!) {
        if (pitch !== null) {
          expect(pitch).toBeGreaterThanOrEqual(0)
          expect(pitch).toBeLessThanOrEqual(127)
        }
      }
    })

    it(`'${bp}' bass velocity is in 70-110 range`, () => {
      const prog = generateProgression(CTX, 42)
      const { pattern } = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', bp)
      for (const v of pattern.bass) {
        if (v > 0) {
          expect(v).toBeGreaterThanOrEqual(70)
          expect(v).toBeLessThanOrEqual(110)
        }
      }
    })
  }
})

// ─── generateChordPattern passes bass through ───────────────────────────────

describe('generateChordPattern with bass pattern', () => {
  it('accepts bass parameter and passes it to applyProgression', () => {
    const r1 = generateChordPattern(DEFAULT_PATTERN, CTX, 42, 'up', 'root')
    const r2 = generateChordPattern(DEFAULT_PATTERN, CTX, 42, 'up', 'pedal')
    // Different bass patterns → different bass noteMaps.
    expect(r1.noteMap.bass).not.toEqual(r2.noteMap.bass)
  })

  it('default bass is root (backward compat)', () => {
    const withDefault = generateChordPattern(DEFAULT_PATTERN, CTX, 42)
    const withRoot = generateChordPattern(DEFAULT_PATTERN, CTX, 42, 'up', 'root')
    expect(withDefault.noteMap.bass).toEqual(withRoot.noteMap.bass)
  })

  it('bass pattern does not affect lead (independent)', () => {
    // Changing the bass pattern should NOT change the lead arpeggio.
    const r1 = generateChordPattern(DEFAULT_PATTERN, CTX, 42, 'up', 'root')
    const r2 = generateChordPattern(DEFAULT_PATTERN, CTX, 42, 'up', 'pedal')
    expect(r1.noteMap.lead).toEqual(r2.noteMap.lead)
  })
})

// ─── Backward compat with existing tests ─────────────────────────────────────

describe('Backward compatibility', () => {
  it('default applyProgression (no bass param) still works', () => {
    const prog = generateProgression(CTX, 42)
    const { pattern, noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42)
    expect(pattern.bass[0]).toBeGreaterThan(0)
    expect(pattern.bass[8]).toBeGreaterThan(0)
    expect(noteMap.bass![0]).not.toBeNull()
  })

  it('root pattern (default) plays on step 0 = chord root', () => {
    const prog = generateProgression(CTX, 42)
    const { noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root')
    expect(noteMap.bass![0]).toBe(prog.chords[0]!.rootNote)
  })
})
