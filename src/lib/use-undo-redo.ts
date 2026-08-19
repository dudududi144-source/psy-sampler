'use client'

// useUndoRedo — generic undo/redo stack for any serializable state.
//
// Keeps a bounded history of past states. undo() moves backward, redo() moves
// forward. The history is capped at MAX_HISTORY entries to avoid unbounded
// memory growth.
//
// Usage:
//   const { state, set, undo, redo, canUndo, canRedo } = useUndoRedo(initialValue)
//   set(newValue)      // pushes the current state onto the undo stack, sets new
//   undo()             // pops undo stack, pushes current to redo stack
//   redo()             // pops redo stack, pushes current to undo stack
//
// Coalescing: rapid consecutive sets to the same value are NOT pushed (dedup).
// This prevents the undo stack from filling with no-op entries when React
// double-invokes state updaters in StrictMode.

import * as React from 'react'

const MAX_HISTORY = 50

export interface UndoRedo<T> {
  state: T
  set: (next: T) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  /** Clear the history (e.g. after loading a new pattern). */
  reset: (next: T) => void
}

export function useUndoRedo<T>(initial: T): UndoRedo<T> {
  // Keep the ENTIRE history + current state in a single state object.
  // This avoids the "call setState from within setState updater" problem and
  // makes canUndo/canRedo reactive for free (they're derived from state).
  const [hist, setHist] = React.useState<{
    current: T
    undo: T[]
    redo: T[]
  }>({ current: initial, undo: [], redo: [] })

  const set = React.useCallback((next: T) => {
    setHist((prev) => {
      // Dedup: don't push if the value is identical (deep equality via JSON).
      if (JSON.stringify(prev.current) === JSON.stringify(next)) return prev
      const undo = [...prev.undo, prev.current].slice(-MAX_HISTORY)
      return { current: next, undo, redo: [] }
    })
  }, [])

  const undo = React.useCallback(() => {
    setHist((prev) => {
      if (prev.undo.length === 0) return prev
      const past = prev.undo[prev.undo.length - 1]!
      return {
        current: past,
        undo: prev.undo.slice(0, -1),
        redo: [...prev.redo, prev.current],
      }
    })
  }, [])

  const redo = React.useCallback(() => {
    setHist((prev) => {
      if (prev.redo.length === 0) return prev
      const future = prev.redo[prev.redo.length - 1]!
      return {
        current: future,
        undo: [...prev.undo, prev.current],
        redo: prev.redo.slice(0, -1),
      }
    })
  }, [])

  const reset = React.useCallback((next: T) => {
    setHist({ current: next, undo: [], redo: [] })
  }, [])

  return {
    state: hist.current,
    set,
    undo,
    redo,
    canUndo: hist.undo.length > 0,
    canRedo: hist.redo.length > 0,
    reset,
  }
}
