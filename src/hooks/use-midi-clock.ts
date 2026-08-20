'use client'

// useMidiClock — MIDI clock send + receive (Phase 5.2).
//
// MIDI clock is the standard way to sync tempo between hardware devices
// and software. It uses 3 message types:
//
//   0xF8 = Clock pulse (24 per quarter note = 24 PPQ)
//   0xFA = Start (begin playback from position 0)
//   0xFB = Continue (begin playback from current position)
//   0xFC = Stop (halt playback)
//
// SEND mode (master): the sampler generates clock pulses at the current BPM
// and sends them to a selected MIDI output. External hardware (drum machines,
// sequencers) will follow the sampler's tempo.
//
// RECEIVE mode (slave): the sampler listens for clock pulses on a selected
// MIDI input and derives the tempo from the pulse spacing. When Start/Stop
// is received, the sampler's transport follows.
//
// The clock pulse interval = 60 / (BPM * 24) seconds. At 120 BPM, that's
// 60 / (120 * 24) = 20.8ms between pulses.
//
// Browser support: Chrome, Edge (Web MIDI API output). Same limitations as
// useMidiInput — Firefox/Safari need polyfill.

import * as React from 'react'

export type MidiClockMode = 'off' | 'master' | 'slave'

export interface UseMidiClockOptions {
  /** The AudioContext (for timing the clock send). */
  audioContext: AudioContext | null
  /** Current BPM (used in master mode to compute pulse interval). */
  bpm: number
  /** Called when slave mode receives a Start command. */
  onStart?: () => void
  /** Called when slave mode receives a Stop command. */
  onStop?: () => void
  /** Called when slave mode derives a new BPM from pulse spacing. */
  onTempoChange?: (bpm: number) => void
}

export interface UseMidiClockResult {
  /** Current clock mode. */
  mode: MidiClockMode
  /** Set the clock mode (off/master/slave). */
  setMode: (mode: MidiClockMode) => void
  /** Available MIDI output devices (for master mode). */
  outputs: Array<{ id: string; name: string }>
  /** Selected output device ID (for master mode). */
  selectedOutputId: string | null
  /** Select the MIDI output device (for master mode). */
  selectOutput: (id: string | null) => void
  /** True if clock is actively sending/receiving. */
  isActive: boolean
}

export function useMidiClock(opts: UseMidiClockOptions): UseMidiClockResult {
  const { audioContext, bpm, onStart, onStop, onTempoChange } = opts
  const [mode, setModeState] = React.useState<MidiClockMode>('off')
  const [outputs, setOutputs] = React.useState<Array<{ id: string; name: string }>>([])
  const [selectedOutputId, setSelectedOutputId] = React.useState<string | null>(null)
  const [isActive, setIsActive] = React.useState(false)

  // Refs for stable callbacks.
  const handlersRef = React.useRef({ onStart, onStop, onTempoChange })
  React.useEffect(() => {
    handlersRef.current = { onStart, onStop, onTempoChange }
  }, [onStart, onStop, onTempoChange])

  const midiAccessRef = React.useRef<unknown>(null)
  const sendIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const lastPulseTimeRef = React.useRef<number>(0)
  const pulseCountRef = React.useRef<number>(0)
  const inputHandlerRef = React.useRef<((e: { data: Uint8Array }) => void) | null>(null)

  // Request MIDI access on mount (for output listing).
  React.useEffect(() => {
    const nav = navigator as Navigator & { requestMIDIAccess?: (opts?: { sysex: boolean }) => Promise<unknown> }
    if (!nav.requestMIDIAccess) return
    let cancelled = false
    nav.requestMIDIAccess({ sysex: false })
      .then((access: unknown) => {
        if (cancelled) return
        midiAccessRef.current = access
        // Populate outputs list.
        const ma = access as { outputs: Map<string, { id: string; name: string }> }
        const list: Array<{ id: string; name: string }> = []
        ma.outputs.forEach((out) => {
          list.push({ id: out.id, name: out.name || 'Unknown' })
        })
        setOutputs(list)
      })
      .catch(() => {
        // MIDI access denied — clock features just won't work.
      })
    return () => { cancelled = true }
  }, [])

  // ─── MASTER mode: send clock pulses ──────────────────────────────────────
  React.useEffect(() => {
    if (mode !== 'master' || !selectedOutputId || !midiAccessRef.current) {
      if (sendIntervalRef.current !== null) {
        clearInterval(sendIntervalRef.current)
        sendIntervalRef.current = null
      }
      setIsActive(false)
      return
    }

    const ma = midiAccessRef.current as {
      outputs: Map<string, { send: (data: number[] | Uint8Array) => void }>
    }
    const output = ma.outputs.get(selectedOutputId)
    if (!output) {
      setIsActive(false)
      return
    }

    // Compute pulse interval: 60 / (BPM * 24) seconds → ms.
    const pulseIntervalMs = (60 / (bpm * 24)) * 1000

    // Send a Start command (0xFA) before the first pulse.
    try { output.send([0xFA]) } catch { /* ignore */ }
    setIsActive(true)

    // Send clock pulses (0xF8) at the computed interval.
    sendIntervalRef.current = setInterval(() => {
      try { output.send([0xF8]) } catch { /* ignore */ }
    }, pulseIntervalMs)

    return () => {
      // Send Stop command (0xFC) when leaving master mode.
      try { output.send([0xFC]) } catch { /* ignore */ }
      if (sendIntervalRef.current !== null) {
        clearInterval(sendIntervalRef.current)
        sendIntervalRef.current = null
      }
      setIsActive(false)
    }
  }, [mode, selectedOutputId, bpm])

  // ─── SLAVE mode: receive clock pulses + derive tempo ─────────────────────
  React.useEffect(() => {
    if (mode !== 'slave' || !selectedOutputId || !midiAccessRef.current) {
      // Clean up previous input handler.
      if (inputHandlerRef.current && midiAccessRef.current && selectedOutputId) {
        const ma = midiAccessRef.current as {
          inputs: Map<string, { onmidimessage: ((e: { data: Uint8Array }) => void) | null }>
        }
        const input = ma.inputs.get(selectedOutputId)
        if (input) input.onmidimessage = null
        inputHandlerRef.current = null
      }
      setIsActive(false)
      return
    }

    const ma = midiAccessRef.current as {
      inputs: Map<string, { onmidimessage: ((e: { data: Uint8Array }) => void) | null }>
    }
    const input = ma.inputs.get(selectedOutputId)
    if (!input) {
      setIsActive(false)
      return
    }

    setIsActive(true)
    pulseCountRef.current = 0
    lastPulseTimeRef.current = 0

    input.onmidimessage = (e: { data: Uint8Array }) => {
      const [status] = e.data
      if (status === undefined) return

      if (status === 0xF8) {
        // Clock pulse.
        const now = performance.now()
        pulseCountRef.current += 1

        // Derive tempo from pulse spacing (every 24 pulses = 1 quarter note).
        if (lastPulseTimeRef.current > 0) {
          const dt = now - lastPulseTimeRef.current
          // Average over the last 24 pulses for stability.
          if (pulseCountRef.current % 24 === 0) {
            // 24 pulses = 1 quarter note. BPM = 60000 / (24 * dt_avg).
            // We use the last pulse interval as a simple estimate.
            // For more accuracy, we'd average over multiple intervals.
            const estimatedBpm = 60000 / (24 * dt)
            if (estimatedBpm > 30 && estimatedBpm < 300) {
              handlersRef.current.onTempoChange?.(Math.round(estimatedBpm))
            }
          }
        }
        lastPulseTimeRef.current = now
      } else if (status === 0xFA) {
        // Start.
        handlersRef.current.onStart?.()
        pulseCountRef.current = 0
      } else if (status === 0xFB) {
        // Continue.
        handlersRef.current.onStart?.()
      } else if (status === 0xFC) {
        // Stop.
        handlersRef.current.onStop?.()
      }
    }
    inputHandlerRef.current = input.onmidimessage

    return () => {
      if (selectedOutputId && midiAccessRef.current) {
        const ma = midiAccessRef.current as {
          inputs: Map<string, { onmidimessage: ((e: { data: Uint8Array }) => void) | null }>
        }
        const input = ma.inputs.get(selectedOutputId)
        if (input) input.onmidimessage = null
      }
      inputHandlerRef.current = null
      setIsActive(false)
    }
  }, [mode, selectedOutputId])

  const setMode = React.useCallback((m: MidiClockMode) => {
    setModeState(m)
  }, [])

  const selectOutput = React.useCallback((id: string | null) => {
    setSelectedOutputId(id)
  }, [])

  return {
    mode,
    setMode,
    outputs,
    selectedOutputId,
    selectOutput,
    isActive,
  }
}
