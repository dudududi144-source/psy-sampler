// Melody octave control tests.
//
// Verifies that the melodyOctave parameter shifts the lead register by whole
// octaves (-2 to +2) without affecting the bass or texture.
//   octave=0  → default register (chord root + 12)
//   octave=+1 → one octave up (chord root + 24)
//   octave=-1 → one octave down (chord root + 0, i.e. same as chord root)
//   octave=+2 → two octaves up
//   octave=-2 → two octaves down
//
// Also verifies clamping, backward compat, and project persistence.

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

describe('Melody octave control', () => {
  it('octave=0 → default register (chord root + 12)', () => {
    const prog = generateProgression(CTX, 42)
    const { noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0)
    // Find the first active lead note — should be chord root + 12.
    for (let i = 0; i < 16; i += 2) {
      if (noteMap.lead![i] !== null) {
        expect(noteMap.lead![i]).toBe(prog.chords[0]!.tones[0]! + 12)
        break
      }
    }
  })

  it('octave=+1 → one octave higher (+12 semitones)', () => {
    const prog = generateProgression(CTX, 42)
    const base = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0)
    const shifted = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 1)
    // Every active lead note should be exactly 12 semitones higher.
    for (let i = 0; i < 16; i += 2) {
      if (base.noteMap.lead![i] !== null && shifted.noteMap.lead![i] !== null) {
        expect(shifted.noteMap.lead![i]! - base.noteMap.lead![i]!).toBe(12)
      }
    }
  })

  it('octave=-1 → one octave lower (-12 semitones)', () => {
    const prog = generateProgression(CTX, 42)
    const base = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0)
    const shifted = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, -1)
    for (let i = 0; i < 16; i += 2) {
      if (base.noteMap.lead![i] !== null && shifted.noteMap.lead![i] !== null) {
        expect(shifted.noteMap.lead![i]! - base.noteMap.lead![i]!).toBe(-12)
      }
    }
  })

  it('octave=+2 → two octaves higher (+24 semitones)', () => {
    const prog = generateProgression(CTX, 42)
    const base = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0)
    const shifted = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 2)
    for (let i = 0; i < 16; i += 2) {
      if (base.noteMap.lead![i] !== null && shifted.noteMap.lead![i] !== null) {
        expect(shifted.noteMap.lead![i]! - base.noteMap.lead![i]!).toBe(24)
      }
    }
  })

  it('octave=-2 → two octaves lower (-24 semitones)', () => {
    const prog = generateProgression(CTX, 42)
    const base = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0)
    const shifted = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, -2)
    for (let i = 0; i < 16; i += 2) {
      if (base.noteMap.lead![i] !== null && shifted.noteMap.lead![i] !== null) {
        expect(shifted.noteMap.lead![i]! - base.noteMap.lead![i]!).toBe(-24)
      }
    }
  })

  it('octave does NOT affect bass (bass is independent)', () => {
    const prog = generateProgression(CTX, 42)
    const low = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, -2)
    const high = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 2)
    // Bass noteMap should be identical regardless of melody octave.
    expect(low.noteMap.bass).toEqual(high.noteMap.bass)
    expect(low.pattern.bass).toEqual(high.pattern.bass)
  })

  it('octave does NOT affect texture (texture is independent)', () => {
    const prog = generateProgression(CTX, 42)
    const low = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, -2)
    const high = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 2)
    expect(low.noteMap.texture).toEqual(high.noteMap.texture)
    expect(low.pattern.texture).toEqual(high.pattern.texture)
  })

  it('default octave is 0 (backward compat)', () => {
    const prog = generateProgression(CTX, 42)
    const withDefault = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6)
    const withExplicit = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 0)
    expect(withDefault.noteMap.lead).toEqual(withExplicit.noteMap.lead)
  })

  it('octave is deterministic (same seed + octave → same output)', () => {
    const prog = generateProgression(CTX, 42)
    const r1 = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 1)
    const r2 = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 1)
    expect(r1.noteMap.lead).toEqual(r2.noteMap.lead)
  })

  it('octave > 2 is clamped to 2', () => {
    const prog = generateProgression(CTX, 42)
    const clamped = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 5)
    const exact = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, 2)
    expect(clamped.noteMap.lead).toEqual(exact.noteMap.lead)
  })

  it('octave < -2 is clamped to -2', () => {
    const prog = generateProgression(CTX, 42)
    const clamped = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, -5)
    const exact = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, -2)
    expect(clamped.noteMap.lead).toEqual(exact.noteMap.lead)
  })

  it('all 5 octave values produce valid MIDI (0-127)', () => {
    const prog = generateProgression(CTX, 42)
    for (const oct of [-2, -1, 0, 1, 2]) {
      const { noteMap } = applyProgression(DEFAULT_PATTERN, prog, 42, 'up', 'root', 0.6, oct)
      for (const pitch of noteMap.lead!) {
        if (pitch !== null) {
          expect(pitch).toBeGreaterThanOrEqual(0)
          expect(pitch).toBeLessThanOrEqual(127)
        }
      }
    }
  })
})

describe('generateChordPattern with octave', () => {
  it('accepts melodyOctave parameter', () => {
    const r1 = generateChordPattern(DEFAULT_PATTERN, CTX, 42, 'up', 'root', 0.6, 0)
    const r2 = generateChordPattern(DEFAULT_PATTERN, CTX, 42, 'up', 'root', 0.6, 1)
    // Different octaves → different lead pitches (+12).
    for (let i = 0; i < 16; i += 2) {
      if (r1.noteMap.lead![i] !== null && r2.noteMap.lead![i] !== null) {
        expect(r2.noteMap.lead![i]! - r1.noteMap.lead![i]!).toBe(12)
      }
    }
  })

  it('default octave is 0 (backward compat)', () => {
    const withDefault = generateChordPattern(DEFAULT_PATTERN, CTX, 42)
    const withExplicit = generateChordPattern(DEFAULT_PATTERN, CTX, 42, 'up', 'root', 0.6, 0)
    expect(withDefault.noteMap.lead).toEqual(withExplicit.noteMap.lead)
  })
})

describe('Octave in project persistence', () => {
  const emptyBusState: Record<BusName, BusMixerState> = {
    drum: { gain: 0.85, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
    music: { gain: 0.8, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
    atmos: { gain: 0.7, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
  }
  const emptySong: Song = { name: 'test', segments: [], savedAt: 0 }

  it('createProject includes melodyOctave', () => {
    const project = createProject('test', {
      bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
      pattern: DEFAULT_PATTERN, musicalKey: 9, scaleName: 'phrygianDominant',
      arpeggio: 'up', bassPattern: 'root', density: 0.6, melodyOctave: 2,
      busState: emptyBusState, filterMode: 'off', pumpEnabled: false, evolveEnabled: false, song: emptySong,
    })
    expect(project.melodyOctave).toBe(2)
  })

  it('serialize + deserialize preserves melodyOctave', () => {
    const project = createProject('test', {
      bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
      pattern: DEFAULT_PATTERN, musicalKey: 9, scaleName: 'minor',
      arpeggio: 'down', bassPattern: 'pedal', density: 0.3, melodyOctave: -1,
      busState: emptyBusState, filterMode: 'off', pumpEnabled: false, evolveEnabled: false, song: emptySong,
    })
    const restored = deserializeProject(serializeProject(project))
    expect(restored!.melodyOctave).toBe(-1)
  })

  it('deserialize defaults to 0 for old projects (backward compat)', () => {
    const oldProject = {
      version: '1.0.0', name: 'old', savedAt: 0,
      bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
      pattern: DEFAULT_PATTERN, busState: emptyBusState,
      filterMode: 'off', pumpEnabled: false, evolveEnabled: false, song: emptySong,
    }
    const restored = deserializeProject(JSON.stringify(oldProject))
    expect(restored!.melodyOctave).toBe(0)
  })

  it('all 5 octave values survive save/load', () => {
    for (const oct of [-2, -1, 0, 1, 2]) {
      const project = createProject('test', {
        bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
        pattern: DEFAULT_PATTERN, musicalKey: 9, scaleName: 'minor',
        arpeggio: 'up', bassPattern: 'root', density: 0.6, melodyOctave: oct,
        busState: emptyBusState, filterMode: 'off', pumpEnabled: false, evolveEnabled: false, song: emptySong,
      })
      const restored = deserializeProject(serializeProject(project))
      expect(restored!.melodyOctave).toBe(oct)
    }
  })
})
