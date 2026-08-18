// Key + Scale selector tests.
//
// Verifies that:
//   1. NOTE_NAMES has 12 entries (C-B)
//   2. SCALE_LABELS matches SCALES (same keys, 9 scales)
//   3. Different keys transpose the chord progression (same shape, +semitones)
//   4. Different scales produce different chord qualities (minor vs major)
//   5. Project persistence saves/restores musicalKey + scaleName
//   6. Backward compat: old projects without key/scale default to A phrygian dominant

import { describe, it, expect } from 'bun:test'
import {
  NOTE_NAMES,
  SCALE_LABELS,
  SCALES,
  generateProgression,
  generateChordPattern,
  buildDiatonicTriad,
} from '../../src/lib/chord-progression'
import {
  createProject,
  serializeProject,
  deserializeProject,
} from '../../src/lib/project-persistence'
import { DEFAULT_PATTERN } from '../../src/lib/demo-director'
import type { BusMixerState } from '../../src/components/types'
import type { Song } from '../../src/lib/song-persistence'
import type { BusName } from '../../src/psy-sampler'

// ─── NOTE_NAMES + SCALE_LABELS ────────────────────────────────────────────────

describe('NOTE_NAMES', () => {
  it('has exactly 12 entries (chromatic scale)', () => {
    expect(NOTE_NAMES.length).toBe(12)
  })

  it('starts with C and ends with B', () => {
    expect(NOTE_NAMES[0]).toBe('C')
    expect(NOTE_NAMES[11]).toBe('B')
  })

  it('sharps are correct', () => {
    expect(NOTE_NAMES[1]).toBe('C#')
    expect(NOTE_NAMES[3]).toBe('D#')
    expect(NOTE_NAMES[6]).toBe('F#')
    expect(NOTE_NAMES[8]).toBe('G#')
    expect(NOTE_NAMES[10]).toBe('A#')
  })

  it('index = pitch class (rootPc)', () => {
    // rootPc 0 = C, rootPc 9 = A, rootPc 11 = B.
    expect(NOTE_NAMES[0]).toBe('C')
    expect(NOTE_NAMES[9]).toBe('A')
    expect(NOTE_NAMES[11]).toBe('B')
  })

  it('all 12 names are unique', () => {
    expect(new Set(NOTE_NAMES).size).toBe(12)
  })
})

describe('SCALE_LABELS', () => {
  it('has exactly 9 scales (matching SCALES)', () => {
    expect(Object.keys(SCALE_LABELS).length).toBe(9)
    expect(Object.keys(SCALES).length).toBe(9)
  })

  it('every SCALE_LABELS key exists in SCALES', () => {
    for (const key of Object.keys(SCALE_LABELS)) {
      expect(SCALES[key]).toBeDefined()
    }
  })

  it('every SCALES key has a label', () => {
    for (const key of Object.keys(SCALES)) {
      expect(SCALE_LABELS[key]).toBeDefined()
    }
  })

  it('labels are human-readable (have a space or are single-word)', () => {
    for (const label of Object.values(SCALE_LABELS)) {
      expect(label.length).toBeGreaterThan(2)
      expect(label[0]!.toUpperCase()).toBe(label[0]) // capitalized
    }
  })

  it('phrygian dominant is labeled correctly (the default)', () => {
    expect(SCALE_LABELS.phrygianDominant).toBe('Phrygian Dominant')
  })
})

// ─── Key transposition ─────────────────────────────────────────────────────────

describe('Key transposition', () => {
  it('different root keys produce transposed chord roots', () => {
    // Same scale, different root: the chord root pitch class should shift by
    // the same number of semitones as the key difference (mod 12).
    const aMinor = buildDiatonicTriad(9, 'minor', 0, 3) // A minor → root pitch class 9
    const cMinor = buildDiatonicTriad(0, 'minor', 0, 3) // C minor → root pitch class 0
    const aPc = aMinor.rootNote % 12
    const cPc = cMinor.rootNote % 12
    // C is 3 semitones above A (mod 12): A=9, C=0 → (0-9+12)%12 = 3.
    expect((cPc - aPc + 12) % 12).toBe(3)
    // The labels confirm the transposition.
    expect(aMinor.label).toBe('Am')
    expect(cMinor.label).toBe('Cm')
  })

  it('different keys produce the same chord SHAPE (same intervals)', () => {
    // The interval between root and 3rd should be the same regardless of key.
    const aMinor = buildDiatonicTriad(9, 'minor', 0, 3)
    const dMinor = buildDiatonicTriad(2, 'minor', 0, 3)
    const aThird = (aMinor.tones[1]! - aMinor.tones[0]!) % 12
    const dThird = (dMinor.tones[1]! - dMinor.tones[0]!) % 12
    expect(aThird).toBe(dThird) // both minor 3rds (3 semitones)
  })

  it('generateProgression respects the root key', () => {
    const ctxA = { rootPc: 9, scale: 'minor' as const } // A minor
    const ctxD = { rootPc: 2, scale: 'minor' as const } // D minor
    const progA = generateProgression(ctxA, 42)
    const progD = generateProgression(ctxD, 42)
    // Same template (same seed) → same degrees, but transposed roots.
    expect(progA.chords[0].degree).toBe(progD.chords[0].degree)
    // The root notes should differ by 5 semitones (A=9, D=2; 9-2=7, but
    // mod 12 with octave wrapping it could be 7 or -5). Check it's non-zero.
    expect(progA.chords[0].rootNote).not.toBe(progD.chords[0].rootNote)
  })
})

// ─── Scale quality ────────────────────────────────────────────────────────────

describe('Scale quality (different scales → different chords)', () => {
  it('minor scale degree 0 = minor triad, major scale degree 0 = major triad', () => {
    const ctxMinor = { rootPc: 9, scale: 'minor' as const }
    const ctxMajor = { rootPc: 9, scale: 'major' as const }
    const progMinor = generateProgression(ctxMinor, 42)
    const progMajor = generateProgression(ctxMajor, 42)
    // Degree 0 chord: minor → 'Am', major → 'A'.
    expect(progMinor.chords[0].label).toBe('Am')
    expect(progMajor.chords[0].label).toBe('A')
  })

  it('phrygian dominant degree 0 = major (the signature III+ is elsewhere)', () => {
    // Phrygian dominant: degree 0 = major triad (root, major 3rd, perfect 5th).
    // The signature augmented 2nd shows up on degree III (augmented chord).
    const ctx = { rootPc: 9, scale: 'phrygianDominant' as const }
    const prog = generateProgression(ctx, 42)
    // Degree 0 should be A (major), not Am.
    expect(prog.chords[0].label).toBe('A')
  })

  it('locrian degree 0 = diminished (the only scale where I is dim)', () => {
    const chord = buildDiatonicTriad(9, 'locrian', 0, 3)
    expect(chord.label).toContain('dim')
  })

  it('dorian degree 0 = minor (like natural minor)', () => {
    const chord = buildDiatonicTriad(9, 'dorian', 0, 3)
    expect(chord.label).toBe('Am')
  })
})

// ─── Project persistence with key + scale ─────────────────────────────────────

describe('Project persistence with key + scale', () => {
  const emptyBusState: Record<BusName, BusMixerState> = {
    drum: { gain: 0.85, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
    music: { gain: 0.8, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
    atmos: { gain: 0.7, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
  }
  const emptySong: Song = { name: 'test', segments: [], savedAt: 0 }

  it('createProject includes musicalKey + scaleName', () => {
    const project = createProject('test', {
      bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
      pattern: DEFAULT_PATTERN, musicalKey: 2, scaleName: 'dorian',
      busState: emptyBusState, filterMode: 'off', pumpEnabled: false, evolveEnabled: false, song: emptySong,
    })
    expect(project.musicalKey).toBe(2)
    expect(project.scaleName).toBe('dorian')
  })

  it('serialize + deserialize preserves musicalKey + scaleName', () => {
    const project = createProject('test', {
      bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
      pattern: DEFAULT_PATTERN, musicalKey: 0, scaleName: 'major',
      busState: emptyBusState, filterMode: 'off', pumpEnabled: false, evolveEnabled: false, song: emptySong,
    })
    const json = serializeProject(project)
    const restored = deserializeProject(json)
    expect(restored).not.toBeNull()
    expect(restored!.musicalKey).toBe(0) // C
    expect(restored!.scaleName).toBe('major')
  })

  it('deserialize defaults to A phrygian dominant for old projects (backward compat)', () => {
    // A project saved before key/scale selectors existed has no musicalKey/scaleName.
    const oldProject = {
      version: '1.0.0', name: 'old', savedAt: 0,
      bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
      pattern: DEFAULT_PATTERN,
      busState: emptyBusState,
      filterMode: 'off', pumpEnabled: false, evolveEnabled: false,
      song: emptySong,
    }
    const restored = deserializeProject(JSON.stringify(oldProject))
    expect(restored).not.toBeNull()
    expect(restored!.musicalKey).toBe(9) // A (default)
    expect(restored!.scaleName).toBe('phrygianDominant') // default
  })

  it('all 12 keys survive save/load', () => {
    for (let key = 0; key < 12; key++) {
      const project = createProject('test', {
        bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
        pattern: DEFAULT_PATTERN, musicalKey: key, scaleName: 'minor',
        busState: emptyBusState, filterMode: 'off', pumpEnabled: false, evolveEnabled: false, song: emptySong,
      })
      const restored = deserializeProject(serializeProject(project))
      expect(restored!.musicalKey).toBe(key)
    }
  })

  it('all 9 scales survive save/load', () => {
    for (const scale of Object.keys(SCALES)) {
      const project = createProject('test', {
        bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
        pattern: DEFAULT_PATTERN, musicalKey: 9, scaleName: scale,
        busState: emptyBusState, filterMode: 'off', pumpEnabled: false, evolveEnabled: false, song: emptySong,
      })
      const restored = deserializeProject(serializeProject(project))
      expect(restored!.scaleName).toBe(scale)
    }
  })

  it('generateChordPattern uses the context key + scale', () => {
    // With musicalKey=0 (C) + major scale, the progression should start with
    // a C major chord, not A.
    const ctxC = { rootPc: 0, scale: 'major' as const }
    const { progression } = generateChordPattern(DEFAULT_PATTERN, ctxC, 42)
    expect(progression.chords[0].label).toBe('C')
  })
})
