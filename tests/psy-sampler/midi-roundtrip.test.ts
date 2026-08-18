// MIDI export + import round-trip tests.
//
// Verifies:
//   1. exportMidiFile produces a valid MIDI file (starts with MThd)
//   2. The exported file has the correct format (0), tracks (1), division
//   3. importMidiFile can parse the exported file
//   4. Round-trip preserves pattern data (export → import → same pattern)
//   5. Invalid input returns null

import { describe, it, expect } from 'bun:test'
import { exportMidiFile } from '../../src/lib/midi-export'
import { importMidiFile } from '../../src/lib/midi-import'
import { DEFAULT_PATTERN } from '../../src/lib/demo-director'
import type { Pattern } from '../../src/lib/demo-director'

describe('MIDI Export', () => {
  it('produces a Blob', () => {
    const blob = exportMidiFile(DEFAULT_PATTERN, 140, 16)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
  })

  it('starts with MThd header', async () => {
    const blob = exportMidiFile(DEFAULT_PATTERN, 140, 16)
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    expect(bytes[0]).toBe(0x4d) // M
    expect(bytes[1]).toBe(0x54) // T
    expect(bytes[2]).toBe(0x68) // h
    expect(bytes[3]).toBe(0x64) // d
  })

  it('has format 0 and 1 track', async () => {
    const blob = exportMidiFile(DEFAULT_PATTERN, 140, 16)
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    const format = (bytes[8]! << 8) | bytes[9]!
    const nTracks = (bytes[10]! << 8) | bytes[11]!
    expect(format).toBe(0) // format 0
    expect(nTracks).toBe(1) // 1 track
  })

  it('encodes BPM in tempo meta event', async () => {
    const blob = exportMidiFile(DEFAULT_PATTERN, 120, 16)
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    // After MThd(4) + size(4) + format(2) + tracks(2) + division(2) = 14 bytes
    // Then MTrk(4) + size(4) = 8 bytes → offset 22
    // Then delta(1=0) + FF 51 03 + 3 bytes tempo
    expect(bytes[22]).toBe(0x00) // delta = 0
    expect(bytes[23]).toBe(0xFF) // meta event
    expect(bytes[24]).toBe(0x51) // tempo
    expect(bytes[25]).toBe(0x03) // length
    // microseconds per quarter = 60000000 / 120 = 500000
    const mspq = (bytes[26]! << 16) | (bytes[27]! << 8) | bytes[28]!
    expect(mspq).toBe(500000)
  })

  it('larger pattern produces larger file', async () => {
    const blob16 = exportMidiFile(DEFAULT_PATTERN, 140, 16)
    const blob32 = exportMidiFile(DEFAULT_PATTERN, 140, 32)
    expect(blob32.size).toBeGreaterThan(blob16.size)
  })
})

describe('MIDI Import', () => {
  it('returns null for invalid input', () => {
    expect(importMidiFile(new ArrayBuffer(10))).toBeNull()
    expect(importMidiFile(new ArrayBuffer(0))).toBeNull()
  })

  it('returns null for non-MIDI data', () => {
    const fake = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    expect(importMidiFile(fake.buffer)).toBeNull()
  })
})

describe('MIDI Round-Trip (export → import)', () => {
  it('can import an exported file', async () => {
    const blob = exportMidiFile(DEFAULT_PATTERN, 140, 16)
    const buf = await blob.arrayBuffer()
    const result = importMidiFile(buf)
    expect(result).not.toBeNull()
    expect(result!.bpm).toBe(140)
    expect(result!.stepCount).toBeGreaterThanOrEqual(8)
    expect(result!.stepCount).toBeLessThanOrEqual(32)
    expect(result!.notesImported).toBeGreaterThan(0)
  })

  it('preserves kick 4-on-floor after round-trip', async () => {
    const pattern = structuredClone(DEFAULT_PATTERN)
    const blob = exportMidiFile(pattern, 140, 16)
    const buf = await blob.arrayBuffer()
    const result = importMidiFile(buf)
    expect(result).not.toBeNull()
    // Kick should have notes at steps 0, 4, 8, 12 (4-on-floor).
    const kick = result!.pattern.kick
    expect(kick[0]).toBeGreaterThan(0)
    expect(kick[4]).toBeGreaterThan(0)
    expect(kick[8]).toBeGreaterThan(0)
    expect(kick[12]).toBeGreaterThan(0)
  })

  it('preserves velocity values', async () => {
    const pattern: Pattern = structuredClone(DEFAULT_PATTERN)
    // Set a specific velocity at step 0.
    pattern.kick[0] = 127
    const blob = exportMidiFile(pattern, 140, 16)
    const buf = await blob.arrayBuffer()
    const result = importMidiFile(buf)
    expect(result).not.toBeNull()
    // The imported velocity should be close to 127 (may be clamped).
    expect(result!.pattern.kick[0]).toBeGreaterThanOrEqual(120)
  })

  it('preserves BPM', async () => {
    for (const bpm of [100, 120, 140, 160, 180]) {
      const blob = exportMidiFile(DEFAULT_PATTERN, bpm, 16)
      const buf = await blob.arrayBuffer()
      const result = importMidiFile(buf)
      expect(result!.bpm).toBe(bpm)
    }
  })

  it('round-trips a randomized pattern', async () => {
    const pattern = structuredClone(DEFAULT_PATTERN)
    // Set some notes.
    pattern.bass[0] = 80
    pattern.bass[4] = 100
    pattern['hat-closed']![2] = 70
    pattern.lead[8] = 90
    pattern.clap[4] = 110

    const blob = exportMidiFile(pattern, 145, 16)
    const buf = await blob.arrayBuffer()
    const result = importMidiFile(buf)
    expect(result).not.toBeNull()
    // The imported pattern should have notes at the same steps.
    expect(result!.pattern.bass[0]).toBeGreaterThan(0)
    expect(result!.pattern.bass[4]).toBeGreaterThan(0)
    expect(result!.pattern['hat-closed']![2]).toBeGreaterThan(0)
    expect(result!.pattern.lead[8]).toBeGreaterThan(0)
    expect(result!.pattern.clap[4]).toBeGreaterThan(0)
  })
})
