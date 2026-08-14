'use client'

// PatternEditor — 9×16 step grid with per-step velocity (0..127, MIDI standard).
//
// Each cell shows its velocity via:
//   - Opacity (0 = invisible/off, 100 = 79% opacity, 127 = full)
//   - A tiny velocity number inside accent cells (≥110)
//   - Border glow proportional to velocity
//
// Interaction:
//   - Click cycles: 0 (off) → 100 (default) → 127 (accent) → 0 (off).
//   - Drag-paint: mousedown on a cell + drag across cells paints them with
//     the same velocity (the velocity of the first cell). This is the standard
//     DAW pattern-editor UX — much faster than clicking each cell individually.
//   - Shift+drag paints at accent velocity (127).
//   - Alt/Option+drag erases (sets to 0).

import * as React from 'react'
import type { SampleRole } from '@/psy-sampler'
import type { Pattern } from '@/lib/demo-director'
import { VEL_ACCENT, VEL_DEFAULT } from '@/lib/demo-director'
import {
  ROLES,
  STEPS,
  ROLE_COLORS,
  ROLE_LABEL,
  NOW_PLAYING_MS,
} from '@/components/types'

export function PatternEditor({
  pattern,
  currentStep,
  onToggle,
  onPaint,
  nowPlayingRole,
  nowPlayingAt,
  onClearPattern,
}: {
  pattern: Pattern
  currentStep: number
  onToggle: (role: SampleRole, step: number) => void
  /** Paint a cell to an explicit velocity (used by drag-paint). */
  onPaint: (role: SampleRole, step: number, velocity: number) => void
  nowPlayingRole: SampleRole | null
  nowPlayingAt: number
  onClearPattern: () => void
}) {
  const now = Date.now()
  const fresh = nowPlayingRole !== null && (now - nowPlayingAt) < NOW_PLAYING_MS

  // Drag-paint state: when dragging, we paint cells with the drag velocity.
  const dragState = React.useRef<{ role: SampleRole; velocity: number; painted: Set<string> } | null>(null)

  const startDrag = React.useCallback((role: SampleRole, step: number, e: React.PointerEvent) => {
    // Determine the paint velocity from modifier keys + current cell state.
    const currentVel = pattern[role]?.[step] ?? 0
    let velocity: number
    if (e.altKey) {
      velocity = 0 // erase
    } else if (e.shiftKey) {
      velocity = VEL_ACCENT // accent
    } else if (currentVel > 0) {
      // Paint with the existing velocity (extend the same dynamics).
      velocity = currentVel
    } else {
      velocity = VEL_DEFAULT
    }
    dragState.current = { role, velocity, painted: new Set([`${role}:${step}`]) }
    onPaint(role, step, velocity)
    // Capture the pointer so we get move/up events even outside the cell.
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }, [pattern, onPaint])

  const continueDrag = React.useCallback((role: SampleRole, step: number) => {
    const ds = dragState.current
    if (!ds || ds.role !== role) return
    const key = `${role}:${step}`
    if (ds.painted.has(key)) return // already painted this cell in this drag
    ds.painted.add(key)
    onPaint(role, step, ds.velocity)
  }, [onPaint])

  const endDrag = React.useCallback(() => {
    dragState.current = null
  }, [])

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-fuchsia-300">PATTERN · 16 steps</h2>
          <button
            type="button"
            onClick={onClearPattern}
            title="Clear pattern (set all steps off)"
            className="touch-manipulation min-h-[28px] rounded border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300 transition-all hover:bg-amber-500/20"
          >
            CLR
          </button>
        </div>
        <span className="font-mono text-[10px] text-zinc-500">click: off → vel → accent → off</span>
      </div>

      {/* Step indicator */}
      <div className="mb-2 flex gap-1 pl-12">
        {Array.from({ length: STEPS }).map((_, i) => (
          <div
            key={i}
            className="flex-1 text-center font-mono text-[10px] tabular-nums"
            style={{
              color: i === currentStep ? '#00ffc8' : i % 4 === 0 ? '#71717a' : '#3f3f46',
              textShadow: i === currentStep ? '0 0 8px rgba(0,255,200,0.8)' : 'none',
            }}
          >
            {(i + 1).toString().padStart(2, '0')}
          </div>
        ))}
      </div>

      {/* Role rows */}
      <div className="space-y-1">
        {ROLES.map((role) => {
          const isNowPlaying = fresh && nowPlayingRole === role
          const color = ROLE_COLORS[role]
          return (
            <div
              key={role}
              className="flex items-center gap-1 rounded-sm transition-all"
              style={{
                backgroundColor: isNowPlaying ? `${color}10` : 'transparent',
                boxShadow: isNowPlaying ? `inset 0 0 12px ${color}30` : 'none',
              }}
            >
              <div
                className="w-11 font-mono text-[11px] font-bold uppercase tracking-wider"
                style={{
                  color,
                  textShadow: isNowPlaying ? `0 0 8px ${color}80` : 'none',
                }}
              >
                {ROLE_LABEL[role]}
              </div>
              <div className="flex flex-1 gap-1">
                {pattern[role]?.map((velocity, step) => {
                  const isActive = velocity > 0
                  const isCurrent = step === currentStep
                  const isBeat = step % 4 === 0
                  const isAccent = velocity >= VEL_ACCENT
                  // Opacity scales with velocity: 0=0%, 100=79%, 127=100%.
                  const opacity = isActive ? 0.35 + (velocity / 127) * 0.65 : 1
                  return (
                    <button
                      key={step}
                      onClick={() => onToggle(role, step)}
                      onPointerDown={(e) => { e.preventDefault(); startDrag(role, step, e) }}
                      onPointerEnter={() => continueDrag(role, step)}
                      onPointerUp={endDrag}
                      onPointerLeave={endDrag}
                      aria-label={`${role} step ${step + 1} ${isActive ? `velocity ${velocity}` : 'off'}`}
                      className="relative aspect-square flex-1 min-h-[44px] min-w-[44px] items-center justify-center rounded-sm border transition-all hover:brightness-125 touch-manipulation select-none"
                      style={{
                        backgroundColor: isActive ? color : isBeat ? 'rgba(39,39,42,0.9)' : 'rgba(24,24,27,0.8)',
                        borderColor: isCurrent ? '#00ffc8' : isActive ? color : isBeat ? '#3f3f46' : '#27272a',
                        boxShadow: isActive
                          ? `0 0 ${4 + velocity / 127 * 8}px ${color}80`
                          : isCurrent
                            ? '0 0 8px rgba(0,255,200,0.5)'
                            : 'none',
                        opacity,
                      }}
                    >
                      {isAccent && (
                        <span
                          className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[9px] font-bold text-black/70"
                        >
                          !
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
