'use client'

// use-pattern-ops — encapsulates all pattern-related state + callbacks.
//
// Extracted from src/app/page.tsx (which had ~30 useState + ~59 useCallback
// hooks in a single component). This hook owns:
//   - pattern (with undo/redo history)
//   - stepCount (8/16/32)
//   - probabilities (per-step probability overlay)
//   - noteMap (per-step pitch overrides from chord progression)
//   - lastProgression (current chord progression label/roman)
//   - mutedRoles, soloedRoles (per-row mute/solo)
//
// And exposes 24 callbacks:
//   onStepCountChange, onSetProbability, onToggleStep, onPaintStep,
//   onClearPattern, onRandomizePattern, onFillRole, onGenerateChords,
//   onHumanize, onQuantize, onRampUp, onRampDown, onScaleUp, onScaleDown,
//   onDoublePattern, onHalfPattern, onCopyRole, onPasteRole,
//   onToggleMute, onToggleSolo, onUndo, onRedo, loadPattern, resetPattern.
//
// The hook receives:
//   - directorRef (ref to DemoDirector — the source of truth for scheduling)
//   - arpeggio, bassPattern, density, melodyOctave, bassOctave
//     (chord-progression params; the page owns these as state for UI controls)

import * as React from 'react'
import { useUndoRedo } from '@/lib/use-undo-redo'
import { autosavePattern } from '@/lib/pattern-persistence'
import {
  generateChordPattern,
  type ArpeggioPattern,
  type BassPattern,
} from '@/lib/chord-progression'
import {
  humanizePattern,
  quantizePattern,
  rampPattern,
  scalePattern,
} from '@/lib/humanize'
import {
  DEFAULT_PATTERN,
  type Pattern,
  type NoteMap,
  type DemoDirector,
} from '@/lib/demo-director'
import type { SampleRole } from '@/psy-sampler'
import { useToast } from '@/hooks/use-toast'

export interface UsePatternOpsOptions {
  directorRef: React.MutableRefObject<DemoDirector | null>
  arpeggio: ArpeggioPattern
  bassPattern: BassPattern
  density: number
  melodyOctave: number
  bassOctave: number
}

export function usePatternOps(opts: UsePatternOpsOptions) {
  const { directorRef, arpeggio, bassPattern, density, melodyOctave, bassOctave } = opts
  const { toast } = useToast()

  // ─── Pattern state with undo/redo history ────────────────────────────────
  const {
    state: pattern,
    set: setPatternWithHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    reset: resetPatternHistory,
  } = useUndoRedo<Pattern>(structuredClone(DEFAULT_PATTERN))

  const [stepCount, setStepCount] = React.useState(16)
  const [probabilities, setProbabilities] = React.useState<Record<string, Record<number, number>>>({})
  const [noteMap, setNoteMap] = React.useState<NoteMap>({})
  const [lastProgression, setLastProgression] = React.useState<{ label: string; roman: string } | null>(null)

  // ─── Per-role mute/solo (pattern-level, finer than bus mute) ─────────────
  const [mutedRoles, setMutedRoles] = React.useState<SampleRole[]>([])
  const [soloedRoles, setSoloedRoles] = React.useState<SampleRole[]>([])

  // Clipboard for copy/paste between roles.
  const clipboardRef = React.useRef<{ row: number[]; fromRole: SampleRole } | null>(null)

  // ─── Step count + probability ─────────────────────────────────────────────
  const onStepCountChange = React.useCallback((newSteps: number) => {
    const director = directorRef.current
    if (!director) return
    director.setStepCount(newSteps)
    setStepCount(newSteps)
    const newPattern = structuredClone(director.getPattern())
    setPatternWithHistory(newPattern)
    autosavePattern(newPattern)  // autosave logs internally on failure
  }, [directorRef, setPatternWithHistory])

  const onSetProbability = React.useCallback((role: SampleRole, step: number, prob: number) => {
    const director = directorRef.current
    if (!director) return
    director.setProbability(role, step, prob)
    setProbabilities(director.getAllProbabilities())
  }, [directorRef])

  // ─── Per-row mute/solo ────────────────────────────────────────────────────
  const onToggleMute = React.useCallback((role: SampleRole) => {
    const director = directorRef.current
    if (!director) return
    const next = !director.isRoleMuted(role)
    director.setRoleMuted(role, next)
    setMutedRoles(director.getMutedRoles())
  }, [directorRef])

  const onToggleSolo = React.useCallback((role: SampleRole) => {
    const director = directorRef.current
    if (!director) return
    const next = !director.isRoleSoloed(role)
    director.setRoleSoloed(role, next)
    setSoloedRoles(director.getSoloedRoles())
  }, [directorRef])

  // ─── Copy/paste between roles ────────────────────────────────────────────
  const onCopyRole = React.useCallback((role: SampleRole) => {
    const director = directorRef.current
    if (!director) return
    const row = director.getPattern()[role]
    if (row) {
      clipboardRef.current = { row: [...row], fromRole: role }
      toast({ title: `Copied ${role}`, description: `${row.length} steps` })
    }
  }, [directorRef, toast])

  const onPasteRole = React.useCallback((role: SampleRole): boolean => {
    const director = directorRef.current
    if (!director || !clipboardRef.current) return false
    const { row } = clipboardRef.current
    const targetRow = director.getPattern()[role]
    if (!targetRow) return false
    const newPattern = structuredClone(pattern)
    const targetLen = targetRow.length
    for (let i = 0; i < targetLen; i++) {
      newPattern[role]![i] = row[i] ?? 0
    }
    director.setPattern(newPattern)
    setPatternWithHistory(newPattern)
    autosavePattern(newPattern)  // autosave logs internally on failure
    toast({ title: `Pasted to ${role}`, description: `From ${clipboardRef.current.fromRole}` })
    return true
  }, [directorRef, pattern, setPatternWithHistory, toast])

  // ─── Toggle / paint cells ─────────────────────────────────────────────────
  const onToggleStep = React.useCallback((role: SampleRole, step: number) => {
    const director = directorRef.current
    if (!director) return
    const newPattern = structuredClone(pattern)
    const row = newPattern[role]
    if (!row) return
    const current = row[step] ?? 0
    if (current === 0) row[step] = 100
    else if (current < 127) row[step] = 127
    else row[step] = 0
    director.setPattern(newPattern)
    setPatternWithHistory(newPattern)
    autosavePattern(newPattern)  // autosave logs internally on failure
  }, [directorRef, pattern, setPatternWithHistory])

  const onPaintStep = React.useCallback((role: SampleRole, step: number, velocity: number) => {
    const director = directorRef.current
    if (!director) return
    const newPattern = structuredClone(pattern)
    const row = newPattern[role]
    if (!row) return
    row[step] = Math.max(0, Math.min(127, Math.round(velocity)))
    director.setPattern(newPattern)
    setPatternWithHistory(newPattern)
    autosavePattern(newPattern)  // autosave logs internally on failure
  }, [directorRef, pattern, setPatternWithHistory])

  // ─── Pattern-level operations ────────────────────────────────────────────
  const onClearPattern = React.useCallback(() => {
    const empty = structuredClone(DEFAULT_PATTERN)
    directorRef.current?.setPattern(empty)
    directorRef.current?.clearNoteMap()
    setNoteMap({})
    setLastProgression(null)
    setPatternWithHistory(empty)
    autosavePattern(empty)  // autosave logs internally on failure
  }, [directorRef, setPatternWithHistory])

  const onRandomizePattern = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    director.randomizePattern()
    director.clearNoteMap()
    setNoteMap({})
    setLastProgression(null)
    const result = structuredClone(director.getPattern())
    setPatternWithHistory(result)
    autosavePattern(result)  // autosave logs internally on failure
    toast({ title: 'Pattern randomized' })
  }, [directorRef, setPatternWithHistory, toast])

  const onFillRole = React.useCallback((role: SampleRole) => {
    const director = directorRef.current
    if (!director) return
    director.fillRole(role)
    director.clearNoteMap()
    setNoteMap({})
    setLastProgression(null)
    const result = structuredClone(director.getPattern())
    setPatternWithHistory(result)
    autosavePattern(result)  // autosave logs internally on failure
    toast({ title: `Filled ${role}`, description: 'Quick pattern generated for this role' })
  }, [directorRef, setPatternWithHistory, toast])

  const onGenerateChords = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const ctx = director.getContext()
    const currentPattern = director.getPattern()
    const seed = Math.floor(Math.random() * 1000000)
    const { pattern: newPattern, noteMap: newNoteMap, progression } = generateChordPattern(
      currentPattern, ctx, seed, arpeggio, bassPattern, density, melodyOctave, bassOctave,
    )
    director.setPattern(newPattern)
    director.setNoteMap(newNoteMap)
    setNoteMap(newNoteMap)
    setLastProgression({ label: progression.label, roman: progression.roman })
    setPatternWithHistory(structuredClone(newPattern))
    autosavePattern(newPattern)  // autosave logs internally on failure
    toast({
      title: `Chords: ${progression.label}`,
      description: `${progression.roman} · ${arpeggio} arp · ${bassPattern} bass`,
    })
  }, [directorRef, arpeggio, bassPattern, density, melodyOctave, bassOctave, setPatternWithHistory, toast])

  const onHumanize = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const seed = Math.floor(Math.random() * 1000000)
    const humanized = humanizePattern(pattern, 0.5, seed)
    director.setPattern(humanized)
    setPatternWithHistory(structuredClone(humanized))
    autosavePattern(humanized)  // autosave logs internally on failure
    toast({ title: 'Groove added' })
  }, [directorRef, pattern, setPatternWithHistory, toast])

  const onQuantize = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const quantized = quantizePattern(pattern, 3)
    director.setPattern(quantized)
    setPatternWithHistory(structuredClone(quantized))
    autosavePattern(quantized)  // autosave logs internally on failure
    toast({ title: 'Quantized' })
  }, [directorRef, pattern, setPatternWithHistory, toast])

  const onRampUp = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const ramped = rampPattern(pattern, 'up', 40, 127)
    director.setPattern(ramped)
    setPatternWithHistory(structuredClone(ramped))
    autosavePattern(ramped)  // autosave logs internally on failure
    toast({ title: 'Build-up applied' })
  }, [directorRef, pattern, setPatternWithHistory, toast])

  const onRampDown = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const ramped = rampPattern(pattern, 'down', 40, 127)
    director.setPattern(ramped)
    setPatternWithHistory(structuredClone(ramped))
    autosavePattern(ramped)  // autosave logs internally on failure
    toast({ title: 'Breakdown applied' })
  }, [directorRef, pattern, setPatternWithHistory, toast])

  const onScaleUp = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const scaled = scalePattern(pattern, 1.25)
    director.setPattern(scaled)
    setPatternWithHistory(structuredClone(scaled))
    autosavePattern(scaled)  // autosave logs internally on failure
    toast({ title: 'Louder' })
  }, [directorRef, pattern, setPatternWithHistory, toast])

  const onScaleDown = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const scaled = scalePattern(pattern, 0.75)
    director.setPattern(scaled)
    setPatternWithHistory(structuredClone(scaled))
    autosavePattern(scaled)  // autosave logs internally on failure
    toast({ title: 'Softer' })
  }, [directorRef, pattern, setPatternWithHistory, toast])

  const onDoublePattern = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    if (director.stepCount >= 32) {
      toast({ title: 'Already 32 steps', description: 'Cannot double further' })
      return
    }
    director.doublePattern()
    setStepCount(director.stepCount)
    const result = structuredClone(director.getPattern())
    setPatternWithHistory(result)
    autosavePattern(result)  // autosave logs internally on failure
    toast({ title: `Doubled to ${director.stepCount} steps`, description: 'Pattern repeated' })
  }, [directorRef, setPatternWithHistory, toast])

  const onHalfPattern = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    if (director.stepCount <= 8) {
      toast({ title: 'Already 8 steps', description: 'Cannot halve further' })
      return
    }
    director.halfPattern()
    setStepCount(director.stepCount)
    const result = structuredClone(director.getPattern())
    setPatternWithHistory(result)
    autosavePattern(result)  // autosave logs internally on failure
    toast({ title: `Halved to ${director.stepCount} steps`, description: 'Kept first half' })
  }, [directorRef, setPatternWithHistory, toast])

  // ─── Undo / redo ──────────────────────────────────────────────────────────
  const onUndo = React.useCallback(() => {
    undo()
  }, [undo])

  const onRedo = React.useCallback(() => {
    redo()
  }, [redo])

  // ─── Pattern load (used by preset loading + song mode) ───────────────────
  const loadPattern = React.useCallback((newPattern: Pattern) => {
    const director = directorRef.current
    if (director) {
      director.setPattern(newPattern)
    }
    setPatternWithHistory(newPattern)
    autosavePattern(newPattern)  // autosave logs internally on failure
  }, [directorRef, setPatternWithHistory])

  return {
    // state
    pattern,
    stepCount,
    probabilities,
    noteMap,
    lastProgression,
    mutedRoles,
    soloedRoles,
    canUndo,
    canRedo,
    // setters (for external mutation when needed — e.g. chord progression params)
    setNoteMap,
    setLastProgression,
    setPatternWithHistory,
    resetPatternHistory,
    setStepCount,
    setProbabilities,
    // callbacks
    onStepCountChange,
    onSetProbability,
    onToggleStep,
    onPaintStep,
    onClearPattern,
    onRandomizePattern,
    onFillRole,
    onGenerateChords,
    onHumanize,
    onQuantize,
    onRampUp,
    onRampDown,
    onScaleUp,
    onScaleDown,
    onDoublePattern,
    onHalfPattern,
    onCopyRole,
    onPasteRole,
    onToggleMute,
    onToggleSolo,
    onUndo,
    onRedo,
    loadPattern,
  }
}

export type UsePatternOpsResult = ReturnType<typeof usePatternOps>
