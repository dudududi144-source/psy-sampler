// Bass octave control tests.
//
// Verifies that the bassOctave parameter shifts the bass register by whole
// octaves (-2 to +2) without affecting the lead or texture.
//   bassOctave=0  → default register (chord root)
//   bassOctave=+1 → one octave up (chord root + 12)
//   bassOctave=-1 → one octave down (chord root - 12)
//
// Also verifies independence from melody octave, clamping, backward compat,
// and project persistence.

import { describe, it, expect } from 'bun:test'
import {
  generateProgression,
  applyProgression,
  generateChordPattern,
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

const CTX = { rootPc: 9, scale: 'phrygianDominant' as const }

describe('Bass octave control', () => {
  it('bassOctave=0 → default register (chord root)', () => {
    const prog = generateProgression(CTX, 42)
    const { noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, 0)
    // Bass at step 0 = chord 0 root.
    expect(noteMap.bass![0]).toBe(prog.chords[0]!.rootNote)
  })

  it('bassOctave=+1 → one octave higher (+12 semitones)', () => {
    const prog = generateProgression(CTX, 42)
    const base = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, 0)
    const shifted = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, 1)
    // Every active bass note should be exactly 12 semitones higher.
    for (let i = 0; i < 16; i++) {
      if (base.noteMap.bass![i] !== null && shifted.noteMap.bass![i] !== null) {
        expect(shifted.noteMap.bass![i]! - base.noteMap.bass![i]!).toBe(12)
      }
    }
  })

  it('bassOctave=-1 → one octave lower (-12 semitones)', () => {
    const prog = generateProgression(CTX, 42)
    const base = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, 0)
    const shifted = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, -1)
    for (let i = 0; i < 16; i++) {
      if (base.noteMap.bass![i] !== null && shifted.noteMap.bass![i] !== null) {
        expect(shifted.noteMap.bass![i]! - base.noteMap.bass![i]!).toBe(-12)
      }
    }
  })

  it('bassOctave=+2 → two octaves higher (+24 semitones)', () => {
    const prog = generateProgression(CTX, 42)
    const base = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, 0)
    const shifted = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, 2)
    for (let i = 0; i < 16; i++) {
      if (base.noteMap.bass![i] !== null && shifted.noteMap.bass![i] !== null) {
        expect(shifted.noteMap.bass![i]! - base.noteMap.bass![i]!).toBe(24)
      }
    }
  })

  it('bassOctave=-2 → two octaves lower (-24 semitones)', () => {
    const prog = generateProgression(CTX, 42)
    const base = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, 0)
    const shifted = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, -2)
    for (let i = 0; i < 16; i++) {
      if (base.noteMap.bass![i] !== null && shifted.noteMap.bass![i] !== null) {
        expect(shifted.noteMap.bass![i]! - base.noteMap.bass![i]!).toBe(-24)
      }
    }
  })

  it('bassOctave does NOT affect lead (lead is independent)', () => {
    const prog = generateProgression(CTX, 42)
    const low = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, -2)
    const high = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, 2)
    expect(low.noteMap.lead).toEqual(high.noteMap.lead)
    expect(low.pattern.lead).toEqual(high.pattern.lead)
  })

  it('bassOctave does NOT affect texture (texture is independent)', () => {
    const prog = generateProgression(CTX, 42)
    const low = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, -2)
    const high = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, 2)
    expect(low.noteMap.texture).toEqual(high.noteMap.texture)
    expect(low.pattern.texture).toEqual(high.pattern.texture)
  })

  it('bassOctave and melodyOctave are independent', () => {
    // Changing bassOctave should not affect the lead's melodyOctave shift.
    const prog = generateProgression(CTX, 42)
    const mUp_bDown = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 1, -1)
    const mUp_bUp = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 1, 1)
    // Lead should be identical (melodyOctave=1 in both).
    expect(mUp_bDown.noteMap.lead).toEqual(mUp_bUp.noteMap.lead)
    // Bass should differ (bassOctave=-1 vs +1 = 24 semitone difference).
    for (let i = 0; i < 16; i++) {
      if (mUp_bDown.noteMap.bass![i] !== null && mUp_bUp.noteMap.bass![i] !== null) {
        expect(mUp_bUp.noteMap.bass![i]! - mUp_bDown.noteMap.bass![i]!).toBe(24)
      }
    }
  })

  it('default bassOctave is 0 (backward compat)', () => {
    const prog = generateProgression(CTX, 42)
    const withDefault = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0)
    const withExplicit = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, 0)
    expect(withDefault.noteMap.bass).toEqual(withExplicit.noteMap.bass)
  })

  it('bassOctave is deterministic', () => {
    const prog = generateProgression(CTX, 42)
    const r1 = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, 1)
    const r2 = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, 1)
    expect(r1.noteMap.bass).toEqual(r2.noteMap.bass)
  })

  it('bassOctave > 2 is clamped to 2', () => {
    const prog = generateProgression(CTX, 42)
    const clamped = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, 5)
    const exact = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, 2)
    expect(clamped.noteMap.bass).toEqual(exact.noteMap.bass)
  })

  it('bassOctave < -2 is clamped to -2', () => {
    const prog = generateProgression(CTX, 42)
    const clamped = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, -5)
    const exact = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, -2)
    expect(clamped.noteMap.bass).toEqual(exact.noteMap.bass)
  })

  it('all 5 bassOctave values produce valid MIDI (0-127)', () => {
    const prog = generateProgression(CTX, 42)
    for (const oct of [-2, -1, 0, 1, 2]) {
      const { noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0, oct)
      for (const pitch of noteMap.bass!) {
        if (pitch !== null) {
          expect(pitch).toBeGreaterThanOrEqual(0)
          expect(pitch).toBeLessThanOrEqual(127)
        }
      }
    }
  })
})

describe('generateChordPattern with bassOctave', () => {
  it('accepts bassOctave parameter', () => {
    const r1 = generateChordPattern(DEFAULT_PATTERN, CTX, 42, 'up', 'root', 0.6, 0, 0)
    const r2 = generateChordPattern(DEFAULT_PATTERN, CTX, 42, 'up', 'root', 0.6, 0, 1)
    for (let i = 0; i < 16; i++) {
      if (r1.noteMap.bass![i] !== null && r2.noteMap.bass![i] !== null) {
        expect(r2.noteMap.bass![i]! - r1.noteMap.bass![i]!).toBe(12)
      }
    }
  })

  it('default bassOctave is 0 (backward compat)', () => {
    const withDefault = generateChordPattern(DEFAULT_PATTERN, CTX, 42)
    const withExplicit = generateChordPattern(DEFAULT_PATTERN, CTX, 42, 'up', 'root', 0.6, 0, 0)
    expect(withDefault.noteMap.bass).toEqual(withExplicit.noteMap.bass)
  })
})

describe('Bass octave in project persistence', () => {
  const emptyBusState: Record<BusName, BusMixerState> = {
    drum: { gain: 0.85, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
    music: { gain: 0.8, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
    atmos: { gain: 0.7, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
  }
  const emptySong: Song = { name: 'test', segments: [], savedAt: 0 }

  it('createProject includes bassOctave', () => {
    const project = createProject('test', {
      bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
      pattern: DEFAULT_PATTERN, musicalKey: 9, scaleName: 'phrygianDominant',
      arpeggio: 'up', bassPattern: 'root', density: 0.6, melodyOctave: 1, bassOctave: -1,
      busState: emptyBusState, filterMode: 'off', pumpEnabled: false, evolveEnabled: false, song: emptySong,
    })
    expect(project.bassOctave).toBe(-1)
  })

  it('serialize + deserialize preserves bassOctave', () => {
    const project = createProject('test', {
      bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
      pattern: DEFAULT_PATTERN, musicalKey: 9, scaleName: 'minor',
      arpeggio: 'down', bassPattern: 'pedal', density: 0.3, melodyOctave: 2, bassOctave: -2,
      busState: emptyBusState, filterMode: 'off', pumpEnabled: false, evolveEnabled: false, song: emptySong,
    })
    const restored = deserializeProject(serializeProject(project))
    expect(restored!.bassOctave).toBe(-2)
    expect(restored!.melodyOctave).toBe(2)
  })

  it('deserialize defaults to 0 for old projects (backward compat)', () => {
    const oldProject = {
      version: '1.0.0', name: 'old', savedAt: 0,
      bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
      pattern: DEFAULT_PATTERN, busState: emptyBusState,
      filterMode: 'off', pumpEnabled: false, evolveEnabled: false, song: emptySong,
    }
    const restored = deserializeProject(JSON.stringify(oldProject))
    expect(restored!.bassOctave).toBe(0)
    expect(restored!.melodyOctave).toBe(0)
  })

  it('all 5 bassOctave values survive save/load', () => {
    for (const oct of [-2, -1, 0, 1, 2]) {
      const project = createProject('test', {
        bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
        pattern: DEFAULT_PATTERN, musicalKey: 9, scaleName: 'minor',
        arpeggio: 'up', bassPattern: 'root', density: 0.6, melodyOctave: 0, bassOctave: oct,
        busState: emptyBusState, filterMode: 'off', pumpEnabled: false, evolveEnabled: false, song: emptySong,
      })
      const restored = deserializeProject(serializeProject(project))
      expect(restored!.bassOctave).toBe(oct)
    }
  })
})
