'use client'

// useMidiInput — Web MIDI API integration for PSY Sampler.
//
// This is the #1 missing feature for a real production tool. Without MIDI
// input, a producer can't play the sampler from a keyboard — they can only
// click buttons with a mouse. This hook:
//
//   1. Requests MIDI access on mount.
//   2. Lists available MIDI input devices.
//   3. Lets the user select which device to listen to.
//   4. Fires onNoteOn(note, velocity) and onNoteOff(note) callbacks.
//   5. Optionally fires onCC(controller, value) for MIDI CC (knobs/sliders).
//
// The note number is mapped to a role via the roleForNote() function, which
// the caller provides. This lets the producer play kick/bass/lead/etc. from
// a keyboard with each key region mapped to a different instrument.
//
// Browser support: Chrome, Edge, Opera (Web MIDI API). Firefox/Safari need
// a polyfill or flag. We degrade gracefully — if MIDI is unavailable, the
// hook is a no-op and the UI works with mouse only.

import * as React from 'react'

export interface MidiInputOptions {
  /** Called when a note-on is received. note=60..127, velocity=0..1. */
  onNoteOn?: (note: number, velocity: number) => void
  /** Called when a note-off is received. note=60..127. */
  onNoteOff?: (note: number) => void
  /** Called when a CC message is received. controller=0..127, value=0..127. */
  onCC?: (controller: number, value: number) => void
  /** If false, the hook is disabled (no MIDI access requested). */
  enabled?: boolean
}

export interface MidiInputState {
  /** True if Web MIDI API is available in this browser. */
  supported: boolean
  /** True if MIDI access has been granted (user permission). */
  accessGranted: boolean
  /** List of available MIDI input devices. */
  inputs: MidiInputDevice[]
  /** The currently selected input device ID (or null = none). */
  selectedInputId: string | null
  /** The last note received (for UI feedback). */
  lastNote: number | null
  /** The last velocity received (for UI feedback). */
  lastVelocity: number | null
  /** Error message if MIDI access failed. */
  error: string | null
}

export interface MidiInputDevice {
  id: string
  name: string
  manufacturer: string
}

export function useMidiInput(opts: MidiInputOptions): MidiInputState & {
  /** Select an input device by ID. Pass null to disconnect. */
  selectInput: (id: string | null) => void
} {
  const { onNoteOn, onNoteOff, onCC, enabled = true } = opts
  const [supported, setSupported] = React.useState(false)
  const [accessGranted, setAccessGranted] = React.useState(false)
  const [inputs, setInputs] = React.useState<MidiInputDevice[]>([])
  const [selectedInputId, setSelectedInputId] = React.useState<string | null>(null)
  const [lastNote, setLastNote] = React.useState<number | null>(null)
  const [lastVelocity, setLastVelocity] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const midiAccessRef = React.useRef<unknown>(null)
  const handlersRef = React.useRef({ onNoteOn, onNoteOff, onCC })

  // Keep handlers ref updated without re-running the MIDI setup effect.
  React.useEffect(() => {
    handlersRef.current = { onNoteOn, onNoteOff, onCC }
  }, [onNoteOn, onNoteOff, onCC])

  // Request MIDI access on mount.
  React.useEffect(() => {
    if (!enabled) return
    const nav = navigator as Navigator & { requestMIDIAccess?: (opts?: { sysex: boolean }) => Promise<unknown> }
    if (!nav.requestMIDIAccess) {
      queueMicrotask(() => {
        setSupported(false)
        setError('Web MIDI API not supported in this browser. Use Chrome/Edge.')
      })
      return
    }
    queueMicrotask(() => setSupported(true))
    let cancelled = false
    nav.requestMIDIAccess({ sysex: false })
      .then((access: unknown) => {
        if (cancelled) return
        midiAccessRef.current = access
        // Defer state updates to avoid synchronous setState in effect.
        queueMicrotask(() => {
          setAccessGranted(true)
          setError(null)
        })
        // Populate inputs list.
        const refreshInputs = () => {
          const midiAccess = access as { inputs: Map<string, { id: string; name: string; manufacturer: string }> }
          const list: MidiInputDevice[] = []
          midiAccess.inputs.forEach((input) => {
            list.push({ id: input.id, name: input.name || 'Unknown', manufacturer: input.manufacturer || '' })
          })
          setInputs(list)
        }
        refreshInputs()
        // Some browsers fire statechange when devices are connected/disconnected.
        const onChange = () => refreshInputs()
        ;(access as { addEventListener: (type: string, cb: () => void) => void }).addEventListener?.('statechange', onChange)
        return () => {
          ;(access as { removeEventListener: (type: string, cb: () => void) => void }).removeEventListener?.('statechange', onChange)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'MIDI access denied')
      })
    return () => { cancelled = true }
  }, [enabled])

  // Connect to the selected input.
  React.useEffect(() => {
    if (!selectedInputId || !midiAccessRef.current) return
    const midiAccess = midiAccessRef.current as {
      inputs: Map<string, {
        id: string
        onmidimessage: ((e: { data: Uint8Array }) => void) | null
      }>
    }
    const input = midiAccess.inputs.get(selectedInputId)
    if (!input) return

    input.onmidimessage = (e: { data: Uint8Array }) => {
      const [status, data1, data2] = e.data
      if (status === undefined) return
      const command = status & 0xf0 // top 4 bits = command
      // Note On (0x90) with velocity > 0.
      if (command === 0x90 && data2 !== undefined && data2 > 0) {
        const note = data1 ?? 0
        const velocity = data2 / 127
        setLastNote(note)
        setLastVelocity(velocity)
        handlersRef.current.onNoteOn?.(note, velocity)
      }
      // Note Off (0x80) OR Note On with velocity 0 (common for release).
      else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
        const note = data1 ?? 0
        handlersRef.current.onNoteOff?.(note)
      }
      // Control Change (0xB0) — knobs, sliders, mod wheel.
      else if (command === 0xb0) {
        const controller = data1 ?? 0
        const value = data2 ?? 0
        handlersRef.current.onCC?.(controller, value)
      }
    }

    return () => {
      input.onmidimessage = null
    }
  }, [selectedInputId])

  const selectInput = React.useCallback((id: string | null) => {
    setSelectedInputId(id)
  }, [])

  return {
    supported,
    accessGranted,
    inputs,
    selectedInputId,
    lastNote,
    lastVelocity,
    error,
    selectInput,
  }
}

/**
 * Map a MIDI note number to a sample role.
 *
 * Convention (editable by the user in a future version):
 *   C2-B2 (36-59)  → kick (any note triggers kick, pitch ignored)
 *   C3-B3 (60-71)  → bass (pitched — note determines pitch)
 *   C4-B4 (72-83)  → lead (pitched)
 *   C5-B5 (84-95)  → hat-closed
 *   C6-B6 (96-107) → clap
 *   C7+   (108+)   → perc
 *
 * This is a starting point. A real product would let the user customize this
 * mapping (MIDI learn per role).
 */
export function roleForNote(note: number): {
  role: 'kick' | 'bass' | 'lead' | 'hat-closed' | 'clap' | 'perc' | 'hat-open' | 'texture' | 'fx'
  pitched: boolean
} {
  if (note < 60) return { role: 'kick', pitched: false }
  if (note < 72) return { role: 'bass', pitched: true }
  if (note < 84) return { role: 'lead', pitched: true }
  if (note < 96) return { role: 'hat-closed', pitched: false }
  if (note < 108) return { role: 'clap', pitched: false }
  return { role: 'perc', pitched: false }
}
