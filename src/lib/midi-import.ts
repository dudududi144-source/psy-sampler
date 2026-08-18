// MIDI import — parse a Standard MIDI File (.mid) into a Pattern.
//
// This is the reverse of midi-export.ts. It reads a .mid file, extracts
// Note On/Off events, and converts them to the Pattern format (velocity
// per role per step). This lets a producer import a MIDI sequence from
// a DAW and continue editing in the PSY Sampler.
//
// The parser handles:
//   - Format 0 (single track) and Format 1 (multiple tracks)
//   - Variable-length delta times
//   - Tempo meta events (for BPM extraction)
//   - Note On (0x90-0x9F) with velocity > 0
//   - Note Off (0x80-0x8F) or Note On with velocity 0
//
// Channel → role mapping uses the same convention as export:
//   0 = kick, 1 = bass, 2 = lead, 3 = hat-closed, 4 = hat-open,
//   5 = clap, 6 = perc, 7 = texture, 8 = fx

import type { Pattern } from './demo-director'
import type { SampleRole } from '@/psy-sampler'

const CHANNEL_TO_ROLE: SampleRole[] = [
  'kick', 'bass', 'lead', 'hat-closed', 'hat-open', 'clap', 'perc', 'texture', 'fx',
]

/** Parse a variable-length value from a MIDI byte stream. Returns [value, bytesRead]. */
function parseVarLen(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0
  let bytesRead = 0
  while (offset + bytesRead < bytes.length) {
    const b = bytes[offset + bytesRead]!
    bytesRead++
    value = (value << 7) | (b & 0x7f)
    if ((b & 0x80) === 0) break
  }
  return [value, bytesRead]
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0
}

export interface MidiImportResult {
  pattern: Pattern
  bpm: number
  stepCount: number
  notesImported: number
}

/**
 * Parse a Standard MIDI File and convert it to a Pattern.
 * @param arrayBuffer The raw .mid file bytes.
 * @param defaultStepCount Pattern length (8/16/32). Default 16.
 * @returns Pattern + BPM + note count.
 */
export function importMidiFile(
  arrayBuffer: ArrayBuffer,
  defaultStepCount: number = 16
): MidiImportResult | null {
  const bytes = new Uint8Array(arrayBuffer)
  if (bytes.length < 14) return null

  // Parse header chunk.
  if (bytes[0] !== 0x4d || bytes[1] !== 0x54 || bytes[2] !== 0x68 || bytes[3] !== 0x64) {
    return null // Not a MIDI file (no "MThd")
  }
  const headerSize = readUint32(bytes, 4)
  const format = readUint16(bytes, 8)
  const nTracks = readUint16(bytes, 10)
  const division = readUint16(bytes, 12)
  const ticksPerQuarter = division & 0x7fff

  let offset = 8 + headerSize // skip header chunk
  let bpm = 140 // default
  let totalTicks = 0

  // Collect all note events across all tracks.
  const noteEvents: Array<{ tick: number; channel: number; note: number; velocity: number; isOn: boolean }> = []

  for (let track = 0; track < nTracks && offset < bytes.length; track++) {
    // Find track chunk (MTrk).
    while (offset < bytes.length - 8) {
      if (bytes[offset] === 0x4d && bytes[offset + 1] === 0x54 && bytes[offset + 2] === 0x72 && bytes[offset + 3] === 0x6b) {
        break // Found "MTrk"
      }
      offset++
    }
    if (offset >= bytes.length - 8) break

    const trackLength = readUint32(bytes, offset + 4)
    offset += 8 // skip MTrk + length
    const trackEnd = offset + trackLength

    let tick = 0
    let runningStatus = 0

    while (offset < trackEnd && offset < bytes.length) {
      // Parse delta time.
      const [delta, deltaBytes] = parseVarLen(bytes, offset)
      offset += deltaBytes
      tick += delta
      totalTicks = Math.max(totalTicks, tick)

      // Parse event.
      let statusByte = bytes[offset]!
      if (statusByte < 0x80) {
        // Running status: use previous status byte.
        statusByte = runningStatus
      } else {
        offset++
        runningStatus = statusByte
      }

      const eventType = statusByte & 0xf0
      const channel = statusByte & 0x0f

      if (eventType === 0x90) {
        // Note On
        const note = bytes[offset]!
        const velocity = bytes[offset + 1]!
        offset += 2
        if (velocity > 0) {
          noteEvents.push({ tick, channel, note, velocity, isOn: true })
        } else {
          // velocity 0 = note off
          noteEvents.push({ tick, channel, note, velocity: 0, isOn: false })
        }
      } else if (eventType === 0x80) {
        // Note Off
        const note = bytes[offset]!
        const velocity = bytes[offset + 1]!
        offset += 2
        noteEvents.push({ tick, channel, note, velocity, isOn: false })
      } else if (eventType === 0xc0) {
        // Program change
        offset += 1
      } else if (eventType === 0xb0) {
        // Control change
        offset += 2
      } else if (eventType === 0xe0) {
        // Pitch bend
        offset += 2
      } else if (statusByte === 0xff) {
        // Meta event
        const metaType = bytes[offset]!
        const [metaLen, metaLenBytes] = parseVarLen(bytes, offset + 1)
        offset += 1 + metaLenBytes

        if (metaType === 0x51 && metaLen === 3) {
          // Tempo: microseconds per quarter note
          const mspq = (bytes[offset]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset + 2]!
          bpm = Math.round(60000000 / mspq)
        }
        offset += metaLen

        if (metaType === 0x2f) {
          // End of track
          break
        }
      } else {
        // Unknown event — skip 1 byte to avoid infinite loop
        offset += 1
      }
    }
  }

  if (noteEvents.length === 0) return null

  // Determine step count from the total ticks.
  // Each step = ticksPerQuarter / 4 (16th note).
  const ticksPerStep = Math.max(1, Math.floor(ticksPerQuarter / 4))
  const calculatedSteps = Math.ceil(totalTicks / ticksPerStep)
  // Use the closest power of 2 from {8, 16, 32}.
  let stepCount = defaultStepCount
  if (calculatedSteps > 24) stepCount = 32
  else if (calculatedSteps > 12) stepCount = 16
  else stepCount = 8

  // Build empty pattern.
  const pattern: Pattern = {} as Pattern
  for (const role of CHANNEL_TO_ROLE) {
    pattern[role] = new Array(stepCount).fill(0)
  }

  // Place note-on events into steps.
  let notesImported = 0
  for (const ev of noteEvents) {
    if (!ev.isOn) continue
    if (ev.channel >= CHANNEL_TO_ROLE.length) continue

    const role = CHANNEL_TO_ROLE[ev.channel]!
    const step = Math.floor(ev.tick / ticksPerStep)
    if (step >= 0 && step < stepCount) {
      // If multiple notes land on the same step, keep the loudest.
      const existing = pattern[role]![step]!
      if (ev.velocity > existing) {
        pattern[role]![step] = Math.max(1, Math.min(127, ev.velocity))
        notesImported++
      }
    }
  }

  return { pattern, bpm, stepCount, notesImported }
}

/** Read a .mid file from a File object and parse it. */
export function readMidiFile(file: File): Promise<MidiImportResult | null> {
  return file.arrayBuffer().then((buf) => importMidiFile(buf))
}
