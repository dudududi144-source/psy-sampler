// Arpeggio pattern variation tests.
//
// Verifies that each arpeggio pattern produces the correct sequence of
// chord-tone indices:
//   up:      root → 3rd → 5th → octave
//   down:    octave → 5th → 3rd → root
//   upDown:  root → 3rd → 5th → octave → 5th → 3rd
//   downUp:  octave → 5th → 3rd → root → 3rd → 5th
//   random:  each note is a random tone (0-3)
//   chordal: always root (dronal — psytrance staple)
//
// Also verifies that different patterns produce different melodies from the
// same chord progression.

import { describe, it, expect } from 'bun:test'
import {
  ARPEGGIO_LABELS,
  generateProgression,
  applyProgression,
  generateChordPattern,
  type ArpeggioPattern,
} from '../../src/lib/chord-progression'
import { Rng } from '../../src/psy-foundation-shim'
import { DEFAULT_PATTERN } from '../../src/lib/demo-director'

const CTX = { rootPc: 9, scale: 'phrygianDominant' as const }

// ─── ARPEGGIO_LABELS ──────────────────────────────────────────────────────────

describe('ARPEGGIO_LABELS', () => {
  it('has exactly 6 patterns', () => {
    expect(Object.keys(ARPEGGIO_LABELS).length).toBe(6)
  })

  it('all labels are non-empty', () => {
    for (const label of Object.values(ARPEGGIO_LABELS)) {
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('includes up, down, upDown, downUp, random, chordal', () => {
    const keys = Object.keys(ARPEGGIO_LABELS)
    expect(keys).toContain('up')
    expect(keys).toContain('down')
    expect(keys).toContain('upDown')
    expect(keys).toContain('downUp')
    expect(keys).toContain('random')
    expect(keys).toContain('chordal')
  })

  it('labels describe the pattern direction', () => {
    expect(ARPEGGIO_LABELS.up).toContain('Up')
    expect(ARPEGGIO_LABELS.down).toContain('Down')
    expect(ARPEGGIO_LABELS.upDown).toContain('Up-Down')
    expect(ARPEGGIO_LABELS.chordal).toContain('root only')
  })
})

// ─── Tone-index sequences ─────────────────────────────────────────────────────
//
// We verify the OUTPUT of applyProgression matches the expected pattern by
// checking the lead noteMap pitches against the chord tones for each step's
// chord. The arpeggio index is global, so we must compute the expected pitch
// per step using that step's chord.

describe('Arpeggio tone sequences', () => {
  const prog = generateProgression(CTX, 42)
  const chordSpan = Math.floor(16 / prog.chords.length) // 4

  /** Compute the expected pitch for step `i` at arpeggio position `arpIdx`. */
  function expectedPitch(chordIdx: number, toneIdx: number): number {
    const chord = prog.chords[chordIdx]!
    const baseTone = toneIdx < 3 ? chord.tones[toneIdx]! : chord.tones[0]! + 12
    return baseTone + 12 // melodic register
  }

  it('up: root → 3rd → 5th → octave (per chord)', () => {
    const { pattern, noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'up')
    let arpIdx = 0
    for (let i = 0; i < 16; i += 2) {
      if (pattern.lead[i]! > 0 && noteMap.lead![i] !== null) {
        const chordIdx = Math.floor(i / chordSpan) % prog.chords.length
        const toneIdx = arpIdx % 4 // up = [0,1,2,3]
        expect(noteMap.lead![i]).toBe(expectedPitch(chordIdx, toneIdx))
        arpIdx++
      }
    }
  })

  it('down: octave → 5th → 3rd → root (per chord)', () => {
    const { pattern, noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'down')
    const downSeq = [3, 2, 1, 0]
    let arpIdx = 0
    for (let i = 0; i < 16; i += 2) {
      if (pattern.lead[i]! > 0 && noteMap.lead![i] !== null) {
        const chordIdx = Math.floor(i / chordSpan) % prog.chords.length
        const toneIdx = downSeq[arpIdx % downSeq.length]!
        expect(noteMap.lead![i]).toBe(expectedPitch(chordIdx, toneIdx))
        arpIdx++
      }
    }
  })

  it('chordal: always root (per chord)', () => {
    const { pattern, noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'chordal')
    for (let i = 0; i < 16; i += 2) {
      if (pattern.lead[i]! > 0 && noteMap.lead![i] !== null) {
        const chordIdx = Math.floor(i / chordSpan) % prog.chords.length
        // chordal = [0,0,0,0] → always root.
        expect(noteMap.lead![i]).toBe(expectedPitch(chordIdx, 0))
      }
    }
  })

  it('upDown: root → 3rd → 5th → octave → 5th → 3rd (per chord)', () => {
    const { pattern, noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'upDown')
    const upDownSeq = [0, 1, 2, 3, 2, 1]
    let arpIdx = 0
    for (let i = 0; i < 16; i += 2) {
      if (pattern.lead[i]! > 0 && noteMap.lead![i] !== null) {
        const chordIdx = Math.floor(i / chordSpan) % prog.chords.length
        const toneIdx = upDownSeq[arpIdx % upDownSeq.length]!
        expect(noteMap.lead![i]).toBe(expectedPitch(chordIdx, toneIdx))
        arpIdx++
      }
    }
  })

  it('downUp: octave → 5th → 3rd → root → 3rd → 5th (per chord)', () => {
    const { pattern, noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'downUp')
    const downUpSeq = [3, 2, 1, 0, 1, 2]
    let arpIdx = 0
    for (let i = 0; i < 16; i += 2) {
      if (pattern.lead[i]! > 0 && noteMap.lead![i] !== null) {
        const chordIdx = Math.floor(i / chordSpan) % prog.chords.length
        const toneIdx = downUpSeq[arpIdx % downUpSeq.length]!
        expect(noteMap.lead![i]).toBe(expectedPitch(chordIdx, toneIdx))
        arpIdx++
      }
    }
  })

  it('random: all notes are valid chord tones (root/3rd/5th/octave) for their chord', () => {
    const { pattern, noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'random')
    for (let i = 0; i < 16; i += 2) {
      if (pattern.lead[i]! > 0 && noteMap.lead![i] !== null) {
        const chordIdx = Math.floor(i / chordSpan) % prog.chords.length
        const chord = prog.chords[chordIdx]!
        const valid = [
          chord.tones[0]! + 12, // root
          chord.tones[1]! + 12, // 3rd
          chord.tones[2]! + 12, // 5th
          chord.tones[0]! + 24, // octave
        ]
        expect(valid).toContain(noteMap.lead![i])
      }
    }
  })
})

// ─── Pattern differences ─────────────────────────────────────────────────────

describe('Different patterns produce different melodies', () => {
  it('up ≠ down (different first note)', () => {
    const prog = generateProgression(CTX, 42)
    const up = applyProgression(DEFAULT_PATTERN, prog, 42, 'up')
    const down = applyProgression(DEFAULT_PATTERN, prog, 42, 'down')
    // Find the first active lead note in each.
    let upFirst: number | null = null
    let downFirst: number | null = null
    for (let i = 0; i < 16; i += 2) {
      if (upFirst === null && up.pattern.lead[i]! > 0) upFirst = up.noteMap.lead![i]
      if (downFirst === null && down.pattern.lead[i]! > 0) downFirst = down.noteMap.lead![i]
      if (upFirst !== null && downFirst !== null) break
    }
    // Up starts on root; down starts on octave — different pitches.
    expect(upFirst).not.toBe(downFirst)
  })

  it('chordal ≠ up (chordal is always root, up varies)', () => {
    const prog = generateProgression(CTX, 42)
    const chordSpan = Math.floor(16 / prog.chords.length)
    const chordal = applyProgression(DEFAULT_PATTERN, prog, 42, 'chordal')
    const up = applyProgression(DEFAULT_PATTERN, prog, 42, 'up')
    // Chordal: every note = that step's chord root. Up: at least one note ≠ root.
    let upHasNonRoot = false
    for (let i = 0; i < 16; i += 2) {
      if (up.pattern.lead[i]! > 0 && up.noteMap.lead![i] !== null) {
        const chordIdx = Math.floor(i / chordSpan) % prog.chords.length
        const root = prog.chords[chordIdx]!.tones[0]! + 12
        if (up.noteMap.lead![i] !== root) {
          upHasNonRoot = true
          break
        }
      }
    }
    expect(upHasNonRoot).toBe(true)
    // Chordal never has non-root (every note = its chord's root).
    for (let i = 0; i < 16; i += 2) {
      if (chordal.pattern.lead[i]! > 0 && chordal.noteMap.lead![i] !== null) {
        const chordIdx = Math.floor(i / chordSpan) % prog.chords.length
        const root = prog.chords[chordIdx]!.tones[0]! + 12
        expect(chordal.noteMap.lead![i]).toBe(root)
      }
    }
  })
})

// ─── Determinism ──────────────────────────────────────────────────────────────

describe('Arpeggio determinism', () => {
  it('same pattern + seed → same lead noteMap', () => {
    const prog = generateProgression(CTX, 42)
    const r1 = applyProgression(DEFAULT_PATTERN, prog, 42, 'upDown')
    const r2 = applyProgression(DEFAULT_PATTERN, prog, 42, 'upDown')
    expect(r1.noteMap.lead).toEqual(r2.noteMap.lead)
  })

  it('random is deterministic (seeded rng)', () => {
    // Same seed → same "random" choices. This is the determinism contract.
    const prog = generateProgression(CTX, 42)
    const r1 = applyProgression(DEFAULT_PATTERN, prog, 42, 'random')
    const r2 = applyProgression(DEFAULT_PATTERN, prog, 42, 'random')
    expect(r1.noteMap.lead).toEqual(r2.noteMap.lead)
  })

  it('different seeds produce different random arpeggios (usually)', () => {
    const prog = generateProgression(CTX, 42)
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
    const results = seeds.map((s) => JSON.stringify(applyProgression(DEFAULT_PATTERN, prog, s, 'random').noteMap.lead))
    // At least 3 distinct results from 8 seeds.
    expect(new Set(results).size).toBeGreaterThanOrEqual(3)
  })
})

// ─── generateChordPattern passes arpeggio through ─────────────────────────────

describe('generateChordPattern with arpeggio', () => {
  it('accepts arpeggio parameter and passes it to applyProgression', () => {
    const r1 = generateChordPattern(DEFAULT_PATTERN, CTX, 42, 'up')
    const r2 = generateChordPattern(DEFAULT_PATTERN, CTX, 42, 'down')
    // Different patterns → different lead noteMaps (at least the first note).
    expect(r1.noteMap.lead).not.toEqual(r2.noteMap.lead)
  })

  it('default arpeggio is up (backward compat)', () => {
    const withDefault = generateChordPattern(DEFAULT_PATTERN, CTX, 42)
    const withUp = generateChordPattern(DEFAULT_PATTERN, CTX, 42, 'up')
    expect(withDefault.noteMap.lead).toEqual(withUp.noteMap.lead)
  })
})

// ─── All patterns produce valid output ───────────────────────────────────────

describe('All 6 patterns produce valid output', () => {
  const patterns: ArpeggioPattern[] = ['up', 'down', 'upDown', 'downUp', 'random', 'chordal']

  for (const arp of patterns) {
    it(`'${arp}' produces a non-empty lead noteMap`, () => {
      const prog = generateProgression(CTX, 42)
      const { noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, arp)
      expect(noteMap.lead).toBeDefined()
      // At least one active note.
      const activeCount = noteMap.lead!.filter((n) => n !== null).length
      expect(activeCount).toBeGreaterThan(0)
    })

    it(`'${arp}' lead pitches are all in valid MIDI range (0-127)`, () => {
      const prog = generateProgression(CTX, 42)
      const { noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, arp)
      for (const pitch of noteMap.lead!) {
        if (pitch !== null) {
          expect(pitch).toBeGreaterThanOrEqual(0)
          expect(pitch).toBeLessThanOrEqual(127)
        }
      }
    })
  }
})
