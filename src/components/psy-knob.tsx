'use client'

// PSY Knob — React port of PsySynthPro's SVG rotary knob.
//
// This is the signature PSY family control element. Every parameter in the
// hardware synth UI uses this knob — not flat sliders. The knob has:
//
//   - 11 tick marks (every 5th is bold/long) around a 270° arc
//   - Background track (subtle gray arc)
//   - Value arc (colored, glowing with drop-shadow)
//   - 3D metallic cap (radial gradient, multi-layer shadows)
//   - Glowing pointer indicator (colored line)
//   - Full interaction: vertical drag, wheel, double-click reset, keyboard
//
// Accessibility: role="slider", tabindex=0, aria-label/valuenow/valuetext,
// keyboard arrows (Shift = coarse), Enter/Space = reset.
//
// The CSS classes (.kzone, .kcap, .kptr, .klabel, .kval) are defined in
// psy-design.css (copied verbatim from PsySynthPro).

import * as React from 'react'

// ─── Geometry helpers (exact port from PsySynthPro) ─────────────────────────

function polarPt(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) }
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const s = polarPt(cx, cy, r, a0)
  const e = polarPt(cx, cy, r, a1)
  const large = a1 - a0 > 180 ? 1 : 0
  return (
    'M ' + s.x.toFixed(2) + ' ' + s.y.toFixed(2) +
    ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' +
    e.x.toFixed(2) + ' ' + e.y.toFixed(2)
  )
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PsyKnobProps {
  /** Current value. */
  value: number
  /** Minimum value. */
  min: number
  /** Maximum value. */
  max: number
  /** Default value (double-click / Enter resets here). */
  def?: number
  /** Step size for quantization (0 = continuous). */
  step?: number
  /** Use logarithmic scale (good for freq/gain). */
  log?: boolean
  /** Knob size in px (default 64, matrix 54, macros 76). */
  size?: number
  /** Accent color (hex) — drives value arc, pointer, value text glow. */
  color: string
  /** Label below the knob (uppercase, 8px). */
  label: string
  /** Value formatter (e.g. v => `${Math.round(v)} BPM`). */
  fmt?: (v: number) => string
  /** Change callback. */
  onChange: (v: number) => void
  /** Disabled state. */
  disabled?: boolean
  /** Phase 5.1: Called when the user right-clicks to start MIDI learn. */
  onLearn?: () => void
  /** Phase 5.1: True when this knob is in MIDI learn mode (visual indicator). */
  learning?: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PsyKnob({
  value,
  min,
  max,
  def,
  step = 0,
  log = false,
  size = 64,
  color,
  label,
  fmt,
  onChange,
  disabled = false,
  onLearn,
  learning = false,
}: PsyKnobProps) {
  const zoneRef = React.useRef<HTMLDivElement>(null)
  const defaultValue = def ?? (min + max) / 2

  // Normalize value to 0..1 (linear or log).
  const norm = React.useCallback((v: number) => {
    if (log) return Math.log(v / min) / Math.log(max / min)
    return (v - min) / (max - min)
  }, [min, max, log])

  // Convert normalized 0..1 back to value.
  const fromNorm = React.useCallback((p: number) => {
    p = Math.min(1, Math.max(0, p))
    if (log) return min * Math.pow(max / min, p)
    return min + p * (max - min)
  }, [min, max, log])

  // Clamp + quantize + set.
  const set = React.useCallback((v: number) => {
    if (step > 0) v = Math.round(v / step) * step
    v = Math.min(max, Math.max(min, v))
    onChange(v)
  }, [min, max, step, onChange])

  // ─── Interaction state ─────────────────────────────────────────────────────
  const dragState = React.useRef<{ dragging: boolean; startY: number; startP: number }>({
    dragging: false,
    startY: 0,
    startP: 0,
  })

  const handlePointerDown = React.useCallback((e: React.PointerEvent) => {
    if (disabled) return
    dragState.current = { dragging: true, startY: e.clientY, startP: norm(value) }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [norm, value, disabled])

  const handlePointerMove = React.useCallback((e: React.PointerEvent) => {
    if (!dragState.current.dragging) return
    const delta = (dragState.current.startY - e.clientY) / 150
    set(fromNorm(dragState.current.startP + delta))
  }, [set, fromNorm])

  const handlePointerUp = React.useCallback(() => {
    dragState.current.dragging = false
  }, [])

  const handleWheel = React.useCallback((e: React.WheelEvent) => {
    if (disabled) return
    e.preventDefault()
    set(fromNorm(norm(value) + (e.deltaY < 0 ? 0.04 : -0.04)))
  }, [norm, value, set, fromNorm, disabled])

  const handleDoubleClick = React.useCallback(() => {
    if (disabled) return
    set(defaultValue)
  }, [set, defaultValue, disabled])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (disabled) return
    const stepF = e.shiftKey ? 0.1 : 0.03
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault()
      set(fromNorm(norm(value) + stepF))
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault()
      set(fromNorm(norm(value) - stepF))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      set(defaultValue)
    }
  }, [norm, value, set, fromNorm, defaultValue, disabled])

  // ─── Render geometry ──────────────────────────────────────────────────────
  const p = norm(value)
  const a1 = -135 + 270 * p
  const NS = 'http://www.w3.org/2000/svg'
  const TICK_COUNT = 11
  const ticks = Array.from({ length: TICK_COUNT }, (_, i) => {
    const a = -135 + (270 * i) / (TICK_COUNT - 1)
    const p1 = polarPt(50, 50, 47, a)
    const p2 = polarPt(50, 50, 42, a)
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, bold: i % 5 === 0 }
  })
  const trackD = arcPath(50, 50, 34, -135, 135)
  const valueD = a1 <= -133 ? '' : arcPath(50, 50, 34, -135, a1)
  const rotation = -135 + 270 * p
  const displayValue = fmt ? fmt(value) : String(Math.round(value))

  return (
    <div className="kwrap" style={{ opacity: disabled ? 0.4 : 1 }}>
      <div
        ref={zoneRef}
        className="kzone"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuetext={displayValue}
        aria-disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={(e) => {
          if (onLearn && !disabled) {
            e.preventDefault()
            onLearn()
          }
        }}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          touchAction: 'none',
          cursor: disabled ? 'default' : 'ns-resize',
          // Phase 5.1: MIDI learn visual indicator — pulsing glow when learning.
          outline: learning ? `2px solid ${color}` : 'none',
          outlineOffset: learning ? '2px' : '0',
          boxShadow: learning ? `0 0 12px ${color}, 0 0 4px ${color}` : 'none',
          borderRadius: '50%',
        }}
      >
        <svg viewBox="0 0 100 100" width={size} height={size}>
          {/* Tick marks */}
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={t.x1.toFixed(2)} y1={t.y1.toFixed(2)}
              x2={t.x2.toFixed(2)} y2={t.y2.toFixed(2)}
              stroke={t.bold ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.14)'}
              strokeWidth={t.bold ? 2 : 1}
            />
          ))}
          {/* Background track */}
          <path
            d={trackD}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={5}
            fill="none"
            strokeLinecap="round"
          />
          {/* Value arc (colored + glowing) */}
          <path
            d={valueD}
            stroke={color}
            strokeWidth={5}
            fill="none"
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 3px ${color})` }}
          />
        </svg>
        {/* Physical cap (3D metal) */}
        <div
          className="kcap"
          style={{
            ['--c' as string]: color,
            ['--rot' as string]: `${rotation}deg`,
          } as React.CSSProperties}
        >
          <div className="kptr" />
        </div>
      </div>
      {/* Label */}
      <div className="klabel">{label}</div>
      {/* Value readout */}
      <div className="kval" style={{ color }}>
        {displayValue}
      </div>
    </div>
  )
}
