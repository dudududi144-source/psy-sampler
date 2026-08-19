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
//   1-9            → trigger performance pads (top-left → bottom-right)
//   D              → generate chord-aware bass/lead (scale + key from context)
//   A              → cycle arpeggio pattern (up→down→upDown→downUp→random→chordal)
//   B              → cycle bass pattern (root→walking→octave→pedal→arp)
//   H              → humanize velocities (add groove via random variation)
//   Q              → quantize velocities (snap to standard tiers)

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
  onPadTrigger?: (index: number) => void
  onGenerateChords?: () => void
  onCycleArpeggio?: () => void
  onCycleBass?: () => void
  onHumanize?: () => void
  onQuantize?: () => void
  onRandomize?: () => void
  onToggleMetronome?: () => void
  enabled?: boolean
}

export function useKeyboardShortcuts(opts: KeyboardShortcutsOptions): void {
  const {
    onTogglePlay, onStop, onUndo, onRedo, onTapTempo, onToggleHelp,
    onToggleMute, onToggleSolo, onClearPattern, onCycleVisualizer,
    onCycleFilter, onTogglePump, onToggleEvolve, onToggleRecord,
    onPadTrigger, onGenerateChords, onCycleArpeggio, onCycleBass, onHumanize,
    onQuantize, onRandomize, onToggleMetronome, enabled = true,
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
        case 'Digit2':
        case 'Digit3':
        case 'Digit4':
        case 'Digit5':
        case 'Digit6':
        case 'Digit7':
        case 'Digit8':
        case 'Digit9':
          if (onPadTrigger) {
            e.preventDefault()
            onPadTrigger(parseInt(e.code.replace('Digit', ''), 10) - 1)
          }
          break
        case 'KeyD':
          if (onGenerateChords) { e.preventDefault(); onGenerateChords() }
          break
        case 'KeyA':
          if (onCycleArpeggio) { e.preventDefault(); onCycleArpeggio() }
          break
        case 'KeyB':
          if (onCycleBass) { e.preventDefault(); onCycleBass() }
          break
        case 'KeyH':
          if (onHumanize) { e.preventDefault(); onHumanize() }
          break
        case 'KeyQ':
          if (onQuantize) { e.preventDefault(); onQuantize() }
          break
        case 'KeyX':
          if (onRandomize) { e.preventDefault(); onRandomize() }
          break
        case 'KeyN':
          if (onToggleMetronome) { e.preventDefault(); onToggleMetronome() }
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    onTogglePlay, onStop, onUndo, onRedo, onTapTempo, onToggleHelp,
    onToggleMute, onToggleSolo, onClearPattern, onCycleVisualizer,
    onCycleFilter, onTogglePump, onToggleEvolve, onToggleRecord,
    onPadTrigger, onGenerateChords, onCycleArpeggio, onCycleBass, onHumanize,
    onQuantize, onRandomize, onToggleMetronome, enabled,
  ])
}
