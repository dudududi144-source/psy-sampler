'use client'

// useMidiLearn — MIDI CC → parameter mapping (Phase 5.1).
//
// This hook provides the "MIDI learn" functionality that every commercial
// sampler has: right-click a knob → "MIDI learn" → twist a hardware knob →
// the knob is now mapped to that MIDI CC. Future CC messages from that
// controller update the knob's value automatically.
//
// Architecture:
//   - learningParam: which paramId is currently being learned (null = idle)
//   - ccToParam: Map<CC, paramId> — forward mapping (CC → param)
//   - paramToSetter: Map<paramId, (value: number) => void> — registered setters
//   - handleCC(controller, value): called by useMidiInput's onCC callback
//     - If learningParam is set → map CC to paramId, clear learning
//     - Else → find paramId for CC, call registered setter with scaled value
//
// Persistence:
//   - ccToParam mappings saved to localStorage on every change
//   - Loaded on mount — mappings survive page reloads
//
// Usage in page.tsx:
//   const midi = useMidiLearn()
//   // Pass to useMidiInput:
//   useMidiInput({ onCC: midi.handleCC, ... })
//   // Register setters for each knob:
//   midi.registerSetter('drum.gain', (v) => onBusGain('drum', v))
//   // Pass to PsyKnob:
//   <PsyKnob onLearn={() => midi.startLearn('drum.gain')} learning={midi.learningParam === 'drum.gain'} />

import * as React from 'react'

const STORAGE_KEY = 'psy-sampler:midi-mappings'

/** A mapping from MIDI CC number to a parameter ID. */
export type MidiMapping = Record<number, string>  // CC → paramId

export interface UseMidiLearnResult {
  /** The paramId currently being learned (null = idle). */
  learningParam: string | null
  /** All CC→param mappings (for display / debugging). */
  mappings: MidiMapping
  /** True if a learn is in progress. */
  isLearning: boolean
  /** Start learning mode for a parameter. Next CC received maps to it. */
  startLearn: (paramId: string) => void
  /** Cancel the current learn (no mapping created). */
  cancelLearn: () => void
  /** Register a setter for a paramId. Called when a mapped CC is received. */
  registerSetter: (paramId: string, setter: (value: number) => void) => void
  /** Unregister a setter (called on unmount). */
  unregisterSetter: (paramId: string) => void
  /** Handle a MIDI CC message. Route to the mapped setter or complete a learn. */
  handleCC: (controller: number, value: number) => void
  /** Clear all mappings (reset). */
  clearAllMappings: () => void
  /** Remove a single mapping by CC number. */
  removeMapping: (cc: number) => void
}

export function useMidiLearn(): UseMidiLearnResult {
  const [learningParam, setLearningParam] = React.useState<string | null>(null)
  // Lazy initializer: load from localStorage on first render (avoids the
  // setState-in-effect lint rule — this is the recommended pattern for
  // initializing state from a side-effect source).
  const [mappings, setMappings] = React.useState<MidiMapping>(() => {
    if (typeof localStorage === 'undefined') return {}
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as MidiMapping
        if (parsed && typeof parsed === 'object') {
          return parsed
        }
      }
    } catch (err) {
      console.warn('[psy-sampler] Failed to load MIDI mappings:', err)
    }
    return {}
  })

  // Setters are stored in a ref (not state) to avoid re-renders on registration.
  const settersRef = React.useRef<Map<string, (value: number) => void>>(new Map())
  // learningParam also in a ref so handleCC (which is a stable callback) can
  // read the latest value without re-creating on every change.
  const learningRef = React.useRef<string | null>(null)

  // Persist mappings to localStorage whenever they change.
  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings))
    } catch (err) {
      console.warn('[psy-sampler] Failed to save MIDI mappings:', err)
    }
  }, [mappings])

  // Keep learningRef in sync with learningParam state.
  React.useEffect(() => {
    learningRef.current = learningParam
  }, [learningParam])

  const startLearn = React.useCallback((paramId: string) => {
    setLearningParam(paramId)
    learningRef.current = paramId
  }, [])

  const cancelLearn = React.useCallback(() => {
    setLearningParam(null)
    learningRef.current = null
  }, [])

  const registerSetter = React.useCallback((paramId: string, setter: (value: number) => void) => {
    settersRef.current.set(paramId, setter)
  }, [])

  const unregisterSetter = React.useCallback((paramId: string) => {
    settersRef.current.delete(paramId)
  }, [])

  const handleCC = React.useCallback((controller: number, value: number) => {
    // Normalize MIDI value (0..127) to 0..1 for knob ranges.
    const normalized = value / 127

    // If we're in learn mode, map this CC to the learning paramId.
    const currentLearning = learningRef.current
    if (currentLearning) {
      setMappings((prev) => {
        // Remove any existing mapping for this CC (overwrite).
        const next = { ...prev }
        // Also remove any existing CC that was mapped to this paramId
        // (a param can only be mapped to one CC at a time).
        for (const [cc, param] of Object.entries(next)) {
          if (param === currentLearning) {
            delete next[parseInt(cc, 10)]
          }
        }
        next[controller] = currentLearning
        return next
      })
      setLearningParam(null)
      learningRef.current = null
      return
    }

    // Not learning — route the CC to the mapped setter.
    const paramId = mappings[controller]
    if (!paramId) return
    const setter = settersRef.current.get(paramId)
    if (setter) {
      setter(normalized)
    }
  }, [mappings])

  const clearAllMappings = React.useCallback(() => {
    setMappings({})
    setLearningParam(null)
    learningRef.current = null
  }, [])

  const removeMapping = React.useCallback((cc: number) => {
    setMappings((prev) => {
      const next = { ...prev }
      delete next[cc]
      return next
    })
  }, [])

  return {
    learningParam,
    mappings,
    isLearning: learningParam !== null,
    startLearn,
    cancelLearn,
    registerSetter,
    unregisterSetter,
    handleCC,
    clearAllMappings,
    removeMapping,
  }
}
