'use client'

// Keyboard shortcuts hook for the PSY Sampler UI.
//
// Shortcuts:
//   Space       → play/stop
//   Escape      → stop

import * as React from 'react'

export interface KeyboardShortcutsOptions {
  onTogglePlay: () => void
  onStop: () => void
  enabled?: boolean
}

export function useKeyboardShortcuts(opts: KeyboardShortcutsOptions): void {
  const { onTogglePlay, onStop, enabled = true } = opts

  React.useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent): void => {
      // Don't intercept if user is typing in an input/select/textarea
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
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
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onTogglePlay, onStop, enabled])
}
