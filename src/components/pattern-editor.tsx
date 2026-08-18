'use client'

// PatternEditor -- 9x16 step grid with per-step velocity (0..127, MIDI standard).
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
import type { Pattern, NoteMap } from '@/lib/demo-director'
import { VEL_ACCENT, VEL_DEFAULT } from '@/lib/demo-director'
import {
  ROLES,
  ROLE_COLORS,
  ROLE_LABEL,
  NOW_PLAYING_MS,
} from '@/components/types'

/** Convert a MIDI note number to a human-readable name (e.g. 45 → "A2", 61 → "C#3"). */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function midiToNoteName(midi: number): string {
  const pc = midi % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[pc]}${octave}`
}

export function PatternEditor({
  pattern,
  currentStep,
  stepCount,
  probabilities,
  onToggle,
  onPaint,
  onStepCountChange,
  onSetProbability,
  onCopyRole,
  onPasteRole,
  onRandomize,
  onChords,
  onHumanize,
  onQuantize,
  onRampUp,
  onRampDown,
  onScaleUp,
  onScaleDown,
  onFillRole,
  onDouble,
  onHalf,
  nowPlayingRole,
  nowPlayingAt,
  onClearPattern,
  noteMap,
}: {
  pattern: Pattern
  currentStep: number
  stepCount: number
  /** Per-step probabilities: {role: {step: 0..1}}. Missing = 1.0 (always). */
  probabilities: Record<string, Record<number, number>>
  /** Per-step pitch overrides (from chord progression). null/absent = ROLE_NOTES. */
  noteMap?: NoteMap
  onToggle: (role: SampleRole, step: number) => void
  /** Paint a cell to an explicit velocity (used by drag-paint). */
  onPaint: (role: SampleRole, step: number, velocity: number) => void
  /** Change pattern length (8/16/32). */
  onStepCountChange?: (steps: number) => void
  /** Set probability for a step (0..1). Called when in probability mode. */
  onSetProbability?: (role: SampleRole, step: number, prob: number) => void
  /** Copy a role's pattern to the clipboard. */
  onCopyRole?: (role: SampleRole) => void
  /** Paste the clipboard into a role. Returns true if paste succeeded. */
  onPasteRole?: (role: SampleRole) => boolean
  /** Randomize the pattern (seeded). */
  onRandomize?: () => void
  /** Generate a chord-aware bass/lead/texture pattern (seeded). */
  onChords?: () => void
  /** Humanize velocities (add groove via random variation). */
  onHumanize?: () => void
  /** Quantize velocities (snap to standard tiers). */
  onQuantize?: () => void
  /** Ramp velocities up (build-up: low→high across pattern). */
  onRampUp?: () => void
  /** Ramp velocities down (breakdown: high→low across pattern). */
  onRampDown?: () => void
  /** Scale velocities up (louder: x1.25). */
  onScaleUp?: () => void
  /** Scale velocities down (softer: x0.75). */
  onScaleDown?: () => void
  /** Fill a single role with a quick pattern. */
  onFillRole?: (role: SampleRole) => void
  /** Double the pattern (8→16 or 16→32). */
  onDouble?: () => void
  /** Half the pattern (32→16 or 16→8). */
  onHalf?: () => void
  nowPlayingRole: SampleRole | null
  nowPlayingAt: number
  onClearPattern: () => void
}) {
  const now = Date.now()
  const fresh = nowPlayingRole !== null && (now - nowPlayingAt) < NOW_PLAYING_MS

  // Edit mode: 'velocity' (default) or 'probability'. In probability mode,
  // clicking a cell cycles its probability: 100% → 75% → 50% → 25% → 100%.
  const [editMode, setEditMode] = React.useState<'velocity' | 'probability'>('velocity')
  // Clipboard for copy/paste between roles. Stores the copied row + which role it came from.
  const [clipboard, setClipboard] = React.useState<{ row: number[]; fromRole: SampleRole } | null>(null)

  const getProb = (role: SampleRole, step: number): number => {
    return probabilities[role]?.[step] ?? 1.0
  }

  const handleCellClick = React.useCallback((role: SampleRole, step: number) => {
    if (editMode === 'probability' && onSetProbability) {
      // Cycle: 100% → 75% → 50% → 25% → 100%
      const current = probabilities[role]?.[step] ?? 1.0
      let next: number
      if (current >= 0.999) next = 0.75
      else if (current > 0.74) next = 0.5
      else if (current > 0.49) next = 0.25
      else next = 1.0
      onSetProbability(role, step, next)
    } else {
      onToggle(role, step)
    }
  }, [editMode, probabilities, onSetProbability, onToggle])

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
    <div className="section p-4" style={{ '--c': '#fbbf24' } as React.CSSProperties}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2
            className="stitle font-mono text-xs font-bold uppercase tracking-[0.2em]"
            style={{ '--c': '#fbbf24' } as React.CSSProperties}
          >
            PATTERN · {stepCount} steps
          </h2>
          <button
            type="button"
            onClick={onClearPattern}
            title="Clear pattern (set all steps off)"
            className="preset touch-manipulation min-h-[28px] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all"
          >
            CLR
          </button>
          {onRandomize && (
            <button
              type="button"
              onClick={onRandomize}
              title="Randomize pattern (X key)"
              className="preset touch-manipulation min-h-[28px] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all"
            >
              RND
            </button>
          )}
          {onChords && (
            <button
              type="button"
              onClick={onChords}
              title="Generate chord-aware bass/lead (D key)"
              className="preset touch-manipulation min-h-[28px] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all"
            >
              CHORDS
            </button>
          )}
        </div>
        {/* Velocity tools — compact group */}
        <div className="flex items-center gap-1">
          {onHumanize && (
            <button
              type="button"
              onClick={onHumanize}
              title="Add groove (H key)"
              className="preset touch-manipulation min-h-[28px] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all"
            >
              HUM
            </button>
          )}
          {onQuantize && (
            <button
              type="button"
              onClick={onQuantize}
              title="Snap to tiers (Q key)"
              className="preset touch-manipulation min-h-[28px] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all"
            >
              QUANT
            </button>
          )}
          {onRampUp && (
            <button
              type="button"
              onClick={onRampUp}
              title="Velocity build-up"
              className="preset touch-manipulation min-h-[28px] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all"
            >
              RAMP UP
            </button>
          )}
          {onRampDown && (
            <button
              type="button"
              onClick={onRampDown}
              title="Velocity breakdown"
              className="preset touch-manipulation min-h-[28px] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all"
            >
              RAMP DOWN
            </button>
          )}
          {onScaleUp && (
            <button
              type="button"
              onClick={onScaleUp}
              title="Scale up -- all velocities x1.25 (louder)"
              className="preset touch-manipulation min-h-[28px] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all"
            >
              SCALE+
            </button>
          )}
          {onScaleDown && (
            <button
              type="button"
              onClick={onScaleDown}
              title="Scale down -- all velocities x0.75 (softer)"
              className="preset touch-manipulation min-h-[28px] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all"
            >
              SCALE-
            </button>
          )}
          {/* Pattern length selector */}
          <div className="flex gap-0.5">
            {([8, 16, 32] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onStepCountChange?.(n)}
                disabled={stepCount === n}
                className="touch-manipulation min-h-[28px] rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-100"
                style={{
                  borderColor: stepCount === n ? '#f472b6' : '#3f3f46',
                  color: stepCount === n ? '#f472b6' : '#71717a',
                  backgroundColor: stepCount === n ? 'rgba(244,114,182,0.1)' : 'transparent',
                }}
                title={`Set pattern length to ${n} steps`}
              >
                {n}
              </button>
            ))}
            {onDouble && (
              <button
                type="button"
                onClick={onDouble}
                disabled={stepCount >= 32}
                className="touch-manipulation min-h-[28px] rounded border border-cyan-400/40 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300 transition-all hover:bg-cyan-500/10 disabled:opacity-30"
                title="Double pattern (8→16 or 16→32, repeating)"
              >
                x2
              </button>
            )}
            {onHalf && (
              <button
                type="button"
                onClick={onHalf}
                disabled={stepCount <= 8}
                className="touch-manipulation min-h-[28px] rounded border border-cyan-400/40 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300 transition-all hover:bg-cyan-500/10 disabled:opacity-30"
                title="Half pattern (32→16 or 16→8, keeping first half)"
              >
                /2
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Edit mode toggle */}
          <button
            type="button"
            onClick={() => setEditMode(editMode === 'velocity' ? 'probability' : 'velocity')}
            className="touch-manipulation min-h-[28px] rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all"
            style={{
              borderColor: editMode === 'probability' ? '#22d3ee' : '#3f3f46',
              color: editMode === 'probability' ? '#22d3ee' : '#71717a',
              backgroundColor: editMode === 'probability' ? 'rgba(34,211,238,0.1)' : 'transparent',
            }}
            title="Toggle edit mode: velocity vs probability"
          >
            PROB
          </button>
          <span className="font-mono text-[10px] text-zinc-500">
            {editMode === 'probability' ? 'click: 100→75→50→25→100%' : 'click: off → vel → accent → off'}
          </span>
        </div>
      </div>

      {/* Step indicator */}
      <div className="mb-2 flex gap-1 pl-12">
        {Array.from({ length: stepCount }).map((_, i) => (
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
      <div className="seq-grid space-y-1">
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
                className="flex w-11 flex-col items-center gap-0.5"
                style={{
                  color,
                  textShadow: isNowPlaying ? `0 0 8px ${color}80` : 'none',
                }}
              >
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider">
                  {ROLE_LABEL[role]}
                </span>
                {/* Copy / Paste buttons */}
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      const row = pattern[role]
                      if (row) {
                        setClipboard({ row: [...row], fromRole: role })
                        onCopyRole?.(role)
                      }
                    }}
                    className="touch-manipulation rounded border border-zinc-700 px-1 font-mono text-[8px] text-zinc-400 hover:bg-zinc-800"
                    title={`Copy ${role} pattern`}
                  >
                    COPY
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (clipboard) {
                        onPasteRole?.(role)
                      }
                    }}
                    disabled={!clipboard}
                    className="touch-manipulation rounded border border-zinc-700 px-1 font-mono text-[8px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
                    title={clipboard ? `Paste from ${clipboard.fromRole}` : 'Nothing copied yet'}
                  >
                    PASTE
                  </button>
                </div>
                {onFillRole && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onFillRole(role) }}
                    className="touch-manipulation rounded border border-zinc-700 px-1 font-mono text-[8px] text-fuchsia-400 hover:bg-fuchsia-500/10"
                    title={`Fill ${role} with a quick pattern`}
                  >
                    FILL
                  </button>
                )}
              </div>
              <div className="flex flex-1 gap-1">
                {pattern[role]?.map((velocity, step) => {
                  const isActive = velocity > 0
                  const isCurrent = step === currentStep
                  const isBeat = step % 4 === 0
                  const isAccent = velocity >= VEL_ACCENT
                  const prob = getProb(role, step)
                  const hasProb = prob < 0.999
                  // Pitch override from the NoteMap (chord progression). When
                  // present, show the note name at the top of the cell so the
                  // user can SEE the melody, not just the velocity rhythm.
                  const pitchOverride = noteMap?.[role]?.[step]
                  const hasPitch = typeof pitchOverride === 'number'
                  // Opacity scales with velocity: 0=0%, 100=79%, 127=100%.
                  // In probability mode, opacity scales with probability instead.
                  const opacity = editMode === 'probability'
                    ? (isActive ? 0.35 + prob * 0.65 : 0.3 + prob * 0.2)
                    : (isActive ? 0.35 + (velocity / 127) * 0.65 : 1)
                  return (
                    <button
                      key={step}
                      onClick={() => handleCellClick(role, step)}
                      onPointerDown={editMode === 'velocity' ? (e) => { e.preventDefault(); startDrag(role, step, e) } : undefined}
                      onPointerEnter={editMode === 'velocity' ? () => continueDrag(role, step) : undefined}
                      onPointerUp={editMode === 'velocity' ? endDrag : undefined}
                      onPointerLeave={editMode === 'velocity' ? endDrag : undefined}
                      aria-label={`${role} step ${step + 1} ${isActive ? `velocity ${velocity}` : 'off'}${hasProb ? ` prob ${Math.round(prob * 100)}%` : ''}`}
                      className={[
                        'relative flex-1 items-center justify-center transition-all hover:brightness-125 touch-manipulation select-none',
                        'seq-btn',
                        isAccent ? 'seq-btn on accent' : isActive ? 'seq-btn on' : '',
                        isCurrent ? 'seq-btn playing' : '',
                      ].filter(Boolean).join(' ')}
                      style={{
                        opacity,
                        ...(editMode === 'probability' ? {
                          backgroundColor: isActive ? color : isBeat ? 'rgba(39,39,42,0.9)' : 'rgba(24,24,27,0.8)',
                        } : {}),
                      }}
                    >
                      {/* Accent marker (velocity mode) */}
                      {isAccent && editMode === 'velocity' && (
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[9px] font-bold text-black/70">
                          !
                        </span>
                      )}
                      {/* Pitch override label (from NoteMap / chord progression).
                          Shows the note name at the top of the cell so the user
                          can see the melody. Only on active cells with a pitch. */}
                      {hasPitch && isActive && (
                        <span
                          className="pointer-events-none absolute top-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[7px] font-bold leading-none text-black/80"
                          title={`Pitch: ${midiToNoteName(pitchOverride)} (override from ROLE_NOTES)`}
                        >
                          {midiToNoteName(pitchOverride)}
                        </span>
                      )}
                      {/* Probability percentage (probability mode) */}
                      {hasProb && editMode === 'probability' && (
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[9px] font-bold text-white">
                          {Math.round(prob * 100)}
                        </span>
                      )}
                      {/* Probability indicator dot (velocity mode, subtle) */}
                      {hasProb && editMode === 'velocity' && (
                        <span
                          className="pointer-events-none absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                          style={{ backgroundColor: '#22d3ee', opacity: 0.8 }}
                        />
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
