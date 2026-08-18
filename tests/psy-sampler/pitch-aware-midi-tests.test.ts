// Pitch-aware MIDI export/import round-trip tests.
//
// Verifies that the NoteMap (per-step pitch override) survives the MIDI
// round-trip: export → import → same pitches. This is the critical test that
// proves a chord-progression arpeggio exported to a DAW and re-imported
// preserves its melody, not just its rhythm.

import { describe, it, expect } from 'bun:test'
import { exportMidiFile } from '../../src/lib/midi-export'
import { importMidiFile } from '../../src/lib/midi-import'
import { DEFAULT_PATTERN, ROLE_NOTES } from '../../src/lib/demo-director'
import type { Pattern, NoteMap } from '../../src/lib/demo-director'
import {
  createProject,
  serializeProject,
  deserializeProject,
} from '../../src/lib/project-persistence'
import type { BusMixerState } from '../../src/components/types'
import type { Song } from '../../src/lib/song-persistence'
import type { BusName } from '../../src/psy-sampler'

// ─── Pitch-aware MIDI export ──────────────────────────────────────────────────

describe('Pitch-aware MIDI export', () => {
  it('export without noteMap uses ROLE_NOTES (backward compat)', async () => {
    // No noteMap → falls back to ROLE_NOTES for every role.
    const blob = exportMidiFile(DEFAULT_PATTERN, 140, 16)
    const buf = await blob.arrayBuffer()
    const result = importMidiFile(buf)
    expect(result).not.toBeNull()
    // The imported kick pitch at step 0 should be ROLE_NOTES.kick.
    expect(result!.noteMap.kick![0]).toBe(ROLE_NOTES.kick)
  })

  it('export with noteMap uses the override pitch', async () => {
    const pattern: Pattern = structuredClone(DEFAULT_PATTERN)
    const noteMap: NoteMap = {
      bass: [55, null, null, null, 50, null, null, null, 55, null, null, null, 50, null, null, null],
    }
    const blob = exportMidiFile(pattern, 140, 16, noteMap)
    const buf = await blob.arrayBuffer()
    const result = importMidiFile(buf)
    expect(result).not.toBeNull()
    // The imported bass pitch at step 0 should be 55 (the override), not ROLE_NOTES.bass (33).
    expect(result!.noteMap.bass![0]).toBe(55)
    expect(result!.noteMap.bass![4]).toBe(50)
  })

  it('export with null cells falls back to ROLE_NOTES', async () => {
    const pattern: Pattern = structuredClone(DEFAULT_PATTERN)
    // Lead active at step 0 (override=72) and step 4 (null → ROLE_NOTES).
    pattern.lead[0] = 100
    pattern.lead[4] = 100
    const noteMap: NoteMap = { lead: [72, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null] }
    const blob = exportMidiFile(pattern, 140, 16, noteMap)
    const buf = await blob.arrayBuffer()
    const result = importMidiFile(buf)
    expect(result).not.toBeNull()
    expect(result!.noteMap.lead![0]).toBe(72) // override
    // Step 4: null in noteMap → falls back to ROLE_NOTES.lead (69).
    expect(result!.noteMap.lead![4]).toBe(ROLE_NOTES.lead)
  })

  it('export with chord-progression arpeggio preserves the melody', async () => {
    // Simulate a chord-progression lead arpeggio: root, 3rd, 5th, octave.
    const pattern: Pattern = structuredClone(DEFAULT_PATTERN)
    pattern.lead[0] = 100
    pattern.lead[2] = 100
    pattern.lead[4] = 100
    pattern.lead[6] = 100
    const noteMap: NoteMap = { lead: [69, null, 72, null, 76, null, 81, null, null, null, null, null, null, null, null, null] }
    const blob = exportMidiFile(pattern, 140, 16, noteMap)
    const buf = await blob.arrayBuffer()
    const result = importMidiFile(buf)
    expect(result).not.toBeNull()
    // The arpeggio pitches should survive the round-trip.
    expect(result!.noteMap.lead![0]).toBe(69) // root
    expect(result!.noteMap.lead![2]).toBe(72) // 3rd
    expect(result!.noteMap.lead![4]).toBe(76) // 5th
    expect(result!.noteMap.lead![6]).toBe(81) // octave
  })
})

// ─── Pitch-aware MIDI import ──────────────────────────────────────────────────

describe('Pitch-aware MIDI import', () => {
  it('import populates the noteMap with actual pitches', async () => {
    // Export a pattern with a known pitch override, then import and verify.
    const pattern: Pattern = structuredClone(DEFAULT_PATTERN)
    const noteMap: NoteMap = { bass: [45, null, null, null, 47, null, null, null, 50, null, null, null, 52, null, null, null] }
    const blob = exportMidiFile(pattern, 140, 16, noteMap)
    const buf = await blob.arrayBuffer()
    const result = importMidiFile(buf)
    expect(result).not.toBeNull()
    expect(result!.noteMap).toBeDefined()
    expect(result!.noteMap.bass).toBeDefined()
    // The pitches should match the original noteMap.
    expect(result!.noteMap.bass![0]).toBe(45)
    expect(result!.noteMap.bass![4]).toBe(47)
    expect(result!.noteMap.bass![8]).toBe(50)
    expect(result!.noteMap.bass![12]).toBe(52)
  })

  it('import noteMap is null on silent steps', async () => {
    const pattern: Pattern = structuredClone(DEFAULT_PATTERN)
    const noteMap: NoteMap = { lead: [69, null, 72, null, null, null, null, null, null, null, null, null, null, null, null, null] }
    const blob = exportMidiFile(pattern, 140, 16, noteMap)
    const buf = await blob.arrayBuffer()
    const result = importMidiFile(buf)
    expect(result).not.toBeNull()
    // Step 1 is silent (no note-on) → noteMap should be null.
    expect(result!.noteMap.lead![1]).toBeNull()
    expect(result!.noteMap.lead![3]).toBeNull()
  })

  it('import noteMap has all 9 roles initialized', async () => {
    const blob = exportMidiFile(DEFAULT_PATTERN, 140, 16)
    const buf = await blob.arrayBuffer()
    const result = importMidiFile(buf)
    expect(result).not.toBeNull()
    // Every role should have a noteMap array (even if mostly null).
    for (const role of ['kick', 'bass', 'lead', 'hat-closed', 'hat-open', 'clap', 'perc', 'texture', 'fx'] as const) {
      expect(result!.noteMap[role]).toBeDefined()
      expect(result!.noteMap[role]!.length).toBe(result!.stepCount)
    }
  })
})

// ─── Full pitch-aware round-trip ─────────────────────────────────────────────

describe('Full pitch-aware round-trip (export → import → same pitches)', () => {
  it('chord-progression arpeggio survives the round-trip', async () => {
    // A realistic chord-progression lead: root, 3rd, 5th, octave across 4 chords.
    const pattern: Pattern = structuredClone(DEFAULT_PATTERN)
    pattern.lead[0] = 90; pattern.lead[2] = 90; pattern.lead[4] = 90; pattern.lead[6] = 90
    pattern.lead[8] = 80; pattern.lead[10] = 80; pattern.lead[12] = 80; pattern.lead[14] = 80
    const noteMap: NoteMap = {
      lead: [69, null, 72, null, 76, null, 81, null, 67, null, 70, null, 74, null, 79, null],
    }
    const blob = exportMidiFile(pattern, 145, 16, noteMap)
    const buf = await blob.arrayBuffer()
    const result = importMidiFile(buf)
    expect(result).not.toBeNull()
    // Every active lead step should have the correct pitch.
    const expected = [69, 72, 76, 81, 67, 70, 74, 79]
    const stepIndices = [0, 2, 4, 6, 8, 10, 12, 14]
    for (let i = 0; i < expected.length; i++) {
      expect(result!.noteMap.lead![stepIndices[i]!]).toBe(expected[i])
    }
  })

  it('bass chord roots survive the round-trip', async () => {
    const pattern: Pattern = structuredClone(DEFAULT_PATTERN)
    // Bass on downbeats with chord-root pitches.
    pattern.bass[0] = 100; pattern.bass[4] = 100; pattern.bass[8] = 100; pattern.bass[12] = 100
    const noteMap: NoteMap = {
      bass: [45, null, null, null, 50, null, null, null, 43, null, null, null, 48, null, null, null],
    }
    const blob = exportMidiFile(pattern, 140, 16, noteMap)
    const buf = await blob.arrayBuffer()
    const result = importMidiFile(buf)
    expect(result).not.toBeNull()
    expect(result!.noteMap.bass![0]).toBe(45)
    expect(result!.noteMap.bass![4]).toBe(50)
    expect(result!.noteMap.bass![8]).toBe(43)
    expect(result!.noteMap.bass![12]).toBe(48)
  })
})

// ─── Project persistence with NoteMap ────────────────────────────────────────

describe('Project persistence with NoteMap', () => {
  const emptyBusState: Record<BusName, BusMixerState> = {
    drum: { gain: 0.85, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
    music: { gain: 0.8, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
    atmos: { gain: 0.7, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
  }
  const emptySong: Song = { name: 'test', segments: [], savedAt: 0 }

  it('createProject includes the noteMap', () => {
    const noteMap: NoteMap = { lead: [69, null, 72, null] }
    const project = createProject('test', {
      bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
      pattern: DEFAULT_PATTERN, noteMap, busState: emptyBusState,
      filterMode: 'off', pumpEnabled: false, evolveEnabled: false, song: emptySong,
    })
    expect(project.noteMap).toEqual(noteMap)
  })

  it('serialize + deserialize preserves the noteMap', () => {
    const noteMap: NoteMap = {
      bass: [45, null, 50, null],
      lead: [69, 72, 76, 81],
    }
    const project = createProject('test', {
      bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
      pattern: DEFAULT_PATTERN, noteMap, busState: emptyBusState,
      filterMode: 'off', pumpEnabled: false, evolveEnabled: false, song: emptySong,
    })
    const json = serializeProject(project)
    const restored = deserializeProject(json)
    expect(restored).not.toBeNull()
    expect(restored!.noteMap).toEqual(noteMap)
  })

  it('deserialize falls back to {} for projects without noteMap (backward compat)', () => {
    // A project saved before NoteMap existed has no noteMap field.
    const oldProject = {
      version: '1.0.0', name: 'old', savedAt: 0,
      bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
      pattern: DEFAULT_PATTERN,
      busState: emptyBusState,
      filterMode: 'off', pumpEnabled: false, evolveEnabled: false,
      song: emptySong,
    }
    const json = JSON.stringify(oldProject)
    const restored = deserializeProject(json)
    expect(restored).not.toBeNull()
    expect(restored!.noteMap).toEqual({})
  })

  it('a full chord-progression project survives save/load', () => {
    const noteMap: NoteMap = {
      bass: [45, null, null, null, 45, null, null, null, 43, null, null, null, 48, null, null, null],
      lead: [69, null, 72, null, 76, null, 81, null, 67, null, 70, null, 74, null, 79, null],
      texture: [57, null, null, null, 55, null, null, null, 50, null, null, null, 53, null, null, null],
    }
    const project = createProject('chord-progression', {
      bpm: 145, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
      pattern: DEFAULT_PATTERN, noteMap, busState: emptyBusState,
      filterMode: 'off', pumpEnabled: true, evolveEnabled: false, song: emptySong,
    })
    const json = serializeProject(project)
    const restored = deserializeProject(json)
    expect(restored).not.toBeNull()
    expect(restored!.noteMap).toEqual(noteMap)
    // The pitches are byte-identical.
    expect(restored!.noteMap.lead![0]).toBe(69)
    expect(restored!.noteMap.lead![6]).toBe(81)
    expect(restored!.noteMap.bass![8]).toBe(43)
    expect(restored!.noteMap.texture![12]).toBe(53)
  })
})
