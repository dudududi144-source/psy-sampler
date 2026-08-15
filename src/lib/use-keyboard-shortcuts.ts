'use client'

// Keyboard shortcuts hook for the PSY Sampler UI.
//
// Shortcuts:
//   Space          → play/stop
//   Escape         → stop
//   Ctrl+Z         → undo
//   Ctrl+Shift+Z   → redo (or Ctrl+Y)
//   T              → tap tempo

import * as React from 'react'

export interface KeyboardShortcutsOptions {
  onTogglePlay: () => void
  onStop: () => void
  onUndo?: () => void
  onRedo?: () => void
  onTapTempo?: () => void
  onToggleHelp?: () => void
  enabled?: boolean
}

export function useKeyboardShortcuts(opts: KeyboardShortcutsOptions): void {
  const { onTogglePlay, onStop, onUndo, onRedo, onTapTempo, onToggleHelp, enabled = true } = opts

  React.useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent): void => {
      // Don't intercept if user is typing in an input/select/textarea
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
        return
      }
      // Don't intercept if user is interacting with a slider (role="slider").
      if (target.getAttribute('role') === 'slider') {
        return
      }

      // Undo/redo work with Ctrl/Cmd modifier.
      if (e.ctrlKey || e.metaKey) {
        if (e.code === 'KeyZ') {
          e.preventDefault()
          if (e.shiftKey) {
            onRedo?.()
          } else {
            onUndo?.()
          }
          return
        }
        if (e.code === 'KeyY') {
          e.preventDefault()
          onRedo?.()
          return
        }
        // Don't fall through to other shortcuts when Ctrl/Cmd is held.
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
          if (onTapTempo) {
            e.preventDefault()
            onTapTempo()
          }
          break
        case 'Slash':
          // Shift+/ = ? → toggle help overlay
          if (e.shiftKey && onToggleHelp) {
            e.preventDefault()
            onToggleHelp()
          }
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onTogglePlay, onStop, onUndo, onRedo, onTapTempo, onToggleHelp, enabled])
}
