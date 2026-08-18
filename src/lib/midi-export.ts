// MIDI export — export the pattern as a Standard MIDI File (.mid).
//
// This is the #1 competitive gap vs PSY6 ULTIMATE and PsySynthPro.
// Both export .mid files. Now we do too.
//
// The MIDI file format:
//   - Header chunk (MThd): format 0, ntracks, division (ticks per quarter)
//   - Track chunk (MTrk): sequence of events with delta-time
//
// We export as format 0 (single track) with all 9 roles on channels 0-8.
// Each step becomes a Note On + Note Off pair. Velocity = pattern value (0-127).
// BPM is encoded in the tempo meta event.

import type { Pattern, NoteMap } from './demo-director'
import { ROLE_NOTES, STEPS } from './demo-director'

/** MIDI file header */
function writeVarLen(value: number): number[] {
  const bytes: number[] = []
  let buffer = value & 0x7f
  value >>= 7
  while (value > 0) {
    buffer <<= 8
    buffer |= (value & 0x7f) | 0x80
    value >>= 7
  }
  while (true) {
    bytes.push(buffer & 0xff)
    if ((buffer & 0x80) !== 0) buffer >>= 8
    else break
  }
  return bytes
}

function uint32(val: number): number[] {
  return [(val >> 24) & 0xff, (val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff]
}

function uint16(val: number): number[] {
  return [(val >> 8) & 0xff, val & 0xff]
}

/**
 * Export a Pattern as a Standard MIDI File (format 0, single track).
 * @param pattern The 9×N velocity pattern.
 * @param bpm Tempo in beats per minute.
 * @param stepCount Number of steps (8/16/32).
 * @param noteMap Optional per-step pitch overrides. When present, the exported
 *   MIDI uses the override pitch instead of ROLE_NOTES — so a chord-progression
 *   arpeggio exports with its actual melody, not a fixed pitch per role.
 * @returns Blob for download as .mid
 */
export function exportMidiFile(pattern: Pattern, bpm: number, stepCount: number = STEPS, noteMap?: NoteMap): Blob {
  const ticksPerQuarter = 96 // standard resolution
  const ticksPerStep = ticksPerQuarter / 4 // 16th notes
  const roles = Object.keys(pattern) as Array<keyof Pattern>

  // Build track data.
  const trackData: number[] = []

  // Tempo meta event (set BPM).
  const microsecondsPerQuarter = Math.round(60000000 / bpm)
  trackData.push(0x00) // delta = 0
  trackData.push(0xFF, 0x51, 0x03) // tempo meta
  trackData.push((microsecondsPerQuarter >> 16) & 0xff)
  trackData.push((microsecondsPerQuarter >> 8) & 0xff)
  trackData.push(microsecondsPerQuarter & 0xff)

  // Program change for each role (channel 0-8, program = role index).
  for (let ch = 0; ch < roles.length; ch++) {
    trackData.push(0x00) // delta = 0
    trackData.push(0xC0 | ch, ch) // program change
  }

  // For each step, collect all notes that fire.
  const secPerStep = 60 / bpm / 4
  // We use ticks for timing. Each step = ticksPerStep ticks.
  for (let step = 0; step < stepCount; step++) {
    const stepStartTick = step * ticksPerStep
    const noteOns: Array<{ channel: number; note: number; velocity: number }> = []
    const noteOffs: Array<{ channel: number; note: number }> = []

    for (let roleIdx = 0; roleIdx < roles.length; roleIdx++) {
      const role = roles[roleIdx]
      const velocity = pattern[role]?.[step] ?? 0
      if (velocity <= 0) continue
      const note = ROLE_NOTES[role] ?? 60
      noteOns.push({ channel: roleIdx, note, velocity })
      noteOffs.push({ channel: roleIdx, note })
    }

    // Sort by channel for deterministic output.
    noteOns.sort((a, b) => a.channel - b.channel)
    noteOffs.sort((a, b) => a.channel - b.channel)

    // Emit Note On events at step start.
    let prevTick = step === 0 ? 0 : (step - 1) * ticksPerStep + ticksPerStep // end of previous step
    if (step === 0) prevTick = 0
    // Actually: delta = stepStartTick - lastEventTick
    // For simplicity, emit all note-ons at stepStartTick with delta from previous event.
    // We track the last event tick.
  }

  // Simpler approach: build a list of (tick, event) pairs, sort, then convert to deltas.
  const events: Array<{ tick: number; data: number[] }> = []

  // Tempo at tick 0.
  events.push({
    tick: 0,
    data: [0xFF, 0x51, 0x03,
      (microsecondsPerQuarter >> 16) & 0xff,
      (microsecondsPerQuarter >> 8) & 0xff,
      microsecondsPerQuarter & 0xff],
  })

  // Program changes at tick 0.
  for (let ch = 0; ch < roles.length; ch++) {
    events.push({ tick: 0, data: [0xC0 | ch, ch] })
  }

  // Note events.
  for (let step = 0; step < stepCount; step++) {
    const startTick = step * ticksPerStep
    const duration = Math.max(1, Math.floor(ticksPerStep * 0.9)) // 90% of step

    for (let roleIdx = 0; roleIdx < roles.length; roleIdx++) {
      const role = roles[roleIdx]
      const velocity = pattern[role]?.[step] ?? 0
      if (velocity <= 0) continue
      // Pitch: use the NoteMap override if present, else ROLE_NOTES.
      // This makes the exported MIDI carry the actual chord-progression
      // arpeggio melody, not a fixed pitch per role.
      const note = noteMap?.[role]?.[step] ?? ROLE_NOTES[role] ?? 60

      // Note On
      events.push({
        tick: startTick,
        data: [0x90 | roleIdx, note, Math.max(1, Math.min(127, velocity))],
      })
      // Note Off
      events.push({
        tick: startTick + duration,
        data: [0x80 | roleIdx, note, 0],
      })
    }
  }

  // End of track.
  events.push({ tick: stepCount * ticksPerStep, data: [0xFF, 0x2F, 0x00] })

  // Sort by tick (stable for same-tick events).
  events.sort((a, b) => a.tick - b.tick)

  // Convert to delta-time + event bytes.
  let lastTick = 0
  for (const ev of events) {
    const delta = ev.tick - lastTick
    trackData.length = 0 // clear (we rebuild below)
    break // We'll build differently
  }

  // Rebuild trackData from sorted events.
  const finalTrack: number[] = []
  lastTick = 0
  for (const ev of events) {
    const delta = ev.tick - lastTick
    finalTrack.push(...writeVarLen(delta))
    finalTrack.push(...ev.data)
    lastTick = ev.tick
  }

  // Build the MIDI file.
  const header = [
    0x4D, 0x54, 0x68, 0x64, // "MThd"
    ...uint32(6), // header size
    ...uint16(0), // format 0 (single track)
    ...uint16(1), // 1 track
    ...uint16(ticksPerQuarter), // division
  ]

  const trackHeader = [
    0x4D, 0x54, 0x72, 0x6B, // "MTrk"
    ...uint32(finalTrack.length),
  ]

  const midiBytes = new Uint8Array([...header, ...trackHeader, ...finalTrack])
  return new Blob([midiBytes], { type: 'audio/midi' })
}

/** Trigger a download of the MIDI file. */
export function downloadMidiFile(pattern: Pattern, bpm: number, stepCount?: number, noteMap?: NoteMap, filename?: string): void {
  const blob = exportMidiFile(pattern, bpm, stepCount, noteMap)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || `psy-sampler-${bpm}bpm-${Date.now()}.mid`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
