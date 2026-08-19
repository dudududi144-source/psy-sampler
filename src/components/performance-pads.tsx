'use client'

// PerformancePads — 3×3 live triggering grid (MPC-style).
//
// Each pad triggers one role's sample immediately via the host event system.
// This is independent of the sequencer — the pads are for LIVE performance:
//   - Fingers/drumsticks can play patterns on top of (or instead of) the grid.
//   - Keyboard shortcuts: 1-9 map to the 9 pads (top-left → bottom-right).
//
// Visual feedback: when a pad fires it flashes its role color for 220ms
// (reusing the NOW_PLAYING_MS window), matching the row-highlight in the
// PatternEditor so the user sees which voices are sounding, even when pads
// are triggered by MIDI, the sequencer, or these pads themselves.
//
// Why this matters: a sampler that can only be driven by a step grid is a
// step-sequencer, not a sampler. Performance pads make this a playable
// instrument — the canonical realization device can be performed live.

import * as React from 'react'
import type { SampleRole } from '@/psy-sampler'
import {
  ROLES,
  ROLE_COLORS,
  ROLE_LABEL,
  NOW_PLAYING_MS,
} from '@/components/types'

export interface PerformancePadsProps {
  /** Called when a pad is pressed. The page publishes a NoteEvent to the host. */
  onTrigger: (role: SampleRole, velocity?: number) => void
  /** The role that most recently sounded (from any source — MIDI, grid, pads). */
  nowPlayingRole: SampleRole | null
  nowPlayingAt: number
  /** Disabled until audio is initialized. */
  disabled?: boolean
}

/**
 * A single pad. Pure presentational component — state is owned by the parent
 * via the nowPlaying timestamp so that ALL trigger sources (pads, MIDI, grid)
 * light the same pad.
 */
function Pad({
  role,
  index,
  onTrigger,
  active,
  disabled,
}: {
  role: SampleRole
  index: number
  onTrigger: (role: SampleRole, velocity: number) => void
  active: boolean
  disabled: boolean
}) {
  const color = ROLE_COLORS[role]
  const label = ROLE_LABEL[role]
  const keyHint = String(index + 1) // 1-9

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(e) => {
        // pointerdown (not click) for lowest latency — performance-critical.
        e.preventDefault()
        if (disabled) return
        // Full-velocity by default; Shift = accent (127), Alt = ghost (50).
        const vel = e.shiftKey ? 127 : e.altKey ? 50 : 100
        onTrigger(role, vel)
      }}
      className={`seq-btn${active ? ' on' : ''} relative flex aspect-square select-none items-center justify-center transition-all duration-75 active:scale-95 disabled:opacity-40 disabled:active:scale-100`}
      style={{
        borderColor: active ? color : 'rgba(255,255,255,0.08)',
        backgroundColor: active
          ? `${color}33`
          : 'rgba(255,255,255,0.02)',
        boxShadow: active
          ? `0 0 24px ${color}66, inset 0 0 16px ${color}22`
          : 'inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
      aria-label={`Trigger ${role} pad, keyboard shortcut ${keyHint}`}
      title={`${role} — key ${keyHint}${disabled ? ' (init first)' : ''}`}
    >
      {/* Color dot — subtle role indicator when idle, bright when active. */}
      <span
        className="absolute left-2 top-2 h-2 w-2 rounded-full transition-opacity"
        style={{
          backgroundColor: color,
          opacity: active ? 1 : 0.4,
        }}
      />
      {/* Key hint — top-right. */}
      <span
        className="absolute right-2 top-1.5 font-mono text-[10px] font-bold"
        style={{ color: active ? color : 'rgba(255,255,255,0.25)' }}
      >
        {keyHint}
      </span>
      {/* Role label — center. */}
      <span
        className="font-mono text-sm font-bold tracking-wider sm:text-base"
        style={{
          color: active ? color : 'rgba(255,255,255,0.7)',
          textShadow: active ? `0 0 12px ${color}` : 'none',
        }}
      >
        {label}
      </span>
    </button>
  )
}

export function PerformancePads({
  onTrigger,
  nowPlayingRole,
  nowPlayingAt,
  disabled = false,
}: PerformancePadsProps) {
  // Re-render when a pad should deactivate (after NOW_PLAYING_MS).
  // Without this the active state would persist until the next unrelated render.
  const [, force] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    if (nowPlayingRole === null) return
    const t = window.setTimeout(force, NOW_PLAYING_MS + 10)
    return () => window.clearTimeout(t)
  }, [nowPlayingRole, nowPlayingAt])

  return (
    <section className="section p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2
          className="stitle font-mono text-xs font-bold tracking-widest"
          style={{ '--c': '#f87171' } as React.CSSProperties}
        >
          PERFORMANCE PADS
        </h2>
        <span className="font-mono text-[10px]" style={{ color: "#5b6470" }} title="Keys 1-9 trigger pads. Shift = accent (127), Alt = ghost (50).">
          KEYS 1-9 · SHIFT=ACC · ALT=GHOST
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {ROLES.map((role, i) => {
          const active =
            nowPlayingRole === role &&
            nowPlayingAt > 0 &&
            Date.now() - nowPlayingAt < NOW_PLAYING_MS
          return (
            <Pad
              key={role}
              role={role}
              index={i}
              onTrigger={onTrigger}
              active={active}
              disabled={disabled}
            />
          )
        })}
      </div>
    </section>
  )
}
