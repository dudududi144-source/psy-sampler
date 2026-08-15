'use client'

// Keyboard shortcuts hook for the PSY Sampler UI.
//
// Shortcuts:
//   Space          → play/stop
//   Escape         → stop
//   Ctrl+Z         → undo
//   Ctrl+Shift+Z   → redo (or Ctrl+Y)
//   T              → tap tempo
//   ?              → toggle help overlay
//   M              → mute drum bus (toggle)
//   S              → solo drum bus (toggle)
//   C              → clear current pattern
//   V              → cycle visualizer mode (bars→wave→both)
//   F              → cycle master filter (off→lp→hp)
//   P              → toggle sidechain pump
//   E              → toggle evolve
//   R              → toggle record (live capture)
//   1/2/3          → set pattern length (8/16/32)

import * as React from 'react'

export interface KeyboardShortcutsOptions {
  onTogglePlay: () => void
  onStop: () => void
  onUndo?: () => void
  onRedo?: () => void
  onTapTempo?: () => void
  onToggleHelp?: () => void
  onToggleMute?: () => void
  onToggleSolo?: () => void
  onClearPattern?: () => void
  onCycleVisualizer?: () => void
  onCycleFilter?: () => void
  onTogglePump?: () => void
  onToggleEvolve?: () => void
  onToggleRecord?: () => void
  onSetStepCount?: (steps: number) => void
  enabled?: boolean
}

export function useKeyboardShortcuts(opts: KeyboardShortcutsOptions): void {
  const {
    onTogglePlay, onStop, onUndo, onRedo, onTapTempo, onToggleHelp,
    onToggleMute, onToggleSolo, onClearPattern, onCycleVisualizer,
    onCycleFilter, onTogglePump, onToggleEvolve, onToggleRecord,
    onSetStepCount, enabled = true,
  } = opts

  React.useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return
      if (target.getAttribute('role') === 'slider') return

      // Ctrl/Cmd shortcuts (undo/redo).
      if (e.ctrlKey || e.metaKey) {
        if (e.code === 'KeyZ') {
          e.preventDefault()
          if (e.shiftKey) onRedo?.()
          else onUndo?.()
          return
        }
        if (e.code === 'KeyY') {
          e.preventDefault()
          onRedo?.()
          return
        }
        return
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          onTogglePlay()
          break
        case 'Escape':
          e.preventDefault()
          onStop()
          break
        case 'KeyT':
          if (onTapTempo) { e.preventDefault(); onTapTempo() }
          break
        case 'Slash':
          if (e.shiftKey && onToggleHelp) { e.preventDefault(); onToggleHelp() }
          break
        case 'KeyM':
          if (onToggleMute) { e.preventDefault(); onToggleMute() }
          break
        case 'KeyS':
          if (onToggleSolo) { e.preventDefault(); onToggleSolo() }
          break
        case 'KeyC':
          if (onClearPattern) { e.preventDefault(); onClearPattern() }
          break
        case 'KeyV':
          if (onCycleVisualizer) { e.preventDefault(); onCycleVisualizer() }
          break
        case 'KeyF':
          if (onCycleFilter) { e.preventDefault(); onCycleFilter() }
          break
        case 'KeyP':
          if (onTogglePump) { e.preventDefault(); onTogglePump() }
          break
        case 'KeyE':
          if (onToggleEvolve) { e.preventDefault(); onToggleEvolve() }
          break
        case 'KeyR':
          if (onToggleRecord) { e.preventDefault(); onToggleRecord() }
          break
        case 'Digit1':
          if (onSetStepCount) { e.preventDefault(); onSetStepCount(8) }
          break
        case 'Digit2':
          if (onSetStepCount) { e.preventDefault(); onSetStepCount(16) }
          break
        case 'Digit3':
          if (onSetStepCount) { e.preventDefault(); onSetStepCount(32) }
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    onTogglePlay, onStop, onUndo, onRedo, onTapTempo, onToggleHelp,
    onToggleMute, onToggleSolo, onClearPattern, onCycleVisualizer,
    onCycleFilter, onTogglePump, onToggleEvolve, onToggleRecord,
    onSetStepCount, enabled,
  ])
}
