'use client'

// PSY CycleButton — React port of PsySynthPro's CycleBtn.
//
// A hardware-style button that cycles through options on click. Used for
// waveform selection, filter modes, octave settings, etc. — anywhere a
// select dropdown would be used in a web UI but a hardware synth uses a
// cycle button.
//
// Features:
//   - Gradient background matching PSY button aesthetic
//   - Colored text with glow (text-shadow)
//   - Click cycles to next option
//   - Label below (same .klabel as knobs)
//
// CSS classes (.cbtn, .cb, .klabel) from psy-design.css.

import * as React from 'react'

export interface PsyCycleButtonProps<T extends string> {
  /** Current selected value. */
  value: T
  /** All options (cycled in order). */
  options: readonly T[]
  /** Display formatter (e.g. v => labels[v] or v => v.toUpperCase()). */
  display: (v: T) => string
  /** Accent color (hex). */
  color: string
  /** Label below the button. */
  label: string
  /** Change callback. */
  onChange: (v: T) => void
  /** Disabled state. */
  disabled?: boolean
}

export function PsyCycleButton<T extends string>({
  value,
  options,
  display,
  color,
  label,
  onChange,
  disabled = false,
}: PsyCycleButtonProps<T>) {
  const handleClick = React.useCallback(() => {
    if (disabled) return
    const idx = options.indexOf(value)
    const next = options[(idx + 1) % options.length]!
    onChange(next)
  }, [options, value, onChange, disabled])

  return (
    <div className="cbtn" style={{ opacity: disabled ? 0.4 : 1 }}>
      <button
        className="cb"
        onClick={handleClick}
        disabled={disabled}
        style={{
          ['--c' as string]: color,
        } as React.CSSProperties}
      >
        {display(value)}
      </button>
      <div className="klabel">{label}</div>
    </div>
  )
}
