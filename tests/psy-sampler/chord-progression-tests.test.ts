import { describe, it, expect } from 'bun:test'
import {
  SCALES,
  getScaleIntervals,
  buildDiatonicTriad,
  generateProgression,
  applyProgression,
  generateChordPattern,
  type Progression,
  type Chord,
} from '@/lib/chord-progression'
import type { Pattern } from '@/lib/demo-director'
import type { MusicalContext } from '@/psy-foundation-shim'

// ─── Chord Progression Generator ─────────────────────────────────────────────
//
// Tests verify:
//   1. Scale interval definitions are correct (music theory).
//   2. Diatonic triads are built correctly (root + 3rd + 5th, correct quality).
//   3. Progression generation is deterministic (same seed → same result).
//   4. Pattern application respects the progression's chord changes.
//   5. Bass plays on downbeats, lead on 8ths, texture sparse.
//   6. Non-pitched roles are untouched.

const EMPTY_PATTERN: Pattern = {
  kick: new Array(16).fill(0),
  bass: new Array(16).fill(0),
  lead: new Array(16).fill(0),
  'hat-closed': new Array(16).fill(0),
  'hat-open': new Array(16).fill(0),
  clap: new Array(16).fill(0),
  perc: new Array(16).fill(0),
  texture: new Array(16).fill(0),
  fx: new Array(16).fill(0),
}

const CTX = { rootPc: 9, scale: 'phrygianDominant' } as Pick<MusicalContext, 'rootPc' | 'scale'>

describe('SCALES', () => {
  it('major scale has correct intervals', () => {
    expect(SCALES.major).toEqual([0, 2, 4, 5, 7, 9, 11])
  })

  it('natural minor scale has correct intervals', () => {
    expect(SCALES.minor).toEqual([0, 2, 3, 5, 7, 8, 10])
  })

  it('phrygian dominant has the flat-2 + major-3 signature', () => {
    // 5th mode of harmonic minor: 1, b2, 3, 4, 5, b6, b7
    expect(SCALES.phrygianDominant).toEqual([0, 1, 4, 5, 7, 8, 10])
  })

  it('harmonic minor has the augmented 2nd + major 7th', () => {
    expect(SCALES.harmonicMinor).toEqual([0, 2, 3, 5, 7, 8, 11])
  })

  it('all scales have 7 notes (heptatonic)', () => {
    for (const [name, intervals] of Object.entries(SCALES)) {
      expect(intervals.length).toBe(7)
      expect(intervals[0]).toBe(0) // root
      expect(intervals[6]).toBeLessThanOrEqual(11)
    }
  })

  it('getScaleIntervals falls back to minor for unknown scales', () => {
    expect(getScaleIntervals('nonexistent')).toEqual(SCALES.minor)
  })

  it('getScaleIntervals returns the named scale', () => {
    expect(getScaleIntervals('dorian')).toEqual(SCALES.dorian)
    expect(getScaleIntervals('locrian')).toEqual(SCALES.locrian)
  })
})

describe('buildDiatonicTriad', () => {
  it('degree 0 of A minor = Am (root, minor 3rd, perfect 5th)', () => {
    const chord = buildDiatonicTriad(9, 'minor', 0, 3)
    expect(chord.degree).toBe(0)
    expect(chord.label).toBe('Am')
    expect(chord.tones.length).toBe(3)
    // A2=45, C3=48 (minor 3rd), E3=52 (perfect 5th)
    expect(chord.tones[0]).toBe(45) // root
    expect(chord.tones[1]).toBe(48) // minor 3rd (+3)
    expect(chord.tones[2]).toBe(52) // perfect 5th (+7)
  })

  it('degree 0 of A major = A (major triad)', () => {
    const chord = buildDiatonicTriad(9, 'major', 0, 3)
    expect(chord.label).toBe('A')
    expect(chord.tones[0]).toBe(45) // root
    expect(chord.tones[1]).toBe(49) // major 3rd (+4)
    expect(chord.tones[2]).toBe(52) // perfect 5th (+7)
  })

  it('degree 6 of A minor = G (major triad, the VII)', () => {
    const chord = buildDiatonicTriad(9, 'minor', 6, 3)
    expect(chord.label).toBe('G')
    // G3=43, but rootPc=9 (A) at octave 3 = 45, +10 = 55? No: intervals[6]=10.
    // 45 + 10 = 55 = G3. Yes.
    expect(chord.tones[0]).toBe(55) // G3
  })

  it('chord tones are ascending (root < 3rd < 5th)', () => {
    for (let deg = 0; deg < 7; deg++) {
      const chord = buildDiatonicTriad(9, 'minor', deg, 3)
      expect(chord.tones[0]).toBeLessThanOrEqual(chord.tones[1])
      expect(chord.tones[1]).toBeLessThanOrEqual(chord.tones[2])
    }
  })

  it('quality detection: minor, major, diminished', () => {
    // A minor degree 0 = Am (minor)
    expect(buildDiatonicTriad(9, 'minor', 0, 3).label).toBe('Am')
    // A minor degree 1 = Bdim (diminished — B D F)
    expect(buildDiatonicTriad(9, 'minor', 1, 3).label).toBe('Bdim')
    // A major degree 0 = A (major)
    expect(buildDiatonicTriad(9, 'major', 0, 3).label).toBe('A')
  })

  it('different root pitch class transposes the chord', () => {
    const cMinor = buildDiatonicTriad(0, 'minor', 0, 3) // C minor
    const dMinor = buildDiatonicTriad(2, 'minor', 0, 3) // D minor
    expect(dMinor.tones[0] - cMinor.tones[0]).toBe(2) // +2 semitones
  })

  it('octave parameter shifts the register', () => {
    const low = buildDiatonicTriad(9, 'minor', 0, 3)
    const high = buildDiatonicTriad(9, 'minor', 0, 4)
    expect(high.tones[0] - low.tones[0]).toBe(12) // +1 octave
  })
})

describe('generateProgression', () => {
  it('produces a 4-chord progression', () => {
    const prog = generateProgression(CTX, 42)
    expect(prog.chords.length).toBe(4)
  })

  it('is deterministic — same seed → same progression', () => {
    const p1 = generateProgression(CTX, 42)
    const p2 = generateProgression(CTX, 42)
    expect(p1.chords).toEqual(p2.chords)
    expect(p1.label).toBe(p2.label)
    expect(p1.roman).toBe(p2.roman)
  })

  it('different seeds usually produce different progressions', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
    const labels = new Set(seeds.map((s) => generateProgression(CTX, s).label))
    // At least 3 distinct progressions from 8 seeds (not all the same).
    expect(labels.size).toBeGreaterThanOrEqual(3)
  })

  it('all chords have valid tones (3 notes, ascending)', () => {
    const prog = generateProgression(CTX, 100)
    for (const chord of prog.chords) {
      expect(chord.tones.length).toBe(3)
      expect(chord.tones[0]).toBeLessThanOrEqual(chord.tones[1])
      expect(chord.tones[1]).toBeLessThanOrEqual(chord.tones[2])
    }
  })

  it('label contains chord names joined by " - "', () => {
    const prog = generateProgression(CTX, 42)
    expect(prog.label).toContain(' - ')
    expect(prog.label.split(' - ').length).toBe(4)
  })

  it('roman numeral string is present', () => {
    const prog = generateProgression(CTX, 42)
    expect(prog.roman).toContain(' - ')
    // Roman numerals are uppercase I-VII.
    expect(prog.roman).toMatch(/^[IVX]+ - /)
  })

  it('degree 0 (i) appears in every progression (tonic anchor)', () => {
    // All 8 templates start on degree 0 (i) — the tonic is the anchor.
    for (const seed of [1, 2, 3, 4, 5]) {
      const prog = generateProgression(CTX, seed)
      expect(prog.chords[0].degree).toBe(0)
    }
  })
})

describe('applyProgression', () => {
  it('returns a new pattern (does not mutate input)', () => {
    const prog = generateProgression(CTX, 42)
    const before = JSON.parse(JSON.stringify(EMPTY_PATTERN)) as Pattern
    const result = applyProgression(EMPTY_PATTERN, prog, 42)
    expect(EMPTY_PATTERN).toEqual(before) // input unchanged
    expect(result).not.toEqual(EMPTY_PATTERN) // output changed
  })

  it('bass plays on beat 1 (step 0) and beat 3 (step 8)', () => {
    const prog = generateProgression(CTX, 42)
    const result = applyProgression(EMPTY_PATTERN, prog, 42)
    expect(result.bass[0]).toBeGreaterThan(0)
    expect(result.bass[8]).toBeGreaterThan(0)
  })

  it('bass downbeat velocity is in 90-110 range', () => {
    const prog = generateProgression(CTX, 42)
    const result = applyProgression(EMPTY_PATTERN, prog, 42)
    expect(result.bass[0]).toBeGreaterThanOrEqual(90)
    expect(result.bass[0]).toBeLessThanOrEqual(110)
  })

  it('lead only places notes on even steps (8th-note grid)', () => {
    const prog = generateProgression(CTX, 42)
    const result = applyProgression(EMPTY_PATTERN, prog, 42)
    for (let i = 1; i < 16; i += 2) {
      expect(result.lead[i]).toBe(0) // odd steps are silent
    }
  })

  it('lead velocity is in 70-100 range when active', () => {
    const prog = generateProgression(CTX, 42)
    const result = applyProgression(EMPTY_PATTERN, prog, 42)
    for (let i = 0; i < 16; i += 2) {
      if (result.lead[i] > 0) {
        expect(result.lead[i]).toBeGreaterThanOrEqual(70)
        expect(result.lead[i]).toBeLessThanOrEqual(100)
      }
    }
  })

  it('non-pitched roles are NOT modified (kick, hats, clap, perc, fx)', () => {
    const prog = generateProgression(CTX, 42)
    const input = { ...EMPTY_PATTERN, kick: new Array(16).fill(100) }
    const result = applyProgression(input, prog, 42)
    expect(result.kick).toEqual(new Array(16).fill(100)) // untouched
    expect(result['hat-closed']).toEqual(EMPTY_PATTERN['hat-closed'])
    expect(result['hat-open']).toEqual(EMPTY_PATTERN['hat-open'])
    expect(result.clap).toEqual(EMPTY_PATTERN.clap)
    expect(result.perc).toEqual(EMPTY_PATTERN.perc)
    expect(result.fx).toEqual(EMPTY_PATTERN.fx)
  })

  it('texture is sparse (at most 4 hits, one per chord)', () => {
    const prog = generateProgression(CTX, 42)
    const result = applyProgression(EMPTY_PATTERN, prog, 42)
    const hits = result.texture.filter((v) => v > 0).length
    expect(hits).toBeLessThanOrEqual(4)
  })

  it('texture velocity is in 50-70 range (quiet)', () => {
    const prog = generateProgression(CTX, 42)
    const result = applyProgression(EMPTY_PATTERN, prog, 42)
    for (const v of result.texture) {
      if (v > 0) {
        expect(v).toBeGreaterThanOrEqual(50)
        expect(v).toBeLessThanOrEqual(70)
      }
    }
  })

  it('is deterministic — same seed → same output', () => {
    const prog = generateProgression(CTX, 42)
    const r1 = applyProgression(EMPTY_PATTERN, prog, 42)
    const r2 = applyProgression(EMPTY_PATTERN, prog, 42)
    expect(r1).toEqual(r2)
  })

  it('respects 32-step patterns (chord span = 8 steps)', () => {
    const prog = generateProgression(CTX, 42)
    const pattern32: Pattern = { ...EMPTY_PATTERN, kick: new Array(32).fill(0), bass: new Array(32).fill(0) }
    for (const role of Object.keys(pattern32) as (keyof Pattern)[]) {
      pattern32[role] = new Array(32).fill(0)
    }
    const result = applyProgression(pattern32, prog, 42)
    expect(result.bass.length).toBe(32)
    expect(result.bass[0]).toBeGreaterThan(0)
    expect(result.bass[16]).toBeGreaterThan(0) // beat 3 of bar 1
  })
})

describe('generateChordPattern', () => {
  it('returns both the pattern and the progression', () => {
    const { pattern, progression } = generateChordPattern(EMPTY_PATTERN, CTX, 42)
    expect(pattern).toBeDefined()
    expect(progression.chords.length).toBe(4)
    expect(progression.label).toContain(' - ')
  })

  it('is deterministic', () => {
    const r1 = generateChordPattern(EMPTY_PATTERN, CTX, 42)
    const r2 = generateChordPattern(EMPTY_PATTERN, CTX, 42)
    expect(r1.pattern).toEqual(r2.pattern)
    expect(r1.progression).toEqual(r2.progression)
  })

  it('different scales produce different progressions', () => {
    const minorCtx = { rootPc: 9, scale: 'minor' }
    const majorCtx = { rootPc: 9, scale: 'major' }
    const r1 = generateChordPattern(EMPTY_PATTERN, minorCtx, 42)
    const r2 = generateChordPattern(EMPTY_PATTERN, majorCtx, 42)
    // Different scales → different chord labels (at least the quality differs).
    expect(r1.progression.label).not.toBe(r2.progression.label)
  })
})
